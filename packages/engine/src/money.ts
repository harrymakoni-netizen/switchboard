import {
  sql,
  getJob,
  recordPayment,
  emit,
  paymentLocks,
} from "@switchboard/db";
import {
  fromCents,
  toCents,
  type Payment,
  type Quote,
} from "@switchboard/shared";
import {
  MockPayPal,
  PayPalHttpError,
  ReceiptReviewError,
  type PayPal,
  type ReceiptAgent,
  type ReceiptProgress,
} from "@switchboard/paypal";
import { smsTemplate, type Telephony } from "@switchboard/calls";
import { transition, selected } from "./index";
import { webhookSchema } from "../../paypal/src/webhooks";
import { locatePayPalJob } from "./paypal-webhooks";
import { z } from "zod";
export function createMoneyEngine({
  paypal,
  env,
  enqueue,
  tel,
  receiptAgent,
}: {
  paypal: PayPal;
  env: { APP_URL: string; MOCK_PAYPAL: string };
  enqueue: (name: string, jobId: string, startAfter?: Date) => Promise<void>;
  tel: Pick<Telephony, "sendSms">;
  receiptAgent?: ReceiptAgent;
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
    if (await ledger(jobId, "order")) return;
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
      let result: Awaited<ReturnType<PayPal["capture"]>>;
      try {
        result = await paypal.capture({
          jobId,
          authorizationId: auth.paypalId,
          invoiceId: "SB-" + jobId,
          expectedAmountCents: q.priceCents,
        });
      } catch (error) {
        if (error instanceof PayPalHttpError && error.isDefinitiveDecline) {
          await transition(jobId, { type: "CAPTURE_DECLINED" });
          return;
        }
        throw error;
      }
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
    const existing = await ledger(jobId, "invoice");
    const p = await ledger(jobId, "capture");
    if (p?.status !== "COMPLETED") return;
    if (env.MOCK_PAYPAL !== "1") {
      if (!p.paypalId || p.paypalId.startsWith("MOCK-")) return;
      const saved = z
        .object({
          invoiceId: z.string(),
          status: z.enum(["PENDING", "PAID", "NEEDS_REVIEW"]),
          verified: z.boolean(),
          notificationSent: z.boolean().optional(),
        })
        .safeParse(existing?.raw);
      if (existing?.status === "PAID" && saved.success && saved.data.verified)
        return;
      if (
        existing?.status === "NEEDS_REVIEW" &&
        (existing.paypalId ||
          !z
            .object({
              reason: z.literal(
                "PayPal did not return a valid sandbox invoice identifier.",
              ),
            })
            .safeParse(existing.raw).success)
      )
        return;
      if (!receiptAgent)
        throw new Error("Sandbox receipt agent is not configured.");
      const job = await getJob(jobId);
      const order = await ledger(jobId, "order");
      const quote = await selected(sql, job);
      if (
        !job.approvedDoneAt ||
        !order?.paypalId ||
        !p.amountCents ||
        p.amountCents !== quote.priceCents
      )
        throw new Error(
          "Receipt requires the approved, captured quote amount.",
        );
      let latest: ReceiptProgress | undefined = saved.success
        ? saved.data
        : undefined;
      const checkpoint = async (progress: ReceiptProgress) => {
        const row = await recordPayment({
          jobId,
          kind: "invoice",
          paypalId: progress.invoiceId || null,
          status: progress.status,
          amountCents: p.amountCents,
          requestId: jobId + ":invoice",
          raw: {
            ...progress,
            captureId: p.paypalId,
            totalCents: p.amountCents,
            mock: false,
          },
        });
        if (
          row.paypalId &&
          progress.invoiceId &&
          row.paypalId !== progress.invoiceId
        )
          throw new Error("Receipt invoice identity changed.");
        await sql`update payments set paypal_id=${progress.invoiceId || null},status=${progress.status},raw=${JSON.stringify({ ...progress, captureId: p.paypalId, totalCents: p.amountCents, mock: false })}::jsonb where id=${row.id}`;
        latest = progress;
        await emit(jobId, "payment.updated", {
          kind: "invoice",
          status: progress.status,
          amountCents: p.amountCents,
        });
      };
      if (!existing)
        await checkpoint({ invoiceId: "", status: "PENDING", verified: false });
      try {
        await receiptAgent(
          {
            jobId,
            orderId: order.paypalId,
            captureId: p.paypalId,
            amountCents: p.amountCents,
            description: job.brief?.task ?? "Home repair",
            businessName: quote.name,
            includes: quote.includes,
            saved: latest,
          },
          checkpoint,
        );
      } catch (error) {
        if (!(error instanceof ReceiptReviewError)) throw error;
        await checkpoint({
          invoiceId: latest?.invoiceId ?? existing?.paypalId ?? "",
          status: "NEEDS_REVIEW",
          verified: false,
          reason: error.message,
        });
      }
      return;
    }
    if (existing) return;
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
    const quote = await selected(sql, j);
    if (quote.priceCents === null) throw new Error("Quote price missing");
    let authorization = await ledger(jobId, "authorization");
    if (!authorization) {
      const a = await paypal.authorizeOrder({
        jobId,
        orderId: token,
        expectedAmountCents: quote.priceCents,
      });
      authorization = await payment(
        jobId,
        "authorization",
        a.authorizationId,
        "HELD",
        a,
      );
    }
    if (!authorization.paypalId || authorization.status !== "HELD")
      throw new Error("Authorization is not held");
    if ((await getJob(jobId)).state === "CANCELLED") {
      await voidHold(jobId);
      return { ok: true };
    }
    if ((await getJob(jobId)).state === "BOOK_APPROVED")
      await transition(jobId, {
        type: "PAYPAL_AUTHORIZED",
        authorizationId: authorization.paypalId,
      });
    return { ok: true };
  }

  async function reconcileWebhook(jobId: string, eventId: string) {
    const [inbox] =
      await sql`select payload::text as raw_payload from webhook_events where id=${eventId} and provider='paypal'`;
    if (!inbox) throw new Error("Verified webhook missing");
    const event = webhookSchema.parse(JSON.parse(inbox.rawPayload));
    if ((await locatePayPalJob(sql, event)) !== jobId)
      throw new Error("Webhook job mismatch");
    const job = await getJob(jobId);
    const type = event.event_type;
    if (
      type === "CHECKOUT.ORDER.APPROVED" ||
      type === "PAYMENT.AUTHORIZATION.CREATED"
    ) {
      const order = await ledger(jobId, "order");
      if (order?.paypalId) await authorize(jobId, order.paypalId);
      return;
    }
    if (type === "PAYMENT.AUTHORIZATION.VOIDED") {
      if (job.state !== "CANCELLED") return;
      const resource = z.object({ id: z.string() }).parse(event.resource);
      const auth =
        (await ledger(jobId, "reauthorization")) ??
        (await ledger(jobId, "authorization"));
      if (auth?.paypalId !== resource.id)
        throw new Error("Authorization mismatch");
      await recordPayment({
        jobId,
        kind: "void",
        paypalId: resource.id,
        status: "VOIDED",
        amountCents: auth.amountCents,
        requestId: jobId + ":void",
        raw: event,
      });
      return;
    }
    if (
      [
        "PAYMENT.CAPTURE.COMPLETED",
        "PAYMENT.CAPTURE.DECLINED",
        "PAYMENT.CAPTURE.DENIED",
      ].includes(type)
    ) {
      const resource = z
        .object({
          id: z.string(),
          amount: z.object({
            currency_code: z.literal("USD"),
            value: z.string(),
          }),
        })
        .parse(event.resource);
      const q = await selected(sql, job);
      const amount = toCents(resource.amount.value);
      if (
        !job.approvedDoneAt ||
        !job.payoutEmailShownAt ||
        amount !== q.priceCents
      )
        throw new Error("Capture webhook lacks matching approval or amount");
      let existing = await ledger(jobId, "capture");
      if (existing && existing.paypalId !== resource.id)
        throw new Error("Capture id mismatch");
      const status =
        type === "PAYMENT.CAPTURE.COMPLETED" ? "COMPLETED" : "DECLINED";
      if (existing?.status === "COMPLETED" && status !== "COMPLETED") return; // Out-of-order denial cannot undo a completed capture.
      if (!existing)
        existing = await recordPayment({
          jobId,
          kind: "capture",
          paypalId: resource.id,
          status,
          amountCents: amount,
          requestId: jobId + ":capture",
          raw: event,
        });
      else {
        await sql`update payments set status=${status} where id=${existing.id}`;
        await emit(jobId, "payment.updated", {
          kind: "capture",
          status,
          amountCents: amount,
        });
      }
      if (job.state === "COMPLETED")
        await transition(
          jobId,
          status === "COMPLETED"
            ? { type: "CAPTURE_COMPLETED", captureId: resource.id }
            : { type: "CAPTURE_DECLINED" },
        );
      return;
    }
    const payoutStates: Record<string, "SUCCEEDED" | "UNCLAIMED" | "FAILED"> = {
      "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "SUCCEEDED",
      "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "UNCLAIMED",
      "PAYMENT.PAYOUTS-ITEM.FAILED": "FAILED",
      "PAYMENT.PAYOUTS-ITEM.RETURNED": "FAILED",
    };
    const status = payoutStates[type];
    if (status) {
      const resource = z
        .object({
          payout_batch_id: z.string(),
          payout_item: z.object({
            receiver: z.string().email(),
            amount: z.object({ currency: z.literal("USD"), value: z.string() }),
          }),
        })
        .parse(event.resource);
      const p = await ledger(jobId, "payout");
      const c = await ledger(jobId, "capture");
      const q = await selected(sql, job);
      if (
        !p ||
        p.paypalId !== resource.payout_batch_id ||
        c?.status !== "COMPLETED" ||
        q.payoutEmail !== resource.payout_item.receiver ||
        toCents(resource.payout_item.amount.value) !== c.amountCents
      )
        throw new Error("Payout webhook recipient or amount mismatch");
      const settledStatus =
        p.status === "SUCCEEDED"
          ? "SUCCEEDED"
          : p.status === "UNCLAIMED" && status !== "SUCCEEDED"
            ? "UNCLAIMED"
            : status;
      await sql`update payments set status=${settledStatus} where id=${p.id}`;
      await emit(jobId, "payment.updated", {
        kind: "payout",
        status: settledStatus,
        amountCents: p.amountCents,
      });
      // A retry must finish the transition even if the prior process stopped after its ledger write.
      if (job.state === "PAID_OUT")
        await transition(
          jobId,
          settledStatus === "FAILED"
            ? { type: "PAYOUT_FAILED" }
            : { type: "PAYOUT_SETTLED", status: settledStatus },
        );
      return;
    }
    if (type === "INVOICING.INVOICE.PAID") {
      const p = await ledger(jobId, "invoice");
      if (p) {
        // A signed notification is not proof of this invoice's total or capture.
        await enqueue("receipt", jobId);
      }
    }
  }
  // Serialize payment execution and verified webhook reconciliation across worker instances.
  // This is an advisory session lock, not a DB transaction held across a provider request.
  function locked<Args extends [string, ...string[]], Result>(
    fn: (...args: Args) => Promise<Result>,
  ) {
    return async (...args: Args): Promise<Result> => {
      const connection = await paymentLocks.reserve();
      try {
        await connection`select pg_advisory_lock(hashtextextended(${args[0]},0))`;
        return await fn(...args);
      } finally {
        try {
          await connection`select pg_advisory_unlock(hashtextextended(${args[0]},0))`;
        } finally {
          connection.release();
        }
      }
    };
  }
  return {
    createOrder: locked(createOrder),
    authorize: locked(authorize),
    capture: locked(capture),
    payout: locked(payout),
    voidHold: locked(voidHold),
    reauthorize: locked(reauthorize),
    receipt: locked(receipt),
    pollCapture: locked(pollCapture),
    pollPayout: locked(pollPayout),
    reconcileWebhook: locked(reconcileWebhook),
    restore,
  };
}
