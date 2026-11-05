import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sql, createJob } from "@switchboard/db";
import { script } from "@switchboard/calls";
import {
  TwilioTelephony,
  TwilioTransportError,
  twilioConfig,
} from "../packages/calls/src/twilio";
import { prepareVoice, realConversation } from "../apps/worker/src/voice";
import { z } from "zod";
const args = process.argv.slice(2);
const customPlan = {
  purpose: "quote" as const,
  task: "provide a practice water-heater repair quote for a Switchboard test, not a real service request",
  location: "Avondale",
  window: "tomorrow in Harare local time",
  maxSeconds: 120,
};
const stateSchema = z.object({
  callId: z.string().uuid(),
  to: z.string(),
  custom: z.boolean(),
  providerSid: z.string().optional(),
  jobId: z.string().optional(),
  attempted: z.literal(true),
  rejection: z.string().optional(),
});
async function main() {
  if (args.includes("--help")) {
    console.log(
      "Twilio trial test only; no booking or payment.\npnpm twilio:smoke --to +<your-verified-phone> --state .twilio-smoke/test.json --call\nAdd --custom to test Switchboard's short quote questionnaire.\nRead status without making a call: pnpm twilio:smoke --state .twilio-smoke/test.json --status\nThe state file prevents accidentally placing the same test call twice. A trial may reject custom call settings; do not enable real app calling until verified.",
    );
    return;
  }
  const client = new TwilioTelephony(twilioConfig());
  const pathArg = args.indexOf("--state");
  if (pathArg < 0 || !args[pathArg + 1] || args[pathArg + 1].startsWith("--"))
    throw new Error("Provide --state .twilio-smoke/test.json.");
  const path = resolve(args[pathArg + 1]);
  if (args.includes("--status")) {
    const state = stateSchema.parse(JSON.parse(await readFile(path, "utf8")));
    if (state.rejection) throw new Error(state.rejection);
    if (!state.providerSid && state.custom) {
      const [call] =
        await sql`select provider_sid from calls where id=${state.callId}`;
      if (call?.providerSid) state.providerSid = String(call.providerSid);
    }
    if (!state.providerSid)
      throw new Error(
        "Call outcome is uncertain. Check Twilio Logs; this state file must not be reused to redial.",
      );
    const result = await client.readCall(state.providerSid);
    console.log(
      JSON.stringify({
        providerSid: result.sid,
        status: result.status,
        durationSeconds: result.duration,
      }),
    );
    if (state.custom) {
      const [session] =
        await sql`select state from voice_sessions where call_id=${state.callId}`;
      console.log(
        JSON.stringify({
          questionnairePhase: session?.state.phase,
          result: session?.state.result,
        }),
      );
    }
    return;
  }
  const toArg = args.indexOf("--to");
  const to = z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .parse(toArg >= 0 ? args[toArg + 1] : undefined);
  if (
    !client.config.allowedNumbers.includes(to) ||
    to === client.config.fromNumber
  )
    throw new Error(
      "Use your own verified phone listed in TWILIO_ALLOWED_NUMBERS, not the Twilio caller number.",
    );
  if (!args.includes("--call"))
    throw new Error(
      "This places a real test call and consumes Twilio minutes. Add --call only when ready to answer.",
    );
  const state: z.infer<typeof stateSchema> = {
    callId: randomUUID(),
    to,
    custom: args.includes("--custom"),
    attempted: true,
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(state) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  const persist = async () => {
    await writeFile(path + ".tmp", JSON.stringify(state) + "\n", {
      mode: 0o600,
    });
    await rename(path + ".tmp", path);
  };
  try {
    if (state.custom) {
      const job = await createJob(
        randomUUID(),
        "Twilio test only — no booking or payment.",
      );
      state.jobId = job.id;
      const [business] =
        await sql`insert into businesses(job_id,name,phone,is_bot) values(${job.id},'Verified test recipient',${to},true) returning id`;
      await sql`insert into calls(id,job_id,business_id,purpose,status) values(${state.callId},${job.id},${business.id},'quote','dispatching')`;
      await prepareVoice(
        state.callId,
        to,
        client.config.fromNumber,
        customPlan,
      );
      await sql`update voice_sessions set attempted_at=now() where call_id=${state.callId}`;
      await persist();
      const result = await client.placeCall({
        callId: state.callId,
        to,
        script: {
          ...script("quote", "Twilio custom questionnaire test"),
          maxSeconds: 120,
        },
      });
      state.providerSid = result.providerSid;
      await sql`update calls set provider_sid=${state.providerSid} where id=${state.callId} and (provider_sid is null or provider_sid=${state.providerSid})`;
    } else state.providerSid = (await client.templateTestCall(to)).sid;
  } catch (error) {
    if (
      error instanceof TwilioTransportError &&
      error.status &&
      error.status >= 400 &&
      error.status < 500
    ) {
      state.rejection = error.message;
      await persist();
    }
    throw error;
  }
  await persist();
  console.log(
    JSON.stringify({
      providerSid: state.providerSid,
      type: state.custom
        ? "Switchboard questionnaire"
        : "Twilio speech-recognition template",
      paymentRequests: 0,
    }),
  );
  console.log(
    "Answer your verified phone. Use --status with the same state file afterward. Do not delete the state file to retry an uncertain call.",
  );
  if (state.custom) {
    console.log(
      "Keep this Shell open: monitoring the custom call's two-minute deadline.",
    );
    const result = await realConversation(client, state.callId, to, customPlan);
    console.log(
      JSON.stringify({
        questionnairePhase: result.phase,
        result: result.result,
      }),
    );
  }
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Twilio test failed",
    );
    process.exitCode = 1;
  })
  .finally(() => sql.end());
