# Deploy the Switchboard worker on Render

Keep the frontend on Vercel. Deploy the existing Fastify/pg-boss process as a paid Render **Web Service** so it stays running and exposes HTTPS webhooks.

## Service settings

- Repository: `harrymakoni-netizen/switchboard`, branch `main`.
- Name: `switchboard-worker` (Render may assign a suffix if needed).
- Language: Node, version 24 (declared in the root package.json).
- Root directory: leave blank; this is a pnpm monorepo.
- Region: the same region and workspace as the Render Postgres database.
- Instance: the paid 512 MB web-service plan (`0.5c-512mb`, formerly Starter).
- Build: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter worker build`
- Pre-deploy: `pnpm db:migrate`
- Start: `pnpm exec tsx apps/worker/src/index.ts`
- Health check: `/health`

Use the paid service's pre-deploy command for migrations, separate from compilation. Do not build the Next.js frontend here. Render sets PORT automatically; the worker already reads it.

## Initial environment

```text
DATABASE_URL=<the database's Internal Database URL>
APP_URL=https://switchboard-hjm-technologies.vercel.app
SESSION_SECRET=<a private random value, at least 32 characters>
PAYPAL_ENV=sandbox
DEMO_MODE=1
MOCK_PAYPAL=1
MOCK_TELEPHONY=1
MOCK_LLM=1
MOCK_PARTNERS=1
```

Keep SESSION_SECRET private and reuse that exact value in the Vercel web environment when connecting it to the worker. Do not paste the database URL or session secret into chat or commit them.

The worker now uses Render's automatic RENDER_EXTERNAL_URL when PUBLIC_WORKER_URL is not explicitly configured, so it can boot on its first deploy without guessing its assigned URL. Explicit PUBLIC_WORKER_URL values still take precedence. Vercel still needs PUBLIC_WORKER_URL set to the actual Render worker URL later.

## Check the initial deployment

Open `https://<assigned-worker-host>/health`. The expected response while all services are mocked is:

```json
{ "ok": true, "mode": "mock" }
```

The worker is not a replacement for the Vercel frontend. Leave HOSTED_UI_ONLY=1 on Vercel until its database, worker URL, shared session secret, and remaining required environment variables have been configured and verified. Use the database's External Database URL on Vercel; its Internal URL is only for Render services on the same private network.

After the worker is healthy, follow `docs/paypal-sandbox.md` to register `/webhooks/paypal` in the existing sandbox REST app. Add the PayPal credentials and webhook ID to the worker before disabling MOCK_PAYPAL. Continue keeping telephony, LLM, and directory mocks enabled while checking PayPal alone.
