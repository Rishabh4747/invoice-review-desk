# Invoice Review Desk

PS-1 case study for accounts payable. Upload a PDF, follow its run, and inspect the decision and evidence. The app stores the original PDF, the extracted fields, stage timestamps, and the decision in the same workspace.

## Workflow and policy

1. **Receive PDF.** Accept PDFs up to 8 MiB, calculate their SHA-256 fingerprint, and preserve the source.
2. **Extract fields.** Gemini 3.1 Flash-Lite reads PDFs directly. The hosted app can render up to eight pages and send the page images to Google Gemma 4 on Cloudflare Workers AI if the Gemini request fails, its key is unavailable, or it returns unusable fields. Local development uses the Gemini Flash-Lite alternate endpoint. The run records the extraction model. The decision rules operate on the extracted fields.
3. **Validate totals.** Compare printed line amounts to subtotal and reconcile subtotal, tax, and any separately printed adjustment to the total. Compare quantity × unit price to the line amount when both are available. Amounts are checked in integer cents with a one-cent rounding tolerance. The demo supports positive USD invoices. Embedded tax or missing breakdowns go to review if arithmetic cannot be verified.
4. **Match purchase order.** Look up the supplier in the approved vendor list and check the explicit PO against supplier, currency, and open status. Without an explicit PO, list open POs for that vendor and currency whose remaining gross balance can cover the invoice. A reviewer confirms the PO even if only one candidate exists.
5. **Apply policy.** An exact PDF match or a matching approved supplier ID and normalized invoice number blocks repeat submission. A prior technical failure is excluded. A reconciled amount over the available balance of a valid explicit PO also blocks the invoice. Missing or inconsistent evidence goes to Needs review. Ready for approval reserves the gross amount against the PO, atomically with the saved decision. Blocked and review runs reserve nothing. Ready means eligible for a human approval step.

The PO register is synthetic, uses gross USD limits, and tracks prior commitments plus this workspace's reservations. PO budget is a hard cap. On the invoice side, blank tax is unknown and explicit zero is zero. The demo does not model a goods receipt or release reservations. A run that still fails after the fallback has its own status and can be retried by re-uploading.

## Run locally

Use Node.js 22.18+ and an existing `.env.local` with `GEMINI_API_KEY`.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open http://127.0.0.1:8787. The local runner uses SQLite in `data/`. This data and `.env.local` are ignored by Git.

## Host on Cloudflare

```powershell
npm.cmd exec -- wrangler login
npm.cmd run deploy
```

Cloudflare stores PDFs and run data in SQLite-backed Durable Objects. The deploy script sends the Gemini key through an ignored server-secret file, generates a reusable demo code, and prints the reviewer URL with that code in its fragment. Share the complete reviewer URL with your evaluator. The code is used for API requests and is stripped from the address bar after opening. Browser workspaces are isolated by a random identifier. Each workspace permits up to 40 uploads. The **New workspace** menu can also return to the previous workspace in the same browser. Use synthetic documents for the case study.

## Verify

```powershell
npm.cmd test
npm.cmd run check
```

With the server running, `node scripts/live-check.mjs` submits the actual sample PDFs. Supply the hosted base URL to check the deployed version using the access code from `.env.demo`. It runs in an isolated workspace.

See [the rehearsal guide](DEMO.md) for the sample order and interview notes.
