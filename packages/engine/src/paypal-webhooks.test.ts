import { randomUUID } from "node:crypto";
import { afterAll, it, expect, vi } from "vitest";
import {
  sql,
  createJob,
  getJob,
  recordPayment,
  paymentLocks,
} from "@switchboard/db";
import { MockPayPal, PayPalHttpError } from "@switchboard/paypal";
import { createMoneyEngine } from "./money";
import { receivePayPalWebhook } from "./paypal-webhooks";
const jobs: string[] = [];
const events: string[] = [];
const brief = {
  task: "repair",
  category: "home_repair",
  location: "Avondale",
  windowStart: "2026-11-01T07:00:00+02:00",
  windowEnd: "2026-11-01T19:00:00+02:00",
  budgetCents: 12000,
  currency: "USD",
};
async function fixture(state = "COMPLETED") {
  const j = await createJob(randomUUID(), "integration fixture");
  jobs.push(j.id);
  const [b] =
    await sql`insert into businesses(job_id,name,phone,payout_email,is_bot) values(${j.id},'QuickFix','+12025550102','safe@example.com',true) returning id`;
  const [c] =
    await sql`insert into calls(job_id,business_id,purpose) values(${j.id},${b.id},'quote') returning id`;
  const [q] =
    await sql`insert into quotes(call_id,business_id,price_cents,confidence) values(${c.id},${b.id},11000,0.95) returning id`;
  await sql`update jobs set state=${state},brief=${JSON.stringify(brief)}::jsonb,chosen_quote_id=${q.id},approved_book_at=now(),approved_done_at=now(),payout_email_shown_at=now() where id=${j.id}`;
  const paypal = new MockPayPal();
  vi.spyOn(paypal, "verifyWebhook").mockResolvedValue(true);
  paypal.restoreOrder("ORDER-" + j.id, j.id);
  await recordPayment({
    jobId: j.id,
    kind: "order",
    paypalId: "ORDER-" + j.id,
    status: "CREATED",
    amountCents: 11000,
    requestId: j.id + ":order",
    raw: {},
  });
  if (state !== "BOOK_APPROVED")
    await recordPayment({
      jobId: j.id,
      kind: "authorization",
      paypalId: "AUTH-" + j.id,
      status: "HELD",
      amountCents: 11000,
      requestId: j.id + ":authorize",
      raw: {},
    });
  const enqueue = vi.fn(async (name: string, jobId: string, at?: Date) => {
    void name;
    void jobId;
    void at;
  });
  const provider: import("@switchboard/paypal").PayPal = paypal;
  const money = createMoneyEngine({
    paypal: provider,
    env: { APP_URL: "http://localhost:3000", MOCK_PAYPAL: "1" },
    enqueue,
    tel: { sendSms: async () => {} },
  });
  return { j, paypal, provider, money, enqueue };
}
async function deliver(paypal: MockPayPal, type: string, resource: unknown) {
  const eventId = randomUUID();
  events.push(eventId);
  const body = JSON.stringify({ id: eventId, event_type: type, resource });
  const result = await receivePayPalWebhook(paypal, {}, body);
  return { eventId, body, result };
}
it("queues verified events durably, dedupes retries, and reconciles capture once", async () => {
  const { j, paypal, money } = await fixture();
  const incoming = await deliver(paypal, "PAYMENT.CAPTURE.COMPLETED", {
    id: "CAP-" + j.id,
    amount: { currency_code: "USD", value: "110.00" },
    supplementary_data: { related_ids: { authorization_id: "AUTH-" + j.id } },
  });
  expect(incoming.result.status).toBe(200);
  expect(
    (await receivePayPalWebhook(paypal, {}, incoming.body)).duplicate,
  ).toBe(true);
  expect(
    await sql`select * from effects where job_id=${j.id} and name='paypalWebhook'`,
  ).toHaveLength(1);
  await Promise.all([
    money.reconcileWebhook(j.id, incoming.eventId),
    money.reconcileWebhook(j.id, incoming.eventId),
  ]);
  expect((await getJob(j.id)).state).toBe("PAID_OUT");
  expect(
    await sql`select * from payments where job_id=${j.id} and kind='capture'`,
  ).toHaveLength(1);
  expect(
    await sql`select * from effects where job_id=${j.id} and name='payout'`,
  ).toHaveLength(1);
});
it("backs up a missed browser approval return", async () => {
  const { j, paypal, money } = await fixture("BOOK_APPROVED");
  const incoming = await deliver(paypal, "CHECKOUT.ORDER.APPROVED", {
    id: "ORDER-" + j.id,
  });
  await money.reconcileWebhook(j.id, incoming.eventId);
  expect((await getJob(j.id)).state).toBe("FUNDS_HELD");
});
it("rejects capture amounts that differ from the approved quote", async () => {
  const { j, paypal, money } = await fixture();
  const incoming = await deliver(paypal, "PAYMENT.CAPTURE.COMPLETED", {
    id: "CAP-" + j.id,
    amount: { currency_code: "USD", value: "220.00" },
    supplementary_data: { related_ids: { authorization_id: "AUTH-" + j.id } },
  });
  await expect(money.reconcileWebhook(j.id, incoming.eventId)).rejects.toThrow(
    /amount/,
  );
  expect((await getJob(j.id)).state).toBe("COMPLETED");
  expect(
    await sql`select * from payments where job_id=${j.id} and kind='capture'`,
  ).toHaveLength(0);
});
it("does not correlate an attacker-supplied custom_id to a job", async () => {
  const { j, paypal } = await fixture();
  await deliver(paypal, "PAYMENT.CAPTURE.COMPLETED", {
    id: "UNRELATED",
    custom_id: j.id,
    amount: { currency_code: "USD", value: "110.00" },
  });
  expect(await sql`select * from effects where job_id=${j.id}`).toHaveLength(0);
});
it.each(["SUCCEEDED", "UNCLAIMED"])(
  "closes only on a verified recipient payout %s",
  async (status) => {
    const { j, paypal, money } = await fixture("PAID_OUT");
    await recordPayment({
      jobId: j.id,
      kind: "capture",
      paypalId: "CAP-" + j.id,
      status: "COMPLETED",
      amountCents: 11000,
      requestId: j.id + ":capture",
      raw: {},
    });
    await recordPayment({
      jobId: j.id,
      kind: "payout",
      paypalId: "BATCH-" + j.id,
      status: "PENDING",
      amountCents: 11000,
      requestId: j.id + ":payout",
      raw: { email: "safe@example.com" },
    });
    const wrong = await deliver(paypal, "PAYMENT.PAYOUTS-ITEM." + status, {
      payout_batch_id: "BATCH-" + j.id,
      payout_item: {
        receiver: "scam@example.com",
        amount: { currency: "USD", value: "110.00" },
      },
    });
    await expect(money.reconcileWebhook(j.id, wrong.eventId)).rejects.toThrow(
      /recipient/,
    );
    expect((await getJob(j.id)).state).toBe("PAID_OUT");
    const good = await deliver(paypal, "PAYMENT.PAYOUTS-ITEM." + status, {
      payout_batch_id: "BATCH-" + j.id,
      payout_item: {
        receiver: "safe@example.com",
        amount: { currency: "USD", value: "110.00" },
      },
    });
    await money.reconcileWebhook(j.id, good.eventId);
    expect((await getJob(j.id)).state).toBe("CLOSED");
  },
);
it("polls pending capture after 60 seconds without issuing a second capture", async () => {
  const { j, provider, money, enqueue } = await fixture();
  const capture = vi
    .spyOn(provider, "capture")
    .mockResolvedValue({ captureId: "CAP-" + j.id, status: "PENDING" });
  const poll = vi
    .spyOn(provider, "pollCapture")
    .mockResolvedValueOnce("PENDING")
    .mockResolvedValue("COMPLETED");
  const before = Date.now();
  await money.capture(j.id);
  expect((await getJob(j.id)).state).toBe("COMPLETED");
  expect(enqueue.mock.calls[0][0]).toBe("pollCapture");
  expect(enqueue.mock.calls[0][2]!.getTime() - before).toBeGreaterThanOrEqual(
    59000,
  );
  await money.pollCapture(j.id);
  expect(enqueue).toHaveBeenCalledTimes(2);
  await money.pollCapture(j.id);
  expect((await getJob(j.id)).state).toBe("PAID_OUT");
  expect(capture).toHaveBeenCalledTimes(1);
  expect(poll).toHaveBeenCalledTimes(2);
});
it("keeps payout pending until recipient status settles", async () => {
  const { j, provider, money, enqueue } = await fixture("PAID_OUT");
  await recordPayment({
    jobId: j.id,
    kind: "capture",
    paypalId: "CAP-" + j.id,
    status: "COMPLETED",
    amountCents: 11000,
    requestId: j.id + ":capture",
    raw: {},
  });
  await recordPayment({
    jobId: j.id,
    kind: "payout",
    paypalId: "BATCH-" + j.id,
    status: "PENDING",
    amountCents: 11000,
    requestId: j.id + ":payout",
    raw: { email: "safe@example.com" },
  });
  vi.spyOn(provider, "pollPayout")
    .mockResolvedValueOnce("PENDING")
    .mockResolvedValue("UNCLAIMED");
  await money.pollPayout(j.id);
  expect((await getJob(j.id)).state).toBe("PAID_OUT");
  expect(enqueue.mock.calls[0][0]).toBe("pollPayout");
  await money.pollPayout(j.id);
  expect((await getJob(j.id)).state).toBe("CLOSED");
});
it("recovers after an authorization was recorded before the state transition", async () => {
  const { j, paypal, money } = await fixture("BOOK_APPROVED");
  await recordPayment({
    jobId: j.id,
    kind: "authorization",
    paypalId: "RECORDED-AUTH",
    status: "HELD",
    amountCents: 11000,
    requestId: j.id + ":authorize",
    raw: {},
  });
  const request = vi.spyOn(paypal, "authorizeOrder");
  await money.authorize(j.id, "ORDER-" + j.id);
  expect(request).not.toHaveBeenCalled();
  expect((await getJob(j.id)).state).toBe("FUNDS_HELD");
});
it("recovers a payout settlement after the ledger write but before closure", async () => {
  const { j, paypal, money } = await fixture("PAID_OUT");
  await recordPayment({
    jobId: j.id,
    kind: "capture",
    paypalId: "CAP-" + j.id,
    status: "COMPLETED",
    amountCents: 11000,
    requestId: j.id + ":capture",
    raw: {},
  });
  await recordPayment({
    jobId: j.id,
    kind: "payout",
    paypalId: "BATCH-" + j.id,
    status: "SUCCEEDED",
    amountCents: 11000,
    requestId: j.id + ":payout",
    raw: {},
  });
  const incoming = await deliver(paypal, "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", {
    payout_batch_id: "BATCH-" + j.id,
    payout_item: {
      receiver: "safe@example.com",
      amount: { currency: "USD", value: "110.00" },
    },
  });
  await money.reconcileWebhook(j.id, incoming.eventId);
  expect((await getJob(j.id)).state).toBe("CLOSED");
});
it("moves a definite provider capture denial to ISSUE without inventing a capture ID", async () => {
  const { j, provider, money } = await fixture();
  vi.spyOn(provider, "capture").mockRejectedValue(
    new PayPalHttpError(422, ["INSTRUMENT_DECLINED"]),
  );
  await money.capture(j.id);
  expect((await getJob(j.id)).state).toBe("ISSUE");
  expect(
    await sql`select * from payments where job_id=${j.id} and kind='capture'`,
  ).toHaveLength(0);
});
afterAll(async () => {
  for (const job of jobs) {
    await sql`delete from effects where job_id=${job}`;
    await sql`delete from events where job_id=${job}`;
    await sql`delete from payments where job_id=${job}`;
    await sql`delete from quotes where business_id in(select id from businesses where job_id=${job})`;
    await sql`delete from calls where job_id=${job}`;
    await sql`delete from businesses where job_id=${job}`;
    await sql`delete from jobs where id=${job}`;
  }
  for (const id of events) await sql`delete from webhook_events where id=${id}`;
  await Promise.all([sql.end(), paymentLocks.end()]);
});
