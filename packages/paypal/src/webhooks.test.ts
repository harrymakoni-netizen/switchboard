import { afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@switchboard/db";
import { MockPayPal } from "./index";
import { handleWebhook } from "./webhooks";
it("verifies first and atomically deduplicates webhook delivery", async () => {
  process.env.MOCK_WEBHOOK_SECRET = "test-only";
  const body = JSON.stringify({
    id: randomUUID(),
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { id: "capture" },
  });
  let n = 0;
  const apply = async () => {
    n++;
  };
  const p = new MockPayPal();
  expect((await handleWebhook(p, {}, body, apply)).status).toBe(401);
  expect(n).toBe(0);
  expect(
    await sql`select id from webhook_events where id=${JSON.parse(body).id}`,
  ).toHaveLength(0);
  const headers = { "x-mock-signature": "test-only" };
  const results = await Promise.all([
    handleWebhook(p, headers, body, apply),
    handleWebhook(p, headers, body, apply),
  ]);
  expect(results.filter((r) => r.duplicate)).toHaveLength(1);
  expect(n).toBe(1);
  delete process.env.MOCK_WEBHOOK_SECRET;
});
it("rolls back inbox deduplication if durable processing fails", async () => {
  process.env.MOCK_WEBHOOK_SECRET = "test-only";
  const id = randomUUID();
  const body = JSON.stringify({
    id,
    event_type: "CHECKOUT.ORDER.APPROVED",
    resource: { id: "O" },
  });
  const client = new MockPayPal();
  const headers = { "x-mock-signature": "test-only" };
  await expect(
    handleWebhook(client, headers, body, async () => {
      throw new Error("DB failure");
    }),
  ).rejects.toThrow("DB failure");
  expect(await sql`select * from webhook_events where id=${id}`).toHaveLength(
    0,
  );
  expect(
    (await handleWebhook(client, headers, body, async () => {})).status,
  ).toBe(200);
  delete process.env.MOCK_WEBHOOK_SECRET;
});
afterAll(() => sql.end());
