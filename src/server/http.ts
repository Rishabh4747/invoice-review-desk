import { timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { maxUpload, model } from '../shared.ts'
import type { RunStore } from './store.ts'

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const runPath = /^\/api\/runs\/([\da-f-]+)(\/pdf)?$/i
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export const uploadTooLarge = () => json({ error: 'Choose a PDF up to 8 MiB.' }, 413)

export function access(request: Request, expected: string | undefined, requireCode: boolean) {
  if (!expected) return requireCode ? json({ error: 'The hosted demo access code has not been configured yet.' }, 503) : null
  const supplied = request.headers.get('Authorization') ?? ''
  const bearer = `Bearer ${expected}`
  if (supplied.length === bearer.length) {
    const left = Buffer.from(supplied)
    const right = Buffer.from(bearer)
    if (left.length === right.length && timingSafeEqual(left, right)) return null
  }
  return json({ error: 'Enter the access code from your reviewer link.' }, 401)
}

export function workspace(request: Request) {
  const id = request.headers.get('X-Workspace') ?? ''
  return uuid.test(id) ? id.toLowerCase() : null
}

export function health(apiKey: string | undefined, backupAvailable = false) {
  return json({ extractionConfigured: Boolean(apiKey) || backupAvailable, model })
}

async function readPdf(request: Request) {
  if (Number(request.headers.get('Content-Length')) > maxUpload) return null
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxUpload) return null
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function filename(request: Request) {
  try {
    return decodeURIComponent(request.headers.get('X-Filename') ?? 'invoice.pdf')
      .replace(/[\\/\p{C}]/gu, '_').trim().slice(0, 150) || 'invoice.pdf'
  } catch {
    return 'invoice.pdf'
  }
}

export async function routeRuns(request: Request, store: RunStore, enqueue: () => Promise<void>) {
  const { pathname } = new URL(request.url)
  if (pathname === '/api/runs' && request.method === 'GET') return json(store.list())
  if (pathname === '/api/runs' && request.method === 'POST') {
    const receivedAt = new Date().toISOString()
    if (request.headers.get('Content-Type')?.split(';')[0].toLowerCase() !== 'application/pdf') {
      return json({ error: 'Choose a PDF document.' }, 415)
    }
    const bytes = await readPdf(request)
    if (!bytes) return uploadTooLarge()
    const signature = new TextDecoder().decode(bytes.subarray(0, 1024))
    if (!/%PDF-\d\.\d/.test(signature)) return json({ error: 'The selected file does not contain a PDF header.' }, 415)
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')
    const run = store.create(filename(request), hash, bytes, receivedAt)
    if (!run) return json({ error: 'This workspace has reached its 40-run limit. Start a new workspace to continue.' }, 429)
    await enqueue()
    return json(run, 202)
  }
  const match = pathname.match(runPath)
  if (match && uuid.test(match[1]) && request.method === 'GET') {
    const run = store.get(match[1])
    if (!run) return json({ error: 'Run not found in this workspace.' }, 404)
    if (match[2]) {
      return new Response(store.pdf(run.id), {
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      })
    }
    return json(run)
  }
  return json({ error: 'API route not found.' }, 404)
}
