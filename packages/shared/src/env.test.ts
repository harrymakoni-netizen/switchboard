import { describe, it, expect } from "vitest";
import { loadEnv } from "./env";
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
    expect(loadEnv({ ...env, PAYPAL_ENV: undefined }).PAYPAL_ENV).toBe("sandbox"));
  it("refuses live money", () =>
    expect(() => loadEnv({ ...env, PAYPAL_ENV: "live" })).toThrow());
  it("refuses missing credentials", () =>
    expect(() => loadEnv({ ...env, MOCK_PAYPAL: "0" })).toThrow(
      /PAYPAL_CLIENT_ID/,
    ));
});
