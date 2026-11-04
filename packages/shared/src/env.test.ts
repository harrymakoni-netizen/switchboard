import { describe, it, expect } from "vitest";
import { loadEnv, DEFAULT_GEMINI_MODEL } from "./env";
const env = {
  PAYPAL_ENV: "sandbox",
  DATABASE_URL: "postgres://a:b@localhost/test",
  SESSION_SECRET: "test-secret-with-at-least-24-chars",
  APP_URL: "http://localhost:3000",
  PUBLIC_WORKER_URL: "http://localhost:4000",
  MOCK_PAYPAL: "1",
  MOCK_LLM: "1",
  MOCK_TELEPHONY: "1",
  MOCK_PARTNERS: "1",
};
describe("startup safety", () => {
  it("runs offline without keys", () =>
    expect(loadEnv(env).PAYPAL_ENV).toBe("sandbox"));
  it("keeps empty legacy voice settings compatible with offline mode", () => {
    expect(loadEnv({ ...env, VOICE_PROVIDER: "" }).VOICE_PROVIDER).toBe(
      "twilio-gather",
    );
  });
  it("does not require an additional voice-provider key for Twilio prompts", () => {
    const configured = {
      ...env,
      MOCK_TELEPHONY: "0",
      TWILIO_ACCOUNT_SID: "test",
      TWILIO_AUTH_TOKEN: "test",
      TWILIO_FROM_NUMBER: "+12025550100",
      TWILIO_ALLOWED_NUMBERS: "+12025550101",
    };
    expect(loadEnv(configured).VOICE_PROVIDER).toBe("twilio-gather");
    expect(() =>
      loadEnv({ ...configured, VOICE_PROVIDER: "unsupported" }),
    ).toThrow("VOICE_PROVIDER");
  });
  it("defaults to sandbox when unset", () =>
    expect(loadEnv({ ...env, PAYPAL_ENV: undefined }).PAYPAL_ENV).toBe(
      "sandbox",
    ));
  it("refuses live money", () =>
    expect(() => loadEnv({ ...env, PAYPAL_ENV: "live" })).toThrow());
  it("refuses missing credentials", () =>
    expect(() => loadEnv({ ...env, MOCK_PAYPAL: "0" })).toThrow(
      /PAYPAL_CLIENT_ID/,
    ));
  it("requires Gemini credentials only for real LLM mode", () => {
    expect(() => loadEnv({ ...env, MOCK_LLM: "0" })).toThrow(/GEMINI_API_KEY/);
    expect(
      loadEnv({ ...env, MOCK_LLM: "0", GEMINI_API_KEY: "test-key" })
        .GEMINI_MODEL,
    ).toBe(DEFAULT_GEMINI_MODEL);
  });
  it("accepts a Gemini model override and rejects an empty model", () => {
    expect(
      loadEnv({ ...env, GEMINI_MODEL: "custom-gemini-model" }).GEMINI_MODEL,
    ).toBe("custom-gemini-model");
    expect(() => loadEnv({ ...env, GEMINI_MODEL: " " })).toThrow();
  });
  it("uses the Render-assigned URL when a worker URL is not configured", () => {
    expect(
      loadEnv({
        ...env,
        PUBLIC_WORKER_URL: undefined,
        RENDER_EXTERNAL_URL: "https://switchboard-worker.onrender.com",
      }).PUBLIC_WORKER_URL,
    ).toBe("https://switchboard-worker.onrender.com");
  });
  it("keeps an explicitly configured worker URL", () => {
    expect(
      loadEnv({ ...env, RENDER_EXTERNAL_URL: "https://other.onrender.com" })
        .PUBLIC_WORKER_URL,
    ).toBe(env.PUBLIC_WORKER_URL);
  });
});
