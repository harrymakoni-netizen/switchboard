import twilio, { type Twilio } from "twilio";
import { z } from "zod";
import type { PlaceCallArgs, Telephony } from "./index";

const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/);
export const twilioConfigSchema = z.object({
  accountSid: z.string().regex(/^AC[0-9a-fA-F]{32}$/),
  authToken: z.string().min(1),
  fromNumber: phone,
  publicWorkerUrl: z.string().url(),
  allowedNumbers: z.array(phone).min(1).max(6),
  mode: z.enum(["trial", "full"]).default("trial"),
});
export type TwilioConfig = z.infer<typeof twilioConfigSchema>;
type CallOptions = Parameters<Twilio["calls"]["create"]>[0];
export interface TwilioPort {
  createCall(options: CallOptions): Promise<{ sid: string; status: string }>;
  readCall(
    sid: string,
  ): Promise<{ sid: string; status: string; duration: string | null }>;
  endCall(sid: string): Promise<unknown>;
  sendMessage(options: {
    to: string;
    from: string;
    body: string;
  }): Promise<unknown>;
}
export class TwilioTransportError extends Error {
  constructor(
    readonly status?: number,
    readonly code?: number,
    detail?: string,
  ) {
    super(
      `Twilio request failed${status ? " (HTTP " + status + ")" : "; delivery is uncertain"}${code ? " [" + code + "]" : ""}${detail ? ": " + detail : ""}`,
    );
  }
}
export function twilioConfig(
  source: Record<string, string | undefined> = process.env,
) {
  const config = twilioConfigSchema.parse({
    accountSid: source.TWILIO_ACCOUNT_SID,
    authToken: source.TWILIO_AUTH_TOKEN,
    fromNumber: source.TWILIO_FROM_NUMBER,
    publicWorkerUrl: source.PUBLIC_WORKER_URL ?? source.RENDER_EXTERNAL_URL,
    allowedNumbers: source.TWILIO_ALLOWED_NUMBERS?.split(",")
      .map((n) => n.trim())
      .filter(Boolean),
    mode: source.TWILIO_ACCOUNT_MODE?.trim() || "trial",
  });
  const url = new URL(config.publicWorkerUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Twilio requires the worker's public HTTPS origin.");
  return { ...config, publicWorkerUrl: url.origin };
}
export type TwilioParams = Record<string, string | string[]>;
export function verifyTwilioRequest(
  config: TwilioConfig,
  path: string,
  signature: string | undefined,
  params: TwilioParams,
) {
  if (
    !params ||
    typeof params !== "object" ||
    !signature ||
    !path.startsWith("/webhooks/twilio/") ||
    params.AccountSid !== config.accountSid
  )
    return false;
  return twilio.validateRequest(
    config.authToken,
    signature,
    new URL(config.publicWorkerUrl).origin + path,
    params,
  );
}
export class TwilioTelephony implements Telephony {
  private readonly port: TwilioPort;
  constructor(
    readonly config: TwilioConfig,
    port?: TwilioPort,
    private readonly smsSkipped?: () => void,
  ) {
    twilioConfigSchema.parse(config);
    const client = twilio(config.accountSid, config.authToken, {
      autoRetry: false,
      timeout: 15000,
    });
    this.port = port ?? {
      createCall: (options) => client.calls.create(options),
      readCall: (sid) => client.calls(sid).fetch(),
      endCall: (sid) => client.calls(sid).update({ status: "completed" }),
      sendMessage: (options) => client.messages.create(options),
    };
  }
  private allowed(to: string) {
    phone.parse(to);
    if (
      to === this.config.fromNumber ||
      !this.config.allowedNumbers.includes(to)
    )
      throw new Error("Calling requires a configured verified recipient.");
  }
  private async request<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const fields = error && typeof error === "object" ? error : {};
      const number = (key: "status" | "code") => {
        const value =
          key in fields ? (fields as Record<string, unknown>)[key] : undefined;
        if (typeof value !== "number" && typeof value !== "string")
          return undefined;
        if (typeof value === "string" && !/^\d+$/.test(value)) return undefined;
        const result = Number(value);
        return Number.isSafeInteger(result) && result > 0 ? result : undefined;
      };
      const status = number("status");
      const rawMessage =
        "message" in fields
          ? (fields as Record<string, unknown>).message
          : undefined;
      // Preserve the provider's explanation, never its request, headers, or credentials.
      const secrets = [
        this.config.authToken,
        encodeURIComponent(this.config.authToken),
        Buffer.from(
          `${this.config.accountSid}:${this.config.authToken}`,
        ).toString("base64"),
      ];
      let detail =
        status && status >= 400 && typeof rawMessage === "string"
          ? rawMessage
          : undefined;
      if (detail) {
        for (const secret of secrets)
          detail = detail.split(secret).join("[redacted]");
        detail = detail.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 600);
      }
      throw new TwilioTransportError(status, number("code"), detail);
    }
  }
  async placeCall(args: PlaceCallArgs) {
    this.allowed(args.to);
    z.string().uuid().parse(args.callId);
    if (!args.script.openingLine.startsWith("Hi, this is an AI assistant"))
      throw new Error("Disclosure required");
    if (
      !Number.isInteger(args.script.maxSeconds) ||
      args.script.maxSeconds < 1 ||
      args.script.maxSeconds > 180
    )
      throw new Error("Invalid call duration cap");
    const result = await this.request(() =>
      this.port.createCall({
        to: args.to,
        from: this.config.fromNumber,
        url:
          this.config.publicWorkerUrl +
          "/webhooks/twilio/voice/" +
          args.callId +
          "/0",
        method: "POST",
        timeLimit: args.script.maxSeconds,
        timeout: 25,
        record: false,
        statusCallback:
          this.config.publicWorkerUrl +
          "/webhooks/twilio/status/" +
          args.callId,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      }),
    );
    return { providerSid: result.sid };
  }
  async templateTestCall(to: string) {
    this.allowed(to);
    return this.request(() =>
      this.port.createCall({
        to,
        from: this.config.fromNumber,
        url: "https://webhooks.twilio.com/v1/Voice/Template/voice_speech_recognition",
      }),
    );
  }
  async endCall(sid: string) {
    z.string()
      .regex(/^CA[0-9a-fA-F]{32}$/)
      .parse(sid);
    await this.request(() => this.port.endCall(sid));
  }
  async readCall(sid: string) {
    z.string()
      .regex(/^CA[0-9a-fA-F]{32}$/)
      .parse(sid);
    return this.request(() => this.port.readCall(sid));
  }
  async sendSms(to: string, body: string) {
    this.allowed(to);
    if (this.config.mode === "trial") {
      this.smsSkipped?.();
      return;
    }
    z.string().min(1).max(1000).parse(body);
    await this.request(() =>
      this.port.sendMessage({ to, from: this.config.fromNumber, body }),
    );
  }
}
