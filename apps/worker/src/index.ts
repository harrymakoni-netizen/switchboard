import { registerPayPalWebhook } from "./webhooks/paypal";
import "dotenv/config";
import Fastify from "fastify";
import PgBoss from "pg-boss";
import { z } from "zod";
import {
  loadEnv,
  fromCents,
  type Business,
  type Call,
  type Quote,
} from "@switchboard/shared";
import { sql, getJob, emit, paymentLocks } from "@switchboard/db";
import {
  transition,
  selected,
  createMoneyEngine,
  receivePayPalWebhook,
} from "@switchboard/engine";
import { MockPayPal, HttpPayPal } from "@switchboard/paypal";
import { MockLLM, GeminiLLM, extract } from "@switchboard/agents";
import {
  MockTelephony,
  parallelCalls,
  script,
  smsTemplate,
} from "@switchboard/calls";
import { bots } from "@switchboard/bots";
const env = loadEnv();
if (env.MOCK_TELEPHONY !== "1")
  throw new Error(
    "Real telephony is not enabled in this M6 build. Keep MOCK_TELEPHONY=1 until M7 is implemented and verified.",
  );
const paypal =
  env.MOCK_PAYPAL === "1"
    ? new MockPayPal()
    : new HttpPayPal(
        process.env.PAYPAL_CLIENT_ID!,
        process.env.PAYPAL_CLIENT_SECRET!,
        process.env.PAYPAL_WEBHOOK_ID!,
      );
const llm = env.MOCK_LLM === "1" ? new MockLLM() : new GeminiLLM();
const tel = new MockTelephony();
const boss = new PgBoss(env.DATABASE_URL);
await boss.start();
async function runFinding(jobId: string) {
  const job = await getJob(jobId);
  if (job.state !== "FINDING" || !job.brief) return;
  if (env.MOCK_PARTNERS !== "1" && env.DEMO_MODE !== "1")
    throw new Error("Real finder requires M7 integration");
  for (const bot of bots(job.brief)) {
    const existing =
      await sql`select id from businesses where job_id=${jobId} and name=${bot.name}`;
    if (existing.length) continue;
    const [b] = await sql<
      Business[]
    >`insert into businesses(job_id,name,phone,rating,is_bot) values(${jobId},${bot.name},${bot.phone},${bot.rating},true) returning *,rating::float8 as rating`;
    await emit(jobId, "business.found", b);
  }
  const [count] =
    await sql`select count(*)::int as count from businesses where job_id=${jobId}`;
  await transition(jobId, { type: "BUSINESSES_FOUND", count: count.count });
}
async function runCalls(jobId: string) {
  const job = await getJob(jobId);
  if (job.state !== "CALLING" || !job.brief) return;
  const businesses = await sql<
    Business[]
  >`select * from businesses where job_id=${jobId}`;
  const personas = bots(job.brief);
  await parallelCalls(
    businesses.map((b) => async (signal) => {
      const [call] = await sql<
        Call[]
      >`insert into calls(job_id,business_id,purpose) values(${jobId},${b.id},'quote') on conflict do nothing returning *`;
      if (!call) return;
      const bot = personas.find((p) => p.name === b.name);
      if (!bot) throw new Error("Unknown mock bot");
      try {
        await tel.conversation(
          {
            callId: call.id,
            to: b.phone,
            script: script("quote", job.brief!.task),
          },
          bot.lines,
          async (event) => {
            if (event.type === "status") {
              await sql`update calls set status=${event.status},started_at=coalesce(started_at,now()),ended_at=case when ${event.status}='completed' then now() else ended_at end where id=${call.id}`;
              await emit(jobId, "call.status", {
                callId: call.id,
                businessId: b.id,
                purpose: "quote",
                status: event.status,
              });
            } else {
              await sql`update calls set transcript=transcript||${JSON.stringify([event.line])}::jsonb where id=${call.id}`;
              await emit(jobId, "transcript.line", {
                callId: call.id,
                ...event.line,
              });
            }
          },
          550,
          signal,
        );
        const [finished] = await sql<
          Call[]
        >`select * from calls where id=${call.id}`;
        const q = await extract(
          llm,
          finished.transcript
            .filter((l) => l.speaker === "party")
            .map((l) => l.text)
            .join("\n"),
        );
        const [quote] = await sql<
          Quote[]
        >`insert into quotes(call_id,business_id,price_cents,earliest_slot,includes,guarantee,willing_to_negotiate,confidence,declined) values(${call.id},${b.id},${q.price_cents},${q.earliest_slot},${q.includes},${q.guarantee},${q.willing_to_negotiate},${q.confidence},${q.declined}) on conflict(call_id) do update set confidence=excluded.confidence returning *,confidence::float8 as confidence`;
        await emit(jobId, "quote.created", { ...quote, business: b });
        if (quote.declined) {
          await sql`update calls set status='declined' where id=${call.id}`;
          await emit(jobId, "call.status", {
            callId: call.id,
            businessId: b.id,
            purpose: "quote",
            status: "declined",
          });
        }
      } catch (error) {
        await sql`update calls set status='failed',ended_at=now() where id=${call.id}`;
        await emit(jobId, "call.status", {
          callId: call.id,
          businessId: b.id,
          purpose: "quote",
          status: "failed",
        });
        throw error;
      }
    }),
  );
  await transition(jobId, { type: "CALLS_FINISHED" });
}
async function enqueue(name: string, jobId: string, startAfter?: Date) {
  await boss.send(
    name,
    { jobId },
    {
      startAfter,
      ...(!["pollCapture", "pollPayout"].includes(name)
        ? { singletonKey: jobId + ":" + name }
        : {}),
      retryLimit: 5,
      retryDelay: 2,
    },
  );
}
async function confirmCall(jobId: string) {
  const job = await getJob(jobId);
  if (job.state !== "FUNDS_HELD" || !job.brief) return;
  await enqueue("reauthorize", jobId, new Date(Date.now() + 72 * 3600000));
  const q = await selected(sql, job);
  const bot = bots(job.brief).find((b) => b.name === q.name);
  if (!bot || !q.earliestSlot) throw new Error("Confirmation unavailable");
  const [call] = await sql<
    Call[]
  >`insert into calls(job_id,business_id,purpose) values(${jobId},${q.businessId},'confirm') returning *`;
  const lines = [
    `Yes, the price is $${fromCents(q.priceCents!)} and the slot is ${q.earliestSlot}. Confirmed. My PayPal email is ${bot.payoutEmail}.`,
  ];
  await tel.conversation(
    {
      callId: call.id,
      to: q.phone,
      script: script(
        "confirm",
        `Read back price, slot, and email. Payment is held by PayPal and released when the customer confirms the job is done.`,
      ),
    },
    lines,
    async (e) => {
      if (e.type === "line") {
        await sql`update calls set transcript=transcript||${JSON.stringify([e.line])}::jsonb where id=${call.id}`;
        await emit(jobId, "transcript.line", { callId: call.id, ...e.line });
      } else
        await sql`update calls set status=${e.status},started_at=coalesce(started_at,now()),ended_at=case when ${e.status}='completed' then now() else ended_at end where id=${call.id}`;
    },
    150,
  );
  if ((await getJob(jobId)).state !== "FUNDS_HELD") return;
  await transition(jobId, {
    type: "BUSINESS_CONFIRMED",
    payoutEmail: bot.payoutEmail,
    slot: new Date(q.earliestSlot).toISOString(),
  });
}
async function confirmed(jobId: string) {
  const j = await getJob(jobId);
  if (j.state !== "CONFIRMED" || !j.brief || !j.bookedSlot) return;
  const q = await selected(sql, j);
  await tel.sendSms(
    q.phone,
    smsTemplate("booking_confirmed", {
      slot: new Date(j.bookedSlot).toISOString(),
      location: j.brief.location,
      amount: fromCents(q.priceCents!),
    }),
  );
  const others = await sql<
    Business[]
  >`select * from businesses where job_id=${jobId} and id<>${q.businessId}`;
  await Promise.all(
    others.map((b) => tel.sendSms(b.phone, smsTemplate("not_selected", {}))),
  );
  await enqueue("slotPassed", jobId, new Date(j.bookedSlot));
}
async function slotPassed(jobId: string) {
  if ((await getJob(jobId)).state === "CONFIRMED")
    await transition(jobId, { type: "SLOT_PASSED" });
}
async function completionCall(jobId: string) {
  if ((await getJob(jobId)).state !== "AWAITING_COMPLETION") return;
  await emit(jobId, "notice", {
    level: "info",
    message:
      "The slot has passed. Confirm completion in the app to release payment. No user phone number is collected in mock mode.",
  });
}
const money = createMoneyEngine({ paypal, env, enqueue, tel });
await money.restore();
const handlers: Record<
  string,
  (jobId: string, payload?: { eventId?: string }) => Promise<void>
> = {
  runFinding,
  runCalls,
  createOrder: money.createOrder,
  confirmCall,
  confirmed,
  completionCall,
  capture: money.capture,
  payout: money.payout,
  void: money.voidHold,
  reauthorize: money.reauthorize,
  slotPassed,
  receipt: money.receipt,
  pollCapture: money.pollCapture,
  pollPayout: money.pollPayout,
  paypalWebhook: async (jobId, payload) => {
    if (!payload?.eventId) throw new Error("Missing webhook event id");
    await money.reconcileWebhook(jobId, payload.eventId);
  },
};
for (const name of Object.keys(handlers)) {
  await boss.createQueue(name);
  await boss.work<{ jobId: string; payload?: { eventId?: string } }>(
    name,
    { pollingIntervalSeconds: 0.5 },
    async (jobs) => {
      for (const j of jobs) await handlers[name](j.data.jobId, j.data.payload);
    },
  );
}
let dispatching = false;
async function dispatch() {
  if (dispatching) return;
  dispatching = true;
  try {
    const effects =
      await sql`select * from effects where dispatched_at is null order by id limit 100`;
    for (const e of effects) {
      if (!handlers[e.name]) continue;
      await boss.send(
        e.name,
        { jobId: e.jobId, payload: e.payload },
        { singletonKey: "effect-" + e.id, retryLimit: 3, retryDelay: 2 },
      );
      await sql`update effects set dispatched_at=now() where id=${e.id}`;
    }
  } catch (error) {
    console.error(
      "Dispatch failed",
      error instanceof Error ? error.message : "unknown",
    );
  } finally {
    dispatching = false;
  }
}
const timer = setInterval(() => void dispatch(), 250);
const app = Fastify({
  logger: {
    redact: [
      "req.headers.authorization",
      "req.headers.paypal-transmission-sig",
    ],
  },
});
await registerPayPalWebhook(app, (headers, body) =>
  receivePayPalWebhook(paypal, headers, body),
);
app.get("/health", async () => ({
  ok: true,
  mode: env.MOCK_TELEPHONY === "1" ? "mock" : "sandbox",
}));
app.addHook("preHandler", async (req, reply) => {
  if (
    req.url.startsWith("/internal/") &&
    req.headers.authorization !== "Bearer " + env.SESSION_SECRET
  )
    return reply.code(401).send({ error: "Unauthorized" });
});
app.post("/internal/authorize", async (req, reply) => {
  const { jobId, token } = z
    .object({ jobId: z.string().uuid(), token: z.string().min(1) })
    .parse(req.body);
  try {
    return await money.authorize(jobId, token);
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "Authorization failed",
    });
  }
});
app.setErrorHandler((error, _req, reply) => {
  console.error(error instanceof Error ? error.message : "unknown");
  reply
    .code(400)
    .send({ error: "Operation failed; please retry from the job page." });
});
await app.listen({ port: Number(process.env.PORT ?? 4000), host: "0.0.0.0" });
async function stop() {
  clearInterval(timer);
  await boss.stop();
  await app.close();
  await Promise.all([sql.end(), paymentLocks.end()]);
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
