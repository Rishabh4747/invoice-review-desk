import { formatMoney, type Check, type Invoice, type Outcome, type PoEvidence } from '../shared.ts'
import { findVendor, normalized, purchaseOrders } from './procurement.ts'

const money = (cents: number) => formatMoney(cents / 100)
const cents = (value: number) => Math.round(value * 100)
const mismatch = (left: number, right: number) => Math.abs(left - right) > 1

function decimal(value: number) {
  const [mantissa, exponent = '0'] = String(value).split('e')
  return {
    digits: BigInt(mantissa.replace('.', '')),
    scale: Number(exponent) - (mantissa.split('.')[1]?.length ?? 0),
  }
}

function extendedPrice(quantity: number, price: number) {
  const count = decimal(quantity)
  const unit = decimal(price)
  const product = count.digits * unit.digits
  const scale = count.scale + unit.scale + 2
  if (scale >= 0) return Number(product * 10n ** BigInt(scale))
  const divisor = 10n ** BigInt(-scale)
  const magnitude = product < 0n ? -product : product
  const rounded = (magnitude + divisor / 2n) / divisor
  return Number(product < 0n ? -rounded : rounded)
}

export function validateInvoice(invoice: Invoice) {
  const checks: Check[] = []
  const { invoiceDate, total, items, subtotal, tax, adjustment, currency } = invoice
  const date = invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) ? new Date(invoiceDate) : null
  const missing = [
    !normalized(invoice.vendor) && 'supplier', !normalized(invoice.invoiceNumber) && 'invoice number',
    (!date || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== invoiceDate) && 'invoice date',
    (!currency || !/^[A-Z]{3}$/.test(currency)) && 'currency', total === null && 'invoice total',
  ].filter(Boolean)
  checks.push(missing.length
    ? { title: 'Required fields need review', detail: `Check the PDF for ${missing.join(', ')}.`, level: 'review' }
    : { title: 'Required fields present', detail: 'Supplier, invoice number, invoice date, currency, and total were extracted.', level: 'pass' })
  if (currency && currency !== 'USD') checks.push({ title: 'Currency needs review', detail: `The demo policy supports USD. The invoice says ${currency}.`, level: 'review' })
  if (total !== null && cents(total) <= 0) checks.push({ title: 'Non-positive invoice total', detail: 'A reviewer must handle zero-value invoices and credit notes.', level: 'review' })

  const printedAmounts = [
    ['subtotal', subtotal], ['tax', tax], ['adjustments', adjustment], ['total', total],
    ...items.map((item, index) => [`line ${index + 1}`, item.amount] as const),
  ] as const
  const fractionalAmounts = printedAmounts.filter(([, value]) => value !== null && cents(value) / 100 !== value)
  if (currency === 'USD' && fractionalAmounts.length) checks.push({
    title: 'Printed amounts include fractional cents',
    detail: fractionalAmounts.map(([label, value]) => `${label}: ${value}`).join(' · '),
    level: 'review',
  })

  const linesComplete = items.length > 0 && items.every(item => item.amount !== null)
  const lineSum = linesComplete ? items.reduce((sum, item) => sum + cents(item.amount!), 0) : null
  const display = (amount: number) => formatMoney(amount / 100, currency ?? '')
  const badLines = items.flatMap(item => {
    if (item.quantity === null || item.unitPrice === null || item.amount === null) return []
    const expected = extendedPrice(item.quantity, item.unitPrice)
    return mismatch(expected, cents(item.amount))
      ? [`${item.description ?? 'Line item'} shows ${formatMoney(item.amount, currency ?? '')} but quantity × price gives ${display(expected)}.`] : []
  })
  if (badLines.length) checks.push({
    title: 'Line item arithmetic differs', detail: badLines.join(' '), level: 'review',
  })

  const expectedTotal = subtotal !== null && tax !== null ? cents(subtotal) + cents(tax) + cents(adjustment ?? 0) : null
  const gross = total === null ? null : cents(total)
  const linesMatch = lineSum !== null && subtotal !== null && !mismatch(lineSum, cents(subtotal))
  const totalMatches = expectedTotal !== null && gross !== null && !mismatch(expectedTotal, gross)
  if (lineSum === null || expectedTotal === null || gross === null) {
    checks.push({ title: 'Totals could not be verified', detail: 'Review the printed line amounts, subtotal, tax, and total. A blank tax amount is treated as unknown.', level: 'review' })
  }
  if (lineSum !== null && subtotal !== null) checks.push(linesMatch
    ? { title: 'Line items reconcile', detail: `Line items add to ${display(lineSum)} and match the printed subtotal within 0.01.`, level: 'pass' }
    : { title: 'Line items differ from subtotal', detail: `Line items add to ${display(lineSum)}. Printed subtotal is ${display(cents(subtotal))}.`, level: 'review' })
  if (expectedTotal !== null && gross !== null) checks.push(totalMatches
    ? { title: 'Invoice total reconciles', detail: `Subtotal, tax, and adjustments give ${display(expectedTotal)}, within 0.01 of the printed total.`, level: 'pass' }
    : { title: 'Printed total does not reconcile', detail: `Subtotal, tax, and adjustments give ${display(expectedTotal)}. Printed total is ${display(gross)}.`, level: 'review' })
  const amountVerified = currency === 'USD' && !fractionalAmounts.length && !badLines.length && linesMatch && totalMatches
  return { checks, verifiedTotal: amountVerified && gross !== null && gross > 0 ? gross : null }
}

export function matchOrder(invoice: Invoice, reservations: Record<string, number>) {
  const checks: Check[] = []
  const vendor = findVendor(invoice.vendor)
  if (!vendor && invoice.vendor) checks.push({ title: 'Supplier needs verification', detail: `${invoice.vendor} is missing from the approved vendor list.`, level: 'review' })
  if (vendor) checks.push({ title: 'Approved supplier', detail: `${vendor.name} · ${vendor.id}`, level: 'pass' })

  const orders = purchaseOrders.map(order => {
    const reserved = reservations[order.id] ?? 0
    return { ...order, reserved, available: order.limit - order.committed - reserved }
  })
  if (!invoice.po) {
    const candidates = orders.filter(order => order.status === 'open' && order.vendor === vendor?.id
      && order.currency === invoice.currency && invoice.total !== null && cents(invoice.total) > 0
      && order.available >= cents(invoice.total))
    checks.push({
      title: candidates.length > 1 ? 'Multiple plausible purchase orders' : 'PO reference missing',
      detail: candidates.length ? `Confirm the PO with the supplier or procurement. Candidates: ${candidates.map(order => order.id).join(', ')}.`
        : 'No open PO for this supplier and currency covers the extracted amount. Confirm the reference with procurement.',
      level: 'review',
    })
    return { orders: candidates, match: null, checks }
  }

  const order = orders.find(candidate => normalized(candidate.id) === normalized(invoice.po))
  const issues = order && [
    order.status !== 'open' && `${order.id} is closed.`,
    order.vendor !== vendor?.id && `${order.id} belongs to supplier ${order.vendor}.`,
    order.currency !== invoice.currency && `${order.id} uses ${order.currency}. The invoice currency is ${invoice.currency ?? 'missing'}.`,
  ].filter(Boolean)
  if (!order || issues?.length) {
    const detail = issues ? issues.join(' ') : `${invoice.po} is missing from the PO register.`
    checks.push({ title: 'PO reference needs verification', detail, level: 'review' })
    return { orders: order ? [order] : [], match: null, checks }
  }
  checks.push({ title: 'Purchase order matched', detail: `${order.id} · ${order.description}`, level: 'pass' })
  return { orders: [order], match: order, checks }
}

export function applyPolicy(total: number | null, checks: Check[], order: PoEvidence | null, duplicate: { id: string; kind: string } | null) {
  const policyChecks: Check[] = []
  policyChecks.push(duplicate
    ? { title: 'Duplicate submission', detail: `${duplicate.kind} matches a previous completed run.`, level: 'block', priorRun: duplicate.id }
    : { title: 'No duplicate found', detail: 'Compared the file fingerprint and, when available, approved supplier ID and invoice number against completed runs.', level: 'pass' })
  const budgetCheck = order && total !== null && total > 0
  if (budgetCheck) {
    policyChecks.push(total > order.available
      ? { title: 'PO balance exceeded', detail: `${order.id} has ${money(order.available)} available. This invoice requests ${money(total)}, exceeding the balance by ${money(total - order.available)}.`, level: 'block' }
      : { title: 'Amount within PO balance', detail: `${money(total)} requested against ${money(order.available)} available before this run.`, level: 'pass' })
  } else if (order) policyChecks.push({
    title: 'PO balance check deferred', detail: 'Verify the invoice amount before comparing it to the available PO balance.', level: 'info',
  })
  const allChecks = [...checks, ...policyChecks]
  const outcome: Outcome = allChecks.some(check => check.level === 'block') ? 'blocked'
    : allChecks.some(check => check.level === 'review') || !budgetCheck ? 'review' : 'ready'
  return { outcome, checks: allChecks, reservation: outcome === 'ready' && budgetCheck ? { po: order.id, amount: total } : null }
}
