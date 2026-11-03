# Decisions

- Use the supplied scope as repository AGENTS.md. Preserve milestone gates; do not claim credential-dependent milestones passed without evidence.
- Render and the specified Next.js/Postgres stack take precedence over Sites hosting.
- Use a real local Postgres 16 in mock mode; offline means external services are mocked, not persistence.
- No RollCall repository was supplied; call orchestration will be built from this specification.
- Use UTC storage, Africa/Harare display, USD integer cents.
- Default to the explicit brief for design decisions, as the scope authorizes choosing the simplest compliant option.
- Use a transactional outbox (`effects`) so committed transitions survive worker crashes; the dispatcher enqueues pg-boss tasks only after commit. Provider idempotency keys protect retryable money effects.
- Consolidate web API implementation in a Next.js optional catch-all route while preserving all specified public URLs.
- Mock service personas use the specified prices and synthetic phone numbers; no outbound calls occur in mock mode.
- Mock planner supports explicit today/tomorrow/in-N-days windows and asks one follow-up for missing fields. Production semantic planning uses the LLM adapter.
- Redirects use configured APP_URL rather than Next's request origin, because a server bound to 0.0.0.0 otherwise emits unusable callback URLs.
- Self-host Public Sans (OFL) to keep the UI typography available offline. Lazy-load AG Grid so the request page and job shell do not download the grid unnecessarily.

- Completion approval uses the specified in-app Mark done path in mock mode. No buyer phone field is specified, so mock mode does not pretend to call an unknown customer number.
- Real telephony is explicitly refused in this M6 build. M7 is not represented as implemented or verified; deployment remains gated on its manual acceptance.

- All PayPal order, authorization, capture, void, payout, and reauthorization execution lives in `packages/engine/src/money.ts`. The worker injects adapters and schedules engine methods; LLM agents cannot execute them.

- The user explicitly changed the hosting target to Vercel and requested GitHub publication; this supersedes the original Render/deployment milestone gate for publishing the current mock build.
- The Vercel web deployment uses `HOSTED_UI_ONLY=1` until hosted Postgres and the background worker are connected. This visibly disables booking and returns HTTP 503 from booking APIs instead of pretending that local services are accessible from Vercel. Local mock mode remains fully functional.

- Integrate providers one at a time, starting with PayPal core payments. On 2026-10-31 the user chose “Finish and test the code first; configure credentials later.” No actual sandbox-account verification is claimed.
- Verified webhook IDs are persisted with outbox intents in one transaction; the worker runs money reconciliation after commit. Raw provider JSON is reloaded as text to preserve snake_case fields despite the database client's JSON camelCase transformation.
- Payout settlement is based on the recipient item's transaction_status. A SUCCESS batch with no item status remains PENDING. UNCLAIMED closes the job per the scope but is labelled awaiting claim.
- Provider execution and webhook reconciliation use a per-job session advisory lock. Committed ledger rows are reused on retry, including recovery between an authorization/payout ledger write and its state transition.
- The standalone sandbox smoke fixture is fixed at $1.00 per leg, requires the buyer to approve both orders, and requires a separate --confirm-done flag before capture. Payout requires an explicitly configured sandbox recipient. Smoke money execution stays in the engine package.
- The PayPal invoice-only Agent Toolkit remains the next payment-related integration; real mode does not fabricate a receipt.

- On 2026-11-03 the user explicitly replaced Anthropic with Google Gemini. This supersedes the original provider choice in the scope. Web and worker use GeminiLLM with the existing LLM interface; all mock flows remain available without a key.
- Use `ai` + `@ai-sdk/google` with `createGoogle` and schema-backed `Output.object`. Direct Google access uses GEMINI_API_KEY and avoids adding another gateway credential. The pending PayPal receipt-agent design uses the same Google provider.
- Default GEMINI_MODEL to gemini-3.8-flash, verified in the current model catalog and the installed Google provider's supported IDs. Flash suits the latency and cost of brief planning and quote extraction; operators can override the model for their account.
- The migration also corrects the finder's E.164 regex so valid directory phone numbers pass its schema. Gemini transport tests cover brief/follow-up unions, quote nulls, business arrays, schema retries, and provider failure handling without network calls.

- The current AI SDK and Google provider require Node >=22. Pin this project to Node 24, matching the existing Vercel project and the runtime used for verification.
- Gemini migration verification: lint, strict typecheck, production build, 105 unit/integration tests, and six mock browser scenarios pass. Database tests ran against the configured local Postgres service on 5433 via an explicit DATABASE_URL; the separately reviewed fallback-port issue was not changed in this migration. No live Google requests were made.

- Render worker deployment uses a Web Service with /health and a separate pre-deploy migration command. PUBLIC_WORKER_URL falls back to Render's trusted RENDER_EXTERNAL_URL when unset, avoiding a first-deployment URL configuration loop. Explicit worker URL overrides are preserved.
- Hosted verification found Render's external Postgres endpoint rejects the initial Vercel connection with "SSL/TLS required". Both postgres.js pools now enable TLS with certificate validation on Vercel; Render internal and local connections retain their existing settings.
