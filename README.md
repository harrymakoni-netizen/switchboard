# Switchboard

A buyer’s assistant for arranging a home repair: one brief, evidence-backed quote comparison, and two explicit payment approvals.

**[Open Switchboard](https://switchboard-hjm-technologies.vercel.app) · [Demo walkthrough](https://switchboard-hjm-technologies.vercel.app/demo) · [Submission draft and video script](docs/hackathon-submission.md)**

The hosted demonstration uses **Gemini and PayPal sandbox APIs** with persistent Postgres state and a Render worker. Quote providers and phone conversations are **simulated**, clearly labeled throughout the interface. Optional Kernel research retrieves real directory leads separately, and Channel3 supplies advisory parts prices. No real repairs are booked or real money moved. A complete offline mode also runs without provider API keys.

## For judges

1. Open the hosted demo in one browser, select the sample repair, then **Find my quotes**.
2. Compare Tendai’s $95 quote and 30-day guarantee with QuickFix’s $110 quote and 90-day guarantee. The cheaper provider offers a later appointment; times outside your requested window are flagged. Avondale declines. All names, prices, ratings, and conversations are synthetic demo data.
3. Open **Transcript** to inspect the evidence, then **Book** a quote within budget.
4. Approve using a **PayPal sandbox Personal buyer account**. Your real PayPal account is not a sandbox buyer login. Create a test buyer at [PayPal Developer → Sandbox Accounts](https://developer.paypal.com/dashboard/accounts), or use sandbox test access supplied privately with the submission. Never publish real credentials or developer API secrets.
5. Once confirmed, select **Show payout recipient**, review it, then **Fast-forward to completion**.
6. **Mark done · release payment** captures the authorized amount and initiates payout. Watch the provider status and open **View receipt** when ready. Unclaimed payouts are distinguished from completed payouts.

To test the other outcomes, **Cancel booking** requests voiding before capture; **Not done · keep funds held** records an issue without capture. Keep the same browser session: access is protected by a signed anonymous cookie. Avoid private-window switching mid-checkout.

| Capability | Hosted demonstration | Offline setup |
| --- | --- | --- |
| Brief planning and quote extraction | Gemini, strict validated output | Deterministic mock |
| Comparison | AG Grid desktop; complete quote details and booking controls on mobile | Same interface |
| Authorize, capture, void, payout | PayPal sandbox API | Stateful mock adapter |
| Invoice receipt | PayPal invoice workflow, independently verified before display | Printable mock receipt |
| Discovery and conversations | Configured providers and scripted transcripts | Same simulation |

Live phone conversations remain unfinished. Kernel directory discovery and Channel3 parts-price research are implemented behind an optional configuration flag; Both have passed hosted verification: six sourced directory leads and five USD parts offers. The configured directory covers the Harare plumbing demonstration; it does not establish service availability or coverage elsewhere. The default demo still uses simulated businesses. See [partner setup and verification](docs/partner-research.md). Twilio placed calls in a separate integration test, but the custom questionnaire has not been verified. See [telephony status](docs/twilio-trial.md).

## Run locally

Requires Node 24, pnpm 11, Docker (or your own PostgreSQL 16).

```sh
cp .env.example .env
pnpm install
# Starts local PostgreSQL with development-only credentials.
docker compose up -d --wait
pnpm exec tsx --env-file=.env packages/db/src/migrate.ts
pnpm dev
```

Open **http://localhost:3000**. The worker listens on port 4000. Keep all `MOCK_*` flags at `1` and `PAYPAL_ENV=sandbox`. Change `SESSION_SECRET` before any hosting. Web configuration loads the root `.env`; worker dev startup uses `--env-file=.env`. PostgreSQL is required in mock mode; no external service keys are needed.

The Docker Compose database is exposed on port **5433**. Set DATABASE_URL in `.env` to that local port before migrating and starting the app. Standalone test commands need DATABASE_URL exported in their environment.

Try **“Fix Mum’s geyser in Avondale tomorrow, under $120”**:

1. Watch three demo businesses get called in parallel: Tendai quotes $95, QuickFix quotes $110, and Avondale declines.
2. Open **Transcript** to inspect the disclosed simulated conversation. This is text, not a recording.
3. Choose **Book**. Mock approval redirects automatically and records a sandbox hold; no charge occurs.
4. Wait for booking confirmation. Click **Show payout recipient** and review the email.
5. Use **Fast-forward to completion**, then **Mark done · release payment**.
6. The job closes with a capture, payout, and a printable mock receipt.

Alternatively, **Cancel booking** before completion to void the hold. **Not done** moves the job to ISSUE and retains the hold. Quotes, calls, events, and payments persist in Postgres across refreshes. Mock authorization state is restored from the ledger when the worker restarts.

## Validate

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm e2e:mock
```

The e2e command starts the production web server and worker, so run `pnpm build` first. A local Postgres instance must already be running and migrated. Tests make no external service calls. The Vitest integration tests write synthetic jobs into the local development database; use a disposable database when evaluating the suite.

## Architecture

- `apps/web`: Next.js App Router, Tailwind, AG Grid Community, signed httpOnly anonymous sessions, authenticated job APIs, and SSE.
- `apps/worker`: Fastify and pg-boss. Dispatches committed outbox effects, mock calls, booking confirmations, delayed slots, capture/payout/void, polling, receipts, and reauthorization.
- `packages/engine`: strict state graph and guards. Transitions lock the job row in a transaction and atomically write state, events, and durable side-effect intents. Payment execution lives exclusively in `packages/engine/src/money.ts` and runs after commit; the worker only schedules these engine operations.
- `packages/db`: Drizzle schema, SQL migration, queries, payment ledger, and Postgres LISTEN/NOTIFY.
- `packages/paypal`: sandbox-only REST adapter, mock stateful adapter, verified webhook inbox, polling, capture/order checks, and independent invoice verification.
- `packages/agents`: Gemini structured JSON with strict validation and a transient-error model fallback, deterministic mock planner/extractor, finder schema, and an invoice-only receipt agent. The receipt agent adapts PayPal Agent Toolkit's older tool interface to the installed AI SDK's ToolLoopAgent. Agents cannot authorize, capture, void, refund, or pay out funds.
- `packages/calls` / `packages/bots`: typed telephony boundary, AI disclosure, bounded concurrent mock conversations, SMS templates, and three synthetic bot personas.
- The worker also supports an opt-in Twilio turn-based trial adapter with signed callbacks and durable call turns. It remains disabled until account and verified-recipient tests pass. See [Twilio trial setup and limits](docs/twilio-trial.md).

All code is newly written from the supplied scope. No RollCall source was provided or reused. No stretch features have been implemented. The API uses a Next.js optional catch-all implementation while exposing the specified URLs; PayPal return/cancel handlers are separate routes.

## Safety boundaries

- Startup rejects `PAYPAL_ENV` other than `sandbox`.
- Quote prices are integer USD cents. Booking rejects missing, declined, cross-job, or over-budget quotes.
- Book authorizes; completion approval captures. Recipient review is required before completion.
- Capture requires a confirmed completion and held authorization. Payout is fixed to the chosen business’s confirmed email and the captured amount.
- Unique ledger request IDs and provider idempotency keys protect retryable payments. Cancellation is refused after capture or while capture is pending.
- Job access is isolated by a signed anonymous cookie; no accounts or passwords.
- Runtime secrets are not committed.

## Integration status and deployment

The hosted project has working PayPal sandbox and Gemini configuration. Local setup defaults to all mocks. **Keep `MOCK_TELEPHONY=1` and `MOCK_PARTNERS=1` for the selected hackathon demo scope.** No paid voice upgrade is required to evaluate that scope.

Live-provider acceptance still requires a final fresh-browser sandbox run before recording the submission. Hosted PayPal order creation and Gemini planning/extraction have been exercised with real provider credentials; the owner reported successful sandbox capture, payout, and receipt viewing. Automated checks use mocks and are not evidence of fresh provider availability. See [receipt implementation](docs/paypal-receipts.md), [trial calling limits](docs/twilio-trial.md), and [release checklist](docs/hackathon-submission.md).

Configure the variables listed in `.env.example` through environment secrets. For PayPal, create a sandbox business account and REST app with Payouts, a sandbox personal buyer, and personal recipient accounts for the two accepting bots. Set `TENDAI_PAYOUT_EMAIL` and `QUICKFIX_PAYOUT_EMAIL` to those sandbox recipient emails. Demo `example.com` addresses must be replaced before real sandbox runs.

The worker is a Render **web service** with HTTPS callbacks and a pre-deploy migration command. See [deployment instructions](docs/render-worker.md). A [Postman collection](docs/switchboard.postman_collection.json) covers the explicit API actions; its requests never automatically execute the next payment step.

## Design

Public Sans is self-hosted under `apps/web/public/fonts` with its OFL license. The interface uses a cobalt shell, cool light workspace, restrained green state feedback, and a data-first board. Screenshots are under `docs/`. Design preferences are documented in [DESIGN.md](DESIGN.md).

## Vercel deployment

Project: `switchboard`, team: `hjm-technologies`. Production alias: https://switchboard-hjm-technologies.vercel.app. Production is publicly accessible; preview deployments retain Vercel Authentication protection.

Root directory: `apps/web`. Install: `cd ../.. && pnpm install --frozen-lockfile`. Build: `pnpm build`. Node: 24.x for the initial deployment. The monorepo source outside the root directory must be included.

Production has `HOSTED_UI_ONLY=0` and connects to the persistent Render worker at https://switchboard-worker-1naa.onrender.com. Preview remains interface-only. Do not set DATABASE_URL or PUBLIC_WORKER_URL to localhost on Vercel. Vercel uses Render's external Postgres URL with TLS; Render uses the database's internal URL. Both services share SESSION_SECRET. See [worker deployment](docs/render-worker.md).

Production keeps `PAYPAL_ENV=sandbox`, `DEMO_MODE=1`, `MOCK_TELEPHONY=1`, and `MOCK_PARTNERS=1`; PayPal and Gemini are enabled separately with `MOCK_PAYPAL=0` and `MOCK_LLM=0`. Do not copy production configuration into local offline tests.

Repository source is pushed to `main`. The initial project was deployed from inline source; repository-based deployments are supported and verified separately. Automatic deployment on every push still requires connecting this repository under the existing Vercel project’s Settings → Git.

## Integration 1: PayPal payments

Sandbox checkout, authorization, capture, void, payouts, verified webhooks, and invoice receipts are implemented. See [PayPal setup and acceptance checks](docs/paypal-sandbox.md) and [receipt recovery and verification](docs/paypal-receipts.md). M7 has not passed in full.

## Gemini configuration

Gemini handles planning, quote extraction, directory interpretation, and the invoice-only receipt agent. AI agents have no tools for authorization, capture, void, refund, or payout.

Mock mode (`MOCK_LLM=1`) needs no Google API key and makes no Gemini requests. When ready to test real AI calls, create a key at https://aistudio.google.com/apikey and set these variables in the web and worker environments:

```text
GEMINI_API_KEY=<Google AI Studio API key>
GEMINI_MODEL=gemini-3.6-flash
GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite
MOCK_LLM=0
```

The model is configurable; use a Gemini model available to your Google account. The default is the latest Flash text model listed by the model catalog and installed provider at the time of this change (2026-11-03), chosen for brief planning and extraction latency. This setup calls Google directly with the key supplied to `createGoogle`; it does not require an AI Gateway account. Old provider credentials are no longer used.

Both the planner's brief/follow-up union and the finder's business array are sent as JSON schemas. Invalid output is rejected, with one validation retry. Temporary HTTP 500/502/503/504 failures can switch once to the fallback model; authentication and quota errors do not. Structured-output calls have a 30-second timeout. Live hosted planning and quote extraction passed; offline tests exercise Google's provider with in-process HTTP stubs.

Optional hackathon partner research: [Kernel + Channel3 configuration](docs/partner-research.md). Set `PARTNER_RESEARCH_MODE=mock` for offline research or `live` with worker credentials and an approved directory URL. Keep demo quotes separate from real directory leads. The previously recorded demo does not show these new integrations.
