# Voice input for repair requests

The request form has a **Record request** button. Allow microphone access, describe the repair/location/time/budget, then choose **Stop recording**. The recording is transcribed by the existing Gemini connection and appended to any typed request. Users review/edit the result and explicitly choose **Find my quotes**. Recording never creates a job, approves a booking or moves money.

Recording stops automatically at 60 seconds. Cancel discards a recording or aborts an in-flight transcription; late permission grants and responses cannot overwrite the form. Microphone tracks are stopped on stop, cancel, failure and unmount. If appended text would exceed 2,000 characters, the original text is preserved rather than truncated.

The interface discloses that audio is sent to Gemini. Switchboard does not save recordings to a database, object store or file system. Audio is processed in memory by a Node.js Vercel function; this does not make a claim about the model provider's retention policies. There are no new keys or worker settings: transcription uses the frontend's existing `GEMINI_API_KEY` and `GEMINI_MODEL`.

## Browser and endpoint behavior

Uses `getUserMedia` and `MediaRecorder` on HTTPS (localhost works for development). The browser chooses supported Opus/WebM, MP4 or Ogg audio. Blocked permissions, missing microphones, unsupported browsers, empty audio, oversized recordings and provider failures have recovery copy and leave typing available.

`POST /api/transcribe` accepts one multipart `audio` file. It requires the configured app origin, bounds the streamed request and file size (2 MiB), validates format signatures, and sends bounded inline audio through the installed Google AI SDK provider. The prompt requests faithful transcription, with no tools, repair diagnosis or instruction-following. The response contains text only and has `Cache-Control: no-store`. A silence result returns 422; quota returns 429; provider details and credentials are not sent to the browser. The request receives a 30-second provider timeout and the function a 45-second limit.

Local `MOCK_LLM=1` returns a clear unavailable message rather than inventing a transcript. Offline UI tests stub the transcription response and microphone API. To test actual transcription, use the hosted build or configure a local Gemini key and set `MOCK_LLM=0`.

## Verification

Automated coverage includes bounded uploads, MIME signatures, Safari-compatible MP4, provider request shape, same-origin checks, silence, quota and error redaction. Browser checks cover recording, stopping, cancelling recording/transcription, preserving typed text, permission denial, unsupported browsers, automatic stop and long-text limits. Desktop/mobile renders are inspected. Real device microphone permissions and device-specific audio quality depend on the user's browser and hardware.

Local verification: 235 automated tests and 20 browser scenarios passed, including the existing payment and partner flows. Strict typecheck, ESLint, production build and the design detector passed. Desktop and 375px recording/transcript renders were inspected. Live transcription acceptance is checked after deployment with prerecorded test audio, without creating a job or initiating payment.

Live acceptance passed on Vercel deployment `dpl_D5sa69RuswQmbQnrWd29WzLHUdA9` (commit `b1ee789`): Chromium’s native MediaRecorder captured a prerecorded synthetic speech fixture and uploaded it to Gemini. The endpoint returned HTTP 200 with the spoken text; the typed prefix was preserved, microphone tracks ended, no job was created, and the 375px page had no horizontal overflow. This tests the real recorder/transcription path without capturing a person's microphone audio.
