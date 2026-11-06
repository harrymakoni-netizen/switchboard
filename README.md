# Switchboard

**Your call. Our legwork.**

Turn one home-repair request into comparable quotes, a booking, and a verified PayPal sandbox receipt—with the buyer approving both the booking and the release of payment.

**[Try the live demo](https://switchboard-hjm-technologies.vercel.app) · [Open the walkthrough](https://switchboard-hjm-technologies.vercel.app/demo)**

Built for the **PayPal AI Hackathon**.

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

## What is live—and what is simulated

The hosted build connects to real provider APIs. **All PayPal transactions use sandbox funds.**

| Integration | Role in the hosted demo |
| --- | --- |
| **PayPal** | Sandbox checkout, authorization, capture, void, payouts, verified webhooks, and invoice receipts. A hosted $95 capture, successful payout, and verified PAID receipt were exercised. |
| **PayPal Agent Toolkit** | An invoice-only receipt workflow. The hosted worker orchestrates its fixed steps; server code independently verifies the completed capture and invoice before showing a paid receipt. |
| **Gemini** | Repair planning, transcription of recorded requests, and structured extraction of quote details from scripted conversations. |
| **Kernel** | A real cloud browser reads the configured public Harare plumbing directory. The app retains source links, lookup time, and session evidence. Six directory leads were verified in the hosted flow. |
| **Channel3** | Live US-market retail searches for explicitly identified replacement parts. Five USD water-heater offers were verified in the hosted flow. Prices can change. |

**The quote-board businesses, sample ratings, service quotes, provider confirmations, and conversations are simulated.** The separate Kernel research panel contains real public directory leads; the app does not attribute scripted quotes to those businesses. No real business is called and no real repair is booked in the selected demo.

Directory leads do not confirm availability or suitability. Channel3 prices cover parts only, exclude labour, delivery and taxes, and do not establish compatibility or local availability. Neither research integration changes an agreed quote or approves payment.

Live provider phone conversations remain outside the verified demo scope. An experimental Twilio adapter is included in the repository and stays disabled in the hosted demonstration. The working microphone button is for **dictating the buyer’s request**, not placing provider calls.

<details>
<summary>See the live quote board and partner research</summary>

![Switchboard quote board with simulated service offers, real Kernel directory leads, and Channel3 parts research](docs/screenshots/live-research.png)

Captured during hosted verification on 6 November 2026. Service offers are simulated; directory and retail results came from live integrations. Displayed retail prices are a lookup snapshot.

</details>

## Try it as a judge

Use the same browser session throughout the flow.

1. Open the [live app](https://switchboard-hjm-technologies.vercel.app) and enter:

   > Replace Mum’s geyser heating element in Avondale, Harare tomorrow, under $120.

   You can also choose **Record request**, allow microphone access, speak, then select **Stop recording**. Review the text before choosing **Find my quotes**. Naming the part lets the demo show Channel3’s parts lookup.

2. Compare the simulated offers: **Tendai Plumbing — $95 with a 30-day guarantee**, and **QuickFix Geysers — $110 with a 90-day guarantee**. Avondale Handyman declines. Tendai’s cheaper appointment is later and is flagged when outside the requested window. Open **Transcript** to inspect each conversation.
3. Scroll to **Research behind your request** to inspect Kernel directory sources and Channel3 parts offers. These are separate from the simulated quote providers.
4. Choose **Book** on Tendai’s $95 offer, then approve the authorization in **PayPal sandbox**. Use a sandbox Personal buyer account—not a real PayPal login. Test accounts can be created through [PayPal Developer → Sandbox Accounts](https://developer.paypal.com/dashboard/accounts). Keep test access details in the submission’s private testing instructions.
5. Once the booking is confirmed, select **Show payout recipient** and review the destination. Choose **Fast-forward to completion** to skip the demo appointment wait; this does not approve payment.
6. Select **Mark done · release payment**. Follow the capture and payout statuses, then open **View receipt** when the paid invoice has been verified. Pending and unclaimed payouts remain distinguishable from successful payouts.

For alternate outcomes, start a separate job and choose **Cancel booking** before capture, or **Not done · keep funds held** at completion. External APIs may take time or hit rate limits; the app preserves saved job state and reports unavailable research rather than substituting invented results.

Job access uses a signed anonymous browser cookie. Switching browsers or private windows creates a different session.

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

The **Next.js** frontend runs on **Vercel**. A **Fastify** worker on **Render** processes durable jobs through **pg-boss**. **PostgreSQL** stores job state, quotes, transcripts, events, and the payment ledger. Server-sent events keep the interface updated; **AG Grid Community** powers desktop comparison, with a dedicated mobile quote view.

The server payment engine owns monetary actions. AI tools cannot authorize, capture, void, or pay out funds. Booking and completion require separate buyer approvals. Amount and recipient guards, transactional outbox effects, provider idempotency keys, verified webhooks, and reconciliation polling protect the sequence across retries and worker restarts. Startup rejects any `PAYPAL_ENV` other than `sandbox`.

For the configured directory, Kernel reads structured listing cards directly and checks names, contacts, and source links against page evidence. This avoids an extra Gemini request for that supported source. Directory coverage is limited to the configured Harare plumbing demonstration.

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
- A recorded PayPal sandbox run verified one $95 capture, one successful $95 payout, and an independently verified PAID invoice receipt.

Automated payment tests use provider mocks. Hosted checks are point-in-time evidence and do not guarantee ongoing external API availability.

To repeat local checks, start and migrate a disposable development database first:

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

| Path | Responsibility |
| --- | --- |
| `apps/web` | Request form, voice input, quote board, job APIs, checkout callbacks, live updates |
| `apps/worker` | Durable background work, partner research, confirmations, payment scheduling and recovery |
| `packages/engine` | State transitions, buyer approvals, monetary guards and payment execution |
| `packages/paypal` | Sandbox REST adapter, webhook verification and receipt verification |
| `packages/agents` | Gemini planning, transcription, extraction and invoice-only receipt tooling |
| `packages/partners` | Kernel directory discovery and Channel3 parts-price research |
| `packages/db` | Schema, migrations, events and payment ledger |
| `packages/calls`, `packages/bots` | Telephony interfaces and simulated provider conversations |

Setup and implementation details: [PayPal sandbox](docs/paypal-sandbox.md) · [Invoice receipt boundaries](docs/paypal-receipts.md#boundaries) · [Kernel and Channel3](docs/partner-research.md) · [Voice input](docs/voice-input.md) · [Render worker](docs/render-worker.md) · [Twilio status](docs/twilio-trial.md).

The web project uses `apps/web` as its Vercel root, includes monorepo sources outside that directory, and connects to the hosted worker and PostgreSQL. Deployment secrets remain outside the repository; see [.env.example](.env.example) for variable names.

## License

[MIT](LICENSE).
