import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PayPal } from "@switchboard/paypal";
const leg = z.object({
  jobId: z.string().uuid(),
  orderId: z.string().nullable(),
  approveUrl: z.string().url().nullable(),
  authorizationId: z.string().nullable(),
  captureId: z.string().nullable(),
  voided: z.boolean(),
});
export const smokeSchema = z.object({
  version: z.literal(1),
  amountCents: z.literal(100),
  capture: leg,
  cancel: leg,
  payout: z
    .object({
      email: z.string().email(),
      batchId: z.string(),
      status: z.string(),
    })
    .nullable(),
});
export type SmokeState = z.infer<typeof smokeSchema>;
export function newSmokeState(): SmokeState {
  const leg = () => ({
    jobId: randomUUID(),
    orderId: null,
    approveUrl: null,
    authorizationId: null,
    captureId: null,
    voided: false,
  });
  return {
    version: 1,
    amountCents: 100,
    capture: leg(),
    cancel: leg(),
    payout: null,
  };
}
export async function preparePayPalSmoke(
  paypal: PayPal,
  state: SmokeState,
  appUrl: string,
  persist: (state: SmokeState) => Promise<void>,
) {
  smokeSchema.parse(state);
  await persist(state);
  for (const purpose of ["capture", "cancel"] as const) {
    const leg = state[purpose];
    if (leg.orderId) continue;
    const result = await paypal.createOrder({
      jobId: leg.jobId,
      amountCents: state.amountCents,
      description: "Switchboard sandbox integration test — " + purpose,
      returnUrl: new URL("/?paypal-smoke=approved", appUrl).href,
      cancelUrl: new URL("/?paypal-smoke=cancelled", appUrl).href,
    });
    leg.orderId = result.orderId;
    leg.approveUrl = result.approveUrl;
    await persist(state);
  }
  return state;
}
export async function resumePayPalSmoke(
  paypal: PayPal,
  state: SmokeState,
  options: { confirmDone: boolean; payoutEmail?: string },
  persist: (state: SmokeState) => Promise<void>,
) {
  smokeSchema.parse(state);
  if (options.payoutEmail) z.string().email().parse(options.payoutEmail);
  if (
    state.payout &&
    options.payoutEmail &&
    state.payout.email !== options.payoutEmail
  )
    throw new Error("Smoke payout recipient cannot change on retry");
  for (const purpose of ["capture", "cancel"] as const) {
    const leg = state[purpose];
    if (!leg.orderId) throw new Error("Prepare smoke orders before resuming");
    if (!leg.authorizationId) {
      const a = await paypal.authorizeOrder({
        jobId: leg.jobId,
        orderId: leg.orderId,
        expectedAmountCents: state.amountCents,
      });
      leg.authorizationId = a.authorizationId;
      await persist(state);
    }
  }
  if (!state.cancel.voided) {
    await paypal.voidAuthorization({
      jobId: state.cancel.jobId,
      authorizationId: state.cancel.authorizationId!,
    });
    state.cancel.voided = true;
    await persist(state);
  }
  if (!options.confirmDone) return state;
  if (!state.capture.captureId) {
    const c = await paypal.capture({
      jobId: state.capture.jobId,
      authorizationId: state.capture.authorizationId!,
      invoiceId: "SB-" + state.capture.jobId,
      expectedAmountCents: state.amountCents,
    });
    state.capture.captureId = c.captureId;
    await persist(state);
  }
  const capture = await paypal.pollCapture(state.capture.captureId!);
  if (capture !== "COMPLETED")
    throw new Error("Capture not completed: " + capture);
  if (options.payoutEmail && !state.payout) {
    const p = await paypal.createPayout({
      jobId: state.capture.jobId,
      email: options.payoutEmail,
      amountCents: state.amountCents,
      note: "Switchboard sandbox integration smoke test",
    });
    state.payout = {
      email: options.payoutEmail,
      batchId: p.batchId,
      status: "PENDING",
    };
    await persist(state);
  }
  if (state.payout) {
    state.payout.status = await paypal.pollPayout(state.payout.batchId);
    await persist(state);
  }
  return state;
}
