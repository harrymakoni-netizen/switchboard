import { it, expect } from "vitest";
import {
  startVoice,
  advanceVoice,
  spokenEmail,
  type VoiceState,
} from "./turns";
const action = (turn: number) =>
  `https://worker.example/webhooks/twilio/voice/test/${turn}`;
function step(state: VoiceState, speech = "", digit?: string) {
  return advanceVoice(state, speech, digit, action);
}
function initial(purpose: "quote" | "confirm" = "quote") {
  return startVoice({
    purpose,
    task: "repair a geyser <unsafe>",
    location: "Avondale",
    window: "tomorrow",
    price: "95.00",
    slot: "5 November at 9 AM",
    maxSeconds: 120,
  });
}
it("starts with AI disclosure and an explicit permission question without recording audio", () => {
  const result = step(initial());
  expect(result.prompt).toMatch(/^Hi, this is an AI assistant/);
  expect(result.xml).toContain("<Gather");
  expect(result.xml).toContain("Audio recording is off");
  expect(result.xml).not.toContain("<Record");
  expect(result.xml).not.toContain("<Stream");
  expect(result.state.phase).toBe("consent");
});
it("collects price, slot and inclusions before ending a quote without booking", () => {
  let s = step(initial()).state;
  s = step(s, "Yes").state;
  expect(s.phase).toBe("price");
  const price = step(s, "95 dollars including labour");
  expect(price.state.phase).toBe("slot");
  const slot = step(price.state, "November 5 at 9 AM");
  expect(slot.state.phase).toBe("includes");
  const end = step(slot.state, "Labour, an element, 30 days warranty");
  expect(end.state.result).toEqual({ declined: false });
  expect(end.xml).toContain("<Hangup");
  expect(end.xml).not.toContain("<Gather");
});
it.each([
  "No thanks",
  "Stop calling",
  "I want a human",
  "We are too busy",
  "Please stop",
  "Can I speak to a human?",
  "Sorry, I cannot help",
])("ends immediately for refusal: %s", (speech) => {
  const result = step(step(initial()).state, speech);
  expect(result.state.result?.declined).toBe(true);
  expect(result.xml).toContain("<Hangup");
});
it("does not interpret an ambiguous yes-but as a confirmed booking", () => {
  let s = step(initial("confirm")).state;
  s = step(s, "yes").state;
  const result = step(s, "yes but a different price");
  expect(result.state.phase).toBe("accept");
  expect(result.state.result?.confirmed).not.toBe(true);
});
it("requires both exact booking acceptance and payout email readback confirmation", () => {
  let s = step(initial("confirm")).state;
  s = step(s, "yes").state;
  s = step(s, "yes").state;
  const email = step(s, "safe at example dot com");
  expect(email.state.email).toBe("safe@example.com");
  expect(email.state.result?.confirmed).not.toBe(true);
  const result = step(email.state, "yes");
  expect(result.state.result).toEqual({
    declined: false,
    confirmed: true,
    payoutEmail: "safe@example.com",
  });
});
it("does not accept an email the business corrected", () => {
  let s = step(initial("confirm")).state;
  s = step(s, "yes").state;
  s = step(s, "yes").state;
  s = step(s, "wrong@example.com").state;
  s = step(s, "no").state;
  expect(s.phase).toBe("email");
  s = step(s, "right@example.com").state;
  expect(step(s, "yes").state.result?.payoutEmail).toBe("right@example.com");
});
it("does not invent a missing or unintelligible payout email", () => {
  let s = step(initial("confirm")).state;
  s = step(s, "yes").state;
  s = step(s, "yes").state;
  s = step(s, "send money elsewhere").state;
  const result = step(s, "I do not know");
  expect(result.state.result?.confirmed).toBe(false);
  expect(result.state.result?.payoutEmail).toBeUndefined();
});
it("caps loops within the trial hop budget", () => {
  const s = initial();
  s.phase = "email";
  s.turn = 8;
  const result = step(s, "invalid");
  expect(result.state.phase).toBe("done");
  expect(result.state.result?.declined).toBe(true);
});
it("escapes service text in generated TwiML", () => {
  const s = step(initial()).state;
  const result = step(s, "yes");
  expect(result.xml).toContain("&lt;unsafe&gt;");
  expect(result.xml).not.toContain("<unsafe>");
});
it("only normalizes an explicitly spoken syntactically valid email", () => {
  expect(spokenEmail("safe underscore test at example dot com")).toBe(
    "safe_test@example.com",
  );
  expect(spokenEmail("cash instead please")).toBeUndefined();
  expect(spokenEmail("My PayPal email is safe at example dot com")).toBe(
    "safe@example.com",
  );
});
