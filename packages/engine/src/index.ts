import {
  briefSchema,
  type Job,
  type JobEvent,
  type State,
  type Quote,
} from "@switchboard/shared";
import { sql, emit, type Tx } from "@switchboard/db";
import { z } from "zod";
export class IllegalTransitionError extends Error {}
export class GuardError extends Error {}
export const allowed: Record<State, State[]> = {
  DRAFT: ["FINDING"],
  FINDING: ["CALLING", "ISSUE"],
  CALLING: ["QUOTED"],
  QUOTED: ["BOOK_APPROVED"],
  BOOK_APPROVED: ["FUNDS_HELD", "CANCELLED"],
  FUNDS_HELD: ["CONFIRMED", "CANCELLED", "ISSUE"],
  CONFIRMED: ["AWAITING_COMPLETION", "CANCELLED"],
  AWAITING_COMPLETION: ["COMPLETED", "ISSUE"],
  COMPLETED: ["PAID_OUT", "ISSUE"],
  PAID_OUT: ["CLOSED", "ISSUE"],
  ISSUE: ["CONFIRMED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};
const sources: Record<JobEvent["type"], State[]> = {
  BRIEF_READY: ["DRAFT"],
  BUSINESSES_FOUND: ["FINDING"],
  CALLS_FINISHED: ["CALLING"],
  USER_BOOKED: ["QUOTED"],
  PAYPAL_AUTHORIZED: ["BOOK_APPROVED"],
  BUSINESS_CONFIRMED: ["FUNDS_HELD", "ISSUE"],
  BUSINESS_DECLINED: ["FUNDS_HELD"],
  SLOT_PASSED: ["CONFIRMED"],
  USER_CONFIRMED_DONE: ["AWAITING_COMPLETION"],
  USER_REPORTED_NOT_DONE: ["AWAITING_COMPLETION"],
  CAPTURE_COMPLETED: ["COMPLETED"],
  CAPTURE_DECLINED: ["COMPLETED"],
  PAYOUT_SETTLED: ["PAID_OUT"],
  PAYOUT_FAILED: ["PAID_OUT"],
  USER_CANCELLED: ["BOOK_APPROVED", "FUNDS_HELD", "CONFIRMED", "ISSUE"],
};
export function nextState(state: State, event: JobEvent): State {
  const targets: Record<JobEvent["type"], State> = {
    BRIEF_READY: "FINDING",
    BUSINESSES_FOUND:
      event.type === "BUSINESSES_FOUND" && event.count < 3
        ? "ISSUE"
        : "CALLING",
    CALLS_FINISHED: "QUOTED",
    USER_BOOKED: "BOOK_APPROVED",
    PAYPAL_AUTHORIZED: "FUNDS_HELD",
    BUSINESS_CONFIRMED: "CONFIRMED",
    BUSINESS_DECLINED: "ISSUE",
    SLOT_PASSED: "AWAITING_COMPLETION",
    USER_CONFIRMED_DONE: "COMPLETED",
    USER_REPORTED_NOT_DONE: "ISSUE",
    CAPTURE_COMPLETED: "PAID_OUT",
    CAPTURE_DECLINED: "ISSUE",
    PAYOUT_SETTLED: "CLOSED",
    PAYOUT_FAILED: "ISSUE",
    USER_CANCELLED: "CANCELLED",
  };
  const next = targets[event.type];
  if (!sources[event.type].includes(state) || !allowed[state].includes(next))
    throw new IllegalTransitionError(`${event.type} is illegal from ${state}`);
  return next;
}
export const effectFor: Partial<Record<State, string>> = {
  FINDING: "runFinding",
  CALLING: "runCalls",
  BOOK_APPROVED: "createOrder",
  FUNDS_HELD: "confirmCall",
  CONFIRMED: "confirmed",
  AWAITING_COMPLETION: "completionCall",
  COMPLETED: "capture",
  PAID_OUT: "payout",
  CANCELLED: "void",
};
export async function selected(tx: Tx | typeof sql, job: Job) {
  const [row] = await tx<
    (Quote & { payoutEmail: string | null; phone: string; name: string })[]
  >`select q.*,b.payout_email,b.phone,b.name from quotes q join businesses b on b.id=q.business_id where q.id=${job.chosenQuoteId} and b.job_id=${job.id}`;
  if (!row) throw new GuardError("Chosen quote missing");
  return row;
}
export async function transition(jobId: string, event: JobEvent): Promise<Job> {
  return (await sql.begin(async (tx) => {
    const [job] = await tx<
      Job[]
    >`select * from jobs where id=${jobId} for update`;
    if (!job) throw new GuardError("Job not found");
    const next = nextState(job.state, event);
    if (event.type === "BRIEF_READY") briefSchema.parse(event.brief);
    if (event.type === "USER_CANCELLED") {
      const [captured] =
        await tx`select id from payments where job_id=${jobId} and kind='capture' and status in ('COMPLETED','PENDING')`;
      if (captured)
        throw new GuardError(
          "Payment already captured or pending; cancellation requires review",
        );
    }
    if (event.type === "PAYPAL_AUTHORIZED") {
      const [auth] =
        await tx`select id from payments where job_id=${jobId} and kind='authorization' and paypal_id=${event.authorizationId} and status='HELD'`;
      if (!auth) throw new GuardError("Verified authorization required");
    }

    if (event.type === "USER_BOOKED") {
      const [quote] = await tx<
        Quote[]
      >`select q.* from quotes q join businesses b on b.id=q.business_id where q.id=${event.quoteId} and b.job_id=${jobId}`;
      if (
        !quote ||
        quote.declined ||
        quote.priceCents === null ||
        !job.brief ||
        quote.priceCents > job.brief.budgetCents
      )
        throw new GuardError("Quote unavailable or over budget");
      await tx`update jobs set chosen_quote_id=${quote.id},approved_book_at=now() where id=${jobId}`;
    }
    if (event.type === "USER_CONFIRMED_DONE") {
      const quote = await selected(tx, job);
      if (!quote.payoutEmail || !job.payoutEmailShownAt)
        throw new GuardError("Show payout recipient before completion");
      await tx`update jobs set approved_done_at=now() where id=${jobId}`;
    }
    if (event.type === "BUSINESS_CONFIRMED") {
      z.string().email().parse(event.payoutEmail);
      z.string().datetime({ offset: true }).parse(event.slot);
      const quote = await selected(tx, job);
      if (
        quote.earliestSlot &&
        new Date(quote.earliestSlot).getTime() !==
          new Date(event.slot).getTime()
      )
        throw new GuardError("Changed slot requires review");
      await tx`update businesses set payout_email=${event.payoutEmail} where id=${quote.businessId}`;
      await tx`update jobs set booked_slot=${event.slot},payout_email_shown_at=null where id=${jobId}`;
    }
    if (event.type === "CAPTURE_COMPLETED") {
      const [p] =
        await tx`select id from payments where job_id=${jobId} and kind='capture' and paypal_id=${event.captureId} and status='COMPLETED'`;
      if (!p) throw new GuardError("Verified capture required");
    }
    if (event.type === "PAYOUT_SETTLED") {
      const [p] =
        await tx`select id from payments where job_id=${jobId} and kind='payout' and status=${event.status}`;
      if (!p) throw new GuardError("Verified payout required");
    }
    if (event.type === "BRIEF_READY")
      await tx`update jobs set brief=${JSON.stringify(event.brief)}::jsonb where id=${jobId}`;
    const [updated] = await tx<
      Job[]
    >`update jobs set state=${next},updated_at=now() where id=${jobId} returning *`;
    await tx`insert into events(job_id,type,from_state,to_state,payload) values(${jobId},${event.type},${job.state},${next},${JSON.stringify(event)}::jsonb)`;
    await tx`select pg_notify(${`job_${jobId.replaceAll("-", "_")}`},${JSON.stringify({ type: "state.changed", data: { from: job.state, to: next } })})`;
    const name = effectFor[next];
    if (name)
      await tx`insert into effects(job_id,name) values(${jobId},${name})`;
    if (next === "ISSUE")
      await emit(
        jobId,
        "notice",
        {
          level: "warning",
          message:
            "This booking needs your attention. Any existing hold is retained.",
        },
        tx,
      );
    return updated;
  })) as Job;
}
export async function showPayoutEmail(jobId: string) {
  return await sql.begin(async (tx) => {
    const [job] = await tx<
      Job[]
    >`select * from jobs where id=${jobId} for update`;
    if (!job || !["CONFIRMED", "AWAITING_COMPLETION"].includes(job.state))
      throw new GuardError("Recipient not confirmed");
    const quote = await selected(tx, job);
    if (!quote.payoutEmail) throw new GuardError("Recipient unavailable");
    await tx`update jobs set payout_email_shown_at=now() where id=${jobId}`;
    return quote.payoutEmail;
  });
}

export { createMoneyEngine } from "./money";

export { receivePayPalWebhook } from "./paypal-webhooks";
