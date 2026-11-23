import { DurableObject } from 'cloudflare:workers'
import { extractWithGemma } from './cloudflare/gemma.ts'
import { access, health, json, routeRuns, uploadTooLarge, workspace } from './server/http.ts'
import { RunStore } from './server/store.ts'
import { maxUpload } from './shared.ts'

interface Env {
  ASSETS: Fetcher
  AI?: Ai
  RUNS: DurableObjectNamespace<InvoiceWorkspace>
  DEMO_ACCESS_CODE?: string
  GEMINI_API_KEY?: string
}

export class InvoiceWorkspace extends DurableObject<Env> {
  private store: RunStore
  private working = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const { storage } = ctx
    this.store = new RunStore({
      run: (query, ...params) => { storage.sql.exec(query, ...params) },
      all: (query, ...params) => storage.sql.exec(query, ...params).toArray() as never,
      transaction: work => storage.transactionSync(work),
      sync: () => storage.sync(),
    })
  }

  private async schedule() {
    if (!this.working && this.store.hasWork() && await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(Date.now())
    }
  }

  async fetch(request: Request) {
    await this.schedule()
    return routeRuns(request, this.store, () => this.schedule())
  }

  async alarm() {
    this.working = true
    try {
      const ai = this.env.AI
      await this.store.processNext(this.env.GEMINI_API_KEY, ai && (pdf => extractWithGemma(pdf, ai)))
    } finally {
      this.working = false
    }
    if (this.store.hasWork()) await this.ctx.storage.setAlarm(Date.now())
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    const invalid = access(request, env.DEMO_ACCESS_CODE, true)
    if (invalid) return invalid
    if (pathname === '/api/health') return health(env.GEMINI_API_KEY, Boolean(env.AI))
    const id = workspace(request)
    if (!id) return json({ error: 'Invalid workspace.' }, 400)
    if (pathname === '/api/runs' && request.method === 'POST' && Number(request.headers.get('Content-Length')) > maxUpload) {
      return uploadTooLarge()
    }
    try {
      return await env.RUNS.getByName(id).fetch(request)
    } catch {
      return json({ error: 'Run storage is temporarily unavailable. Reload before uploading again.' }, 503)
    }
  },
}
