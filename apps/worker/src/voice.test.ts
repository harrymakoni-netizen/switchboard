import { randomUUID } from "node:crypto";
import { afterAll, it, expect, vi } from "vitest";
import { sql, createJob } from "@switchboard/db";
import {
  prepareVoice,
  handleVoiceTurn,
  handleVoiceStatus,
  realConversation,
  reserveConfirmationCall,
} from "./voice";
import {
  TwilioTelephony,
  type TwilioConfig,
  type TwilioPort,
} from "../../../packages/calls/src/twilio";
const config: TwilioConfig = {
  accountSid: "AC" + "1".repeat(32),
  authToken: "test-auth",
  fromNumber: "+12025550100",
  publicWorkerUrl: "https://worker.example",
  allowedNumbers: ["+12025550109"],
  mode: "trial",
};
const plan = {
  purpose: "quote" as const,
  task: "repair a geyser",
  location: "Avondale",
  window: "tomorrow",
  maxSeconds: 120,
};
const jobs: string[] = [];
async function fixture() {
  const job = await createJob(randomUUID(), "voice test");
  jobs.push(job.id);
  const [business] =
    await sql`insert into businesses(job_id,name,phone) values(${job.id},'Test',${config.allowedNumbers[0]}) returning id`;
  const [call] =
    await sql`insert into calls(job_id,business_id,purpose) values(${job.id},${business.id},'quote') returning id`;
  await prepareVoice(
    call.id,
    config.allowedNumbers[0],
    config.fromNumber,
    plan,
  );
  const body = {
    AccountSid: config.accountSid,
    CallSid: "CA" + randomUUID().replaceAll("-", ""),
    To: config.allowedNumbers[0],
    From: config.fromNumber,
  };
  return {
    job,
    callId: String(call.id),
    businessId: String(business.id),
    body,
  };
}
afterAll(async () => {
  for (const id of jobs) {
    await sql`delete from events where job_id=${id}`;
    await sql`delete from calls where job_id=${id}`;
    await sql`delete from businesses where job_id=${id}`;
    await sql`delete from jobs where id=${id}`;
  }
  await sql.end();
});
it("replays duplicate turns without duplicating transcripts or advancing twice", async () => {
  const f = await fixture();
  const first = await handleVoiceTurn(
    f.callId,
    0,
    f.body,
    config.publicWorkerUrl,
  );
  const second = await handleVoiceTurn(
    f.callId,
    0,
    f.body,
    config.publicWorkerUrl,
  );
  expect(second).toBe(first);
  const [call] = await sql`select transcript from calls where id=${f.callId}`;
  expect(call.transcript).toHaveLength(1);
  const [session] =
    await sql`select state from voice_sessions where call_id=${f.callId}`;
  expect(session.state.turn).toBe(1);
});
it("refuses to bind a callback for another recipient or another provider call", async () => {
  const f = await fixture();
  await handleVoiceTurn(
    f.callId,
    0,
    { ...f.body, To: "+12025550101" },
    config.publicWorkerUrl,
  );
  let [call] = await sql`select * from calls where id=${f.callId}`;
  expect(call.providerSid).toBeNull();
  expect(call.transcript).toHaveLength(0);
  await handleVoiceTurn(f.callId, 0, f.body, config.publicWorkerUrl);
  await handleVoiceTurn(
    f.callId,
    1,
    { ...f.body, CallSid: "CA" + "3".repeat(32), SpeechResult: "yes" },
    config.publicWorkerUrl,
  );
  [call] = await sql`select * from calls where id=${f.callId}`;
  expect(call.providerSid).toBe(f.body.CallSid);
  expect(call.transcript).toHaveLength(1);
});
it("does not accept out-of-order or expired turn callbacks", async () => {
  const f = await fixture();
  const future = await handleVoiceTurn(
    f.callId,
    2,
    f.body,
    config.publicWorkerUrl,
  );
  expect(future).toContain("<Hangup");
  await sql`update voice_sessions set deadline=now()-interval '1 second' where call_id=${f.callId}`;
  const expired = await handleVoiceTurn(
    f.callId,
    0,
    f.body,
    config.publicWorkerUrl,
  );
  expect(expired).toContain("time limit");
  const [call] = await sql`select * from calls where id=${f.callId}`;
  expect(call.status).toBe("failed");
  expect(call.transcript).toHaveLength(0);
});
it("keeps an explicit refusal terminal despite a later completed status callback", async () => {
  const f = await fixture();
  await handleVoiceTurn(f.callId, 0, f.body, config.publicWorkerUrl);
  await handleVoiceTurn(
    f.callId,
    1,
    { ...f.body, SpeechResult: "No thanks" },
    config.publicWorkerUrl,
  );
  await handleVoiceStatus(f.callId, { ...f.body, CallStatus: "completed" });
  const [call] = await sql`select * from calls where id=${f.callId}`;
  expect(call.status).toBe("declined");
});
it("does not treat a premature hangup as a completed questionnaire", async () => {
  const f = await fixture();
  await handleVoiceTurn(f.callId, 0, f.body, config.publicWorkerUrl);
  await handleVoiceStatus(f.callId, { ...f.body, CallStatus: "completed" });
  const [call] = await sql`select * from calls where id=${f.callId}`;
  expect(call.status).toBe("failed");
});
it("reserves a single confirmation call across concurrent dispatchers", async () => {
  const f = await fixture();
  const rows = await Promise.all([
    reserveConfirmationCall(f.job.id, f.businessId),
    reserveConfirmationCall(f.job.id, f.businessId),
  ]);
  expect(rows[0].id).toBe(rows[1].id);
  const result =
    await sql`select id from calls where job_id=${f.job.id} and purpose='confirm'`;
  expect(result).toHaveLength(1);
});
it("never turns a historical mock call into a real dial", async () => {
  const f = await fixture();
  const port: TwilioPort = {
    createCall: vi.fn(),
    readCall: vi.fn(),
    endCall: vi.fn(),
    sendMessage: vi.fn(),
  };
  await sql`update calls set provider_sid=${"MOCK-CA-" + f.callId} where id=${f.callId}`;
  await expect(
    realConversation(
      new TwilioTelephony(config, port),
      f.callId,
      config.allowedNumbers[0],
      plan,
    ),
  ).rejects.toThrow("historical mock call");
  expect(port.createCall).not.toHaveBeenCalled();
});
it("never starts an outgoing call after the parent task was aborted", async () => {
  const f = await fixture();
  const port: TwilioPort = {
    createCall: vi.fn(),
    readCall: vi.fn(),
    endCall: vi.fn(),
    sendMessage: vi.fn(),
  };
  const controller = new AbortController();
  controller.abort();
  await expect(
    realConversation(
      new TwilioTelephony(config, port),
      f.callId,
      config.allowedNumbers[0],
      plan,
      controller.signal,
    ),
  ).rejects.toThrow("time limit");
  expect(port.createCall).not.toHaveBeenCalled();
});
it("never starts an outgoing call for an already expired durable session", async () => {
  const f = await fixture();
  const port: TwilioPort = {
    createCall: vi.fn(),
    readCall: vi.fn(),
    endCall: vi.fn(),
    sendMessage: vi.fn(),
  };
  await sql`update voice_sessions set deadline=now()-interval '1 second' where call_id=${f.callId}`;
  await expect(
    realConversation(
      new TwilioTelephony(config, port),
      f.callId,
      config.allowedNumbers[0],
      plan,
    ),
  ).rejects.toThrow("time limit");
  expect(port.createCall).not.toHaveBeenCalled();
});
it("places only one provider call when concurrent workers resume the same session", async () => {
  const f = await fixture();
  const port: TwilioPort = {
    createCall: vi.fn(async () => {
      for (const [turn, SpeechResult] of [
        [0, ""],
        [1, "yes"],
        [2, "95 dollars"],
        [3, "November 6 at 9 AM"],
        [4, "Labour, 30 day guarantee"],
      ] as const)
        await handleVoiceTurn(
          f.callId,
          turn,
          { ...f.body, SpeechResult },
          config.publicWorkerUrl,
        );
      return { sid: f.body.CallSid, status: "queued" };
    }),
    endCall: vi.fn(),
    readCall: vi.fn(),
    sendMessage: vi.fn(),
  };
  const client = new TwilioTelephony(config, port);
  const result = await Promise.all([
    realConversation(client, f.callId, config.allowedNumbers[0], plan),
    realConversation(client, f.callId, config.allowedNumbers[0], plan),
  ]);
  expect(port.createCall).toHaveBeenCalledOnce();
  expect(result.every((r) => r.phase === "done" && !r.result?.declined)).toBe(
    true,
  );
});
