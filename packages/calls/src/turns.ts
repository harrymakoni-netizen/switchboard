import twilio from "twilio";
import { z } from "zod";
import { openingLine } from "./index";

export const voicePlanSchema = z.object({
  purpose: z.enum(["quote", "confirm", "completion"]),
  task: z.string().min(1).max(500),
  location: z.string().min(1).max(300),
  window: z.string().min(1).max(300),
  price: z.string().optional(),
  slot: z.string().optional(),
  maxSeconds: z.number().int().min(1).max(180),
});
export type VoicePlan = z.infer<typeof voicePlanSchema>;
export const voiceStateSchema = z.object({
  plan: voicePlanSchema,
  phase: z.enum([
    "start",
    "consent",
    "price",
    "slot",
    "includes",
    "accept",
    "email",
    "email-check",
    "completion",
    "done",
  ]),
  turn: z.number().int().min(0).max(10),
  attempts: z.number().int().min(0).max(3),
  email: z.string().email().optional(),
  result: z
    .object({
      declined: z.boolean(),
      confirmed: z.boolean().optional(),
      payoutEmail: z.string().email().optional(),
      done: z.boolean().optional(),
    })
    .optional(),
});
export type VoiceState = z.infer<typeof voiceStateSchema>;
export function startVoice(plan: VoicePlan): VoiceState {
  return {
    plan: voicePlanSchema.parse(plan),
    phase: "start",
    turn: 0,
    attempts: 0,
  };
}
export function spokenEmail(text: string) {
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(
      /^(?:my (?:paypal )?email(?: address)? is|the email(?: address)? is|it is|it's)\s+/i,
      "",
    )
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+(?:hyphen|dash)\s+/g, "-")
    .replace(/\s+underscore\s+/g, "_")
    .replace(/\s+/g, "")
    .replace(/[.!?]+$/, "");
  const parsed = z.string().email().max(254).safeParse(normalized);
  return parsed.success ? parsed.data : undefined;
}
const yes = (text: string, digit?: string) =>
  digit === "1" ||
  (/^(yes|sure|okay|ok|correct|that is correct|go ahead)\b/i.test(
    text.trim(),
  ) &&
    !/\b(but|instead|different|however)\b/i.test(text));
const no = (text: string, digit?: string) =>
  digit === "2" ||
  /^(no[.!\s]*$|no thanks|not now|(?:please )?stop[.!\s]*$)|\b(stop calling|do not call|want a human|(?:speak|talk) (?:to|with) a human|not interested|too busy|cannot take|can't take|cannot help|can't help)\b/i.test(
    text.trim(),
  );
export function hangupXml(message = "Thank you. Goodbye.") {
  const response = new twilio.twiml.VoiceResponse();
  response.say(message);
  response.hangup();
  return response.toString();
}
export function advanceVoice(
  previous: VoiceState,
  speech: string,
  digits: string | undefined,
  actionUrl: (turn: number) => string,
) {
  const state: VoiceState = structuredClone(voiceStateSchema.parse(previous));
  const party = speech.trim().slice(0, 2000);
  const finish = (
    message: string,
    result: NonNullable<VoiceState["result"]>,
  ) => {
    state.phase = "done";
    state.result = result;
    return { state, xml: hangupXml(message), prompt: message, party };
  };
  const ask = (phase: VoiceState["phase"], prompt: string) => {
    state.phase = phase;
    state.turn++;
    const response = new twilio.twiml.VoiceResponse();
    response
      .gather({
        input: ["speech", "dtmf"],
        numDigits: 1,
        action: actionUrl(state.turn),
        method: "POST",
        actionOnEmptyResult: true,
        timeout: 5,
        speechTimeout: "auto",
        language: "en-US",
      })
      .say(prompt);
    response.say("We did not hear a response. No booking has been made.");
    response.hangup();
    return { state, xml: response.toString(), prompt, party };
  };
  if (state.phase === "done")
    return { state, xml: hangupXml(), prompt: "", party: "" };
  if (state.turn >= 8)
    return finish("We could not finish verification. Thank you. Goodbye.", {
      declined: true,
    });
  if (state.phase !== "start" && no(party, digits)) {
    if (state.phase === "email-check" && state.attempts++ === 0)
      return ask(
        "email",
        "Please spell the correct PayPal email address, saying at and dot.",
      );
    if (state.phase === "completion")
      return finish("Thank you. The customer can review this in Switchboard.", {
        declined: false,
        done: false,
      });
    return finish("Thank you. I will let the customer know. Goodbye.", {
      declined: true,
      confirmed: false,
    });
  }
  if (state.phase === "start")
    return ask(
      "consent",
      openingLine +
        " I will use speech recognition to note your answers. Audio recording is off. Say yes or press 1 to continue; say no or press 2 to decline.",
    );
  if (state.phase === "consent") {
    if (!yes(party, digits)) {
      if (state.attempts++ === 0)
        return ask(
          "consent",
          "May this AI assistant ask a quick question? Say yes or press 1, or no or press 2.",
        );
      return finish("We could not confirm permission to continue. Goodbye.", {
        declined: true,
      });
    }
    state.attempts = 0;
    if (state.plan.purpose === "quote")
      return ask(
        "price",
        `What is your total price in US dollars to ${state.plan.task} in ${state.plan.location}? The requested time is ${state.plan.window}. Please quote the full price including any parts and labour.`,
      );
    if (state.plan.purpose === "confirm") {
      if (!state.plan.price || !state.plan.slot)
        return finish("The booking details are incomplete. Goodbye.", {
          declined: true,
        });
      return ask(
        "accept",
        `The customer selected your quote of ${state.plan.price} US dollars for ${state.plan.slot}. Payment is held by PayPal and released when the customer confirms the job is done. Can you confirm this exact price and time? Say yes or press 1, or no or press 2.`,
      );
    }
    return ask(
      "completion",
      "Has the job been done and is everything working? Say yes or press 1, or no or press 2.",
    );
  }
  if (state.phase === "price")
    return ask(
      "slot",
      "What is your earliest available date and time? Please give the full date and time in Harare local time.",
    );
  if (state.phase === "slot")
    return ask(
      "includes",
      "What is included in that price, and what guarantee do you offer?",
    );
  if (state.phase === "includes")
    return finish(
      "Thank you for your quote. The customer will review it and choose a provider. No booking has been made by this call. Goodbye.",
      { declined: false },
    );
  if (state.phase === "accept") {
    if (yes(party, digits))
      return ask(
        "email",
        "What PayPal email address should receive the payment after the customer confirms completion? Please spell it, saying at and dot.",
      );
    if (state.attempts++ === 0)
      return ask(
        "accept",
        "Please confirm the exact price and time just stated. Say yes or press 1, or no or press 2.",
      );
    return finish("We could not verify the booking. Goodbye.", {
      declined: true,
      confirmed: false,
    });
  }
  if (state.phase === "email") {
    state.email = spokenEmail(party);
    if (!state.email) {
      if (state.attempts++ === 0)
        return ask(
          "email",
          "I could not understand that email. Please spell it, saying at and dot.",
        );
      return finish("We could not verify the payment email. Goodbye.", {
        declined: true,
        confirmed: false,
      });
    }
    return ask(
      "email-check",
      "I heard " +
        state.email
          .split("")
          .map((c) => (c === "@" ? " at " : c === "." ? " dot " : c))
          .join(" ") +
        ". Is that correct? Say yes or press 1, or no or press 2.",
    );
  }
  if (state.phase === "email-check" && yes(party, digits))
    return finish(
      "Thank you. The booking details are confirmed. Payment remains held until the customer confirms the work is done. Goodbye.",
      { declined: false, confirmed: true, payoutEmail: state.email },
    );
  if (state.phase === "completion" && yes(party, digits))
    return finish(
      "Thank you. Please confirm completion in Switchboard to release the payment.",
      { declined: false, done: true },
    );
  return finish(
    "We could not verify your answer. Please review this in Switchboard. Goodbye.",
    { declined: true, confirmed: false },
  );
}
