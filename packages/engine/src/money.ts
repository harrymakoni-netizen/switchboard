import { sql, getJob, recordPayment, emit } from "@switchboard/db";
import { fromCents, type Payment, type Quote } from "@switchboard/shared";
import { MockPayPal, type PayPal } from "@switchboard/paypal";
import { smsTemplate, type Telephony } from "@switchboard/calls";
import { transition, selected } from "./index";
export function createMoneyEngine({
  paypal,
  env,
  enqueue,
  tel,
}: {
  paypal: PayPal;
  env: { APP_URL: string; MOCK_PAYPAL: string };
  enqueue: (name: string, jobId: string, startAfter?: Date) => Promise<void>;
  tel: Pick<Telephony, "sendSms">;
}) {
  async function restore() {
    // Restore mock holds after a worker restart; the durable ledger is authoritative.
    if (paypal instanceof MockPayPal) {
      const ledger = await sql<
        Payment[]
      >`select * from payments order by created_at`;
      for (const p of ledger) {
        if (p.kind === "order" && p.paypalId)
          paypal.restoreOrder(p.paypalId, p.jobId);
        if (
          ["authorization", "reauthorization"].includes(p.kind) &&
          p.paypalId
        ) {
          const status = ledger.some(
            (x) => x.jobId === p.jobId && x.kind === "void",
          )
            ? "VOIDED"
            : ledger.some(
                  (x) =>
                    x.jobId === p.jobId &&
                    x.kind === "capture" &&
                    x.status === "COMPLETED",
                )
              ? "CAPTURED"
              : "HELD";
          paypal.restoreHold(p.paypalId, p.jobId, status);
        }
      }
    }
  }
  async function payment(
    jobId: string,
    kind: "order" | "authorization",
    paypalId: string,
    status: string,
    raw: unknown,
  ) {
    const job = await getJob(jobId);
    const [q] = await sql<
      Quote[]
    >`select * from quotes where id=${job.chosenQuoteId}`;
    return recordPayment({
      jobId,
      kind,
      paypalId,
      status,
      amountCents: q.priceCents,
      requestId:
        jobId + ":" + (kind === "authorization" ? "authorize" : "order"),
      raw,
    });
  }
  async function createOrder(jobId: string) {
    const j = await getJob(jobId);
    if (j.state !== "BOOK_APPROVED") return;
    const [q] = await sql<
      Quote[]
    >`select * from quotes where id=${j.chosenQuoteId}`;
    if (q.priceCents === null) throw new Error("Price missing");
    const result = await paypal.createOrder({
      jobId,
      amountCents: q.priceCents,
      description: j.brief!.task,
      returnUrl: `${env.APP_URL}/jobs/${jobId}/paypal/return`,
      cancelUrl: `${env.APP_URL}/jobs/${jobId}/paypal/cancel`,
    });
    await payment(jobId, "order", result.orderId, "CREATED", result);
  }

  async function ledger(jobId: string, kind: Payment["kind"]) {
    const [p] = await sql<
      Payment[]
    >`select * from payments where job_id=${jobId} and kind=${kind} order by created_at desc limit 1`;
    return p;
  }
  async function capture(jobId: string) {
    const job = await getJob(jobId);
    if (
      job.state !== "COMPLETED" ||
      !job.approvedDoneAt ||
      !job.payoutEmailShownAt
    )
      return;
    const q = await selected(sql, job);
    if (!q.payoutEmail || q.priceCents === null)
      throw new Error("Recipient or price missing");
    const auth =
      (await ledger(jobId, "reauthorization")) ??
      (await ledger(jobId, "authorization"));
    if (!auth?.paypalId) throw new Error("Hold missing");
    let payment = await ledger(jobId, "capture");
    if (!payment) {
      const result = await paypal.capture({
        jobId,
        authorizationId: auth.paypalId,
        invoiceId: "SB-" + jobId,
      });
      payment = await recordPayment({
        jobId,
        kind: "capture",
        paypalId: result.captureId,
        status: result.status,
        amountCents: q.priceCents,
        requestId: jobId + ":capture",
        raw: result,
      });
    }
    if (payment.status === "COMPLETED")
      await transition(jobId, {
        type: "CAPTURE_COMPLETED",
        captureId: payment.paypalId!,
      });
    else if (payment.status === "DECLINED")
      await transition(jobId, { type: "CAPTURE_DECLINED" });
    else await enqueue("pollCapture", jobId, new Date(Date.now() + 60000));
  }
  async function pollCapture(jobId: string) {
    const p = await ledger(jobId, "capture");
    if (!p?.paypalId || (await getJob(jobId)).state !== "COMPLETED") return;
    const status = await paypal.pollCapture(p.paypalId);
    await sql`update payments set status=${status} where id=${p.id}`;
    await emit(jobId, "payment.updated", {
      kind: "capture",
      status,
      amountCents: p.amountCents,
    });
    if (status === "COMPLETED")
      await transition(jobId, {
        type: "CAPTURE_COMPLETED",
        captureId: p.paypalId,
      });
    else if (status === "DECLINED")
      await transition(jobId, { type: "CAPTURE_DECLINED" });
    else await enqueue("pollCapture", jobId, new Date(Date.now() + 60000));
  }
  async function payout(jobId: string) {
    const job = await getJob(jobId);
    if (job.state !== "PAID_OUT") return;
    const captured = await ledger(jobId, "capture");
    const q = await selected(sql, job);
    if (
      captured?.status !== "COMPLETED" ||
      !q.payoutEmail ||
      !job.payoutEmailShownAt ||
      captured.amountCents !== q.priceCents
    )
      throw new Error("Payout guard rejected");
    let p = await ledger(jobId, "payout");
    if (!p) {
      const result = await paypal.createPayout({
        jobId,
        email: q.payoutEmail,
        amountCents: captured.amountCents!,
        note: "Switchboard job " + jobId,
      });
      p = await recordPayment({
        jobId,
        kind: "payout",
        paypalId: result.batchId,
        status: env.MOCK_PAYPAL === "1" ? "SUCCEEDED" : "PENDING",
        amountCents: captured.amountCents,
        requestId: jobId + ":payout",
        raw: { ...result, email: q.payoutEmail },
      });
    }
    await enqueue("receipt", jobId);
    if (["SUCCEEDED", "UNCLAIMED"].includes(p.status)) {
      await transition(jobId, {
        type: "PAYOUT_SETTLED",
        status: p.status as "SUCCEEDED" | "UNCLAIMED",
      });
      await tel.sendSms(
        q.phone,
        smsTemplate("paid", {
          email: q.payoutEmail,
          amount: fromCents(captured.amountCents!),
          date: new Date().toISOString().slice(0, 10),
        }),
      );
    } else await enqueue("pollPayout", jobId, new Date(Date.now() + 60000));
  }
  async function pollPayout(jobId: string) {
    const p = await ledger(jobId, "payout");
    if (!p?.paypalId || (await getJob(jobId)).state !== "PAID_OUT") return;
    const status = await paypal.pollPayout(p.paypalId);
    await sql`update payments set status=${status} where id=${p.id}`;
    await emit(jobId, "payment.updated", {
      kind: "payout",
      status,
      amountCents: p.amountCents,
    });
    if (status === "SUCCEEDED" || status === "UNCLAIMED")
      await transition(jobId, { type: "PAYOUT_SETTLED", status });
    else if (status === "FAILED")
      await transition(jobId, { type: "PAYOUT_FAILED" });
    else await enqueue("pollPayout", jobId, new Date(Date.now() + 60000));
  }
  async function receipt(jobId: string) {
    if (await ledger(jobId, "invoice")) return;
    const p = await ledger(jobId, "capture");
    if (p?.status !== "COMPLETED") return;
    if (env.MOCK_PAYPAL !== "1") throw new Error("Receipt toolkit requires M7");
    await recordPayment({
      jobId,
      kind: "invoice",
      paypalId: "MOCK-INV-" + jobId.slice(0, 8),
      status: "PAID",
      amountCents: p.amountCents,
      requestId: jobId + ":invoice",
      raw: { captureId: p.paypalId, totalCents: p.amountCents, mock: true },
    });
  }
  async function voidHold(jobId: string) {
    const j = await getJob(jobId);
    if (j.state !== "CANCELLED") return;
    const auth =
      (await ledger(jobId, "reauthorization")) ??
      (await ledger(jobId, "authorization"));
    if (!auth?.paypalId || (await ledger(jobId, "void"))) return;
    await paypal.voidAuthorization({ jobId, authorizationId: auth.paypalId });
    await recordPayment({
      jobId,
      kind: "void",
      paypalId: auth.paypalId,
      status: "VOIDED",
      amountCents: auth.amountCents,
      requestId: jobId + ":void",
      raw: {},
    });
  }
  async function reauthorize(jobId: string) {
    const j = await getJob(jobId);
    if (
      !["FUNDS_HELD", "CONFIRMED", "AWAITING_COMPLETION", "ISSUE"].includes(
        j.state,
      )
    )
      return;
    const auth =
      (await ledger(jobId, "reauthorization")) ??
      (await ledger(jobId, "authorization"));
    if (!auth?.paypalId) return;
    const [count] =
      await sql`select count(*)::int as n from payments where job_id=${jobId} and kind='reauthorization'`;
    const n = count.n + 1;
    const result = await paypal.reauthorize({
      jobId,
      authorizationId: auth.paypalId,
      n,
    });
    await recordPayment({
      jobId,
      kind: "reauthorization",
      paypalId: result.authorizationId,
      status: "HELD",
      amountCents: auth.amountCents,
      requestId: jobId + ":reauth-" + n,
      raw: result,
    });
  }

  async function authorize(jobId: string, token: string) {
    const j = await getJob(jobId);
    if (j.state !== "BOOK_APPROVED") return { ok: true };
    const order = await ledger(jobId, "order");
    if (!order || order.paypalId !== token) throw new Error("Order mismatch");
    const a = await paypal.authorizeOrder({ jobId, orderId: token });
    await payment(jobId, "authorization", a.authorizationId, "HELD", a);
    if ((await getJob(jobId)).state === "CANCELLED") {
      await voidHold(jobId);
      return { ok: true };
    }
    if ((await getJob(jobId)).state === "BOOK_APPROVED")
      await transition(jobId, {
        type: "PAYPAL_AUTHORIZED",
        authorizationId: a.authorizationId,
      });
    return { ok: true };
  }
  return {
    createOrder,
    authorize,
    capture,
    payout,
    voidHold,
    reauthorize,
    receipt,
    pollCapture,
    pollPayout,
    restore,
  };
}
