import Fastify from "fastify";
import twilio from "twilio";
import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { registerTwilioWebhooks, parseTwilioForm } from "./twilio";
import type { TwilioConfig } from "../../../../packages/calls/src/twilio";
const config: TwilioConfig = {
  accountSid: "AC" + "1".repeat(32),
  authToken: "test-auth",
  fromNumber: "+12025550100",
  publicWorkerUrl: "https://worker.example",
  allowedNumbers: ["+12025550109"],
  mode: "trial",
};
it("rejects missing, forged or changed signatures before invoking any handler", async () => {
  const app = Fastify();
  const voice = vi.fn(async () => "<Response/>");
  const status = vi.fn();
  await registerTwilioWebhooks(app, config, { voice, status });
  const url = `/webhooks/twilio/voice/${randomUUID()}/0`;
  const body = {
    AccountSid: config.accountSid,
    CallSid: "CA" + "2".repeat(32),
    SpeechResult: "yes",
  };
  for (const signature of [undefined, "forged"]) {
    const result = await app.inject({
      method: "POST",
      url,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(signature ? { "x-twilio-signature": signature } : {}),
      },
      payload: new URLSearchParams(body).toString(),
    });
    expect(result.statusCode).toBe(403);
  }
  const signature = twilio.getExpectedTwilioSignature(
    config.authToken,
    config.publicWorkerUrl + url,
    body,
  );
  const changed = await app.inject({
    method: "POST",
    url,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    payload: new URLSearchParams({ ...body, SpeechResult: "no" }).toString(),
  });
  expect(changed.statusCode).toBe(403);
  expect(voice).not.toHaveBeenCalled();
  expect(status).not.toHaveBeenCalled();
  await app.close();
});
it("accepts a genuine SDK signature through a proxy without trusting the Host header", async () => {
  const app = Fastify();
  const voice = vi.fn(async () => "<Response><Hangup/></Response>");
  const status = vi.fn();
  await registerTwilioWebhooks(app, config, { voice, status });
  const callId = randomUUID();
  const url = `/webhooks/twilio/voice/${callId}/1`;
  const body = {
    AccountSid: config.accountSid,
    CallSid: "CA" + "2".repeat(32),
    SpeechResult: "95 dollars",
    To: config.allowedNumbers[0],
    From: config.fromNumber,
  };
  const signature = twilio.getExpectedTwilioSignature(
    config.authToken,
    config.publicWorkerUrl + url,
    body,
  );
  const result = await app.inject({
    method: "POST",
    url,
    headers: {
      host: "internal-proxy.invalid",
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    payload: new URLSearchParams(body).toString(),
  });
  expect(result.statusCode).toBe(200);
  expect(result.headers["content-type"]).toContain("text/xml");
  expect(voice).toHaveBeenCalledWith(callId, 1, body);
  await app.close();
});
it("preserves repeated fields for official signature validation and rejects an unrelated account", async () => {
  expect(parseTwilioForm("A=one&A=two&From=%2B12025550100")).toEqual({
    A: ["one", "two"],
    From: "+12025550100",
  });
  const app = Fastify();
  const status = vi.fn();
  await registerTwilioWebhooks(app, config, { voice: vi.fn(), status });
  const url = `/webhooks/twilio/status/${randomUUID()}`;
  const body = {
    AccountSid: "AC" + "4".repeat(32),
    CallSid: "CA" + "2".repeat(32),
    CallStatus: "completed",
  };
  const signature = twilio.getExpectedTwilioSignature(
    config.authToken,
    config.publicWorkerUrl + url,
    body,
  );
  const result = await app.inject({
    method: "POST",
    url,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    payload: new URLSearchParams(body).toString(),
  });
  expect(result.statusCode).toBe(403);
  expect(status).not.toHaveBeenCalled();
  await app.close();
});
