import assert from 'node:assert/strict'
import test from 'node:test'
import type { Invoice } from '../src/shared.ts'
import { parseInvoice } from '../src/server/extract.ts'
import { applyPolicy, matchOrder, validateInvoice } from '../src/server/policy.ts'

const invoice: Invoice = {
  vendor: 'Northstar Office Supply LLC', invoiceNumber: 'TEST-1', po: 'PO-1042', invoiceDate: '2026-11-20',
  currency: 'USD', subtotal: 100, tax: 8, adjustment: null, total: 108,
  items: [{ description: 'Paper', quantity: 2, unitPrice: 50, amount: 100 }],
}

test('arithmetic accepts one cent of rounding and flags a larger difference', () => {
  assert.ok(validateInvoice({ ...invoice, total: 108.01 }).checks.every(check => check.level === 'pass'))
  assert.ok(validateInvoice({ ...invoice, total: 108.02 }).checks.some(check => check.title === 'Printed total does not reconcile'))
})

test('a missing tax value and an impossible date both need review', () => {
  assert.ok(validateInvoice({ ...invoice, tax: null }).checks.some(check => check.title === 'Totals could not be verified'))
  assert.ok(validateInvoice({ ...invoice, invoiceDate: '2026-02-30' }).checks.some(check => check.title === 'Required fields need review'))
})

test('ready reserves a gross amount, while a duplicate never reserves again', () => {
  const match = matchOrder(invoice, {})
  const validation = validateInvoice(invoice)
  const checks = [...validation.checks, ...match.checks]
  assert.deepEqual(applyPolicy(validation.verifiedTotal, checks, match.match, null).reservation, { po: 'PO-1042', amount: 10800 })
  const duplicate = applyPolicy(validation.verifiedTotal, checks, match.match, { id: 'older', kind: 'The PDF fingerprint' })
  assert.equal(duplicate.outcome, 'blocked')
  assert.equal(duplicate.reservation, null)
  assert.equal(duplicate.checks.find(check => check.level === 'block')?.priorRun, 'older')
})

test('an invoice exactly on the remaining balance fits, and a cent over blocks', () => {
  const match = matchOrder(invoice, { 'PO-1042': 143200 })
  assert.equal(match.match?.available, 10800)
  assert.equal(applyPolicy(10800, [], match.match, null).outcome, 'ready')
  assert.equal(applyPolicy(10801, [], match.match, null).outcome, 'blocked')
})

test('fractional unit prices round half-up and printed fractional cents require review', () => {
  const halfCent = { ...invoice, subtotal: 10.09, tax: 0, total: 10.09,
    items: [{ description: 'Paper', quantity: 1, unitPrice: 10.075, amount: 10.09 }] }
  assert.equal(validateInvoice(halfCent).verifiedTotal, 1009)
  assert.equal(validateInvoice({ ...halfCent, total: 10.0901 }).verifiedTotal, null)
  const badLine = { ...halfCent, items: [{ ...halfCent.items[0], amount: 10.10 }] }
  assert.match(validateInvoice(badLine).checks.find(check => check.title === 'Line item arithmetic differs')?.detail ?? '', /\$10\.08/)
})

test('negative adjustments and explicit zero tax reconcile', () => {
  assert.equal(validateInvoice({ ...invoice, adjustment: -3, tax: 0, total: 97 }).verifiedTotal, 9700)
})

test('a mismatched total yields review even if the printed figure exceeds the PO', () => {
  const incomplete = { ...invoice, items: [], total: 2500 }
  const validation = validateInvoice(incomplete)
  const match = matchOrder(incomplete, {})
  assert.ok(validation.checks.some(check => check.title === 'Printed total does not reconcile'))
  assert.equal(validation.verifiedTotal, null)
  const result = applyPolicy(validation.verifiedTotal, [...validation.checks, ...match.checks], match.match, null)
  assert.equal(result.outcome, 'review')
  assert.equal(result.reservation, null)
  assert.ok(result.checks.some(check => check.title === 'PO balance check deferred'))
})

test('a missing PO always needs review and candidate availability reflects reservations', () => {
  const missingPo = { ...invoice, vendor: 'Cedarline Facilities LLC', po: null }
  const match = matchOrder(missingPo, { 'PO-3106': 75000 })
  assert.deepEqual(match.orders.map(order => order.id), ['PO-3107'])
  assert.equal(match.match, null)
  assert.equal(applyPolicy(10800, match.checks, match.match, null).outcome, 'review')
})

test('closed, unknown, wrong-supplier, and wrong-currency POs cannot match', () => {
  for (const [changes, phrase] of [
    [{ po: 'PO-0990' }, 'closed'], [{ po: 'PO-9999' }, 'missing from the PO register'],
    [{ po: 'PO-2081' }, 'belongs to supplier V-102'], [{ currency: 'EUR' }, 'invoice currency is EUR'],
  ] as const) {
    const match = matchOrder({ ...invoice, ...changes }, {})
    assert.equal(match.match, null)
    assert.ok(match.checks.some(check => check.level === 'review' && check.detail.includes(phrase)))
  }
})

test('non-USD, negative, zero, and missing totals cannot reserve funds', () => {
  for (const changes of [{ currency: 'EUR' }, { total: -20 }, { total: 0 }, { total: null }]) {
    assert.equal(validateInvoice({ ...invoice, ...changes }).verifiedTotal, null)
  }
  assert.equal(applyPolicy(0, [], matchOrder(invoice, {}).match, null).outcome, 'review')
})

test('malformed structured extraction is rejected', () => {
  assert.deepEqual(parseInvoice(invoice), invoice)
  assert.throws(() => parseInvoice({ ...invoice, total: '108.00' }), /Expected numeric amount/)
  assert.throws(() => parseInvoice({ ...invoice, subtotal: undefined }), /Expected numeric amount/)
})
