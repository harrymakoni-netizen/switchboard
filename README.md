# Switchboard

**Your call. Our legwork.**

Turn one home-repair request into comparable quotes, a booking, and a verified PayPal sandbox receipt—with the buyer approving both the booking and the release of payment.

**[Try the live demo](https://switchboard-hjm-technologies.vercel.app) · [Open the walkthrough](https://switchboard-hjm-technologies.vercel.app/demo)**

Built for the **PayPal AI Hackathon**.

**Start here:** [Judge walkthrough](#try-it-as-a-judge) · [Local setup](#run-locally-without-service-keys) · [Integrations](#integrations-and-demo-scope) · [Architecture](#how-it-works) · [Verification](#verification)

## The problem

Arranging a repair means explaining the same problem repeatedly, comparing prices with different inclusions and appointment times, and deciding when to pay. That gets harder when you are organizing the work for someone else.

Switchboard brings the request, quote details, supporting transcripts, research, and payment status into one place. The buyer chooses the provider, reviews the recipient, and confirms completion before the server captures payment.

## What you can do

- **Type or speak a request.** Record up to 60 seconds, review the Gemini transcription, and edit it before submitting. Recordings are processed in memory and are not saved by Switchboard.
- **Build a repair brief.** Gemini extracts the task, location, time window, and USD budget, or asks a follow-up question when information is missing.
- **Compare the evidence.** Review prices, appointments, included work, guarantees, and transcripts. Over-budget offers cannot be booked; uncertain extractions and appointments outside the requested window are flagged.
- **Inspect real research.** Kernel retrieves public business-directory leads with source links. Channel3 supplies retail parts offers and an advisory USD median.
- **Approve the booking.** PayPal sandbox checkout authorizes the selected quote amount without capturing it.
- **Approve completion.** After reviewing the payout recipient, mark the work done to trigger capture, payout, and a verified invoice receipt. Cancellation before capture requests a void; reporting unfinished work leaves payment uncaptured and records an issue.

## Integrations and demo scope

The hosted build connects to real provider APIs. **All PayPal transactions use sandbox funds.**

| Integration              | Role in the hosted demo                                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PayPal**               | Orders v2 creates sandbox checkout; Payments v2 authorizes, captures and voids; Payouts v1 sends the payout; Invoicing v2 provides receipts. Verified webhooks and polling reconcile payment states. A hosted $95 capture, successful payout, and verified PAID receipt were exercised.                          |
| **PayPal Agent Toolkit** | An invoice-only receipt workflow. The hosted worker orchestrates its fixed steps; server code independently verifies the completed capture and invoice before showing a paid receipt.                                                                                                                            |
| **Gemini**               | Repair planning, transcription of recorded requests, and structured extraction of quote details from scripted conversations.                                                                                                                                                                                     |
| **Vercel AI SDK**        | The `ai` package and `@ai-sdk/google` connect Gemini to planning, transcription and schema-validated quote extraction. The receipt tooling also uses the toolkit's AI SDK adapter.                                                                                                                               |
| **Kernel**               | A real cloud browser reads the configured public Harare plumbing directory. The app retains source links, lookup time, and session evidence. Six directory leads were verified in the hosted flow.                                                                                                               |
| **Channel3**             | Live US-market retail searches for explicitly identified replacement parts. Five USD water-heater offers were verified in the hosted flow. Prices can change.                                                                                                                                                    |
| **Render**               | Hosts the always-running Fastify worker as a Web Service and the PostgreSQL database. The worker runs pg-boss jobs, receives webhooks, and coordinates research, payment processing and reconciliation. [Deployment settings](docs/render-worker.md) document build, migration, start and health-check commands. |
| **Vercel hosting**       | Hosts the Next.js frontend and its server routes, including the request interface, job views and PayPal return/cancel callbacks. This hosting role is separate from Vercel AI SDK usage.                                                                                                                         |

**The quote-board businesses, sample ratings, service quotes, provider confirmations, and conversations are simulated.** The separate Kernel research panel contains real public directory leads; the app does not attribute scripted quotes to those businesses. No real business is called and no real repair is booked in the selected demo.

Directory leads do not confirm availability or suitability. Channel3 prices cover parts only, exclude labour, delivery and taxes, and do not establish compatibility or local availability. Neither research integration changes an agreed quote or approves payment.

Live provider phone conversations remain outside the verified demo scope. An experimental Twilio adapter is included in the repository and stays disabled in the hosted demonstration. The working microphone button is for **dictating the buyer’s request**, not placing provider calls.

<details>
<summary>See the live quote board and partner research</summary>

![Switchboard quote board with simulated service offers, real Kernel directory leads, and Channel3 parts research](docs/screenshots/live-research.png)

Captured during hosted verification on 6 November 2026. Service offers are simulated; directory and retail results came from live integrations. Displayed retail prices are a lookup snapshot.

</details>

## Try it as a judge

No Switchboard registration, installation or API keys are needed to try the hosted app. Complete the flow in the same browser session. For checkout, use the sandbox Personal buyer credentials supplied in the submission's testing instructions, or create your own sandbox buyer through [PayPal Developer](https://developer.paypal.com/dashboard/accounts).

1. Open the [live app](https://switchboard-hjm-technologies.vercel.app) and enter:

   > Replace Mum’s geyser heating element in Avondale, Harare tomorrow, under $120.

   You can also choose **Record request**, allow microphone access, speak, then select **Stop recording**. Review the text before choosing **Find my quotes**. Naming the part lets the demo show Channel3’s parts lookup.

2. Compare the simulated offers: **Tendai Plumbing — $95 with a 30-day guarantee**, and **QuickFix Geysers — $110 with a 90-day guarantee**. Avondale Handyman declines. Tendai’s cheaper appointment is later and is flagged when outside the requested window. Open **Transcript** to inspect each conversation.
3. Scroll to **Research behind your request** to inspect Kernel directory sources and Channel3 parts offers. These are separate from the simulated quote providers.
4. Choose **Book** on Tendai’s $95 offer, then approve the authorization in **PayPal sandbox**. Use a sandbox Personal buyer account—not a real PayPal login. Test accounts can be created through [PayPal Developer → Sandbox Accounts](https://developer.paypal.com/dashboard/accounts). Sandbox test access belongs in the submission’s testing instructions; developer/API credentials are never needed by judges. After returning to Switchboard, expect **$95.00 held**, with no capture or payout yet.
5. Once the booking is confirmed, select **Show payout recipient** and review the destination. Choose **Fast-forward to completion** to skip the demo appointment wait; this does not approve payment.
6. Select **Mark done · release payment**. Follow the capture and payout statuses, then open **View receipt** when the paid invoice has been verified. For a successful test, confirm **capture COMPLETED**, **payout SUCCEEDED**, and an independently verified **PAID receipt**. A pending or unclaimed payout is displayed separately and is not a successful payout.

For alternate outcomes, start a separate job and choose **Cancel booking** before capture, or **Not done · keep funds held** at completion. External APIs may take time or hit rate limits; the app preserves saved job state and reports unavailable research rather than substituting invented results.

Job access uses a signed anonymous browser cookie. Switching browsers or private windows creates a different session.

### Troubleshooting the hosted demo

- **Microphone unavailable:** type the request instead. Voice transcription requires microphone permission and a live Gemini connection.
- **PayPal checkout:** sign in only on `sandbox.paypal.com` or `www.sandbox.paypal.com` with a sandbox Personal buyer. Switch accounts if a different buyer is already signed in, then let checkout return to the original Switchboard session.
- **Payment still pending:** wait for the displayed provider status. Reconciliation polling begins after 60 seconds for pending capture/payout settlement. Avoid repeatedly submitting payment actions.
- **Research unavailable:** the interface reports provider failures; directory and retail results are not prerequisites for choosing a simulated quote.
- **Job missing in another browser:** return to the browser that created it. Job access depends on its signed session cookie.

## How it works

```mermaid
flowchart TD
    Request["Typed or spoken repair request"] --> Brief["Gemini: structured brief"]
    Brief --> Quotes["Scripted provider conversations<br/>Gemini quote extraction"]
    Brief --> Research["Kernel directory leads<br/>Channel3 parts research"]
    Quotes --> Review["Buyer reviews quotes and evidence"]
    Research --> Review
    Review --> Book["Approval 1: PayPal sandbox authorization"]
    Book --> Done["Provider confirmation: simulated<br/>Buyer reviews payout recipient"]
    Done --> Complete["Approval 2: buyer confirms completion"]
    Complete --> Payment["Server: capture, payout, verified receipt"]
```

The **Next.js** frontend runs on **Vercel**. A **Fastify** worker on **Render** processes durable jobs through **pg-boss**. **Render PostgreSQL** stores job state, quotes, transcripts, events, and the payment ledger. Server-sent events keep the interface updated; **AG Grid Community** powers desktop comparison, with a dedicated mobile quote view.

The server payment engine owns monetary actions. AI tools cannot authorize, capture, void, or pay out funds. Booking and completion require separate buyer approvals. Amount and recipient guards, transactional outbox effects, provider idempotency keys, verified webhooks, and reconciliation polling protect the sequence across retries and worker restarts. Startup rejects any `PAYPAL_ENV` other than `sandbox`.

For the configured directory, Kernel reads structured listing cards directly and checks names, contacts, and source links against page evidence. This avoids an extra Gemini request for that supported source. Directory coverage is limited to the configured Harare plumbing demonstration.

## Technology and implementation references

The application uses **TypeScript**, **React/Next.js**, **Tailwind CSS**, **Node.js 24**, **Fastify**, **PostgreSQL**, **Drizzle ORM**, **pg-boss**, **AG Grid Community** and **Zod**. **pnpm** manages the workspace, **Docker Compose** supplies the local database, and **Vitest/Playwright** provide automated verification. Dependency names and versions are recorded in [package.json](package.json), [the web package](apps/web/package.json), and [pnpm-lock.yaml](pnpm-lock.yaml).

| Area                            | Implementation and documentation                                                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PayPal REST and monetary guards | [PayPal adapter](packages/paypal/src/index.ts), [payment engine](packages/engine/src/money.ts), [receipt verification](packages/paypal/src/receipts.ts), [sandbox setup](docs/paypal-sandbox.md)                              |
| Gemini through Vercel AI SDK    | [Planner and extractor](packages/agents/src/gemini.ts), [voice transcription](packages/agents/src/transcribe.ts), [invoice-only Agent Toolkit workflow](packages/agents/src/receipt.ts)                                       |
| Kernel and Channel3             | [Kernel browser adapter](packages/partners/src/kernel.ts), [Channel3 search adapter](packages/partners/src/channel3.ts), [research orchestration](packages/partners/src/research.ts), [setup guide](docs/partner-research.md) |
| Render and persistence          | [Worker entry point](apps/worker/src/index.ts), [database package](packages/db), [Render deployment guide](docs/render-worker.md)                                                                                             |
| Vercel frontend                 | [Next.js application](apps/web), [Vercel project settings](apps/web/vercel.json), [PayPal checkout callbacks](apps/web/app/jobs/%5Bid%5D/paypal)                                                                              |
| Manual API review               | [Postman-compatible collection](docs/switchboard.postman_collection.json) is supplied for exercising the API. This is a review artifact, not a Postman/Astro runtime integration.                                             |

## Run locally without service keys

Requires **Node.js 24**, **pnpm 11.25**, and **Docker Compose** (or PostgreSQL 16).

```sh
git clone https://github.com/harrymakoni-netizen/switchboard.git
cd switchboard
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm exec tsx --env-file=.env packages/db/src/migrate.ts
pnpm dev
```

Open **http://localhost:3000**. The worker runs on port **4000**; the Compose database is exposed on **5433**, matching `.env.example`.

The example configuration uses mock AI, payments, discovery, and conversations. PostgreSQL is still required. Mock checkout approves automatically, so no PayPal login or external API key is needed. To see illustrative research locally, set `PARTNER_RESEARCH_MODE=mock` before starting. Voice transcription needs a live Gemini connection; offline mode leaves typing available and does not invent a transcript.

For live integrations, configure secrets in the relevant deployment environment and follow the guides below. Keep `PAYPAL_ENV=sandbox`. The hosted demo retains simulated quote providers and calls while enabling live research separately. Never commit API keys or sandbox passwords.

## Verification

As of **6 November 2026**:

- **235 automated tests** and **20 browser scenarios** passed, including payment guards, idempotency, session isolation, research, and voice-input recovery.
- Strict TypeScript checks, ESLint, and the production build passed; desktop and 375px mobile renders were inspected.
- Hosted checks verified Gemini planning and quote extraction, Kernel directory leads, Channel3 parts offers, and native browser recording through the real Gemini transcription endpoint.

### Recorded sandbox payment

A recorded hosted run on **6 November 2026** ended in job state `CLOSED` with one $95 capture, one successful $95 payout, and an independently verified paid invoice:

| Record | Provider reference | Recorded result |
| --- | --- | --- |
| Capture | `015155227R373833T` | `COMPLETED` · $95.00 USD |
| Payout | `YX7SR4837TKYW` | `SUCCEEDED` · $95.00 USD |
| Invoice | `INV2-UADH-JS7Y-GG2D-BQPJ` | `PAID` · server verification passed |

These references belong to job `46a88c11-2573-4396-9b0f-a4ce1572b765`. They document that run rather than guaranteeing future API availability. Sandbox payment completion does not prove a real repair occurred or that receipt email was delivered.

Automated payment tests use provider mocks; the hosted results above are separate, dated checks.

To repeat local checks, complete the local setup above and use a disposable development database. Stop `pnpm dev` before the browser suite so Playwright can start the production web server and worker:

```sh
export DATABASE_URL=postgres://switchboard:switchboard@localhost:5433/switchboard
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm exec playwright install chromium
PARTNER_RESEARCH_MODE=mock pnpm e2e:mock
```

The browser suite starts the production web server and worker. Tests use synthetic data and stub external provider requests; they do not move real money.

## Project structure and guides

| Path                              | Responsibility                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/web`                        | Request form, voice input, quote board, job APIs, checkout callbacks, live updates        |
| `apps/worker`                     | Durable background work, partner research, confirmations, payment scheduling and recovery |
| `packages/engine`                 | State transitions, buyer approvals, monetary guards and payment execution                 |
| `packages/paypal`                 | Sandbox REST adapter, webhook verification and receipt verification                       |
| `packages/agents`                 | Gemini planning, transcription, extraction and invoice-only receipt tooling               |
| `packages/partners`               | Kernel directory discovery and Channel3 parts-price research                              |
| `packages/db`                     | Schema, migrations, events and payment ledger                                             |
| `packages/calls`, `packages/bots` | Telephony interfaces and simulated provider conversations                                 |

Setup and implementation details: [PayPal sandbox](docs/paypal-sandbox.md) · [Invoice receipt boundaries](docs/paypal-receipts.md#boundaries) · [Kernel and Channel3](docs/partner-research.md) · [Voice input](docs/voice-input.md) · [Render worker](docs/render-worker.md) · [Twilio status](docs/twilio-trial.md).

The web project uses `apps/web` as its Vercel root, includes monorepo sources outside that directory, and connects to the hosted worker and PostgreSQL. Deployment secrets remain outside the repository; see [.env.example](.env.example) for variable names.

## License

[MIT](LICENSE) — an [OSI-approved open-source license](https://opensource.org/license/mit).
