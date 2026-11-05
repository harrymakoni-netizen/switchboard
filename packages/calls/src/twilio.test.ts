import { it, expect, vi } from "vitest";
import twilio from "twilio";
import { randomUUID } from "node:crypto";
import {
  TwilioTelephony,
  twilioConfig,
  verifyTwilioRequest,
  type TwilioConfig,
  type TwilioPort,
} from "./twilio";
import { script } from "./index";
const config: TwilioConfig = {
  accountSid: "AC" + "1".repeat(32),
  authToken: "test-auth",
  fromNumber: "+12025550100",
  publicWorkerUrl: "https://worker.example",
  allowedNumbers: ["+12025550109"],
  mode: "trial",
};
function fixture() {
  const port: TwilioPort = {
    createCall: vi.fn(async () => ({
      sid: "CA" + "2".repeat(32),
      status: "queued",
    })),
    readCall: vi.fn(async (sid) => ({
      sid,
      status: "completed",
      duration: "12",
    })),
    endCall: vi.fn(),
    sendMessage: vi.fn(),
  };
  return { port, client: new TwilioTelephony(config, port) };
}
it("uses the official trial template for a basic smoke call", async () => {
  const { client, port } = fixture();
  await client.templateTestCall(config.allowedNumbers[0]);
  expect(port.createCall).toHaveBeenCalledWith({
    to: config.allowedNumbers[0],
    from: config.fromNumber,
    url: "https://webhooks.twilio.com/v1/Voice/Template/voice_speech_recognition",
  });
});
it("rejects non-allowlisted and self-dialled targets before contacting Twilio", async () => {
  const { client, port } = fixture();
  await expect(client.templateTestCall("+12025550101")).rejects.toThrow(
    "verified recipient",
  );
  await expect(client.templateTestCall(config.fromNumber)).rejects.toThrow(
    "verified recipient",
  );
  expect(port.createCall).not.toHaveBeenCalled();
});
it("caps full-account custom calls and uses signed-callback endpoints without audio recording", async () => {
  const { port } = fixture();
  const client = new TwilioTelephony({ ...config, mode: "full" }, port);
  const callId = randomUUID();
  await client.placeCall({
    callId,
    to: config.allowedNumbers[0],
    script: script("quote", "repair"),
  });
  expect(port.createCall).toHaveBeenCalledWith(
    expect.objectContaining({
      timeLimit: 180,
      record: false,
      url: `https://worker.example/webhooks/twilio/voice/${callId}/0`,
      statusCallback: `https://worker.example/webhooks/twilio/status/${callId}`,
    }),
  );
});
it("omits unsupported Calls API options for limited-trial custom calls", async () => {
  const { client, port } = fixture();
  const callId = randomUUID();
  vi.mocked(port.createCall).mockImplementation(async (options) => {
    const allowed = new Set(["to", "from", "url", "statusCallback"]);
    if (Object.keys(options).some((key) => !allowed.has(key)))
      throw {
        status: 400,
        message: "Invalid or disallowed parameters provided",
      };
    return { sid: "CA" + "2".repeat(32), status: "queued" };
  });
  await expect(
    client.placeCall({
      callId,
      to: config.allowedNumbers[0],
      script: script("quote", "repair"),
    }),
  ).resolves.toEqual({ providerSid: "CA" + "2".repeat(32) });
  expect(port.createCall).toHaveBeenCalledOnce();
  expect(port.createCall).toHaveBeenCalledWith({
    to: config.allowedNumbers[0],
    from: config.fromNumber,
    url: `https://worker.example/webhooks/twilio/voice/${callId}/0`,
    statusCallback: `https://worker.example/webhooks/twilio/status/${callId}`,
  });
});
it("does not retry an uncertain call creation", async () => {
  const { client, port } = fixture();
  vi.mocked(port.createCall).mockRejectedValue(new Error("socket timeout"));
  await expect(
    client.templateTestCall(config.allowedNumbers[0]),
  ).rejects.toThrow("delivery is uncertain");
  expect(port.createCall).toHaveBeenCalledOnce();
});
it("preserves trial rejection details while redacting credentials", async () => {
  const { client, port } = fixture();
  const basic = Buffer.from(
    `${config.accountSid}:${config.authToken}`,
  ).toString("base64");
  vi.mocked(port.createCall).mockRejectedValue({
    status: 400,
    code: "21215",
    message: `Unsupported trial parameter. ${config.authToken} Basic ${basic}\n`,
    request: { secret: "never print this" },
  });
  const error = await client
    .templateTestCall(config.allowedNumbers[0])
    .catch((e: unknown) => e);
  expect(error).toMatchObject({ status: 400, code: 21215 });
  const message = (error as Error).message;
  expect(message).toContain("Unsupported trial parameter");
  expect(message).not.toContain(config.authToken);
  expect(message).not.toContain(basic);
  expect(message).not.toContain("never print this");
  expect(message).not.toContain("\n");
  expect(port.createCall).toHaveBeenCalledOnce();
});
it("keeps the HTTP status when a provider returns a null error code", async () => {
  const { client, port } = fixture();
  vi.mocked(port.createCall).mockRejectedValue({
    status: 400,
    code: null,
    message: "Custom URL is invalid",
  });
  await expect(
    client.templateTestCall(config.allowedNumbers[0]),
  ).rejects.toThrow("HTTP 400): Custom URL is invalid");
});
it("does not send custom SMS during the limited trial", async () => {
  const { client, port } = fixture();
  await client.sendSms(config.allowedNumbers[0], "booking confirmation");
  expect(port.sendMessage).not.toHaveBeenCalled();
});
it("validates the exact public URL, account and complete webhook parameters", () => {
  const path = "/webhooks/twilio/status/" + randomUUID();
  const body = {
    AccountSid: config.accountSid,
    CallSid: "CA" + "2".repeat(32),
    CallStatus: "completed",
  };
  const signature = twilio.getExpectedTwilioSignature(
    config.authToken,
    config.publicWorkerUrl + path,
    body,
  );
  expect(verifyTwilioRequest(config, path, signature, body)).toBe(true);
  expect(
    verifyTwilioRequest(config, path, signature, {
      ...body,
      CallStatus: "failed",
    }),
  ).toBe(false);
  expect(
    verifyTwilioRequest(config, path + "?changed=1", signature, body),
  ).toBe(false);
  expect(
    verifyTwilioRequest(config, path, signature, {
      ...body,
      AccountSid: "AC" + "3".repeat(32),
    }),
  ).toBe(false);
});
it("rejects unsafe callback origins in configuration", () => {
  for (const url of [
    "http://worker.example",
    "https://user:pass@worker.example",
    "https://worker.example?x=1",
    "https://worker.example/path",
  ])
    expect(() =>
      twilioConfig({
        TWILIO_ACCOUNT_SID: config.accountSid,
        TWILIO_AUTH_TOKEN: config.authToken,
        TWILIO_FROM_NUMBER: config.fromNumber,
        PUBLIC_WORKER_URL: url,
        TWILIO_ALLOWED_NUMBERS: config.allowedNumbers.join(","),
      }),
    ).toThrow();
});
