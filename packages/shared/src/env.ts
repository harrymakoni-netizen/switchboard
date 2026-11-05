import { z } from "zod";
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

export function assertSandboxMode(
  source: Record<string, string | undefined> = process.env,
) {
  const paypalEnv = source.PAYPAL_ENV ?? "sandbox";
  if (paypalEnv !== "sandbox")
    throw new Error("Switchboard requires PAYPAL_ENV=sandbox");
  return paypalEnv;
}

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
) {
  const normalized = {
    ...source,
    PAYPAL_ENV: source.PAYPAL_ENV ?? "sandbox",
    PUBLIC_WORKER_URL: source.PUBLIC_WORKER_URL ?? source.RENDER_EXTERNAL_URL,
    VOICE_PROVIDER: source.VOICE_PROVIDER?.trim() || "twilio-gather",
  };
  assertSandboxMode(normalized);
  const env = z
    .object({
      PAYPAL_ENV: z.literal("sandbox"),
      DATABASE_URL: z.string().url(),
      SESSION_SECRET: z.string().min(24),
      APP_URL: z.string().url(),
      PUBLIC_WORKER_URL: z.string().url(),
      DEMO_MODE: z.enum(["0", "1"]).default("0"),
      MOCK_PAYPAL: z.enum(["0", "1"]).default("0"),
      MOCK_TELEPHONY: z.enum(["0", "1"]).default("0"),
      VOICE_PROVIDER: z.string().default("twilio-gather"),
      MOCK_LLM: z.enum(["0", "1"]).default("0"),
      GEMINI_MODEL: z.string().trim().min(1).default(DEFAULT_GEMINI_MODEL),
      PARTNER_RESEARCH_MODE: z.enum(["off", "mock", "live"]).default("off"),
      MOCK_PARTNERS: z.enum(["0", "1"]).default("0"),
    })
    .parse(normalized);
  const required = [
    ...(env.MOCK_PAYPAL === "0"
      ? ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"]
      : []),
    ...(env.MOCK_TELEPHONY === "0"
      ? [
          "TWILIO_ACCOUNT_SID",
          "TWILIO_AUTH_TOKEN",
          "TWILIO_FROM_NUMBER",
          "TWILIO_ALLOWED_NUMBERS",
        ]
      : []),
    ...(env.MOCK_LLM === "0" ? ["GEMINI_API_KEY"] : []),
    ...(env.MOCK_PARTNERS === "0" && env.DEMO_MODE === "0"
      ? ["KERNEL_API_KEY", "DIRECTORY_URL_TEMPLATE"]
      : []),
  ];
  for (const key of required)
    if (!source[key]?.trim())
      throw new Error(`Missing required environment variable: ${key}`);
  if (env.MOCK_TELEPHONY === "0" && env.VOICE_PROVIDER !== "twilio-gather")
    throw new Error(
      "VOICE_PROVIDER must be twilio-gather for turn-based calls.",
    );
  return env;
}
