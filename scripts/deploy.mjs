import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

const demoFile = '.env.demo'
if (existsSync('.env.local')) process.loadEnvFile('.env.local')
if (existsSync(demoFile)) process.loadEnvFile(demoFile)
const key = process.env.GEMINI_API_KEY
if (!key) throw new Error('Set GEMINI_API_KEY in .env.local before deploying.')
const access = process.env.DEMO_ACCESS_CODE || randomBytes(24).toString('base64url')
if (!/^[\w-]{24,100}$/.test(access)) throw new Error('Use at least 24 letters, digits, underscores, or hyphens for DEMO_ACCESS_CODE.')
if (!existsSync(demoFile)) await writeFile(demoFile, `DEMO_ACCESS_CODE=${access}\n`, { mode: 0o600, flag: 'wx' })

const upload = resolve(`.env.deploy-${process.pid}`)
await writeFile(upload, JSON.stringify({ GEMINI_API_KEY: key, DEMO_ACCESS_CODE: access }), { mode: 0o600, flag: 'wx' })
try {
  const cli = resolve('node_modules/wrangler/bin/wrangler.js')
  const args = [cli, 'deploy', '--secrets-file', upload]
  if (process.argv.includes('--temporary')) args.push('--temporary')
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }
  delete env.GEMINI_API_KEY
  delete env.DEMO_ACCESS_CODE
  const child = spawn(process.execPath, args, { stdio: ['inherit', 'pipe', 'pipe'], env })
  let output = ''
  for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.setEncoding('utf8').on('data', chunk => {
      const sanitized = chunk.replaceAll(key, '[server secret]')
      output += sanitized
      target.write(sanitized)
    })
  }
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  if (code !== 0) process.exitCode = Number(code) || 1
  else {
    const deployed = output.match(/https:\/\/invoice-review-desk\.[a-z0-9-]+\.workers\.dev\b/i)
    if (deployed) console.log(`Reviewer URL: ${deployed[0]}/#access=${access}`)
  }
} finally {
  await unlink(upload)
}
