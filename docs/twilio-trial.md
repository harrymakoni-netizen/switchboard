# Twilio trial calling

The user selected the limited trial and turn-by-turn speech prompts on 2026-11-04. This supersedes the initial Media Streams implementation plan for this stage. Twilio's trial blocks Stream, ConversationRelay, and recording verbs, but supports Say/Gather within its trial limits. See [Twilio's Voice trial documentation](https://www.twilio.com/docs/usage/trials/try-out-voice).

## What is implemented

- Twilio SDK 6.2.0 transport, explicit verified-recipient allowlist, and finite call duration.
- Signed form webhooks at `/webhooks/twilio/voice/:callId/:turn` and `/webhooks/twilio/status/:callId`.
- Fixed speech/DTMF questions for quote price, date/time, inclusions and guarantee. Gemini extracts the recorded text afterward; webhooks do not wait for an LLM response.
- Booking confirmation reads the exact selected price and time, then asks for the business's PayPal email and confirms it by spelling it back. Missing or declined confirmation cannot change the booking to confirmed.
- A persistent `voice_sessions` row stores each turn and its TwiML response. Repeated callbacks reuse the response without duplicating transcripts. Provider call IDs, expected caller/callee, account, and signature must match.
- Outbound dispatch is reserved before contacting Twilio. Concurrent workers do not dial twice. An uncertain create response is not automatically redialed. Expired/aborted tasks cannot start a new call.
- Trial custom SMS is explicitly skipped; no SMS delivery is claimed. No audio recording is requested. Customer completion approval remains in the app; no customer phone number is collected.

## Configure Render without enabling app calls

Keep `MOCK_TELEPHONY=1`. Add the following to the worker's Environment settings, using the same Twilio account that owns the trial caller number:

```text
TWILIO_ACCOUNT_SID=<account SID>
TWILIO_AUTH_TOKEN=<private Auth Token>
TWILIO_FROM_NUMBER=<Twilio trial caller number, with country code>
TWILIO_ALLOWED_NUMBERS=<your verified personal phone, with country code>
TWILIO_ACCOUNT_MODE=trial
VOICE_PROVIDER=twilio-gather
TWILIO_TRIAL_CUSTOM_VOICE_VERIFIED=0
```

Never use the Twilio caller number as the test destination. Only allowlist numbers you control and have verified in Twilio. Trial calls are restricted by the signup country and verified-recipient limits. Keep credentials out of chat and GitHub. These settings are worker-only; Vercel does not need the Twilio Auth Token.

Set the Render pre-deploy command to `pnpm db:migrate`, then deploy the latest commit. It applies the additive `0001_voice_sessions.sql` migration. `/health` reports whether Twilio configuration is present; that is not proof of a successful call.

## Test one verified phone

Run commands from the worker's Render Shell, where its environment secrets are already available. All actual calls below require `--call` and consume Twilio minutes; none creates a booking, PayPal order, capture or payout.

Start with Twilio's own speech-recognition template:

```sh
pnpm twilio:smoke --to +<YOUR_VERIFIED_PHONE> --state .twilio-smoke/template.json --call
pnpm twilio:smoke --state .twilio-smoke/template.json --status
```

Then test Switchboard's questionnaire with a different state file:

```sh
pnpm twilio:smoke --to +<YOUR_VERIFIED_PHONE> --state .twilio-smoke/custom.json --custom --call
pnpm twilio:smoke --state .twilio-smoke/custom.json --status
```

For the custom call, answer the AI disclosure with yes or keypad 1, then provide a practice USD price, an explicit date/time in Harare, inclusions and a guarantee. A completed questionnaire is stored as a synthetic DRAFT test job and cannot initiate payment effects.

The CLI reserves an ignored state file before calling. Reusing it refuses a second outgoing request. For an uncertain custom-call response, `--status` can recover a call ID that a signed callback already saved. Otherwise check Twilio Logs before deciding whether to make a new test. A queued API result alone does not prove the phone rang or the questionnaire worked.

Trial API options can differ from full accounts. Twilio's docs describe restricted call-create parameters separately from supported custom TwiML verbs. A successful standard template does not verify custom outbound URLs, callbacks, or time-limit options on this account. If the custom request is rejected, inspect its Twilio error code and Console Custom setup; leave app calls mocked. Do not upgrade or spend money automatically.

## Enable the app only after a custom test succeeds

For the demo, configure three **distinct verified recipients**, each willing to role-play a demo provider:

```text
TENDAI_PHONE_NUMBER=<verified demo recipient 1>
QUICKFIX_PHONE_NUMBER=<verified demo recipient 2>
AVONDALE_PHONE_NUMBER=<verified demo recipient 3>
TWILIO_ALLOWED_NUMBERS=<all three verified recipients, comma-separated>
TWILIO_TRIAL_CUSTOM_VOICE_VERIFIED=1
MOCK_TELEPHONY=0
```

The worker refuses to enable trial app calling until the custom-test flag and demo recipient configuration are present. The placeholders in the repository are never valid dial destinations. Mock mode remains available with all service keys blank. Demo test recipients have no fabricated ratings or BOT badge when real trial calling is enabled.

The limited-trial demo uses verified human test recipients. Fully automated business-bot phone lines, the original streaming conversation bridge, custom SMS, real directory discovery, and a customer completion phone call are not implemented by this trial integration. Completion and payment release still require the customer's explicit in-app action.

## Verification status

Offline transport, questionnaire, signature, replay, expiry, and concurrent-dispatch tests pass. The production build and all six mock browser scenarios pass. Actual Twilio authentication, standard template delivery, and custom trial calling remain unverified until worker credentials and a verified test destination are configured.
