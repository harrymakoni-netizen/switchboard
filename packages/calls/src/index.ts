import type { TranscriptLine } from "@switchboard/shared";
export interface CallScript {
  purpose: "quote" | "confirm" | "completion";
  systemPrompt: string;
  openingLine: string;
  maxSeconds: number;
}
export interface PlaceCallArgs {
  callId: string;
  to: string;
  script: CallScript;
}
export interface Telephony {
  placeCall(a: PlaceCallArgs): Promise<{ providerSid: string }>;
  sendSms(to: string, body: string): Promise<void>;
}
export interface VoiceSession {
  onTranscript(
    cb: (line: { speaker: "agent" | "party"; text: string }) => void,
  ): void;
  onEnd(cb: (reason: "hangup" | "timeout" | "agent_end") => void): void;
}
export const openingLine =
  "Hi, this is an AI assistant calling on behalf of a customer. Is now a good time for a quick question?";
export function script(
  purpose: CallScript["purpose"],
  goal: string,
): CallScript {
  return {
    purpose,
    openingLine,
    systemPrompt:
      goal +
      " Never claim to be human, invent a quote, agree to outside payment, or reveal the customer phone. End immediately if the party objects. Recording requires an explicit yes.",
    maxSeconds: { quote: 180, confirm: 120, completion: 60 }[purpose],
  };
}
export type CallEvent =
  { type: "status"; status: string } | { type: "line"; line: TranscriptLine };
export const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Call timeout"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Call timeout"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
export class MockTelephony implements Telephony {
  readonly sms: { to: string; body: string }[] = [];
  async placeCall(a: PlaceCallArgs) {
    if (!/^\+[1-9]\d{7,14}$/.test(a.to)) throw new Error("E.164 required");
    if (!a.script.openingLine.startsWith("Hi, this is an AI assistant"))
      throw new Error("Disclosure required");
    return { providerSid: "MOCK-CA-" + a.callId };
  }
  async sendSms(to: string, body: string) {
    this.sms.push({ to, body });
  }
  async conversation(
    a: PlaceCallArgs,
    partyLines: string[],
    emit: (event: CallEvent) => Promise<void>,
    delay = 350,
    signal?: AbortSignal,
  ) {
    const local = AbortSignal.timeout(a.script.maxSeconds * 1000);
    const combined = signal ? AbortSignal.any([signal, local]) : local;
    await this.placeCall(a);
    await emit({ type: "status", status: "ringing" });
    await wait(delay, combined);
    await emit({ type: "status", status: "in_progress" });
    await emit({
      type: "line",
      line: {
        speaker: "agent",
        text: a.script.openingLine,
        at: new Date().toISOString(),
      },
    });
    for (const text of partyLines) {
      await wait(delay, combined);
      await emit({
        type: "line",
        line: { speaker: "party", text, at: new Date().toISOString() },
      });
    }
    await emit({ type: "status", status: "completed" });
  }
}
export async function parallelCalls<T>(
  tasks: ((signal: AbortSignal) => Promise<T>)[],
  maxMs = 240000,
) {
  if (tasks.length > 6) throw new Error("Maximum six businesses");
  const signal = AbortSignal.timeout(maxMs);
  return Promise.allSettled(
    tasks.map(
      (task) =>
        new Promise<T>((resolve, reject) => {
          const abort = () => reject(new Error("Overall call timeout"));
          signal.addEventListener("abort", abort, { once: true });
          void task(signal)
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", abort));
        }),
    ),
  );
}
export function smsTemplate(
  kind: "booking_confirmed" | "not_selected" | "paid",
  a: {
    slot?: string;
    location?: string;
    amount?: string;
    email?: string;
    date?: string;
  },
) {
  if (kind === "not_selected")
    return "Switchboard: thanks for your quote today. The customer has chosen another provider this time.";
  if (kind === "paid") {
    if (!a.amount || !a.email || !a.date) throw new Error("Missing SMS fields");
    return `Switchboard: $${a.amount} has been sent to ${a.email} via PayPal for the job on ${a.date}.`;
  }
  if (!a.slot || !a.location || !a.amount)
    throw new Error("Missing SMS fields");
  return `Switchboard: booking confirmed for ${a.slot} at ${a.location}. $${a.amount} is held by PayPal and paid to you when the customer confirms the job is done.`;
}
export function businessHours(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Harare",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return hour >= 7 && hour < 19;
}
