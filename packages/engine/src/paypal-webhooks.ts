import { sql, type Tx } from "@switchboard/db";
import { handleWebhook, type PayPalEvent } from "../../paypal/src/webhooks";
import type { PayPal } from "@switchboard/paypal";
import { z } from "zod";
const related = z
  .object({
    supplementary_data: z
      .object({
        related_ids: z
          .object({
            order_id: z.string().optional(),
            authorization_id: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    id: z.string().optional(),
    payout_batch_id: z.string().optional(),
    payout_item_id: z.string().optional(),
  })
  .passthrough();
export async function locatePayPalJob(
  tx: Tx | typeof sql,
  event: PayPalEvent,
): Promise<string | null> {
  const r = related.parse(event.resource);
  const ids = r.supplementary_data?.related_ids;
  const kind = event.event_type.startsWith("CHECKOUT.ORDER.")
    ? "order"
    : event.event_type.startsWith("PAYMENT.AUTHORIZATION.")
      ? "authorization"
      : event.event_type.startsWith("PAYMENT.CAPTURE.")
        ? "capture"
        : event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.")
          ? "payout"
          : event.event_type.startsWith("INVOICING.INVOICE.")
            ? "invoice"
            : null;
  if (!kind) return null;
  const [p] = await tx<
    { jobId: string }[]
  >`select job_id from payments where (kind=${kind} and paypal_id=${r.payout_batch_id ?? r.id ?? ""}) or (kind='order' and paypal_id=${ids?.order_id ?? ""}) or (kind in ('authorization','reauthorization') and paypal_id=${ids?.authorization_id ?? ""}) or (kind='payout' and raw->>'itemId'=${r.payout_item_id ?? r.id ?? ""}) order by created_at desc limit 1`;
  return p?.jobId ?? null;
}
export async function receivePayPalWebhook(
  paypal: PayPal,
  headers: Record<string, string>,
  body: string,
) {
  return handleWebhook(paypal, headers, body, async (tx, event) => {
    const jobId = await locatePayPalJob(tx, event);
    if (!jobId) return;
    await tx`insert into effects(job_id,name,payload) values(${jobId},'paypalWebhook',${JSON.stringify({ eventId: event.id })}::jsonb)`;
  });
}
