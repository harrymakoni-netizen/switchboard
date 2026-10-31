import { afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, createJob, getJob, recordPayment } from "@switchboard/db";
import type { JobEvent, State } from "@switchboard/shared";
import { nextState, allowed, transition, showPayoutEmail } from "./index";
const brief = {
  task: "Fix geyser",
  category: "home_repair" as const,
  location: "Avondale",
  windowStart: "2026-11-01T07:00:00+02:00",
  windowEnd: "2026-11-01T19:00:00+02:00",
  budgetCents: 12000,
  currency: "USD" as const,
};
const cases: [State, JobEvent, State][] = [
  ["DRAFT", { type: "BRIEF_READY", brief }, "FINDING"],
  ["FINDING", { type: "BUSINESSES_FOUND", count: 3 }, "CALLING"],
  ["FINDING", { type: "BUSINESSES_FOUND", count: 2 }, "ISSUE"],
  ["CALLING", { type: "CALLS_FINISHED" }, "QUOTED"],
  ["QUOTED", { type: "USER_BOOKED", quoteId: randomUUID() }, "BOOK_APPROVED"],
  [
    "BOOK_APPROVED",
    { type: "PAYPAL_AUTHORIZED", authorizationId: "a" },
    "FUNDS_HELD",
  ],
  [
    "FUNDS_HELD",
    {
      type: "BUSINESS_CONFIRMED",
      payoutEmail: "a@b.com",
      slot: brief.windowStart,
    },
    "CONFIRMED",
  ],
  ["FUNDS_HELD", { type: "BUSINESS_DECLINED" }, "ISSUE"],
  ["CONFIRMED", { type: "SLOT_PASSED" }, "AWAITING_COMPLETION"],
  ["AWAITING_COMPLETION", { type: "USER_CONFIRMED_DONE" }, "COMPLETED"],
  ["AWAITING_COMPLETION", { type: "USER_REPORTED_NOT_DONE" }, "ISSUE"],
  ["COMPLETED", { type: "CAPTURE_COMPLETED", captureId: "c" }, "PAID_OUT"],
  ["COMPLETED", { type: "CAPTURE_DECLINED" }, "ISSUE"],
  ["PAID_OUT", { type: "PAYOUT_SETTLED", status: "SUCCEEDED" }, "CLOSED"],
  ["PAID_OUT", { type: "PAYOUT_FAILED" }, "ISSUE"],
  [
    "ISSUE",
    {
      type: "BUSINESS_CONFIRMED",
      payoutEmail: "a@b.com",
      slot: brief.windowStart,
    },
    "CONFIRMED",
  ],
  ...(["BOOK_APPROVED", "FUNDS_HELD", "CONFIRMED", "ISSUE"] as State[]).map(
    (s) =>
      [s, { type: "USER_CANCELLED" }, "CANCELLED"] as [State, JobEvent, State],
  ),
];
describe("transition graph", () => {
  for (const [from, event, to] of cases)
    it(`${from} → ${to}`, () => expect(nextState(from, event)).toBe(to));
  it("covers every allowed edge", () => {
    for (const [from, tos] of Object.entries(allowed))
      for (const to of tos)
        expect(cases.some(([a, , b]) => a === from && b === to)).toBe(true);
  });
  for (const state of Object.keys(allowed) as State[])
    if (state !== "QUOTED")
      it(`rejects booking from ${state}`, () =>
        expect(() =>
          nextState(state, { type: "USER_BOOKED", quoteId: "x" }),
        ).toThrow());
});
async function fixture(price = 11000) {
  const j = await createJob(randomUUID(), "test");
  await sql`update jobs set state='QUOTED',brief=${JSON.stringify(brief)}::jsonb where id=${j.id}`;
  const [b] =
    await sql`insert into businesses(job_id,name,phone,is_bot) values(${j.id},'Bot','+12025550101',true) returning id`;
  const [c] =
    await sql`insert into calls(job_id,business_id,purpose) values(${j.id},${b.id},'quote') returning id`;
  const [q] =
    await sql`insert into quotes(call_id,business_id,price_cents,confidence,earliest_slot) values(${c.id},${b.id},${price},0.9,${brief.windowStart}) returning id`;
  return { j, q, b };
}
describe("transactional guards and ledger", () => {
  it("rejects over budget without writes", async () => {
    const { j, q } = await fixture(13000);
    await expect(
      transition(j.id, { type: "USER_BOOKED", quoteId: q.id }),
    ).rejects.toThrow(/budget/);
    expect((await getJob(j.id)).state).toBe("QUOTED");
  });
  it("serializes concurrent bookings", async () => {
    const { j, q } = await fixture();
    const [b2] =
      await sql`insert into businesses(job_id,name,phone,is_bot) values(${j.id},'Other Bot','+12025550102',true) returning id`;
    const [c2] =
      await sql`insert into calls(job_id,business_id,purpose) values(${j.id},${b2.id},'quote') returning id`;
    const [q2] =
      await sql`insert into quotes(call_id,business_id,price_cents,confidence) values(${c2.id},${b2.id},10000,0.9) returning id`;
    const results = await Promise.allSettled([
      transition(j.id, { type: "USER_BOOKED", quoteId: q.id }),
      transition(j.id, { type: "USER_BOOKED", quoteId: q2.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await sql`select * from effects where job_id=${j.id}`).toHaveLength(
      1,
    );
  });
  it("requires shown payout email before completion", async () => {
    const { j, b } = await fixture();
    await sql`update jobs set state='AWAITING_COMPLETION',chosen_quote_id=(select id from quotes where business_id=${b.id}) where id=${j.id}`;
    await sql`update businesses set payout_email='safe@example.com' where id=${b.id}`;
    await expect(
      transition(j.id, { type: "USER_CONFIRMED_DONE" }),
    ).rejects.toThrow(/recipient/);
    await showPayoutEmail(j.id);
    await transition(j.id, { type: "USER_CONFIRMED_DONE" });
    expect((await getJob(j.id)).state).toBe("COMPLETED");
  });
  it("keeps one ledger row per request id across concurrent retries", async () => {
    const { j } = await fixture();
    const p = {
      jobId: j.id,
      kind: "order" as const,
      paypalId: "O",
      status: "CREATED",
      amountCents: 11000,
      requestId: j.id + ":order",
      raw: {},
    };
    await Promise.all([recordPayment(p), recordPayment(p)]);
    expect(
      await sql`select * from payments where request_id=${p.requestId}`,
    ).toHaveLength(1);
  });
  it("refuses cancellation after a capture even in ISSUE", async () => {
    const { j } = await fixture();
    await sql`update jobs set state='ISSUE' where id=${j.id}`;
    await recordPayment({
      jobId: j.id,
      kind: "capture",
      paypalId: "CAP",
      status: "COMPLETED",
      amountCents: 11000,
      requestId: j.id + ":capture",
      raw: {},
    });
    await expect(transition(j.id, { type: "USER_CANCELLED" })).rejects.toThrow(
      /captured/,
    );
  });
  it("rejects cross-job quotes", async () => {
    const { j } = await fixture();
    const other = await fixture();
    await expect(
      transition(j.id, { type: "USER_BOOKED", quoteId: other.q.id }),
    ).rejects.toThrow();
  });
});
afterAll(() => sql.end());
