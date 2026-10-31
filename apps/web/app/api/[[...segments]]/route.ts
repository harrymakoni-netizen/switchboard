import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql, createJob, snapshot } from "@switchboard/db";
import { transition, showPayoutEmail } from "@switchboard/engine";
import { MockLLM, AnthropicLLM, plan } from "@switchboard/agents";
import { ownJob, runtime, session } from "../../../lib/server";
export const dynamic = "force-dynamic";
type Context = { params: { segments?: string[] } };
async function handle(req: NextRequest, { params }: Context) {
  try {
    if (process.env.HOSTED_UI_ONLY === "1")
      return NextResponse.json(
        { error: "Online booking is not available on this deployment yet." },
        { status: 503 },
      );
    const env = runtime();
    const parts = params.segments ?? [];
    if (
      req.method === "POST" &&
      req.headers.get("origin") &&
      req.headers.get("origin") !== new URL(env.APP_URL).origin
    )
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    const llm = () =>
      env.MOCK_LLM === "1" ? new MockLLM() : new AnthropicLLM();
    if (parts.join("/") === "jobs" && req.method === "POST") {
      const { request } = z
        .object({ request: z.string().min(5).max(2000) })
        .parse(await req.json());
      const job = await createJob(session(true), request);
      const brief = await plan(llm(), request);
      if ("followUpQuestion" in brief)
        return NextResponse.json({ jobId: job.id, ...brief });
      await transition(job.id, { type: "BRIEF_READY", brief });
      return NextResponse.json({ jobId: job.id });
    }
    if (parts[0] === "demo" && parts[1] === "fast-forward") {
      if (env.DEMO_MODE !== "1") return new Response(null, { status: 404 });
      const { jobId } = z
        .object({ jobId: z.string().uuid() })
        .parse(await req.json());
      await ownJob(jobId);
      await transition(jobId, { type: "SLOT_PASSED" });
      return NextResponse.json({ ok: true });
    }
    if (parts[0] !== "jobs" || !parts[1])
      return new Response(null, { status: 404 });
    const id = z.string().uuid().parse(parts[1]);
    const job = await ownJob(id);
    const action = parts[2];
    if (req.method === "GET" && action === "receipt") {
      const data = await snapshot(id);
      const invoice = data.payments.find((p) => p.kind === "invoice");
      if (!invoice)
        return new Response("Receipt is still being prepared", { status: 404 });
      const escape = (v: string) =>
        v
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('\"', "&quot;");
      return new Response(
        `<!doctype html><html lang="en"><title>Switchboard receipt</title><body style="font-family:Arial;padding:40px;max-width:700px;margin:auto"><h1>Switchboard receipt</h1><p>MOCK · PayPal sandbox · No real money moved</p><hr><p>${escape(job.brief?.task ?? "Home repair")}</p><p>Amount: $${((invoice.amountCents ?? 0) / 100).toFixed(2)} USD</p><p>Status: ${escape(invoice.status)}</p><p>Invoice: ${escape(invoice.paypalId ?? "")}</p><p>Job: ${escape(id)}</p></body></html>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
        },
      );
    }
    if (req.method === "GET" && !action)
      return NextResponse.json(await snapshot(id));
    if (req.method === "GET" && action === "events") {
      const encoder = new TextEncoder();
      let stop: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let closed = false;
      const stream = new ReadableStream({
        async start(controller) {
          const send = (text: string) => {
            if (!closed) controller.enqueue(encoder.encode(text));
          };
          const listener = await sql.listen(
            `job_${id.replaceAll("-", "_")}`,
            (payload) => {
              const event = z
                .object({ type: z.string(), data: z.unknown() })
                .parse(JSON.parse(payload));
              send(
                `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
              );
            },
          );
          stop = () => {
            void listener.unlisten();
          };
          send("event: connected\ndata: {}\n\n");
          heartbeat = setInterval(() => send(": heartbeat\n\n"), 15000);
          req.signal.addEventListener(
            "abort",
            () => {
              closed = true;
              if (heartbeat) clearInterval(heartbeat);
              stop?.();
              try {
                controller.close();
              } catch {}
            },
            { once: true },
          );
        },
        cancel() {
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          stop?.();
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }
    if (
      req.method === "GET" &&
      action === "calls" &&
      parts[4] === "transcript"
    ) {
      const callId = z.string().uuid().parse(parts[3]);
      const [call] =
        await sql`select transcript from calls where id=${callId} and job_id=${id}`;
      if (!call) return new Response(null, { status: 404 });
      return NextResponse.json(call.transcript);
    }
    if (req.method !== "POST") return new Response(null, { status: 405 });
    if (action === "answer") {
      const { answer } = z
        .object({ answer: z.string().min(1).max(1000) })
        .parse(await req.json());
      if (job.state !== "DRAFT") throw new Error("Brief already submitted");
      const raw = job.rawRequest + "; " + answer;
      const result = await plan(llm(), raw);
      await sql`update jobs set raw_request=${raw} where id=${id}`;
      if ("followUpQuestion" in result) return NextResponse.json(result);
      await transition(id, { type: "BRIEF_READY", brief: result });
      return NextResponse.json({ ok: true });
    }
    if (action === "book") {
      const { quoteId } = z
        .object({ quoteId: z.string().uuid() })
        .parse(await req.json());
      await transition(id, { type: "USER_BOOKED", quoteId });
      for (let n = 0; n < 100; n++) {
        const [p] =
          await sql`select raw from payments where job_id=${id} and kind='order'`;
        if (p) {
          const { approveUrl } = z
            .object({ approveUrl: z.string().url() })
            .parse(p.raw);
          return NextResponse.json({ approveUrl });
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error(
        "Approval is being prepared. Refresh this job to continue.",
      );
    }
    if (action === "show-payout-email")
      return NextResponse.json({ email: await showPayoutEmail(id) });
    if (action === "done") {
      const { done, note } = z
        .object({ done: z.boolean(), note: z.string().max(1000).optional() })
        .parse(await req.json());
      await transition(
        id,
        done
          ? { type: "USER_CONFIRMED_DONE" }
          : { type: "USER_REPORTED_NOT_DONE", note },
      );
      return NextResponse.json({ ok: true });
    }
    if (action === "cancel") {
      await transition(id, { type: "USER_CANCELLED" });
      return NextResponse.json({ ok: true });
    }
    return new Response(null, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Job not found" ? 404 : 400 },
    );
  }
}
export const GET = handle;
export const POST = handle;
