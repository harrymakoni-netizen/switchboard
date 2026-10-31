import { it, expect } from "vitest";
import { MockPayPal } from "./index";
const args = {
  jobId: "test",
  amountCents: 11000,
  description: "repair",
  returnUrl: "http://localhost/return",
  cancelUrl: "http://localhost/cancel",
};
it("hold → capture → payout is idempotent", async () => {
  const p = new MockPayPal();
  const o = await p.createOrder(args);
  expect(await p.createOrder(args)).toEqual(o);
  const a = await p.authorizeOrder({ jobId: "test", orderId: o.orderId });
  const capture = {
    jobId: "test",
    authorizationId: a.authorizationId,
    invoiceId: "SB-test",
  };
  const c = await p.capture(capture);
  expect(await p.capture(capture)).toEqual(c);
  expect(c.status).toBe("COMPLETED");
  const pay = {
    jobId: "test",
    email: "safe@example.com",
    amountCents: 11000,
    note: "repair",
  };
  expect(await p.createPayout(pay)).toEqual(await p.createPayout(pay));
  await expect(p.voidAuthorization(capture)).rejects.toThrow();
});
it("hold → void never captures", async () => {
  const p = new MockPayPal();
  const o = await p.createOrder(args);
  const a = await p.authorizeOrder({ jobId: "test", orderId: o.orderId });
  await p.voidAuthorization({ jobId: "test", ...a });
  await p.voidAuthorization({ jobId: "test", ...a });
  await expect(
    p.capture({ jobId: "test", ...a, invoiceId: "x" }),
  ).rejects.toThrow();
});
it("rejects changed amount on retry and wrong order ownership", async () => {
  const p = new MockPayPal();
  const o = await p.createOrder(args);
  await expect(p.createOrder({ ...args, amountCents: 22000 })).rejects.toThrow(
    /Idempotency/,
  );
  await expect(
    p.authorizeOrder({ jobId: "other", orderId: o.orderId }),
  ).rejects.toThrow();
});
it("rejects unsigned mock webhooks", async () =>
  expect(await new MockPayPal().verifyWebhook({}, "{}")).toBe(false));
