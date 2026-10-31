import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { fromCents, type Cents } from "@switchboard/shared";
export interface OrderArgs {
  jobId: string;
  amountCents: Cents;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}
export interface PayPal {
  createOrder(a: OrderArgs): Promise<{ orderId: string; approveUrl: string }>;
  authorizeOrder(a: {
    jobId: string;
    orderId: string;
  }): Promise<{ authorizationId: string; expiresAt: string }>;
  reauthorize(a: {
    jobId: string;
    authorizationId: string;
    n: number;
  }): Promise<{ authorizationId: string }>;
  capture(a: {
    jobId: string;
    authorizationId: string;
    invoiceId: string;
  }): Promise<{
    captureId: string;
    status: "COMPLETED" | "PENDING" | "DECLINED";
  }>;
  voidAuthorization(a: {
    jobId: string;
    authorizationId: string;
  }): Promise<void>;
  createPayout(a: {
    jobId: string;
    email: string;
    amountCents: Cents;
    note: string;
  }): Promise<{ batchId: string; itemId: string | null }>;
  verifyWebhook(
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<boolean>;
  pollCapture(id: string): Promise<"COMPLETED" | "PENDING" | "DECLINED">;
  pollPayout(
    id: string,
  ): Promise<"SUCCEEDED" | "UNCLAIMED" | "PENDING" | "FAILED">;
}
const id = () => randomUUID().replaceAll("-", "").slice(0, 17).toUpperCase();
export class MockPayPal implements PayPal {
  private capturedJobs = new Set<string>();
  restoreOrder(orderId: string, jobId: string) {
    this.orders.set(orderId, { jobId, status: "CREATED" });
  }
  restoreHold(authorizationId: string, jobId: string, status: string) {
    this.holds.set(authorizationId, { jobId, status });
    if (status === "CAPTURED") this.capturedJobs.add(jobId);
  }
  private requests = new Map<
    string,
    { fingerprint: string; result: unknown }
  >();
  private orders = new Map<string, { jobId: string; status: string }>();
  private holds = new Map<string, { jobId: string; status: string }>();
  private once<T>(key: string, args: unknown, fn: () => T): T {
    const fingerprint = JSON.stringify(args);
    const old = this.requests.get(key);
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw new Error("Idempotency key reused with different arguments");
      return old.result as T;
    }
    const result = fn();
    this.requests.set(key, { fingerprint, result });
    return result;
  }
  async createOrder(a: OrderArgs) {
    fromCents(a.amountCents);
    return this.once(a.jobId + ":order", a, () => {
      const orderId = "MOCK-O-" + id();
      this.orders.set(orderId, { jobId: a.jobId, status: "CREATED" });
      return { orderId, approveUrl: a.returnUrl + "?token=" + orderId };
    });
  }
  async authorizeOrder(a: { jobId: string; orderId: string }) {
    return this.once(a.jobId + ":authorize", a, () => {
      const order = this.orders.get(a.orderId);
      if (!order || order.jobId !== a.jobId) throw new Error("Order mismatch");
      order.status = "AUTHORIZED";
      const authorizationId = "MOCK-A-" + id();
      this.holds.set(authorizationId, { jobId: a.jobId, status: "HELD" });
      return {
        authorizationId,
        expiresAt: new Date(Date.now() + 29 * 86400000).toISOString(),
      };
    });
  }
  async reauthorize(a: { jobId: string; authorizationId: string; n: number }) {
    return this.once(`${a.jobId}:reauth-${a.n}`, a, () => {
      const h = this.hold(a);
      if (h.status !== "HELD") throw new Error("Authorization not held");
      return { authorizationId: a.authorizationId };
    });
  }
  private hold(a: { jobId: string; authorizationId: string }) {
    const h = this.holds.get(a.authorizationId);
    if (!h || h.jobId !== a.jobId) throw new Error("Authorization mismatch");
    return h;
  }
  async capture(a: {
    jobId: string;
    authorizationId: string;
    invoiceId: string;
  }) {
    return this.once(a.jobId + ":capture", a, () => {
      const h = this.hold(a);
      if (h.status !== "HELD") throw new Error("Authorization not held");
      h.status = "CAPTURED";
      this.capturedJobs.add(a.jobId);
      return { captureId: "MOCK-C-" + id(), status: "COMPLETED" as const };
    });
  }
  async voidAuthorization(a: { jobId: string; authorizationId: string }) {
    this.once(a.jobId + ":void", a, () => {
      const h = this.hold(a);
      if (h.status !== "HELD") throw new Error("Authorization not held");
      h.status = "VOIDED";
      return true;
    });
  }
  async createPayout(a: {
    jobId: string;
    email: string;
    amountCents: number;
    note: string;
  }) {
    z.string().email().parse(a.email);
    fromCents(a.amountCents);
    return this.once(a.jobId + ":payout", a, () => {
      if (!this.capturedJobs.has(a.jobId)) throw new Error("Capture required");
      return { batchId: "MOCK-P-" + id(), itemId: "MOCK-I-" + id() };
    });
  }
  async verifyWebhook(headers: Record<string, string>, rawBody: string) {
    const secret = process.env.MOCK_WEBHOOK_SECRET;
    if (!secret) return false;
    const received = Buffer.from(headers["x-mock-signature"] ?? "");
    const expected = Buffer.from(secret);
    try {
      JSON.parse(rawBody);
      return (
        received.length === expected.length &&
        timingSafeEqual(received, expected)
      );
    } catch {
      return false;
    }
  }
  async pollCapture() {
    return "COMPLETED" as const;
  }
  async pollPayout() {
    return "SUCCEEDED" as const;
  }
}
const record = z.record(z.unknown());
const orderResponse = z.object({
  id: z.string(),
  links: z.array(z.object({ rel: z.string(), href: z.string().url() })),
});
export class HttpPayPal implements PayPal {
  private token: string | null = null;
  private expiry = 0;
  constructor(
    private clientId: string,
    private clientSecret: string,
    private webhookId: string,
  ) {
    if (process.env.PAYPAL_ENV !== "sandbox")
      throw new Error("PayPal sandbox required");
  }
  private async accessToken() {
    if (this.token && Date.now() < this.expiry) return this.token;
    const r = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
      method: "POST",
      headers: {
        authorization:
          "Basic " +
          Buffer.from(this.clientId + ":" + this.clientSecret).toString(
            "base64",
          ),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`PayPal OAuth ${r.status}`);
    const data = z
      .object({ access_token: z.string(), expires_in: z.number() })
      .parse(await r.json());
    this.token = data.access_token;
    this.expiry = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
    return this.token;
  }
  private async request(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ): Promise<unknown> {
    const r = await fetch("https://api-m.sandbox.paypal.com" + path, {
      method,
      headers: {
        authorization: "Bearer " + (await this.accessToken()),
        "content-type": "application/json",
        ...(key ? { "PayPal-Request-Id": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`PayPal ${method} ${path}: ${r.status}`);
    return r.status === 204 ? {} : r.json();
  }
  async createOrder(a: OrderArgs) {
    const d = orderResponse.parse(
      await this.request(
        "/v2/checkout/orders",
        "POST",
        {
          intent: "AUTHORIZE",
          purchase_units: [
            {
              reference_id: a.jobId,
              custom_id: a.jobId,
              description: a.description,
              amount: { currency_code: "USD", value: fromCents(a.amountCents) },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: "Switchboard",
                shipping_preference: "NO_SHIPPING",
                user_action: "CONTINUE",
                return_url: a.returnUrl,
                cancel_url: a.cancelUrl,
              },
            },
          },
        },
        a.jobId + ":order",
      ),
    );
    const link = d.links.find((l) =>
      ["payer-action", "approve"].includes(l.rel),
    );
    if (!link) throw new Error("PayPal approval URL missing");
    return { orderId: d.id, approveUrl: link.href };
  }
  async authorizeOrder(a: { jobId: string; orderId: string }) {
    const d = z
      .object({
        purchase_units: z.array(
          z.object({
            payments: z.object({
              authorizations: z.array(
                z.object({ id: z.string(), expiration_time: z.string() }),
              ),
            }),
          }),
        ),
      })
      .parse(
        await this.request(
          `/v2/checkout/orders/${encodeURIComponent(a.orderId)}/authorize`,
          "POST",
          {},
          a.jobId + ":authorize",
        ),
      );
    const auth = d.purchase_units[0]?.payments.authorizations[0];
    if (!auth) throw new Error("Authorization missing");
    return { authorizationId: auth.id, expiresAt: auth.expiration_time };
  }
  async reauthorize(a: { jobId: string; authorizationId: string; n: number }) {
    const d = z
      .object({ id: z.string() })
      .parse(
        await this.request(
          `/v2/payments/authorizations/${encodeURIComponent(a.authorizationId)}/reauthorize`,
          "POST",
          {},
          `${a.jobId}:reauth-${a.n}`,
        ),
      );
    return { authorizationId: d.id };
  }
  async capture(a: {
    jobId: string;
    authorizationId: string;
    invoiceId: string;
  }) {
    const d = z
      .object({
        id: z.string(),
        status: z.enum(["COMPLETED", "PENDING", "DECLINED"]),
      })
      .parse(
        await this.request(
          `/v2/payments/authorizations/${encodeURIComponent(a.authorizationId)}/capture`,
          "POST",
          { final_capture: true, invoice_id: a.invoiceId },
          a.jobId + ":capture",
        ),
      );
    return { captureId: d.id, status: d.status };
  }
  async voidAuthorization(a: { jobId: string; authorizationId: string }) {
    await this.request(
      `/v2/payments/authorizations/${encodeURIComponent(a.authorizationId)}/void`,
      "POST",
      {},
      a.jobId + ":void",
    );
  }
  async createPayout(a: {
    jobId: string;
    email: string;
    amountCents: number;
    note: string;
  }) {
    z.string().email().parse(a.email);
    const d = z
      .object({
        batch_header: z.object({ payout_batch_id: z.string() }),
        items: z.array(z.object({ payout_item_id: z.string() })).optional(),
      })
      .parse(
        await this.request(
          "/v1/payments/payouts",
          "POST",
          {
            sender_batch_header: {
              sender_batch_id: a.jobId + ":payout",
              email_subject: "You've been paid via Switchboard",
            },
            items: [
              {
                recipient_type: "EMAIL",
                receiver: a.email,
                amount: { currency: "USD", value: fromCents(a.amountCents) },
                note: a.note,
                sender_item_id: a.jobId,
              },
            ],
          },
          a.jobId + ":payout",
        ),
      );
    return {
      batchId: d.batch_header.payout_batch_id,
      itemId: d.items?.[0]?.payout_item_id ?? null,
    };
  }
  async verifyWebhook(h: Record<string, string>, rawBody: string) {
    try {
      const event = record.parse(JSON.parse(rawBody));
      const result = z
        .object({ verification_status: z.string() })
        .parse(
          await this.request(
            "/v1/notifications/verify-webhook-signature",
            "POST",
            {
              auth_algo: h["paypal-auth-algo"],
              cert_url: h["paypal-cert-url"],
              transmission_id: h["paypal-transmission-id"],
              transmission_sig: h["paypal-transmission-sig"],
              transmission_time: h["paypal-transmission-time"],
              webhook_id: this.webhookId,
              webhook_event: event,
            },
          ),
        );
      return result.verification_status === "SUCCESS";
    } catch {
      return false;
    }
  }
  async pollCapture(id: string) {
    return z
      .object({ status: z.enum(["COMPLETED", "PENDING", "DECLINED"]) })
      .parse(
        await this.request("/v2/payments/captures/" + encodeURIComponent(id)),
      ).status;
  }
  async pollPayout(
    id: string,
  ): Promise<"SUCCEEDED" | "UNCLAIMED" | "PENDING" | "FAILED"> {
    const s = z
      .object({ batch_header: z.object({ batch_status: z.string() }) })
      .parse(
        await this.request("/v1/payments/payouts/" + encodeURIComponent(id)),
      ).batch_header.batch_status;
    return s === "SUCCESS"
      ? "SUCCEEDED"
      : s === "DENIED"
        ? "FAILED"
        : "PENDING";
  }
}
