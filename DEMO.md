# Record and rehearse PS-1

Record your screen with your own voice. Aim for three minutes and thirty seconds to four minutes. Use the reviewer URL for the recording. Open it in a private window or choose **New workspace** to start with the original PO balances. Rehearse first in a separate workspace.

## Recording route

| Time | Show and explain |
| --- | --- |
| 0:00–0:25 | Open **Invoice review**. Explain that an AP analyst needs to see what was extracted, why an invoice passed, and what to check when it did not. |
| 0:25–1:30 | Upload [01-office-supplies.pdf](public/samples/01-office-supplies.pdf) and click **Process invoice**. Point to the live workflow. Open the output and show the printed total of $496.80 and the matching PO with $1,540.00 available. The decision is **Ready for approval**. An AP reviewer still owns approval. |
| 1:30–2:40 | Upload [02-rescanned-copy.pdf](public/samples/02-rescanned-copy.pdf). The file is image-only, so the extraction model reads the visual content. The decision is **Blocked** because the approved supplier and invoice number match the first run. Click **View original run** to show the link. |
| 2:40–3:30 | Open **Run history**. Show the two outcomes and reopen one. Explain that the original PDF, extracted data, and policy evidence are saved with each run. End here or use the remaining time to show the ambiguous PO case. |

Use the **Sample invoices** tab to select the same PDFs without browsing for local files. It loads the PDF into the form, then **Process invoice** starts the real run. The video should show at least one live edge case and stay under five minutes. Share the complete reviewer URL and the recording link with your hiring coordinator. Test both links in a private window before submitting.

## Interview inputs

Run these in a fresh workspace in the listed order. The two paired cases depend on what has already run in that workspace.

| Input | Expected decision and evidence |
| --- | --- |
| [01-office-supplies.pdf](public/samples/01-office-supplies.pdf) | **Ready for approval.** Northstar, PO-1042, $496.80 against $1,540.00 available. |
| [02-rescanned-copy.pdf](public/samples/02-rescanned-copy.pdf) | **Blocked.** Same supplier and invoice number as 01 even though the file contents changed. Renaming and re-uploading 01 instead exercises the exact-file fingerprint. |
| [03-packaging-first-shipment.pdf](public/samples/03-packaging-first-shipment.pdf) | **Ready for approval.** First split invoice reserves $700.00 from an available $1,150.00. |
| [04-packaging-second-shipment.pdf](public/samples/04-packaging-second-shipment.pdf) | **Blocked.** The second invoice asks for $500.00 while only $450.00 remains. Either invoice can fit individually before the other reserves funds. |
| [05-missing-po.pdf](public/samples/05-missing-po.pdf) | **Needs review.** PO-3106 and PO-3107 are both plausible. A reviewer confirms which PO is correct. |
| [06-scan-total-mismatch.pdf](public/samples/06-scan-total-mismatch.pdf) | **Needs review.** The scan prints $342.00, while $300.00 plus $24.00 tax gives $324.00. |

## How to explain the design

- **Why split extraction and decision?** PDF layouts and scans vary. Gemini or the Cloudflare-hosted Gemma backup transcribes what it sees. Code decides from the extracted facts and the same rules every time. The original PDF is available to compare with the extraction.
- **Why reserve at Ready for approval?** Two invoices can each fit when examined separately. The app checks and reserves gross funds in a single transaction when saving a ready decision.
- **What needs a human?** AP follows up on missing or ambiguous POs, unreadable information, and arithmetic discrepancies. A technical failure has its own status and can be retried.
- **Where are the demo boundaries?** The vendor and PO register are synthetic. The policy uses USD gross balances and a one-cent arithmetic tolerance. Goods receipts, approval actions, and reservation release are outside this workflow.
