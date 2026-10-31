import { it, expect } from "vitest";
import { MockTelephony, parallelCalls, script, smsTemplate } from "./index";
import { MockLLM, extract } from "@switchboard/agents";
import { bots } from "@switchboard/bots";
const brief = {
  task: "repair",
  category: "home_repair" as const,
  location: "Avondale",
  windowStart: "2026-11-01T07:00:00+02:00",
  windowEnd: "2026-11-01T19:00:00+02:00",
  budgetCents: 12000,
  currency: "USD" as const,
};
it("starts three calls together, with disclosure, producing two quotes and a decline", async () => {
  const tel = new MockTelephony();
  const starts: number[] = [];
  const results = await parallelCalls(
    bots(brief).map((bot, i) => async (signal) => {
      starts.push(Date.now());
      const lines: string[] = [];
      let first = "";
      await tel.conversation(
        {
          callId: String(i),
          to: bot.phone,
          script: script("quote", "Get quote"),
        },
        bot.lines,
        async (e) => {
          if (e.type === "line") {
            if (!first) first = e.line.text;
            if (e.line.speaker === "party") lines.push(e.line.text);
          }
        },
        5,
        signal,
      );
      expect(first).toContain("AI assistant");
      return extract(new MockLLM(), lines.join("\n"));
    }),
  );
  expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(5000);
  const values = results.flatMap((r) =>
    r.status === "fulfilled" ? [r.value] : [],
  );
  expect(values.filter((q) => q.price_cents !== null)).toHaveLength(2);
  expect(values.filter((q) => q.declined)).toHaveLength(1);
});
it("one failed call does not stop others and timeouts abort", async () => {
  const results = await parallelCalls(
    [
      async () => {
        throw new Error("no answer");
      },
      async (signal) => {
        await new Promise((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
        throw new Error("timeout");
      },
      async () => 42,
    ],
    10,
  );
  expect(results.map((r) => r.status)).toEqual([
    "rejected",
    "rejected",
    "fulfilled",
  ]);
});
it("fixed SMS templates require fields", () => {
  expect(() => smsTemplate("paid", {})).toThrow();
  expect(
    smsTemplate("booking_confirmed", {
      amount: "110.00",
      slot: "tomorrow",
      location: "Avondale",
    }),
  ).toContain("$110.00 is held");
});
