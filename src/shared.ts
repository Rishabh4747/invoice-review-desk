export const stages = [
  ['intake', 'Receive PDF', 'Store the source and fingerprint its contents'],
  ['extract', 'Extract fields', 'Read the invoice PDF with AI'],
  ['validate', 'Validate totals', 'Reconcile line items, subtotal, tax, and total'],
  ['match', 'Match purchase order', 'Check supplier, currency, and available POs'],
  ['decide', 'Apply policy', 'Check duplicates and PO balance, then save the decision'],
] as const

export type Stage = typeof stages[number][0]
export type Outcome = 'ready' | 'review' | 'blocked'
export type RunStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type Check = { title: string; detail: string; level: 'pass' | 'review' | 'block' | 'info'; priorRun?: string }
export type LineItem = { description: string | null; quantity: number | null; unitPrice: number | null; amount: number | null }
export type Invoice = {
  vendor: string | null; invoiceNumber: string | null; invoiceDate: string | null; po: string | null
  currency: string | null; subtotal: number | null; tax: number | null; adjustment: number | null; total: number | null
  items: LineItem[]
}
export type PurchaseOrder = {
  id: string; vendor: string; description: string; currency: string; limit: number; committed: number; status: 'open' | 'closed'
}
export type PoEvidence = PurchaseOrder & { reserved: number; available: number }
export type RunSummary = {
  id: string; filename: string; createdAt: string; status: RunStatus; outcome: Outcome | null
  vendor: string | null; invoiceNumber: string | null; total: number | null; currency: string | null
}
export type Run = RunSummary & {
  invoice: Invoice | null; events: { stage: Stage; start: string; end?: string }[]
  checks: Check[]; orders: PoEvidence[]; error: string | null; finishedAt: string | null; model: string | null
}
export const labels: Record<Outcome | RunStatus, string> = {
  ready: 'Ready for approval', review: 'Needs review', blocked: 'Blocked',
  queued: 'Queued', processing: 'Processing', completed: 'Completed', failed: 'Processing failed',
}
export const maxUpload = 8 * 1024 * 1024
export const model = 'gemini-3.1-flash-lite'
export const fallbackModel = 'gemini-flash-lite-latest'

export function formatMoney(amount: number | null, currency = 'USD', maxFractionDigits?: number) {
  if (amount === null) return '—'
  const precision = maxFractionDigits ? { maximumFractionDigits: maxFractionDigits, minimumFractionDigits: 2 } : {}
  return new Intl.NumberFormat('en-US', /^[A-Z]{3}$/.test(currency)
    ? { style: 'currency', currency, ...precision }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2, ...precision }).format(amount)
}
