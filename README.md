# Switchboard

A buyer’s assistant for arranging a home repair: one brief, parallel quote calls, a live comparison board, and two explicit payment approvals.

**Current build: M0–M6 offline mock demo.** No real phone calls or money transfers occur. M7 real-service integrations and M8 hosting have not passed; the current Vercel web deployment is interface-only until a hosted database and worker are connected. GitHub publication is pending repository access; there is no real-service judge login yet. See [MILESTONES.md](MILESTONES.md).

## Run locally

Requires Node 20+, pnpm 11, Docker (or your own PostgreSQL 16).

```sh
cp .env.example .env
pnpm install
# Starts local PostgreSQL with development-only credentials.
docker compose up -d --wait
pnpm db:migrate
pnpm dev
```

Open **http://localhost:3000**. The worker listens on port 4000. Keep all `MOCK_*` flags at `1` and `PAYPAL_ENV=sandbox`. Change `SESSION_SECRET` before any hosting. Web configuration loads the root `.env`; worker dev startup uses `--env-file=.env`. PostgreSQL is required in mock mode; no external service keys are needed.

Try **“Fix Mum’s geyser in Avondale tomorrow, under $120”**:

1. Watch three demo businesses get called in parallel: Tendai quotes $95, QuickFix quotes $110, and Avondale declines.
2. Open **Listen** to inspect the disclosed AI conversation. This is a transcript, not a recording.
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
- `packages/paypal`: sandbox-only REST adapter, mock stateful adapter, webhook-verification/deduplication helper, and polling methods. The real webhook-to-engine wiring is pending M7.
- `packages/agents`: Anthropic adapter with validated JSON and one retry, deterministic mock planner/extractor, finder schema, and untrusted-data prompts. These agents have no payment tools.
- `packages/calls` / `packages/bots`: typed telephony boundary, AI disclosure, bounded concurrent mock conversations, SMS templates, and three synthetic bot personas.

All code is newly written from the supplied scope. No RollCall source was provided or reused. No stretch features have been implemented. The API uses a Next.js optional catch-all implementation while exposing the specified URLs; PayPal return/cancel handlers are separate routes.

## Safety boundaries

- Startup rejects `PAYPAL_ENV` other than `sandbox`.
- Quote prices are integer USD cents. Booking rejects missing, declined, cross-job, or over-budget quotes.
- Book authorizes; completion approval captures. Recipient review is required before completion.
- Capture requires a confirmed completion and held authorization. Payout is fixed to the chosen business’s confirmed email and the captured amount.
- Unique ledger request IDs and provider idempotency keys protect retryable payments. Cancellation is refused after capture or while capture is pending.
- Job access is isolated by a signed anonymous cookie; no accounts or passwords.
- Runtime secrets are not committed.

## M7: real integrations still required

The environment has no configured provider credentials. **Keep mock mode enabled.** The worker deliberately refuses real telephony rather than silently substituting mock calls.

Remaining implementation and verification: Twilio outbound calls, signature-validated webhooks and media bridge; selected realtime voice provider; real bot phone numbers; Kernel discovery; PayPal webhook event routing; invoice-only PayPal Agent Toolkit receipt flow; and a manual end-to-end run that matches the sandbox ledger. The sandbox REST methods and Anthropic JSON adapter exist but have not been exercised with live credentials.

Configure the variables listed in `.env.example` through environment secrets. For PayPal, create a sandbox business account and REST app with Payouts, a sandbox personal buyer, and personal recipient accounts for the two accepting bots. Set `TENDAI_PAYOUT_EMAIL` and `QUICKFIX_PAYOUT_EMAIL` to those sandbox recipient emails. Demo `example.com` addresses must be replaced before real sandbox runs.

The scope gates deployment on M7. Render provisioning, `render.yaml`, hosted judge acceptance, the public repository, and the final Postman collection remain M8 work. The Twilio worker must be a Render **web service** for public HTTPS/WSS callbacks.

## Design

Public Sans is self-hosted under `apps/web/public/fonts` with its OFL license. The interface uses a cobalt shell, cool light workspace, restrained green state feedback, and a data-first board. Screenshots are under `docs/`. Design preferences are documented in [DESIGN.md](DESIGN.md).

## Vercel deployment

Project: `switchboard`, team: `hjm-technologies`. Production alias: https://switchboard-hjm-technologies.vercel.app. The project keeps the team’s default Vercel Authentication protection.

Root directory: `apps/web`. Install: `cd ../.. && pnpm install --frozen-lockfile`. Build: `pnpm build`. Node: 24.x for the initial deployment. The monorepo source outside the root directory must be included.

The hosted web deployment has `HOSTED_UI_ONLY=1`: it visibly disables booking and returns HTTP 503 from the API. The database and pg-boss worker must be hosted and configured before removing that flag. Do not set DATABASE_URL or PUBLIC_WORKER_URL to localhost on Vercel. The current long-running worker cannot be assumed to keep running between Vercel Function requests; use a suitable persistent worker host or adapt its queue execution before enabling online booking.

Keep `PAYPAL_ENV=sandbox`, `DEMO_MODE=1`, and all MOCK flags at `1`. Configure `DATABASE_URL`, `PUBLIC_WORKER_URL`, `APP_URL`, and a newly generated `SESSION_SECRET` in both server environments. Run migrations against the dedicated hosted database before enabling requests.
