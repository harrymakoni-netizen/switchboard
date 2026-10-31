# PayPal sandbox integration — step 1

Implemented: Orders v2 authorization checkout, Payments v2 capture/void/reauthorize, Payouts v1, verified webhooks, durable webhook processing, item-level settlement polling, and a resumable smoke runner. Provider requests are sandbox-only. All payment execution remains in `packages/engine`.

**Verification status:** lint, strict typechecking, production build, 92 unit/integration tests (including HTTP contracts and Postgres reconciliation), and all six mock browser scenarios pass. No request has been tested against PayPal with real sandbox credentials. The user chose to configure credentials later. The invoice-only PayPal Agent Toolkit receipt agent is a separate remaining integration; real mode never fabricates a receipt.

## Configure later

Create a REST application under a **sandbox business** account in https://developer.paypal.com/dashboard/applications/sandbox. Enable Payouts for that application. Create a sandbox personal buyer and sandbox personal recipient accounts. Keep their passwords out of this repository and out of chat.

Set secrets on the server that executes the worker:

```text
PAYPAL_ENV=sandbox
MOCK_PAYPAL=0
PAYPAL_CLIENT_ID=<sandbox REST app client ID>
PAYPAL_CLIENT_SECRET=<sandbox REST app secret>
PAYPAL_WEBHOOK_ID=<sandbox webhook ID>
```

Keep `MOCK_TELEPHONY=1 MOCK_LLM=1 MOCK_PARTNERS=1 DEMO_MODE=1` while testing this integration alone. Configure `TENDAI_PAYOUT_EMAIL` and `QUICKFIX_PAYOUT_EMAIL` to actual sandbox personal account emails before booking demo bots with sandbox payouts. The committed example.com addresses are placeholders, not recipient accounts.

The app still needs a reachable Postgres database and worker. The Vercel web project currently has `HOSTED_UI_ONLY=1`; leave that enabled until its backend has been provisioned. Credentials in Vercel alone do not start a background worker. The worker must use a direct or session-pooled Postgres connection that supports LISTEN/NOTIFY and session advisory locks, not a transaction-pooler URL. The worker and web must reach the same database and share SESSION_SECRET, with APP_URL pointing to the app and PUBLIC_WORKER_URL to the worker.

## Register the webhook

Once the worker has a public HTTPS endpoint, add this URL to the **same sandbox REST app**:

```text
https://<worker-host>/webhooks/paypal
```

Subscribe to:

- `CHECKOUT.ORDER.APPROVED`
- `PAYMENT.AUTHORIZATION.CREATED`
- `PAYMENT.AUTHORIZATION.VOIDED`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.DECLINED`
- `PAYMENT.CAPTURE.DENIED`
- `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`
- `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`
- `PAYMENT.PAYOUTS-ITEM.FAILED`
- `PAYMENT.PAYOUTS-ITEM.RETURNED`
- `INVOICING.INVOICE.PAID` (receipt integration follows separately)

Store the returned webhook ID as PAYPAL_WEBHOOK_ID. Localhost cannot receive PayPal webhooks. Use a suitable HTTPS test endpoint or deploy the worker; do not disable signature verification. The mock x-mock-signature mechanism is test-only and is never accepted by HttpPayPal.

The endpoint preserves the raw body and asks PayPal's signature-verification API to authenticate it. Only then does it atomically write the inbox event and a durable outbox task. Repeated provider event IDs are acknowledged without creating another task. Events are correlated using stored provider IDs, not caller-supplied job metadata. Unknown/unrelated signed events are recorded and acknowledged without changing a job.

## Smoke test without Postgres

The smoke runner tests two **$1.00 USD sandbox** orders and does not need the database or worker. It stores only IDs and test progress under ignored `.paypal-smoke/`; credentials are read from the environment. Keep the state file for retries so the same provider idempotency keys are reused.

```sh
pnpm paypal:smoke --help
pnpm paypal:smoke --state .paypal-smoke/run.json
```

Open both printed approval URLs using the sandbox personal buyer. Approve each order in PayPal. A prepared order alone is not a passed test.

Then authorize both and void the cancellation leg:

```sh
pnpm paypal:smoke --state .paypal-smoke/run.json --resume
```

The capture leg stays held. To separately confirm completion and capture its $1.00:

```sh
pnpm paypal:smoke --state .paypal-smoke/run.json --resume --confirm-done
```

To test payout too, configure PAYPAL_SMOKE_PAYOUT_EMAIL to a sandbox personal recipient account, then run the same resume command. A changed payout recipient is rejected on retry. A pending payout is not a success: rerun to poll until the item is SUCCEEDED or UNCLAIMED, and compare the IDs in the output to the sandbox dashboard. UNCLAIMED means the recipient still needs to claim it; it is displayed that way in the app.

## Required acceptance before calling this integration live-verified

- Buyer approves the actual PayPal sandbox checkout.
- The authorization amount is exactly the chosen quote amount, in USD.
- Completion approval produces one capture, with matching amount and stored capture ID.
- The payout goes to the displayed confirmed sandbox recipient with the same amount.
- Recipient item status reaches SUCCEEDED or UNCLAIMED; batch acceptance alone does not close the job.
- The second order is voided without capture.
- Invalid signatures are rejected; duplicate delivery produces no duplicate money effects.
- The sandbox ledger matches the app ledger.

Capture and payout polling starts after 60 seconds when settlement is pending. Pending polls are rescheduled without suppressing the next poll behind the active queue task. Job-scoped PostgreSQL advisory locks serialize provider requests and webhook reconciliation across worker instances. Tests include retries after a ledger write but before its corresponding state transition.
