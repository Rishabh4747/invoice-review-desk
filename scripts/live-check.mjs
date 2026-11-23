import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'

const base = process.argv[2] || 'http://127.0.0.1:8787'
const url = new URL(base)
const origin = url.origin
if (url.protocol === 'https:' && existsSync('.env.demo')) process.loadEnvFile('.env.demo')
const access = new URLSearchParams(url.hash.slice(1)).get('access') || process.env.DEMO_ACCESS_CODE
const workspace = process.env.INVOICE_QA_WORKSPACE || randomUUID()

function request(path, options = {}, space = workspace, code = access) {
  const headers = new Headers(options.headers)
  headers.set('X-Workspace', space)
  if (code) headers.set('Authorization', `Bearer ${code}`)
  const bytes = options.body?.byteLength
  const timeout = bytes > 8 * 1024 * 1024 ? 45000 : 10000
  return fetch(`${origin}/api${path}`, { ...options, headers, signal: AbortSignal.timeout(timeout) }).catch(error => {
    throw new Error(`${options.method ?? 'GET'} /api${path}${bytes ? ` (${bytes} bytes)` : ''} failed before a response`, { cause: error })
  })
}

async function expect(response, status) {
  assert.equal(response.status, status, `Unexpected response: ${response.status} ${await response.clone().text()}`)
  return response.json()
}

async function enqueue(file, filename = file, space = workspace) {
  const bytes = await readFile(new URL(`../public/samples/${file}`, import.meta.url))
  const queued = await expect(await request('/runs', { method: 'POST', headers: {
    'Content-Type': 'application/pdf', 'X-Filename': encodeURIComponent(filename),
  }, body: bytes }, space), 202)
  assert.equal(queued.status, 'queued')
  assert.equal(queued.events[0].stage, 'intake')
  return { queued, bytes, filename, space }
}

async function complete({ queued, bytes, filename, space }) {
  const observed = new Set()
  let elapsed = 0
  while (elapsed < 65000) {
    const start = Date.now()
    const run = await expect(await request(`/runs/${queued.id}`, {}, space), 200)
    observed.add(run.status)
    if (run.status === 'failed') throw new Error(`${filename} processing failed: ${run.error}`)
    if (run.status === 'completed') {
      assert.deepEqual(run.events.map(event => event.stage), ['intake', 'extract', 'validate', 'match', 'decide'])
      assert.ok(run.events.every(event => event.end && event.end >= event.start))
      assert.ok(run.events.slice(1).every((event, index) => event.start >= run.events[index].end))
      const stored = await request(`/runs/${run.id}/pdf`, {}, space)
      assert.equal(stored.status, 200)
      assert.equal(stored.headers.get('content-type'), 'application/pdf')
      assert.equal(stored.headers.get('content-disposition'), 'attachment')
      assert.deepEqual(Buffer.from(await stored.arrayBuffer()), bytes)
      console.log(`${filename}: ${run.outcome} · ${run.model} · observed ${[...observed].join(' → ')}`)
      return run
    }
    await setTimeout(550)
    elapsed += Date.now() - start
  }
  throw new Error(`Timed out waiting for ${filename}`)
}

async function submit(file, expected, reason, filename = file, priorRun) {
  const run = await complete(await enqueue(file, filename))
  assert.equal(run.outcome, expected, JSON.stringify(run.checks))
  const matchingCheck = run.checks.find(check => check.detail.includes(reason))
  assert.ok(matchingCheck, JSON.stringify(run.checks))
  if (priorRun) assert.equal(matchingCheck.priorRun, priorRun)
  return run
}

async function verifyUploadGuards() {
  await expect(await request('/runs', {}, 'invalid-workspace'), 400)
  await expect(await request('/runs', { method: 'POST', body: 'not a PDF' }), 415)
  const headers = { 'Content-Type': 'application/pdf' }
  await expect(await request('/runs', { method: 'POST', headers, body: 'not a PDF' }), 415)
  await expect(await request('/runs', { method: 'POST', headers, body: new Uint8Array(8 * 1024 * 1024 + 1) }), 413)
}

async function verifyConcurrentUploads() {
  const splitSpace = randomUUID()
  const simultaneous = await Promise.all([
    enqueue('03-packaging-first-shipment.pdf', undefined, splitSpace),
    enqueue('04-packaging-second-shipment.pdf', undefined, splitSpace),
  ])
  const splitRuns = await Promise.all(simultaneous.map(complete))
  assert.deepEqual(splitRuns.map(run => run.outcome).sort(), ['blocked', 'ready'])
  const winner = splitRuns.find(run => run.outcome === 'ready')
  const overrun = splitRuns.find(run => run.outcome === 'blocked')
  assert.equal(overrun.orders[0].reserved, winner.total * 100)
  assert.ok(overrun.checks.some(check => check.title === 'PO balance exceeded'))

  const dupSpace = randomUUID()
  const duplicates = await Promise.all([
    enqueue('01-office-supplies.pdf', 'same-a.pdf', dupSpace),
    enqueue('01-office-supplies.pdf', 'same-b.pdf', dupSpace),
  ])
  const duplicateRuns = await Promise.all(duplicates.map(complete))
  assert.deepEqual(duplicateRuns.map(run => run.outcome).sort(), ['blocked', 'ready'])
  const original = duplicateRuns.find(run => run.outcome === 'ready')
  const repeat = duplicateRuns.find(run => run.outcome === 'blocked')
  assert.equal(repeat.checks.find(check => check.title === 'Duplicate submission').priorRun, original.id)
  console.log('Verified concurrent uploads cannot double-reserve a PO or create two ready duplicates.')
}

assert.equal((await expect(await request('/health'), 200)).extractionConfigured, true)
if (url.protocol === 'https:') {
  assert.equal((await request('/health', {}, workspace, 'invalid-code')).status, 401)
  assert.equal((await request('/runs', {}, workspace, '')).status, 401)
}
const previousWorkspaceFlag = process.argv.indexOf('--previous-workspace')
if (previousWorkspaceFlag !== -1) {
  const previous = process.argv[previousWorkspaceFlag + 1]
  const previousRuns = await expect(await request('/runs', {}, previous), 200)
  assert.equal(previousRuns.length, 7)
  const previousReady = previousRuns.find(run => run.outcome === 'ready' && run.filename === '01-office-supplies.pdf')
  assert.ok(previousReady)
  const previousPdf = await request(`/runs/${previousReady.id}/pdf`, {}, previous)
  assert.equal(previousPdf.status, 200)
  assert.deepEqual(Buffer.from(await previousPdf.arrayBuffer()),
    await readFile(new URL('../public/samples/01-office-supplies.pdf', import.meta.url)))
  console.log('Verified previous hosted history and original PDF survived redeployment.')
}
if (process.argv.includes('--http-only')) {
  await verifyUploadGuards()
  assert.deepEqual(await expect(await request('/runs'), 200), [])
  console.log('Verified hosted access and upload guards without sending a PDF to Gemini.')
  process.exit(0)
}
if (process.argv.includes('--concurrency-only')) {
  await verifyConcurrentUploads()
  process.exit(0)
}
assert.deepEqual(await expect(await request('/runs'), 200), [])
console.log(`Testing ${origin} in workspace ${workspace}`)
const first = await submit('01-office-supplies.pdf', 'ready', '$1,540.00 available')
const scan = await submit('02-rescanned-copy.pdf', 'blocked', 'Approved supplier and invoice number', undefined, first.id)
assert.equal(scan.invoiceNumber, first.invoiceNumber)
if (process.argv.includes('--reviewer-check')) {
  assert.equal((await expect(await request('/runs'), 200)).length, 2)
  console.log('Verified reviewer access, both recording samples, their decisions, and saved history in a fresh workspace.')
  process.exit(0)
}
await submit('01-office-supplies.pdf', 'blocked', 'PDF fingerprint', 'renamed-invoice.pdf', first.id)
await submit('03-packaging-first-shipment.pdf', 'ready', '$1,150.00 available')
const split = await submit('04-packaging-second-shipment.pdf', 'blocked', '$450.00 available')
assert.equal(split.orders[0].reserved, 70000)
const ambiguous = await submit('05-missing-po.pdf', 'review', 'PO-3106, PO-3107')
assert.equal(ambiguous.orders.length, 2)
await submit('06-scan-total-mismatch.pdf', 'review', 'give $324.00. Printed total is $342.00')
const history = await expect(await request('/runs'), 200)
assert.equal(history.length, 7)
assert.deepEqual(await expect(await request('/runs', {}, randomUUID()), 200), [])
await expect(await request(`/runs/${first.id}`, {}, randomUUID()), 404)
await expect(await request(`/runs/${first.id}/pdf`, {}, randomUUID()), 404)
await verifyUploadGuards()
assert.equal((await expect(await request('/runs'), 200)).length, 7)

if (process.argv.includes('--concurrency')) await verifyConcurrentUploads()
console.log(`Verified seven live runs, source files, isolated history, and invalid-file handling. QA workspace: ${workspace}`)
