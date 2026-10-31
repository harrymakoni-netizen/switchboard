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
