# Milestone checks

## Selected hackathon submission scope — 5 November 2026

The current release prioritizes a complete, clearly disclosed demo with Gemini and PayPal sandbox, using synthetic provider discovery and scripted conversations. The original live-phone M7 target is unfinished; it is not a requirement imposed by the hackathon. The owner delegated product improvements after reviewing this tradeoff. Historical gates below describe the original implementation sequence and do not imply live telephony has passed.

- Implemented: truthful demo labels, a public `/demo` walkthrough, mobile quote comparison and booking, requested-time-window warnings, buyer approval explanations, recipient review, payment activity, receipt access, keyboard-safe transcript recovery, and a submission/video draft.
- Verified offline: 186 unit/integration tests; ten browser scenarios including two quote choices, over-budget rejection, transcript failure recovery, cancellation, completion, and session isolation; production compilation and strict checks. Screenshots are mock-mode evidence, not live-provider proof.
- Hosted integration evidence from earlier work: real Gemini planning/extraction and PayPal sandbox order creation were exercised; the owner reported successful sandbox completion, payout, and receipt viewing.
- Still required before submission: final hosted sandbox rehearsal with a buyer login, public video, Devpost submission, and uninterrupted judge access. Live phone conversation, automated business-bot phone lines, directory browsing, and custom SMS remain unfinished.

## Original milestone history

- M0: PASS — pnpm install, build, test; startup rejects PAYPAL_ENV=live.
- M1: PASS — PostgreSQL migration, 39 engine tests covering every graph edge, 12 illegal booking states, budget, cross-job, concurrency, shown recipient, and duplicate payment rows.
- M2: PASS (offline gate) — mock capture/payout and void paths; REST sandbox client; webhook verification/deduplication; polling methods. Live PayPal smoke pending credentials.
- M3: PASS — planner/schema tests and all 10 extraction transcript fixtures. Mock extraction is deterministic and deliberately conservative.
- M4: PASS — three parallel disclosed mock conversations, two quotes and one decline; timeout/failure isolation; SMS template test.
- M5: PASS — production build and Playwright browser flow: live rows, transcript disclosure, mock booking approval, funds held; desktop and 375px screenshots inspected.
- M6: PASS — six Playwright scenarios pass: live quote board, full loop CLOSED with exactly one capture/payout and a receipt, cancellation with void, not-done ISSUE with hold kept, and anonymous-session isolation. Latest full verification: lint, typecheck, production build, 63 Vitest tests, and six Playwright scenarios pass. Latest happy path measured at 6.2 seconds.
- M7: IN PROGRESS — PayPal core code is wired: sandbox REST contracts, raw-body verified webhook endpoint, durable inbox/outbox, correlation by stored provider IDs, serialized reconciliation, item-level polling, amount/recipient guards, restart-safe retries, and resumable smoke runner. Verification: lint, strict typecheck, production build, 92 unit/integration tests, and all six browser scenarios pass. Sandbox credential verification is deferred by user request. Invoice toolkit, Twilio/realtime, Kernel, and full manual sandbox acceptance remain open. The LLM provider has been changed to Gemini; lint, strict typecheck, production build, 105 unit/integration tests, and six mock browser scenarios pass. Its real-account verification remains pending credentials.
- M8: gated on M7; public GitHub source and a Vercel interface-only deployment now exist; full hosted booking acceptance is still pending backend provisioning.
- M9: intentionally excluded.

- Kernel/Channel3 follow-up: implemented optional durable directory and parts-price research, distinct from judge-mode quote providers. Live credentials and directory acceptance are deferred by user request; automated and browser verification are recorded in docs/partner-research.md.

- 6 November hosted acceptance: worker/frontend research enabled; both keys and directory configured. Hosted Channel3 lookup and Gemini planning/quote extraction passed. Kernel hosted research failed twice; redacted stage/class/status diagnostics added for the next worker deployment. No payment was initiated in these acceptance checks. 222 automated tests pass.
