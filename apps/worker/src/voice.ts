import { createHash } from "node:crypto";
import { z } from "zod";
import { sql, emit } from "@switchboard/db";
import {
  advanceVoice,
  startVoice,
  voiceStateSchema,
  hangupXml,
  type VoicePlan,
  type VoiceState,
} from "../../../packages/calls/src/turns";
import {
  TwilioTelephony,
  type TwilioParams,
} from "../../../packages/calls/src/twilio";
import { wait } from "@switchboard/calls";
import type { TranscriptLine, Call } from "@switchboard/shared";

type Session = {
  callId: string;
  toNumber: string;
  fromNumber: string;
  state: unknown;
  responses: unknown;
  attemptedAt: Date | null;
  deadline: Date;
};
const sidSchema = z.string().regex(/^CA[0-9a-fA-F]{32}$/);
const responsesSchema = z.record(
  z.object({ hash: z.string(), xml: z.string() }),
);
const terminal = new Set([
  "completed",
  "declined",
  "failed",
  "busy",
  "no_answer",
  "canceled",
]);
export async function reserveConfirmationCall(
  jobId: string,
  businessId: string,
) {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${jobId + ":voice-confirm"},0))`;
    const [existing] = await tx<
      Call[]
    >`select * from calls where job_id=${jobId} and business_id=${businessId} and purpose='confirm' order by started_at desc nulls last limit 1`;
    if (existing) return existing;
    const [created] = await tx<
      Call[]
    >`insert into calls(job_id,business_id,purpose) values(${jobId},${businessId},'confirm') returning *`;
    return created;
  });
}
export async function prepareVoice(
  callId: string,
  to: string,
  from: string,
  plan: VoicePlan,
) {
  z.string().uuid().parse(callId);
  await sql`insert into voice_sessions(call_id,to_number,from_number,state,deadline)
    values(${callId},${to},${from},${JSON.stringify(startVoice(plan))}::jsonb,${new Date(Date.now() + plan.maxSeconds * 1000).toISOString()}) on conflict(call_id) do nothing`;
}
export async function handleVoiceTurn(
  callId: string,
  turn: number,
  params: TwilioParams,
  baseUrl: string,
) {
  z.string().uuid().parse(callId);
  z.number().int().min(0).max(10).parse(turn);
  const body = z
    .object({
      CallSid: sidSchema,
      To: z.string(),
      From: z.string(),
      SpeechResult: z.string().max(10000).optional(),
      Digits: z.string().max(8).optional(),
    })
    .parse(params);
  return sql.begin(async (tx) => {
    const [session] = await tx<
      Session[]
    >`select * from voice_sessions where call_id=${callId} for update`;
    if (
      !session ||
      session.toNumber !== body.To ||
      session.fromNumber !== body.From
    )
      return hangupXml();
    const [call] = await tx`select * from calls where id=${callId} for update`;
    if (!call || (call.providerSid && call.providerSid !== body.CallSid))
      return hangupXml();
    const responses = responsesSchema.parse(session.responses);
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          body.CallSid,
          body.SpeechResult ?? "",
          body.Digits ?? "",
        ]),
      )
      .digest("hex");
    if (responses[turn])
      return responses[turn].hash === hash ? responses[turn].xml : hangupXml();
    const state = voiceStateSchema.parse(session.state);
    if (
      state.turn !== turn ||
      state.phase === "done" ||
      terminal.has(call.status)
    )
      return hangupXml();
    if (new Date(session.deadline).getTime() <= Date.now()) {
      await tx`update calls set status='failed',ended_at=now() where id=${callId}`;
      await emit(
        call.jobId,
        "call.status",
        {
          callId,
          businessId: call.businessId,
          purpose: call.purpose,
          status: "failed",
        },
        tx,
      );
      return hangupXml("This call has reached its time limit. Goodbye.");
    }
    const result = advanceVoice(
      state,
      body.SpeechResult ?? "",
      body.Digits,
      (next) => baseUrl + `/webhooks/twilio/voice/${callId}/${next}`,
    );
    const lines: TranscriptLine[] = [];
    if (turn > 0 && result.party)
      lines.push({
        speaker: "party",
        text: result.party,
        at: new Date().toISOString(),
      });
    if (result.prompt)
      lines.push({
        speaker: "agent",
        text: result.prompt,
        at: new Date().toISOString(),
      });
    const status =
      result.state.phase === "done"
        ? result.state.result?.declined
          ? "declined"
          : "completed"
        : "in_progress";
    responses[turn] = { hash, xml: result.xml };
    await tx`update voice_sessions set state=${JSON.stringify(result.state)}::jsonb,responses=${JSON.stringify(responses)}::jsonb where call_id=${callId}`;
    await tx`update calls set provider_sid=${body.CallSid},status=${status},started_at=coalesce(started_at,now()),ended_at=case when ${result.state.phase === "done"} then now() else ended_at end,transcript=transcript||${JSON.stringify(lines)}::jsonb where id=${callId}`;
    for (const line of lines)
      await emit(call.jobId, "transcript.line", { callId, ...line }, tx);
    await emit(
      call.jobId,
      "call.status",
      { callId, businessId: call.businessId, purpose: call.purpose, status },
      tx,
    );
    return result.xml;
  });
}
export async function handleVoiceStatus(callId: string, params: TwilioParams) {
  z.string().uuid().parse(callId);
  const body = z
    .object({
      CallSid: sidSchema,
      CallStatus: z.enum([
        "queued",
        "initiated",
        "ringing",
        "in-progress",
        "completed",
        "busy",
        "failed",
        "no-answer",
        "canceled",
      ]),
      To: z.string(),
      From: z.string(),
    })
    .parse(params);
  await sql.begin(async (tx) => {
    const [session] = await tx<
      Session[]
    >`select * from voice_sessions where call_id=${callId} for update`;
    if (
      !session ||
      session.toNumber !== body.To ||
      session.fromNumber !== body.From
    )
      return;
    const [call] = await tx`select * from calls where id=${callId} for update`;
    if (
      !call ||
      terminal.has(call.status) ||
      (call.providerSid && call.providerSid !== body.CallSid)
    )
      return;
    let status = body.CallStatus.replaceAll("-", "_");
    if (status === "initiated") status = "queued";
    if (
      (call.status === "in_progress" &&
        ["queued", "ringing"].includes(status)) ||
      (call.status === "ringing" && status === "queued")
    )
      return;
    // A hangup before the questionnaire completes is not a completed quote or booking confirmation.
    if (
      status === "completed" &&
      voiceStateSchema.parse(session.state).phase !== "done"
    )
      status = "failed";
    await tx`update calls set provider_sid=${body.CallSid},status=${status},started_at=case when ${status === "in_progress"} then coalesce(started_at,now()) else started_at end,ended_at=case when ${terminal.has(status)} then coalesce(ended_at,now()) else ended_at end where id=${callId}`;
    await emit(
      call.jobId,
      "call.status",
      { callId, businessId: call.businessId, purpose: call.purpose, status },
      tx,
    );
  });
}
export async function realConversation(
  client: TwilioTelephony,
  callId: string,
  to: string,
  plan: VoicePlan,
  signal?: AbortSignal,
): Promise<VoiceState> {
  if (signal?.aborted) throw new Error("Call reached its time limit.");
  const [knownCall] =
    await sql`select provider_sid from calls where id=${callId}`;
  if (!knownCall) throw new Error("Call session missing");
  if (
    typeof knownCall.providerSid === "string" &&
    knownCall.providerSid.startsWith("MOCK-")
  )
    throw new Error(
      "A historical mock call cannot be redialed as a real call.",
    );
  await prepareVoice(callId, to, client.config.fromNumber, plan);
  if (knownCall.providerSid)
    await sql`update voice_sessions set attempted_at=coalesce(attempted_at,now()) where call_id=${callId}`;
  const [reservation] = await sql<
    Session[]
  >`update voice_sessions set attempted_at=now() where call_id=${callId} and attempted_at is null and deadline>now() returning *`;
  if (reservation) {
    await sql`update calls set status='dispatching' where id=${callId}`;
    if (signal?.aborted) {
      await sql`update calls set status='failed',ended_at=now() where id=${callId}`;
      throw new Error("Call reached its time limit.");
    }
    try {
      const result = await client.placeCall({
        callId,
        to,
        script: {
          purpose: plan.purpose,
          maxSeconds: plan.maxSeconds,
          openingLine:
            "Hi, this is an AI assistant calling on behalf of a customer. Is now a good time for a quick question?",
          systemPrompt: plan.task,
        },
      });
      const updated =
        await sql`update calls set provider_sid=${result.providerSid} where id=${callId} and (provider_sid is null or provider_sid=${result.providerSid}) returning id`;
      if (!updated.length) {
        await client.endCall(result.providerSid);
        throw new Error("Twilio call identity mismatch");
      }
    } catch (error) {
      // Never automatically redial an uncertain create request. A signed callback may still bind its SID.
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        typeof error.status === "number" &&
        error.status >= 400 &&
        error.status < 500
      )
        await sql`update calls set status='failed',ended_at=now() where id=${callId} and provider_sid is null`;
      else if (!(
        typeof error === "object" &&
        error !== null &&
        "status" in error
      ))
        throw error;
    }
  }
  while (true) {
    const [session] = await sql<
      Session[]
    >`select * from voice_sessions where call_id=${callId}`;
    const [call] =
      await sql`select status,provider_sid from calls where id=${callId}`;
    if (!session || !call) throw new Error("Call session missing");
    const state = voiceStateSchema.parse(session.state);
    if (terminal.has(call.status)) {
      if (state.phase === "done") return state;
      throw new Error("Call ended before the conversation completed.");
    }
    if (signal?.aborted || new Date(session.deadline).getTime() <= Date.now()) {
      if (call.providerSid)
        await client.endCall(call.providerSid).catch(() => undefined);
      await sql`update calls set status='failed',ended_at=now() where id=${callId}`;
      throw new Error("Call reached its time limit.");
    }
    await wait(500);
  }
}
