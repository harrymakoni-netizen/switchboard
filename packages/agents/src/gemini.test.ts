import { afterEach, describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  GeminiLLM,
  plan,
  extract,
  findBusinesses,
  foundBusinessSchema,
} from "./index";
import { DEFAULT_GEMINI_MODEL } from "@switchboard/shared";

function transport(outputs: (string | Response)[]) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    const output = outputs[Math.min(requests.length - 1, outputs.length - 1)];
    if (output instanceof Response) return output;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: { role: "model", parts: [{ text: output }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 10,
          totalTokenCount: 20,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { requests, fetcher };
}
afterEach(() => vi.unstubAllEnvs());
describe("Gemini provider contract", () => {
  it("requests validated JSON directly from Google with the selected model", async () => {
    const t = transport(['{"name":"QuickFix"}']);
    const llm = new GeminiLLM({ apiKey: "test-google-key", fetch: t.fetcher });
    expect(
      await llm.json({
        system: "Use only supplied facts.",
        user: "Untrusted source text",
        schema: z.object({ name: z.string() }),
        maxTokens: 900,
      }),
    ).toEqual({ name: "QuickFix" });
    expect(t.requests).toHaveLength(1);
    const req = t.requests[0];
    expect(req.url).toContain("generativelanguage.googleapis.com");
    expect(req.url).toContain(DEFAULT_GEMINI_MODEL + ":generateContent");
    expect(new Headers(req.init.headers).get("x-goog-api-key")).toBe(
      "test-google-key",
    );
    const body = JSON.parse(String(req.init.body));
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      maxOutputTokens: 900,
      thinkingConfig: { thinkingLevel: "low" },
    });
    expect(body.generationConfig.responseJsonSchema.properties.name.type).toBe(
      "string",
    );
    expect(body.systemInstruction.parts[0].text).toContain(
      "Use only supplied facts.",
    );
  });
  it("supports planner union responses with exactly one follow-up", async () => {
    const t = transport(['{"followUpQuestion":"Where is the repair?"}']);
    const result = await plan(
      new GeminiLLM({ apiKey: "test", fetch: t.fetcher }),
      "Fix the geyser",
      new Date("2026-11-03T10:00:00Z"),
    );
    expect(result).toEqual({ followUpQuestion: "Where is the repair?" });
    const body = JSON.parse(String(t.requests[0].init.body));
    expect(body.generationConfig.responseJsonSchema.anyOf).toHaveLength(2);
    expect(body.contents[0].parts[0].text).toContain(
      "<untrusted_data>Fix the geyser</untrusted_data>",
    );
  });
  it("validates complete job briefs", async () => {
    const brief = {
      task: "Repair geyser",
      category: "home_repair",
      location: "Avondale",
      windowStart: "2026-11-04T07:00:00+02:00",
      windowEnd: "2026-11-04T19:00:00+02:00",
      budgetCents: 12000,
      currency: "USD",
    };
    const t = transport([JSON.stringify(brief)]);
    expect(
      await plan(
        new GeminiLLM({ apiKey: "test", fetch: t.fetcher }),
        "Fix Mum’s geyser in Avondale tomorrow, under $120",
      ),
    ).toEqual(brief);
  });
  it("preserves nullable quote fields and extraction guards", async () => {
    const quote = {
      price_cents: null,
      currency: "USD",
      earliest_slot: null,
      includes: [],
      guarantee: null,
      willing_to_negotiate: null,
      declined: false,
      confidence: 0.3,
    };
    const t = transport([JSON.stringify(quote)]);
    expect(
      await extract(
        new GeminiLLM({ apiKey: "test", fetch: t.fetcher }),
        "We need to inspect it first.",
      ),
    ).toEqual(quote);
    const body = JSON.parse(String(t.requests[0].init.body));
    expect(body.systemInstruction.parts[0].text).toContain(
      "Never invent a price",
    );
    expect(body.systemInstruction.parts[0].text).toContain(
      "Do not choose recipients or execute payments",
    );
  });
  it("validates business-array outputs and E.164 phones", async () => {
    const businesses = [1, 2, 3].map((n) => ({
      name: "Business " + n,
      phone: "+26377100000" + n,
      rating: null,
      sourceUrl: null,
    }));
    const t = transport([JSON.stringify(businesses)]);
    const brief = {
      task: "repair",
      category: "home_repair" as const,
      location: "Avondale",
      windowStart: "2026-11-04T07:00:00+02:00",
      windowEnd: "2026-11-04T19:00:00+02:00",
      budgetCents: 12000,
      currency: "USD" as const,
    };
    expect(
      await findBusinesses(
        new GeminiLLM({ apiKey: "test", fetch: t.fetcher }),
        brief,
        "Directory evidence",
      ),
    ).toEqual(businesses);
    expect(() =>
      foundBusinessSchema.parse({ ...businesses[0], phone: "not a phone" }),
    ).toThrow();
  });
  it.each(["not JSON", '{"price":"invented"}'])(
    "retries invalid output once: %s",
    async (invalid) => {
      const t = transport([invalid, '{"value":7}']);
      const llm = new GeminiLLM({ apiKey: "test", fetch: t.fetcher });
      expect(
        await llm.json({
          system: "Return a number.",
          user: "source",
          schema: z.object({ value: z.number() }),
        }),
      ).toEqual({ value: 7 });
      expect(t.requests).toHaveLength(2);
      expect(String(t.requests[1].init.body)).toContain(
        "prior output failed validation",
      );
    },
  );
  it("fails closed after two invalid outputs", async () => {
    const t = transport(['{"value":"invalid"}']);
    await expect(
      new GeminiLLM({ apiKey: "test", fetch: t.fetcher }).json({
        system: "Number only.",
        user: "source",
        schema: z.object({ value: z.number() }),
      }),
    ).rejects.toThrow(/after two attempts/);
    expect(t.requests).toHaveLength(2);
  });
  it("uses the fallback model for a temporary outage with the same validated schema", async () => {
    const t = transport([
      new Response(
        JSON.stringify({
          error: { code: 503, message: "High demand", status: "UNAVAILABLE" },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
      '{"ok":true}',
    ]);
    await expect(
      new GeminiLLM({ apiKey: "test", fetch: t.fetcher }).json({
        system: "test",
        user: "source",
        schema: z.object({ ok: z.boolean() }),
      }),
    ).resolves.toEqual({ ok: true });
    expect(t.requests).toHaveLength(2);
    expect(t.requests[0].url).toContain(DEFAULT_GEMINI_MODEL);
    expect(t.requests[1].url).toContain("gemini-3.5-flash-lite");
    expect(JSON.parse(String(t.requests[1].init.body))).toEqual(
      JSON.parse(String(t.requests[0].init.body)),
    );
  });
  it("stops after the fallback model also fails", async () => {
    const t = transport(
      [503, 503].map(
        (status) =>
          new Response(
            JSON.stringify({
              error: {
                code: status,
                message: "High demand",
                status: "UNAVAILABLE",
              },
            }),
            { status, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await expect(
      new GeminiLLM({ apiKey: "test", fetch: t.fetcher }).json({
        system: "test",
        user: "source",
        schema: z.object({ ok: z.boolean() }),
      }),
    ).rejects.toThrow(
      "Gemini request failed. Check server configuration or retry.",
    );
    expect(t.requests).toHaveLength(2);
  });
  it.each([400, 401, 403, 429])(
    "does not switch models for HTTP %s",
    async (status) => {
      const t = transport([
        new Response(
          JSON.stringify({
            error: {
              code: status,
              message: "test upstream detail",
              status: "PERMISSION_DENIED",
            },
          }),
          { status, headers: { "content-type": "application/json" } },
        ),
      ]);
      await expect(
        new GeminiLLM({ apiKey: "test", fetch: t.fetcher }).json({
          system: "test",
          user: "source",
          schema: z.object({ ok: z.boolean() }),
        }),
      ).rejects.toThrow(
        "Gemini request failed. Check server configuration or retry.",
      );
      expect(t.requests).toHaveLength(1);
    },
  );
  it("allows a model override and requires a Gemini key", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(() => new GeminiLLM()).toThrow(/GEMINI_API_KEY/);
    expect(
      new GeminiLLM({ apiKey: "test", modelId: "gemini-custom" }).modelId,
    ).toBe("gemini-custom");
  });
});
