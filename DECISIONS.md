# Decisions

- 2026-11-05: After reviewing the official hackathon requirements, the owner delegated preparation of a stronger submission. The release baseline is a clearly labeled simulation of business discovery/conversations, with the existing hosted Gemini and PayPal sandbox integrations. Live voice is unfinished and is not a release gate for this selected demo scope. This updates the original phone-bot assumption without claiming organizer approval of a particular submission.
- 2026-11-05: Desktop keeps AG Grid comparison; mobile uses full-detail provider rows so booking and transcript controls require no sideways scrolling. Requested-time-window conflicts are flagged but the buyer may consciously choose a later quote. Server budget, recipient, approval, sandbox, and idempotency boundaries are unchanged.

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
- Live Gemini setup confirmed the key and model catalog, but newer Flash models intermittently returned 503 high-demand errors. Production overrides GEMINI_MODEL to gemini-3.6-flash. For transient HTTP 500/502/503/504 only, GeminiLLM makes one fallback attempt with gemini-3.5-flash-lite, verified against Google's structured-output endpoint; GEMINI_FALLBACK_MODEL can override it. Both models retain the same validation and low reasoning effort. Authentication, quota, and bad-request errors do not switch models. Validation retries stay on the model already in use.
- Receipt generation uses the published PayPal Agent Toolkit 1.11.0 invoice capabilities through a narrow SDK 4 → SDK 7 adapter. A ToolLoopAgent chooses only the next fixed invoice operation; tool inputs cannot alter amounts, recipients, or capture IDs. One line item preserves the captured quote total without inventing a parts/labour split. Provider reads verify capture/order identity and independently verify the paid invoice and matching payment before display.
- Invoice checkpoints and deterministic provider keys recover interrupted tasks. Existing completed sandbox captures are backfilled on worker startup; mock captures are excluded. Invoice webhook notifications enqueue verification rather than promoting an invoice to PAID. A paid invoice that PayPal refuses to resend remains available, with unconfirmed email notification explicitly recorded.
- On 2026-11-04 the user explicitly chose to stay on Twilio's limited trial and use turn-by-turn speech prompts. The trial blocks Media Streams, so this stage uses bounded Say/Gather questionnaires and Gemini text extraction. The original streaming bridge remains deferred. Twilio credentials stay on the worker; no separate voice-provider API key is required for this path.
- Call turn state and cached TwiML responses persist in voice_sessions. Signed callbacks are correlated against the expected account, caller/callee and provider call ID. An outbound attempt is reserved before contacting Twilio; uncertain requests are never automatically redialed. Trial custom SMS is skipped, audio recording stays off, and customer completion approval remains in the app. Real app calling requires an explicit custom-trial-test verification flag and three distinct verified demo recipients. Mock calling remains enabled until those tests pass.

## 2026-11-05 — Hackathon partner research

- Kernel and Channel3 are optional, independently queued job research (`PARTNER_RESEARCH_MODE=off|mock|live`, default off). The existing judge booking/payment demo stays intact while credentials are configured later at the user's request.
- Kernel uses its current SDK remote Playwright execution endpoint, with fixed read-only code and a bounded, hostname-restricted browser session. Store source evidence and session ID; do not expose browser control credentials.
- Judge-mode real directory leads remain separate from simulated quote providers. Outside judge mode, Kernel replaces the finder placeholder; real businesses cannot acquire simulated quotes. Insufficient evidence is not padded to three results.
- Channel3 provides a USD US-market retail parts benchmark only for an explicit part hint. One cheapest offer per returned product contributes to the median. No automatic payment or provider-price changes, no invented fallbacks, and no diagnosis from a vague repair request. Counteroffer automation remains deferred until the voice integration supports and verifies it.
- Research snapshots reuse the owned-job event stream; no schema migration is required. Manual retries use the durable outbox with a one-minute request cooldown.

- Live Kernel verification retrieved the fixed public Harare plumber directory. Directory configuration now accepts a fixed URL as well as a complete query/location template; this avoids pretending a static category page performs a dynamic search. Directory coverage is explicitly limited to this demo area/trade.

## 2026-11-06 — Hosted research acceptance

- Channel3 succeeded in the hosted job; Kernel failed twice despite successful direct browser retrieval. Persist only safe failure stage/class/status for the owning job to distinguish configuration, browser and extraction failures. No SDK messages or secrets are stored.
- Translate the regional part term geyser to water heater for the configured US catalogue and exclude unrelated heating-element categories before calculating the advisory median.

- Kernel hosted failure was Gemini extraction HTTP 429, not browser access. The explicitly supported Harare plumbing directory is now parsed from real listing cards, with the same source/contact checks and recorded extraction method. Other sources retain the model path; no synthetic fallback or quota-driven model switching is introduced. The live adapter returned six leads without invoking Gemini.
