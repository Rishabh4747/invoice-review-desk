import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { RunStore } from '../src/server/store.ts'
import { fallbackModel, model } from '../src/shared.ts'
import { extractInvoice } from '../src/server/extract.ts'
import { health } from '../src/server/http.ts'

test('a technical failure has no outcome and an identical retry can be ready', async context => {
  const db = new DatabaseSync(':memory:')
  context.after(() => db.close())
  const store = new RunStore({
    run(query, ...params) {
      db.prepare(query).run(...params.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value))
    },
    all: (query, ...params) => db.prepare(query).all(...params.map(value =>
      value instanceof ArrayBuffer ? new Uint8Array(value) : value)) as never,
    transaction(work) { return work() },
    sync: async () => {},
  })
  const bytes = new Uint8Array([1, 2, 3])
  const original = store.create('invoice.pdf', 'same-pdf', bytes, new Date().toISOString())!
  await store.processNext(undefined)
  const failed = store.get(original.id)
  assert.equal(failed?.status, 'failed')
  assert.equal(failed?.outcome, null)
  assert.equal(failed?.events.at(-1)?.stage, 'extract')
  assert.equal(failed?.events.at(-1)?.end, undefined)
  assert.match(failed?.error ?? '', /missing its Gemini API key/)

  const invoice = {
    vendor: 'Northstar Office Supply LLC', invoiceNumber: 'TEST-2', po: 'PO-1042', invoiceDate: '2026-11-20',
    currency: 'USD', subtotal: 100, tax: 8, adjustment: null, total: 108,
    items: [{ description: 'Paper', quantity: 2, unitPrice: 50, amount: 100 }],
  }
  const provider = context.mock.method(globalThis, 'fetch', async () => Response.json({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(invoice) }] } }],
  }))
  provider.mock.mockImplementationOnce(async () => new Response(null, { status: 503 }))
  const retry = store.create('re-upload.pdf', 'same-pdf', bytes, new Date().toISOString())!
  await store.processNext('stub-for-test')
  const completed = store.get(retry.id)
  assert.equal(completed?.status, 'completed')
  assert.equal(completed?.outcome, 'ready')
  assert.equal(completed?.error, null)
  assert.equal(completed?.model, fallbackModel)
  assert.equal(provider.mock.callCount(), 2)
  assert.deepEqual(provider.mock.calls.map(call => String(call.arguments[0]).split('/').at(-1)),
    [`${model}:generateContent`, `${fallbackModel}:generateContent`])
  assert.deepEqual(store.pdf(retry.id), bytes)
})

test('the hosted backup receives the original bytes when Gemini rejects the request or its key is unavailable', async context => {
  const primary = context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }))
  const pdf = new Uint8Array([1, 2, 3, 4])
  const invoice = {
    vendor: null, invoiceNumber: null, invoiceDate: null, po: null, currency: null,
    subtotal: null, tax: null, adjustment: null, total: null, items: [],
  }
  const backup = async (original: Uint8Array) => {
    assert.equal(original, pdf)
    return { invoice, model: 'backup-model' }
  }
  for (const status of [400, 401, 403, 404, 429, 503]) {
    primary.mock.mockImplementationOnce(async () => new Response(null, { status }))
    assert.deepEqual(await extractInvoice(pdf, 'stub-for-test', backup), { invoice, model: 'backup-model' })
  }
  assert.deepEqual(await extractInvoice(pdf, undefined, backup), { invoice, model: 'backup-model' })
  assert.equal(primary.mock.callCount(), 6)
  assert.equal((await health(undefined, true).json()).extractionConfigured, true)
})
