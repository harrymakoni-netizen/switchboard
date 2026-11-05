import { createHash } from "node:crypto";
import { z } from "zod";
import { toCents } from "@switchboard/shared";

export interface ReceiptRequest {
  jobId: string;
  orderId: string;
  captureId: string;
  amountCents: number;
  description: string;
  businessName: string;
  includes: string[];
  saved?: ReceiptProgress;
}
export interface ReceiptContext {
  buyerEmail: string;
  merchantEmail: string;
  paidAt: string;
}
export interface ReceiptProgress {
  invoiceId: string;
  status: "PENDING" | "PAID" | "NEEDS_REVIEW";
  verified: boolean;
  invoiceUrl?: string;
  notificationSent?: boolean;
  reason?: string;
}
export type ReceiptAgent = (
  request: ReceiptRequest,
  checkpoint: (progress: ReceiptProgress) => Promise<void>,
) => Promise<void>;
export const invoiceSchema = z.object({
  id: z.string().regex(/^INV2-[A-Z0-9-]+$/),
  status: z.string(),
  detail: z.object({ invoice_number: z.string(), reference: z.string() }),
  amount: z.object({ currency_code: z.string(), value: z.string() }),
  due_amount: z
    .object({ currency_code: z.string(), value: z.string() })
    .optional(),
  primary_recipients: z.array(
    z.object({ billing_info: z.object({ email_address: z.string().email() }) }),
  ),
  items: z.array(
    z.object({
      quantity: z.string(),
      unit_amount: z.object({ currency_code: z.string(), value: z.string() }),
    }),
  ),
  payments: z
    .object({
      transactions: z
        .array(
          z.object({
            payment_id: z.string().optional(),
            method: z.string().optional(),
            note: z.string().optional(),
            amount: z
              .object({ currency_code: z.string(), value: z.string() })
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  links: z.array(z.object({ rel: z.string(), href: z.string() })).optional(),
});
export type ReceiptInvoice = z.infer<typeof invoiceSchema>;
export interface ReceiptProvider {
  receiptContext(request: ReceiptRequest): Promise<ReceiptContext>;
  findReceiptInvoice(
    invoiceNumber: string,
  ): Promise<ReceiptInvoice | undefined>;
  getReceiptInvoice(invoiceId: string): Promise<ReceiptInvoice>;
}
export class ReceiptReviewError extends Error {}
export function receiptCaptureReference(request: ReceiptRequest) {
  return `Switchboard job ${request.jobId}; verified PayPal capture ${request.captureId}.`;
}
export function receiptNumber(jobId: string) {
  return "SB-" + createHash("sha256").update(jobId).digest("hex").slice(0, 22);
}
export function receiptUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "www.sandbox.paypal.com" &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function verifyInvoice(
  invoice: ReceiptInvoice,
  request: ReceiptRequest,
  context: ReceiptContext,
  paid = false,
) {
  if (
    invoice.detail.invoice_number !== receiptNumber(request.jobId) ||
    invoice.detail.reference !== request.jobId
  )
    throw new ReceiptReviewError("Invoice reference does not match this job.");
  if (
    invoice.amount.currency_code !== "USD" ||
    toCents(invoice.amount.value) !== request.amountCents ||
    invoice.items.length !== 1 ||
    invoice.items[0].quantity !== "1" ||
    invoice.items[0].unit_amount.currency_code !== "USD" ||
    toCents(invoice.items[0].unit_amount.value) !== request.amountCents
  )
    throw new ReceiptReviewError(
      "Invoice total does not match the captured payment.",
    );
  if (
    invoice.primary_recipients.length !== 1 ||
    invoice.primary_recipients[0].billing_info.email_address.toLowerCase() !==
      context.buyerEmail.toLowerCase()
  )
    throw new ReceiptReviewError(
      "Invoice buyer does not match the approved order.",
    );
  if (
    paid &&
    (!["PAID", "MARKED_AS_PAID"].includes(invoice.status) ||
      invoice.due_amount?.currency_code !== "USD" ||
      toCents(invoice.due_amount.value) !== 0 ||
      !invoice.payments?.transactions?.some(
        (p) =>
          ((p.payment_id === request.captureId && p.method === "PAYPAL") ||
            (p.method === "OTHER" &&
              p.note === receiptCaptureReference(request))) &&
          p.amount?.currency_code === "USD" &&
          toCents(p.amount.value) === request.amountCents,
      ))
  )
    throw new ReceiptReviewError(
      "Invoice payment does not match the verified PayPal capture.",
    );
}

type ReadPayPal = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<unknown>;
export async function readReceiptContext(
  read: ReadPayPal,
  request: ReceiptRequest,
): Promise<ReceiptContext> {
  const capture = z
    .object({
      id: z.string(),
      status: z.string(),
      invoice_id: z.string(),
      amount: z.object({ currency_code: z.string(), value: z.string() }),
      create_time: z.string().datetime({ offset: true }),
      supplementary_data: z
        .object({ related_ids: z.object({ order_id: z.string().optional() }) })
        .optional(),
    })
    .parse(
      await read(
        "/v2/payments/captures/" + encodeURIComponent(request.captureId),
      ),
    );
  if (
    capture.id !== request.captureId ||
    capture.status !== "COMPLETED" ||
    capture.invoice_id !== "SB-" + request.jobId ||
    capture.amount.currency_code !== "USD" ||
    toCents(capture.amount.value) !== request.amountCents ||
    (capture.supplementary_data?.related_ids.order_id &&
      capture.supplementary_data.related_ids.order_id !== request.orderId)
  )
    throw new ReceiptReviewError(
      "PayPal capture does not match the completed job.",
    );
  const order = z
    .object({
      id: z.string(),
      payer: z.object({ email_address: z.string().email() }).optional(),
      payment_source: z
        .object({
          paypal: z.object({ email_address: z.string().email() }).optional(),
        })
        .optional(),
      purchase_units: z.array(
        z.object({
          custom_id: z.string(),
          reference_id: z.string(),
          amount: z.object({ currency_code: z.string(), value: z.string() }),
          payee: z.object({ email_address: z.string().email() }),
        }),
      ),
    })
    .parse(
      await read("/v2/checkout/orders/" + encodeURIComponent(request.orderId)),
    );
  const unit = order.purchase_units[0];
  const buyerEmail =
    order.payer?.email_address ?? order.payment_source?.paypal?.email_address;
  if (
    order.id !== request.orderId ||
    order.purchase_units.length !== 1 ||
    !buyerEmail ||
    unit.custom_id !== request.jobId ||
    unit.reference_id !== request.jobId ||
    unit.amount.currency_code !== "USD" ||
    toCents(unit.amount.value) !== request.amountCents
  )
    throw new ReceiptReviewError(
      "PayPal order does not match the completed job.",
    );
  return {
    buyerEmail,
    merchantEmail: unit.payee.email_address,
    paidAt: capture.create_time,
  };
}
export async function getInvoice(read: ReadPayPal, id: string) {
  if (!/^INV2-[A-Z0-9-]+$/.test(id))
    throw new ReceiptReviewError("Invalid invoice identifier.");
  return invoiceSchema.parse(await read("/v2/invoicing/invoices/" + id));
}
export async function findInvoice(read: ReadPayPal, number: string) {
  const data = z
    .object({
      items: z
        .array(
          z.object({
            id: z.string(),
            detail: z.object({ invoice_number: z.string() }),
          }),
        )
        .default([]),
    })
    .parse(
      await read(
        "/v2/invoicing/search-invoices?page=1&page_size=100&total_required=false",
        "POST",
        {
          invoice_number: number,
        },
      ),
    );
  const matches = data.items.filter((i) => i.detail.invoice_number === number);
  if (matches.length > 1)
    throw new ReceiptReviewError("Multiple invoices found for this job.");
  return matches[0] ? getInvoice(read, matches[0].id) : undefined;
}
