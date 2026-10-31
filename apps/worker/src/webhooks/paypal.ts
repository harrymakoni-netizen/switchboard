import type { FastifyInstance } from "fastify";
import { z } from "zod";
export type PayPalWebhookReceiver = (
  headers: Record<string, string>,
  body: string,
) => Promise<{ status: number; duplicate: boolean }>;
export async function registerPayPalWebhook(
  app: FastifyInstance,
  receive: PayPalWebhookReceiver,
) {
  await app.register(async (webhook) => {
    webhook.removeContentTypeParser("application/json");
    webhook.addContentTypeParser(
      "application/json",
      { parseAs: "string", bodyLimit: 262144 },
      (_request, body, done) => done(null, body),
    );
    webhook.post("/webhooks/paypal", async (req, reply) => {
      const headers = Object.fromEntries(
        Object.entries(req.headers).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value]] : [],
        ),
      );
      const result = await receive(headers, z.string().parse(req.body));
      return reply.code(result.status).send({ ok: result.status === 200 });
    });
  });
}
