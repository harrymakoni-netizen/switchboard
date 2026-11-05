# Switchboard submission package

Prepared 5 November 2026. This is a draft for review, not a submitted entry. No prize or eligibility outcome is guaranteed.

Official sources: [rules](https://paypalaihackathon.devpost.com/rules), [submission requirements and judging](https://paypalaihackathon.devpost.com/). Deadline: **12 November 2026, 12:00 PST / 20:00 UTC / 22:00 Africa/Harare**. Keep judge access working through **15 December 2026**. Real phone calls are not required by the rules; simulated conversations must be disclosed, and the application must function as described. The organizers decide eligibility.

## Suggested title and tagline

**Switchboard — your call, our legwork**

Turn a home-repair request into comparable quotes and a booking you control, with PayPal sandbox funds held until you approve completion.

## What it does

Arranging a repair involves more than finding a phone number. A buyer needs to explain the problem, compare prices and appointments, understand what is included, and decide when to pay.

Switchboard turns one repair request into a structured brief, extracts quote details from provider conversations, and puts the evidence side by side. Price is only one part of the decision: our sample includes a cheaper, later appointment with a shorter guarantee and a more expensive, earlier alternative. The customer chooses.

Two explicit approvals govern payment. Booking creates a PayPal sandbox authorization. After reviewing the confirmed recipient, the buyer can mark the work done to trigger capture and payout. Cancellation before capture requests release of the authorization; reporting unfinished work keeps payment held. A receipt is shown only after its payment record is verified.

**Demo boundaries:** provider discovery, provider identities, ratings, repair quotes, and conversations are simulated. Gemini planning, Gemini extraction, and PayPal sandbox interactions are integrated. No real repairs are arranged. Live telephone conversations and autonomous directory discovery remain unfinished. Do not describe the demo as an agent that actually phones local businesses.

## How we built it

Next.js and React power the interface, with AG Grid Community on desktop and an accessible mobile quote view. A Fastify worker and pg-boss perform durable background work against Postgres. Gemini produces schema-validated briefs and extracts prices, availability, inclusions, and guarantees from transcript text. Unknown values stay unknown.

The server-side payment engine owns authorization, capture, void, and payout. These actions are not exposed as AI tools. State transitions, amount and recipient guards, transactional outbox effects, provider idempotency keys, verified webhooks, and recovery polling protect the payment sequence. An invoice-only PayPal Agent Toolkit workflow prepares the receipt; the server independently verifies it before presenting it.

## What to emphasize

- The agent reduces coordination work; the buyer retains choice and payment approval.
- A transcript supports each quote; low-confidence extraction is flagged rather than concealed.
- Time-window conflicts and over-budget offers are explicit.
- PayPal is central to the booking lifecycle, not an unrelated checkout button.
- Pending, failed, and unclaimed payment outcomes remain visible. Do not describe every sent payout as claimed.
- The product supports both a hosted integration demo and a reproducible, service-key-free local build.

## Video script and shot list — target 2:40

Record the actual hosted build with working Gemini and PayPal sandbox, using a prepared sandbox buyer account. Do not show secrets, passwords, real customer information, or API tokens. Keep simulated-call disclosure visible. Rehearse the checkout before recording; if editing out waits, label the cut rather than implying instant processing. Use only visuals, music, and assets you have rights to publish.

| Time | Screen | Suggested narration |
| --- | --- | --- |
| 0:00–0:15 | Home and simulation disclosure | “A home repair should not mean chasing several businesses and paying before you know the work is done. Switchboard gives the buyer one brief, clear choices, and two payment approvals. This demo uses simulated provider conversations with working Gemini and PayPal sandbox integrations.” |
| 0:15–0:35 | Fill the sample and start | “Gemini extracts the repair, location, budget, and time window. Missing information becomes a follow-up question.” |
| 0:35–1:00 | Quote board, times, guarantee, transcript | “These scripted conversations produce two options and a decline. The cheaper appointment is later; the other offers an earlier time and a longer guarantee. We can read the evidence before choosing.” |
| 1:00–1:30 | Book; actual PayPal sandbox approval | “The first approval authorizes the chosen quote amount. The AI cannot approve payment or change the recipient. No capture happens at booking.” |
| 1:30–1:55 | Confirmation, recipient review, fast-forward | “We review the confirmed payout recipient. Fast-forward only skips the demo appointment wait; it does not skip payment approval.” |
| 1:55–2:20 | Mark done, payout status, receipt | “Only after the buyer confirms completion does the server capture funds and send the payout. We show the actual status and a verified sandbox receipt.” |
| 2:20–2:40 | Payment activity, other-outcome explanation | “If the job is unfinished, payment stays held. Cancellation before capture requests a void. Switchboard demonstrates how AI can organize the work while the customer controls the money.” |

If a payout is unclaimed, narrate that status accurately. If the verified receipt is not ready, show its preparation state; do not substitute an unrelated receipt.

## Submission checklist

- [ ] Rehearse the complete hosted flow in a fresh browser, including the PayPal sandbox buyer login and receipt.
- [ ] Verify cancellation and unfinished-work paths on the hosted sandbox if not exercised in the final rehearsal.
- [ ] Supply sandbox buyer test access privately in the submission’s testing instructions, or explain how judges can create their own. Never place developer secrets in the public repo.
- [ ] Verify the hosted `/demo` page matches actual deployed provider flags.
- [ ] Upload a publicly visible YouTube video under three minutes, showing the real application functioning.
- [ ] Submit the hosted URL and public GitHub repository; confirm the MIT license is detected on GitHub.
- [ ] Identify Gemini, PayPal APIs, PayPal Agent Toolkit, AG Grid, Render, Next.js, and other tools actually used. Do not claim optional sponsor integrations that are only planned.
- [ ] State the simulation boundaries in both the project description and video.
- [ ] Check personal/team eligibility under section 3 of the official rules.
- [ ] Keep hosting, sandbox configuration, and test access available through judging.
- [ ] Submit on Devpost before the deadline; save confirmation.

## Ready-to-use testing instructions

Open https://switchboard-hjm-technologies.vercel.app/demo. Use the sample repair and keep the same browser session throughout. The hosted build uses PayPal sandbox and Gemini with simulated discovery and provider conversations. Only sandbox funds are involved. Book a quote, approve the sandbox authorization, review the payout recipient, fast-forward the demo appointment, and mark the work done. Follow payment status to the receipt. Use the supplied sandbox buyer test login at checkout; do not use a real PayPal login. If you prefer a provider-free evaluation, follow the repository’s local setup with all `MOCK_*` flags set to `1`.

Before submitting this paragraph, supply the actual private sandbox testing instructions; this draft does not create a buyer account or claim credentials have been provided.
