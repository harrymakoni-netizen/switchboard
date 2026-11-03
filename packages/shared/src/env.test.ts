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
});
