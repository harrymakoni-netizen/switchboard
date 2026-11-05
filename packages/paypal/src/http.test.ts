import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { HttpPayPal, PayPalHttpError } from "./index";
const requests: { url: string; init: RequestInit }[] = [];
let responseFor: (url: string, init: RequestInit) => unknown;
beforeEach(() => {
  vi.stubEnv("PAYPAL_ENV", "sandbox");
  requests.length = 0;
  responseFor = () => ({});
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({ url, init });
      const data = url.endsWith("/oauth2/token")
        ? { access_token: "test-token", expires_in: 3600 }
        : responseFor(url, init);
      if (data instanceof Response) return data;
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const client = () =>
  new HttpPayPal("sandbox-client", "sandbox-secret", "WH-test");
const order = {
  jobId: "job-1",
  amountCents: 11000,
  description: "Repair geyser",
  returnUrl: "https://app.example/jobs/job-1/paypal/return",
  cancelUrl: "https://app.example/jobs/job-1/paypal/cancel",
};
describe("sandbox REST contract", () => {
  it("reads invoices on the toolkit sandbox origin without changing the payment origin", async () => {
    responseFor = (url) =>
      url.includes("search-invoices")
        ? { items: [] }
        : {
            id: "INV2-TEST",
            status: "DRAFT",
            detail: { invoice_number: "SB-test", reference: "job-1" },
            amount: { currency_code: "USD", value: "110.00" },
            primary_recipients: [
              { billing_info: { email_address: "buyer@example.com" } },
            ],
            items: [
              {
                quantity: "1",
                unit_amount: { currency_code: "USD", value: "110.00" },
              },
            ],
          };
    const paypal = client();
    await expect(paypal.findReceiptInvoice("SB-test")).resolves.toBeUndefined();
    await expect(paypal.getReceiptInvoice("INV2-TEST")).resolves.toMatchObject({
      id: "INV2-TEST",
    });
    expect(requests[0].url).toBe(
      "https://api-m.sandbox.paypal.com/v1/oauth2/token",
    );
    expect(
      requests
        .slice(1)
        .every(
          (r) => new URL(r.url).origin === "https://api.sandbox.paypal.com",
        ),
    ).toBe(true);
  });
  it("authorizes, never auto-captures an order, and reuses OAuth", async () => {
    responseFor = (url) =>
      url.endsWith("/authorize")
        ? {
            purchase_units: [
              {
                payments: {
                  authorizations: [
                    {
                      id: "AUTH",
                      expiration_time: "2026-12-01T00:00:00Z",
                      amount: { currency_code: "USD", value: "110.00" },
                    },
                  ],
                },
              },
            ],
          }
        : {
            id: "ORDER",
            links: [
              {
                rel: "payer-action",
                href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER",
              },
            ],
          };
    const p = client();
    expect((await p.createOrder(order)).orderId).toBe("ORDER");
    await p.authorizeOrder({
      jobId: order.jobId,
      orderId: "ORDER",
      expectedAmountCents: 11000,
    });
    expect(
      requests.filter((r) => r.url.endsWith("/oauth2/token")),
    ).toHaveLength(1);
    const request = requests.find((r) =>
      r.url.endsWith("/v2/checkout/orders"),
    )!;
    expect(JSON.parse(String(request.init.body))).toMatchObject({
      intent: "AUTHORIZE",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: "110.00" },
          custom_id: order.jobId,
        },
      ],
    });
    expect(new Headers(request.init.headers).get("PayPal-Request-Id")).toBe(
      "job-1:order",
    );
    expect(
      requests.every((r) =>
        r.url.startsWith("https://api-m.sandbox.paypal.com/"),
      ),
    ).toBe(true);
    expect(requests.some((r) => r.url.endsWith("/capture"))).toBe(false);
  });
  it("rejects a mismatched authorization amount", async () => {
    responseFor = () => ({
      purchase_units: [
        {
          payments: {
            authorizations: [
              {
                id: "A",
                expiration_time: "2026-12-01T00:00:00Z",
                amount: { currency_code: "USD", value: "220.00" },
              },
            ],
          },
        },
      ],
    });
    await expect(
      client().authorizeOrder({
        jobId: "job",
        orderId: "O",
        expectedAmountCents: 11000,
      }),
    ).rejects.toThrow(/amount mismatch/);
  });
  it("validates capture totals and normalizes declined states", async () => {
    responseFor = () => ({
      id: "CAP",
      status: "DENIED",
      amount: { currency_code: "USD", value: "110.00" },
    });
    const p = client();
    expect(
      await p.capture({
        jobId: "j",
        authorizationId: "A",
        invoiceId: "SB-j",
        expectedAmountCents: 11000,
      }),
    ).toEqual({ captureId: "CAP", status: "DECLINED" });
    const req = requests.at(-1)!;
    expect(JSON.parse(String(req.init.body))).toEqual({
      final_capture: true,
      invoice_id: "SB-j",
    });
    expect(new Headers(req.init.headers).get("PayPal-Request-Id")).toBe(
      "j:capture",
    );
    await expect(
      p.capture({
        jobId: "j",
        authorizationId: "A",
        invoiceId: "SB-j",
        expectedAmountCents: 22000,
      }),
    ).rejects.toThrow(/amount mismatch/);
  });
  it.each([
    ["SUCCESS", "SUCCEEDED"],
    ["UNCLAIMED", "UNCLAIMED"],
    ["FAILED", "FAILED"],
    ["RETURNED", "FAILED"],
    ["PENDING", "PENDING"],
  ])("uses payout item state %s", async (status, expected) => {
    responseFor = () => ({
      batch_header: { batch_status: "SUCCESS" },
      items: [{ transaction_status: status }],
    });
    expect(await client().pollPayout("batch")).toBe(expected);
  });
  it("does not mistake batch acceptance for recipient settlement", async () => {
    responseFor = () => ({ batch_header: { batch_status: "SUCCESS" } });
    expect(await client().pollPayout("batch")).toBe("PENDING");
  });
  it("sends fixed USD EMAIL payouts and stable batch IDs", async () => {
    responseFor = () => ({ batch_header: { payout_batch_id: "BATCH" } });
    const p = client();
    await p.createPayout({
      jobId: "j",
      email: "recipient@example.com",
      amountCents: 11000,
      note: "repair",
    });
    const req = requests.at(-1)!;
    expect(JSON.parse(String(req.init.body))).toMatchObject({
      sender_batch_header: { sender_batch_id: "j:payout" },
      items: [
        {
          receiver: "recipient@example.com",
          recipient_type: "EMAIL",
          amount: { currency: "USD", value: "110.00" },
        },
      ],
    });
  });
  it("rejects missing signature headers without contacting PayPal", async () => {
    expect(await client().verifyWebhook({}, "{}")).toBe(false);
    expect(requests).toHaveLength(0);
  });
  it("accepts only an explicit successful signature verification", async () => {
    const headers = {
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url":
        "https://api.sandbox.paypal.com/v1/notifications/certs/test",
      "paypal-transmission-id": "t",
      "paypal-transmission-sig": "s",
      "paypal-transmission-time": "2026-10-31T00:00:00Z",
    };
    responseFor = () => ({ verification_status: "FAILURE" });
    const p = client();
    expect(await p.verifyWebhook(headers, '{"id":"event"}')).toBe(false);
    responseFor = () => ({ verification_status: "SUCCESS" });
    expect(await p.verifyWebhook(headers, '{"id":"event"}')).toBe(true);
    expect(JSON.parse(String(requests.at(-1)!.init.body))).toMatchObject({
      webhook_id: "WH-test",
      webhook_event: { id: "event" },
    });
  });
  it("classifies definite declines without leaking provider error bodies", async () => {
    responseFor = () =>
      new Response(
        JSON.stringify({
          details: [{ issue: "INSTRUMENT_DECLINED" }],
          debug_id: "private-debug",
          message: "sensitive upstream text",
        }),
        { status: 422 },
      );
    let failure: unknown;
    try {
      await client().capture({
        jobId: "j",
        authorizationId: "A",
        invoiceId: "SB-j",
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PayPalHttpError);
    expect((failure as PayPalHttpError).isDefinitiveDecline).toBe(true);
    expect((failure as Error).message).not.toContain("sensitive");
  });
  it("refuses construction in live mode", () => {
    vi.stubEnv("PAYPAL_ENV", "live");
    expect(() => client()).toThrow(/sandbox/);
  });
});
