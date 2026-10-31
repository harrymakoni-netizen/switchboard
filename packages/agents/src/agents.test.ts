import { it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { MockLLM, extract, plan } from "./index";
const fixtures = new URL(
  "../../../tests/fixtures/transcripts/",
  import.meta.url,
);
for (const file of readdirSync(fixtures))
  it("extracts " + file, async () => {
    const f = JSON.parse(readFileSync(new URL(file, fixtures), "utf8")) as {
      text: string;
      expected: number | null;
    };
    const q = await extract(new MockLLM(), f.text);
    expect(q.price_cents).toBe(f.expected);
    if (file === "range.json") expect(q.confidence).toBeLessThan(0.7);
  });
it("asks exactly one missing-field question", async () => {
  const r = await plan(new MockLLM(), "Fix geyser");
  expect(r).toEqual({ followUpQuestion: expect.any(String) });
});
it("plans the example in Harare time", async () => {
  const r = await plan(
    new MockLLM(),
    "Fix Mum’s geyser in Avondale tomorrow, under $120",
    new Date("2026-10-31T12:00:00Z"),
  );
  expect(r).toMatchObject({
    location: "Avondale",
    budgetCents: 12000,
    windowStart: "2026-11-01T07:00:00+02:00",
  });
});
