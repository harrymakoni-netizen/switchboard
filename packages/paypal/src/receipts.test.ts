import { it, expect, vi } from "vitest";
import {
  readReceiptContext,
  receiptNumber,
  receiptUrl,
  findInvoice,
  type ReceiptRequest,
} from "./receipts";

const request: ReceiptRequest = {
  jobId: "job-1",
  orderId: "ORDER1",
  captureId: "CAPTURE1",
  amountCents: 11000,
  description: "repair",
  businessName: "QuickFix",
  includes: [],
};
function data() {
  const capture = {
    id: "CAPTURE1",
    status: "COMPLETED",
    invoice_id: "SB-job-1",
    amount: { currency_code: "USD", value: "110.00" },
    create_time: "2026-11-03T10:00:00Z",
    supplementary_data: { related_ids: { order_id: "ORDER1" } },
  };
  const order = {
    id: "ORDER1",
    payer: { email_address: "buyer@example.com" },
    purchase_units: [
      {
        custom_id: "job-1",
        reference_id: "job-1",
        amount: { currency_code: "USD", value: "110.00" },
        payee: { email_address: "merchant@example.com" },
      },
    ],
  };
  const read = vi.fn(async (path: string) =>
    path.includes("captures/") ? capture : order,
  );
  return { capture, order, read };
}
it("derives invoice contacts from the verified provider order, not business text", async () => {
  const f = data();
  expect(await readReceiptContext(f.read, request)).toEqual({
    buyerEmail: "buyer@example.com",
    merchantEmail: "merchant@example.com",
    paidAt: "2026-11-03T10:00:00Z",
  });
  expect(f.read.mock.calls.map((c) => c[0])).toEqual([
    "/v2/payments/captures/CAPTURE1",
    "/v2/checkout/orders/ORDER1",
  ]);
});
it.each(["amount", "currency", "capture", "reference", "order", "status"])(
  "rejects a mismatched capture %s",
  async (field) => {
    const f = data();
    if (field === "amount") f.capture.amount.value = "220.00";
    if (field === "currency") f.capture.amount.currency_code = "EUR";
    if (field === "capture") f.capture.id = "OTHER";
    if (field === "reference") f.capture.invoice_id = "SB-other";
    if (field === "order")
      f.capture.supplementary_data.related_ids.order_id = "OTHER";
    if (field === "status") f.capture.status = "PENDING";
    await expect(readReceiptContext(f.read, request)).rejects.toThrow(
      "capture does not match",
    );
    expect(f.read).toHaveBeenCalledTimes(1);
  },
);
it("rejects a provider order for another job even if the amount matches", async () => {
  const f = data();
  f.order.purchase_units[0].custom_id = "other-job";
  await expect(readReceiptContext(f.read, request)).rejects.toThrow(
    "order does not match",
  );
});
it("uses a stable provider-sized invoice number with the full job reference kept separately", () => {
  expect(receiptNumber(request.jobId)).toHaveLength(25);
  expect(receiptNumber(request.jobId)).toBe(receiptNumber(request.jobId));
  expect(receiptNumber("other")).not.toBe(receiptNumber(request.jobId));
});
it("never redirects receipt viewers to an arbitrary host or production PayPal", () => {
  expect(
    receiptUrl("https://www.sandbox.paypal.com/invoice/p/test"),
  ).toBeDefined();
  for (const url of [
    "https://evil.example",
    "javascript:alert(1)",
    "https://www.paypal.com/invoice/p/test",
    "https://www.sandbox.paypal.com.evil.example",
    "https://a@www.sandbox.paypal.com/invoice",
  ])
    expect(receiptUrl(url)).toBeUndefined();
});
it("does not pick an ambiguous invoice after an interrupted creation", async () => {
  const read = vi.fn(async () => ({
    items: [1, 2].map((n) => ({
      id: "INV2-TEST-" + n,
      detail: { invoice_number: "SB-one" },
    })),
  }));
  await expect(findInvoice(read, "SB-one")).rejects.toThrow(
    "Multiple invoices",
  );
  expect(read).toHaveBeenCalledTimes(1);
});
