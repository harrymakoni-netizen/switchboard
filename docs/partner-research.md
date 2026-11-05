# Kernel and Channel3 research

The hackathon keeps the existing simulated provider conversations and real PayPal **sandbox** integration. Optional research adds real directory leads through Kernel and advisory parts prices through Channel3. Directory leads are displayed separately from the quote board: the demo never attributes a simulated quote, availability, guarantee or payout address to a real business.

## Configuration

Default `PARTNER_RESEARCH_MODE=off` preserves existing hosted behavior. No provider keys are required to build or run tests.

- `PARTNER_RESEARCH_MODE=mock`: deterministic illustrative research, explicitly labeled simulated; no API calls. A request such as “Replace the geyser element in Avondale tomorrow, under $120” includes a parts search. A vague fault does not automatically become a parts diagnosis.
- `PARTNER_RESEARCH_MODE=live`: use configured APIs. Each provider reports unavailable or failed independently; missing configuration never becomes synthetic live evidence.

Configure these on the **Render worker** for live research:

```
PARTNER_RESEARCH_MODE=live
KERNEL_API_KEY=<Kernel dashboard key>
DIRECTORY_URL_TEMPLATE=https://your-approved-directory/search?q={query}&location={location}
CHANNEL3_API_KEY=<Channel3 dashboard key>
```

The directory URL above is a template example, not a working directory. Choose a public business directory you are permitted to browse whose results expose business names and phone numbers. Test that specific URL in Kernel before the demo. Both `{query}` and `{location}` placeholders are required. Query values are encoded; the configured hostname cannot come from user input. Kernel permits network requests only to that hostname. Sites needing a different redirect host, third-party scripts or CAPTCHA may fail rather than produce usable evidence. No default directory coverage is promised.

Set `PARTNER_RESEARCH_MODE=live` on **Vercel** too, and redeploy so the UI and job-owned research action are enabled. API keys belong on the worker; Vercel does not need either key or the directory template. Keep `DEMO_MODE=1`, `MOCK_PARTNERS=1`, `MOCK_TELEPHONY=1`, and `PAYPAL_ENV=sandbox`. Keep the already-working PayPal settings. Kernel extraction uses the existing worker Gemini configuration (`MOCK_LLM=0` and its configured key).

Sign up / get keys:

- Kernel: https://dashboard.onkernel.com/ — https://www.kernel.sh/docs/start/quickstart
- Channel3: https://trychannel3.com/developers — https://docs.trychannel3.com/

## Execution and evidence

New jobs enqueue optional research independently of the quote/payment state machine. Existing jobs can use **Research this repair**. Failed/unavailable research can be retried after one minute using **Retry research**. The API checks session ownership and same-origin POSTs before queuing any work. A durable outbox and pg-boss queue survive worker restarts. Research snapshots are persisted as `partners.updated` events and included in the existing owned-job snapshot and SSE refresh flow. No database migration is needed.

Kernel's official SDK creates a short-lived browser, runs fixed read-only Playwright code in the browser VM, and deletes the session in `finally`. This uses the current supported remote execution interface rather than opening a worker CDP connection. The job preserves the session ID, searched URL, lookup time and supporting directory links, never a CDP URL or live-view control token. Browser cleanup does not invalidate the stored source links. Names and nearby phone tokens must occur in the retrieved text, links must occur in the retrieved page, duplicates are removed, and unsupported ratings are discarded. These are public directory leads, not verified service providers.

Channel3 calls `POST https://api.trychannel3.com/v1/search` using a server-only `x-api-key`. It searches the brief's explicitly identified part in the US market and USD. The median uses the cheapest valid USD offer per distinct returned product (up to five), excludes unavailable/invalid offers, and retains merchant links and lookup time. It is a search-result benchmark, not an assessment of product compatibility or fair labour cost. Delivery, taxes, installation and local availability are not established. Empty results have no price; outages do not substitute the mock $35 value.

Neither integration can approve a booking, modify a quote, choose a payout recipient, or perform a PayPal operation. Automatic negotiation/counteroffers remain deferred; the current voice questionnaire is not verified for that feature.

Outside judge mode, `MOCK_PARTNERS=0` enables the Kernel finder instead of the old unimplemented error. Fewer than three evidenced leads move the job to ISSUE under the existing state machine. With simulated telephony, real directory leads never receive simulated quotes. Actual calls retain the existing recipient allowlist and trial verification gates. This mode is separate from the recommended hackathon configuration.

## Verification

Offline tests exercise the official Kernel SDK through stubbed HTTP, session cleanup on success/failure, encoded directory queries, evidence filtering, Channel3 request/response contracts, USD median calculation, duplicates, missing keys, empty results, unsafe URLs and isolated provider failures. Browser checks cover research display, source separation, retries, ownership and the full mock payment flow.

A test passing against stubs is not live partner acceptance. Before claiming either integration in the submission, configure real keys, verify the selected directory, inspect a live research result and record updated footage. The previously delivered video predates these integrations.

Verified on 5 November 2026: 217 automated tests passed across 20 files; strict typecheck, ESLint and the Next.js production build passed. All 12 browser scenarios passed in fully mocked mode, with the two research scenarios rerun after adding coverage for manual research on an existing job. Desktop (1440 px) and mobile (375 px) screenshots were inspected; no horizontal overflow. The Impeccable detector reported no findings. Live Kernel and Channel3 calls were not made.
