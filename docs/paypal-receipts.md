# PayPal sandbox invoice receipts

After an approved capture, the worker uses `@paypal/agent-toolkit@1.11.0` to prepare the buyer's invoice receipt. It never creates another payment. The three fixed invoice steps are server-orchestrated in the hosted worker; the optional model-driven implementation remains available and tested. Planning and quote extraction still use Gemini.

The server independently reads the completed capture and approved order before invoice work. If invoicing cannot link a Checkout capture directly (404), it can record that already verified payment using method OTHER and an exact server-generated job/capture reference in the transaction note. Verification accepts that record only when its note, amount, buyer, invoice reference, paid status, and zero balance match. An arbitrary manually marked invoice is not proof of capture.

## Boundaries

- Only `create_invoice`, `record_payment_for_invoice`, and `send_invoice` are enabled. The agent cannot authorize, capture, void, refund, or pay out funds.
- Each model-facing tool accepts an empty object. Server code fixes the invoice buyer, merchant, capture ID, USD amount, and single line item from the completed job. No parts/labour price breakdown is invented when the quote provides no breakdown.
- Before creating an invoice, the server re-reads the actual capture and order from PayPal, checks the completed status, job references, order identity, and exact amount, and derives contact emails from the approved provider order.
- The server independently re-reads the invoice before recording and exposing it. The total, line item, buyer, job reference, zero balance, and recorded PayPal capture must match. A PAID status alone is insufficient.
- Mismatches persist as `NEEDS_REVIEW`; the UI offers no paid receipt link. A signed invoice webhook schedules re-verification instead of marking the local receipt paid on its own.

## Recovery and notifications

The invoice number is a deterministic, provider-sized hash of the job ID. The full job ID remains the invoice reference. The worker searches for that number before creating, uses stable provider request IDs per action, and persists the invoice ID before proceeding. Retries reuse the saved invoice and inspect existing payments before recording again. A dedicated database advisory lock serializes concurrent receipt tasks.

Some PayPal accounts require draft activation before payment can be recorded. If that specific draft operation returns HTTP 422, the adapter activates the invoice with `send_to_recipient=false` before attaching the existing capture. It never intentionally emails an unpaid invoice. The final send is attempted only after the invoice is independently verified as paid. PayPal can refuse to resend an already-paid invoice; in that case the paid receipt remains available in Switchboard, and `notificationSent=false` records that email delivery was not confirmed. No claim of email delivery is inferred from invoice payment alone.

At startup, the sandbox worker resumes up to 100 real completed captures with missing or pending invoices, including payments completed before this integration. Historical `MOCK-` captures are excluded. Review cases require investigation rather than automatic re-creation.

## Configuration

The worker needs its existing sandbox PayPal credentials and GEMINI_API_KEY. Keep PAYPAL_ENV=sandbox. Production currently overrides GEMINI_MODEL to gemini-3.6-flash, with gemini-3.5-flash-lite as the transient-error fallback. No new payment credential or database migration is required.

## Verification

**Recorded hosted verification — 6 November 2026:** the sandbox flow completed a $95 capture and successful payout, followed by invoice `INV2-UADH-JS7Y-GG2D-BQPJ` with `PAID` status and independent server verification. The matching capture and payout references are in the [README verification section](../README.md#verification). Receipt email delivery was not established by this result.

An earlier preflight returned HTTP 403 `NOT_AUTHORIZED` for invoicing; that historical observation preceded the completed invoice run above. If a new deployment encounters that response, check Invoicing access for its sandbox REST app and restart the worker after permissions are updated.

The [README](../README.md#verification) records the latest documented automated and browser-suite counts as of 6 November 2026. Tests cover toolkit capability restrictions, capture/order verification, mismatches, injected arguments, duplicate/restart recovery and review states. Automated provider tests use mocks; the hosted result is separate point-in-time evidence.

The worker's public `/health` response reports its deployed Git revision and configured provider modes without revealing credentials. `mode=mock` still indicates simulated telephony; use `providers.paypal`, `providers.llm`, and `providers.receipts` to distinguish the enabled integrations.

PayPal references: [Invoicing v2](https://developer.paypal.com/api/invoicing/v2/), [payment records](https://developer.paypal.com/api/invoicing/v2/definitions/payments).
