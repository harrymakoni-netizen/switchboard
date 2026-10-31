import { z } from "zod";
import { sql, type Tx } from "@switchboard/db";
import type { PayPal } from "./index";
export const webhookSchema = z.object({
  id: z.string().min(1),
  event_type: z.string(),
  resource: z.record(z.unknown()),
});
export type PayPalEvent = z.infer<typeof webhookSchema>;
export async function handleWebhook(
  client: PayPal,
  headers: Record<string, string>,
  rawBody: string,
  apply: (tx: Tx, event: PayPalEvent) => Promise<void>,
) {
  if (!(await client.verifyWebhook(headers, rawBody)))
    return { status: 401, duplicate: false };
  const event = webhookSchema.parse(JSON.parse(rawBody));
  return await sql.begin(async (tx) => {
    const inserted =
      await tx`insert into webhook_events(id,provider,payload) values(${event.id},'paypal',${rawBody}::jsonb) on conflict do nothing returning id`;
    if (!inserted.length) return { status: 200, duplicate: true };
    await apply(tx, event);
    return { status: 200, duplicate: false };
  });
}
