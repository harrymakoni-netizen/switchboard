import Fastify from "fastify";
import { it, expect } from "vitest";
import { registerPayPalWebhook } from "./paypal";
it("passes exact webhook bytes through verification and keeps internal JSON parsing", async () => {
  const app = Fastify();
  let seen = "";
  await registerPayPalWebhook(app, async (headers, body) => {
    seen = body;
    expect(headers["paypal-transmission-id"]).toBe("transmission");
    return { status: 200, duplicate: false };
  });
  app.post("/internal/test", async (req) => req.body);
  const body = '{ "id": "evt",\n "event_type": "CHECKOUT.ORDER.APPROVED" }';
  const result = await app.inject({
    method: "POST",
    url: "/webhooks/paypal",
    headers: {
      "content-type": "application/json",
      "paypal-transmission-id": "transmission",
    },
    payload: body,
  });
  expect(result.statusCode).toBe(200);
  expect(seen).toBe(body);
  const internal = await app.inject({
    method: "POST",
    url: "/internal/test",
    payload: { jobId: "123" },
  });
  expect(internal.json()).toEqual({ jobId: "123" });
  await app.close();
});
it("returns 401 for unverified delivery", async () => {
  const app = Fastify();
  await registerPayPalWebhook(app, async () => ({
    status: 401,
    duplicate: false,
  }));
  const result = await app.inject({
    method: "POST",
    url: "/webhooks/paypal",
    payload: { id: "fake" },
  });
  expect(result.statusCode).toBe(401);
  await app.close();
});
