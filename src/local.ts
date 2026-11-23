import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { finished } from 'node:stream/promises'
import { DatabaseSync } from 'node:sqlite'
import { access, health, json, routeRuns, workspace } from './server/http.ts'
import { RunStore } from './server/store.ts'

const root = resolve('dist')
const directory = resolve(process.env.INVOICE_DATA_DIR ?? 'data')
const port = Number(process.env.PORT ?? 8787)
const key = process.env.GEMINI_API_KEY
const stores = new Map<string, RunStore>()
const processing = new Set<string>()
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
}
await mkdir(directory, { recursive: true })

function getStore(id: string) {
  const present = stores.get(id)
  if (present) return present
  const db = new DatabaseSync(resolve(directory, `${id}.sqlite`))
  db.exec('PRAGMA journal_mode=WAL')
  const values = (params: (string | number | ArrayBuffer | null)[]) =>
    params.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value)
  const store = new RunStore({
    run: (query, ...params) => { db.prepare(query).run(...values(params)) },
    all: (query, ...params) => db.prepare(query).all(...values(params)) as never,
    transaction(work) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = work()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    sync: async () => { await new Promise<void>(resolve => setImmediate(resolve)) },
  })
  stores.set(id, store)
  return store
}

async function schedule(id: string, store: RunStore) {
  if (processing.has(id) || !store.hasWork()) return
  processing.add(id)
  setImmediate(async () => {
    try {
      while (store.hasWork()) await store.processNext(key)
    } catch {
      console.error('Local run storage error. Refresh to retry pending work.')
    } finally {
      processing.delete(id)
    }
  })
}

async function route(request: Request) {
  const { pathname } = new URL(request.url)
  if (pathname.startsWith('/api/')) {
    const invalid = access(request, process.env.DEMO_ACCESS_CODE, false)
    if (invalid) return invalid
    if (pathname === '/api/health') return health(key)
    const id = workspace(request)
    if (!id) return json({ error: 'Invalid workspace.' }, 400)
    const store = getStore(id)
    await schedule(id, store)
    return routeRuns(request, store, () => schedule(id, store))
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  const filename = resolve(root, pathname === '/' ? 'index.html' : `.${decodeURIComponent(pathname)}`)
  if (!filename.startsWith(root + sep)) return new Response(null, { status: 404 })
  try {
    const bytes = await readFile(filename)
    return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
      'Content-Type': types[extname(filename)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
    } })
  } catch {
    return new Response('Not found. Run npm.cmd run build before starting the server.', { status: 404 })
  }
}

createServer(async (incoming, outgoing) => {
  try {
    const method = incoming.method
    const chunks = incoming.iterator({ destroyOnReturn: false })
    const body = method !== 'GET' && method !== 'HEAD' ? new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await chunks.next()
        if (done) controller.close()
        else controller.enqueue(value)
      },
    }, { highWaterMark: 0 }) : undefined
    const options = { method, body, headers: incoming.headers as HeadersInit, duplex: 'half' }
    const response = await route(new Request(`http://127.0.0.1:${port}${incoming.url}`, options))
    // Keep the HTTP connection reusable when a request is rejected before consuming its body.
    if (body && !incoming.readableEnded) {
      await chunks.return?.()
      incoming.resume()
      await finished(incoming, { cleanup: true })
    }
    const bytes = response.body ? Buffer.from(await response.arrayBuffer()) : undefined
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    outgoing.end(bytes)
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json' })
    if (!outgoing.writableEnded) outgoing.end(JSON.stringify({ error: 'The local server could not complete this request.' }))
  }
}).listen(port, '127.0.0.1', () => console.log(`Invoice Review Desk listening on http://127.0.0.1:${port}`))
