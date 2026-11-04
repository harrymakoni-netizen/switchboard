import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  verifyTwilioRequest,
  type TwilioConfig,
  type TwilioParams,
} from "../../../../packages/calls/src/twilio";
export function parseTwilioForm(body: string): TwilioParams {
  const result: TwilioParams = Object.create(null) as TwilioParams;
  for (const [key, value] of new URLSearchParams(body)) {
    const previous = result[key];
    result[key] =
      previous === undefined
        ? value
        : Array.isArray(previous)
          ? [...previous, value]
          : [previous, value];
  }
  return result;
}
export async function registerTwilioWebhooks(
  app: FastifyInstance,
  config: TwilioConfig,
  handlers: {
    voice: (
      callId: string,
      turn: number,
      params: TwilioParams,
    ) => Promise<string>;
    status: (callId: string, params: TwilioParams) => Promise<void>;
  },
) {
  await app.register(async (webhook) => {
    webhook.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 32768 },
      (_req, body, done) => done(null, parseTwilioForm(String(body))),
    );
    webhook.addHook("preHandler", async (req, reply) => {
      const signature =
        typeof req.headers["x-twilio-signature"] === "string"
          ? req.headers["x-twilio-signature"]
          : undefined;
      if (
        !verifyTwilioRequest(
          config,
          req.url,
          signature,
          req.body as TwilioParams,
        )
      )
        return reply.code(403).send({ error: "Invalid Twilio signature" });
    });
    webhook.post("/webhooks/twilio/voice/:callId/:turn", async (req, reply) => {
      const p = z
        .object({
          callId: z.string().uuid(),
          turn: z.coerce.number().int().min(0).max(10),
        })
        .parse(req.params);
      return reply
        .type("text/xml")
        .header("cache-control", "no-store")
        .send(await handlers.voice(p.callId, p.turn, req.body as TwilioParams));
    });
    webhook.post("/webhooks/twilio/status/:callId", async (req, reply) => {
      const { callId } = z
        .object({ callId: z.string().uuid() })
        .parse(req.params);
      await handlers.status(callId, req.body as TwilioParams);
      return reply.code(204).send();
    });
  });
}
