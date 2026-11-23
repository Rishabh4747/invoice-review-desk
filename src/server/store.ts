import { model, type Invoice, type Run, type RunSummary, type Stage } from '../shared.ts'
import { applyPolicy, matchOrder, validateInvoice } from './policy.ts'
import { findVendor, normalized } from './procurement.ts'
import { extractInvoice, ExtractionFailure, type BackupExtractor } from './extract.ts'

type Value = string | number | ArrayBuffer | null
export type Sql = {
  run: (query: string, ...params: Value[]) => void
  all: <T>(query: string, ...params: Value[]) => T[]
  transaction: <T>(work: () => T) => T
  sync: () => Promise<void>
}
type Entry = { id: string; hash: string; payload: string }

export class RunStore {
  private sql: Sql

  constructor(sql: Sql) {
    this.sql = sql
    sql.run(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL, hash TEXT NOT NULL, identity TEXT,
      reserve_po TEXT, reserve_cents INTEGER, payload TEXT NOT NULL
    )`)
    sql.run('CREATE INDEX IF NOT EXISTS run_status ON runs(status, created_at)')
    sql.run('CREATE INDEX IF NOT EXISTS run_hash ON runs(hash, status)')
    sql.run('CREATE INDEX IF NOT EXISTS run_identity ON runs(identity, status)')
    sql.run(`CREATE TABLE IF NOT EXISTS pdf_parts (
      run_id TEXT NOT NULL, part INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (run_id, part)
    )`)
  }

  list(): RunSummary[] {
    return this.sql.all<Entry>('SELECT payload FROM runs ORDER BY created_at DESC, rowid DESC').map(({ payload }) => {
      const { id, filename, createdAt, status, outcome, vendor, invoiceNumber, total, currency } = JSON.parse(payload) as Run
      return { id, filename, createdAt, status, outcome, vendor, invoiceNumber, total, currency }
    })
  }

  get(id: string): Run | null {
    const record = this.sql.all<Entry>('SELECT payload FROM runs WHERE id = ?', id)[0]
    return record ? JSON.parse(record.payload) as Run : null
  }

  create(filename: string, hash: string, bytes: Uint8Array<ArrayBuffer>, receivedAt: string): Run | null {
    const now = new Date().toISOString()
    const run: Run = {
      id: crypto.randomUUID(), filename, createdAt: now, status: 'queued', outcome: null, vendor: null,
      invoiceNumber: null, total: null, currency: null, invoice: null, model: null, finishedAt: null,
      events: [{ stage: 'intake', start: receivedAt, end: now }], checks: [], orders: [], error: null,
    }
    return this.sql.transaction(() => {
      if (this.sql.all<{ count: number }>('SELECT COUNT(*) AS count FROM runs')[0].count >= 40) return null
      this.sql.run('INSERT INTO runs (id, created_at, status, hash, payload) VALUES (?, ?, ?, ?, ?)', run.id, now, run.status, hash, JSON.stringify(run))
      const chunk = 512 * 1024
      for (let offset = 0; offset < bytes.byteLength; offset += chunk) {
        this.sql.run('INSERT INTO pdf_parts VALUES (?, ?, ?)', run.id, offset, bytes.slice(offset, offset + chunk).buffer)
      }
      return run
    })
  }

  pdf(id: string): Uint8Array<ArrayBuffer> {
    const parts = this.sql.all<{ bytes: ArrayBuffer | Uint8Array }>('SELECT bytes FROM pdf_parts WHERE run_id = ? ORDER BY part', id)
      .map(({ bytes }) => new Uint8Array(bytes))
    const merged = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
    let offset = 0
    for (const part of parts) {
      merged.set(part, offset)
      offset += part.byteLength
    }
    return merged
  }

  private save(run: Run) {
    this.sql.run('UPDATE runs SET status = ?, payload = ? WHERE id = ?', run.status, JSON.stringify(run), run.id)
  }

  private async start(run: Run, stage: Stage) {
    run.events.push({ stage, start: new Date().toISOString() })
    this.save(run)
    await this.sql.sync()
  }

  private finishStage(run: Run) {
    run.events.at(-1)!.end = new Date().toISOString()
  }

  private reservations() {
    const rows = this.sql.all<{ po: string; reserved: number }>(
      'SELECT reserve_po AS po, SUM(reserve_cents) AS reserved FROM runs WHERE reserve_po IS NOT NULL GROUP BY reserve_po',
    )
    return Object.fromEntries(rows.map(row => [row.po, row.reserved]))
  }

  private duplicate(entry: Entry, identity: string | null) {
    const previous = this.sql.all<{ id: string; hash: string }>(
      `SELECT id, hash FROM runs WHERE status = 'completed' AND id <> ? AND (hash = ? OR identity = ?)
        ORDER BY hash = ? DESC, created_at, rowid LIMIT 1`,
      entry.id, entry.hash, identity, entry.hash,
    )[0]
    return previous ? { id: previous.id, kind: previous.hash === entry.hash ? 'The PDF fingerprint' : 'Approved supplier and invoice number' } : null
  }

  private finish(run: Run, entry: Entry, invoice: Invoice, verifiedTotal: number | null) {
    this.sql.transaction(() => {
      // Recheck available balance inside the same transaction that reserves it.
      const match = matchOrder(invoice, this.reservations())
      const vendor = findVendor(invoice.vendor)
      const number = normalized(invoice.invoiceNumber)
      const identity = vendor && number ? `${vendor.id}:${number}` : null
      const result = applyPolicy(verifiedTotal, run.checks, match.match, this.duplicate(entry, identity))
      this.finishStage(run)
      run.status = 'completed'
      run.finishedAt = new Date().toISOString()
      run.outcome = result.outcome
      run.orders = match.orders
      run.checks = result.checks
      this.sql.run('UPDATE runs SET identity = ?, reserve_po = ?, reserve_cents = ? WHERE id = ?',
        identity, result.reservation?.po ?? null, result.reservation?.amount ?? null, run.id)
      this.save(run)
    })
  }

  hasWork() {
    return this.sql.all<{ id: string }>("SELECT id FROM runs WHERE status IN ('queued', 'processing') LIMIT 1").length > 0
  }

  async processNext(apiKey: string | undefined, backup?: BackupExtractor) {
    const entry = this.sql.all<Entry>("SELECT id, hash, payload FROM runs WHERE status IN ('queued', 'processing') ORDER BY created_at, rowid LIMIT 1")[0]
    if (!entry) return
    const run = JSON.parse(entry.payload) as Run
    // A process interrupted before a terminal commit can be replayed from the persisted source.
    Object.assign(run, {
      events: run.events.slice(0, 1), checks: [], orders: [], status: 'processing', model,
      invoice: null, vendor: null, invoiceNumber: null, total: null, currency: null, error: null,
    })
    try {
      await this.start(run, 'extract')
      const extraction = await extractInvoice(this.pdf(run.id), apiKey, backup)
      const { invoice } = extraction
      Object.assign(run, {
        invoice, model: extraction.model, vendor: invoice.vendor, invoiceNumber: invoice.invoiceNumber, total: invoice.total, currency: invoice.currency,
      })
      this.finishStage(run)
      await this.start(run, 'validate')
      const validation = validateInvoice(invoice)
      run.checks = validation.checks
      this.finishStage(run)
      await this.start(run, 'match')
      const match = matchOrder(invoice, this.reservations())
      run.orders = match.orders
      run.checks.push(...match.checks)
      this.finishStage(run)
      await this.start(run, 'decide')
      this.finish(run, entry, invoice, validation.verifiedTotal)
    } catch (error) {
      run.error = error instanceof ExtractionFailure
        ? error.message : 'The server interrupted this run. Upload the PDF again to retry.'
      run.status = 'failed'
      run.outcome = null
      const active = run.events.at(-1)
      if (active) delete active.end
      run.finishedAt = new Date().toISOString()
      this.save(run)
    }
  }
}
