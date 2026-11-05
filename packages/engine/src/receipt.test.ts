import { randomUUID } from "node:crypto";
import { afterAll, it, expect, vi } from "vitest";
import { sql, paymentLocks, createJob, recordPayment } from "@switchboard/db";
import {
  MockPayPal,
  ReceiptReviewError,
  type ReceiptAgent,
} from "@switchboard/paypal";
import { createMoneyEngine } from "./money";

const jobs: string[] = [];
async function fixture(receiptAgent: ReceiptAgent) {
  const job = await createJob(randomUUID(), "receipt fixture");
  jobs.push(job.id);
  const [business] =
    await sql`insert into businesses(job_id,name,phone,payout_email) values(${job.id},'QuickFix','+12025550102','recipient@example.com') returning id`;
  const [call] =
    await sql`insert into calls(job_id,business_id,purpose) values(${job.id},${business.id},'quote') returning id`;
  const [quote] =
    await sql`insert into quotes(call_id,business_id,price_cents,confidence,includes) values(${call.id},${business.id},11000,0.95,ARRAY['labour']) returning id`;
  await sql`update jobs set state='CLOSED',chosen_quote_id=${quote.id},approved_book_at=now(),approved_done_at=now(),payout_email_shown_at=now() where id=${job.id}`;
  for (const kind of ["order", "capture"] as const)
    await recordPayment({
      jobId: job.id,
      kind,
      paypalId: kind.toUpperCase() + "-" + job.id,
      status: kind === "capture" ? "COMPLETED" : "CREATED",
      amountCents: 11000,
      requestId: job.id + ":" + kind,
      raw: {},
    });
  const engine = createMoneyEngine({
    paypal: new MockPayPal(),
    env: { APP_URL: "https://app.example", MOCK_PAYPAL: "0" },
    enqueue: vi.fn(),
    tel: { sendSms: vi.fn() },
    receiptAgent,
  });
  return { job, engine };
}
afterAll(async () => {
  for (const id of jobs) {
    await sql`delete from effects where job_id=${id}`;
    await sql`delete from events where job_id=${id}`;
    await sql`delete from payments where job_id=${id}`;
    await sql`update jobs set chosen_quote_id=null where id=${id}`;
    await sql`delete from quotes where business_id in(select id from businesses where job_id=${id})`;
    await sql`delete from calls where job_id=${id}`;
    await sql`delete from businesses where job_id=${id}`;
    await sql`delete from jobs where id=${id}`;
  }
  await Promise.all([sql.end(), paymentLocks.end()]);
});
it("serializes receipt retries and stores one verified invoice without changing captured money", async () => {
  const run = vi.fn<ReceiptAgent>(async (request, checkpoint) => {
    expect(request.amountCents).toBe(11000);
    expect(request.businessName).toBe("QuickFix");
    await checkpoint({
      invoiceId: "INV2-TEST-TEST-TEST-TEST",
      status: "PENDING",
      verified: false,
    });
    await checkpoint({
      invoiceId: "INV2-TEST-TEST-TEST-TEST",
      status: "PAID",
      verified: true,
    });
  });
  const { job, engine } = await fixture(run);
  await Promise.all([engine.receipt(job.id), engine.receipt(job.id)]);
  const rows = await sql`select * from payments where job_id=${job.id}`;
  expect(run).toHaveBeenCalledTimes(1);
  expect(rows.filter((r) => r.kind === "invoice")).toHaveLength(1);
  expect(rows.find((r) => r.kind === "invoice")).toMatchObject({
    status: "PAID",
    amountCents: 11000,
  });
  expect(rows.filter((r) => r.kind === "capture")).toHaveLength(1);
  expect(rows.some((r) => r.kind === "payout")).toBe(false);
});
it("passes the durable invoice ID back after an interrupted provider operation", async () => {
  let attempt = 0;
  const run: ReceiptAgent = async (request, checkpoint) => {
    if (!attempt++) {
      await checkpoint({
        invoiceId: "INV2-RESUME",
        status: "PENDING",
        verified: false,
      });
      throw new Error("provider timeout");
    }
    expect(request.saved?.invoiceId).toBe("INV2-RESUME");
    await checkpoint({
      invoiceId: "INV2-RESUME",
      status: "PAID",
      verified: true,
    });
  };
  const { job, engine } = await fixture(run);
  await expect(engine.receipt(job.id)).rejects.toThrow("provider timeout");
  await engine.receipt(job.id);
  const rows =
    await sql`select * from payments where job_id=${job.id} and kind='invoice'`;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ paypalId: "INV2-RESUME", status: "PAID" });
});
it("records review status instead of a paid receipt after a mismatch", async () => {
  const run = vi.fn<ReceiptAgent>(async (_request, checkpoint) => {
    await checkpoint({
      invoiceId: "INV2-REVIEW",
      status: "PENDING",
      verified: false,
    });
    throw new ReceiptReviewError("Invoice total mismatch");
  });
  const { job, engine } = await fixture(run);
  await engine.receipt(job.id);
  await engine.receipt(job.id);
  const [invoice] =
    await sql`select * from payments where job_id=${job.id} and kind='invoice'`;
  expect(invoice.status).toBe("NEEDS_REVIEW");
  expect(invoice.raw.verified).toBe(false);
  expect(run).toHaveBeenCalledTimes(1);
});
it("requires completion approval before invoking receipt tools", async () => {
  const run = vi.fn<ReceiptAgent>();
  const { job, engine } = await fixture(run);
  await sql`update jobs set approved_done_at=null where id=${job.id}`;
  await expect(engine.receipt(job.id)).rejects.toThrow(
    "approved, captured quote amount",
  );
  expect(run).not.toHaveBeenCalled();
});
it("recovers only identifier-format review failures without repeating payment", async () => {
  const run = vi.fn<ReceiptAgent>(async (_request, checkpoint) => {
    await checkpoint({
      invoiceId: "INV2-RECOVERED",
      status: "PAID",
      verified: true,
    });
  });
  const { job, engine } = await fixture(run);
  await recordPayment({
    jobId: job.id,
    kind: "invoice",
    paypalId: null,
    status: "NEEDS_REVIEW",
    amountCents: 11000,
    requestId: job.id + ":invoice",
    raw: {
      invoiceId: "",
      status: "NEEDS_REVIEW",
      verified: false,
      reason: "PayPal did not return a valid sandbox invoice identifier.",
    },
  });
  await engine.receipt(job.id);
  await engine.receipt(job.id);
  expect(run).toHaveBeenCalledTimes(1);
  const rows = await sql`select * from payments where job_id=${job.id}`;
  expect(rows.filter((p) => p.kind === "capture")).toHaveLength(1);
  expect(rows.some((p) => p.kind === "payout")).toBe(false);
  expect(rows.find((p) => p.kind === "invoice")?.status).toBe("PAID");
});
it("does not create real invoices for historical mock captures", async () => {
  const run = vi.fn<ReceiptAgent>();
  const { job, engine } = await fixture(run);
  await sql`update payments set paypal_id='MOCK-C-OLD' where job_id=${job.id} and kind='capture'`;
  await engine.receipt(job.id);
  expect(run).not.toHaveBeenCalled();
});
