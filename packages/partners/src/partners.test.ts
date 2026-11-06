import { describe, it, expect, vi } from "vitest";
import Kernel from "@onkernel/sdk";
import type { LLM } from "@switchboard/agents";
import {
  briefSchema,
  publicUrl,
  partnerResearchSchema,
} from "@switchboard/shared";
import { KernelDirectory, directoryUrl, discoverBusinesses } from "./kernel";
import { searchPartPrices } from "./channel3";
import { researchJob, safeResearchFailure } from "./research";
import { DirectoryResearchError } from "./kernel";
const brief = briefSchema.parse({
  task: "Replace geyser element",
  category: "home_repair",
  location: "Avondale",
  budgetCents: 12000,
  currency: "USD",
  windowStart: "2026-11-10T08:00:00Z",
  windowEnd: "2026-11-10T18:00:00Z",
  partHint: "water heater element",
});
const template =
  "https://directory.example.org/search?q={query}&area={location}";
const candidate = {
  name: "Evidence Plumbing",
  phone: "+263771234567",
  rating: 4.8,
  sourceUrl: "https://directory.example.org/evidence",
};
const page = {
  url: directoryUrl(template, brief),
  text: "Evidence Plumbing\nCall 077 123 4567\nAnother Firm +263771234568",
  links: [candidate.sourceUrl],
};
const llm: LLM = { json: async (a) => a.schema.parse([candidate]) };
const offer = (
  price: number,
  currency = "USD",
  url = "https://merchant.example.org/part",
) => ({
  url,
  domain: "merchant.example.org",
  availability: "InStock",
  price: { price, currency },
});
const fetchProducts =
  (products: unknown[]): typeof fetch =>
  async () =>
    Response.json({ products });
describe("Kernel discovery", () => {
  it("encodes user input without changing the configured host", () => {
    const url = new URL(
      directoryUrl(template, { ...brief, task: "element &other=1 ` ${bad}" }),
    );
    expect(url.hostname).toBe("directory.example.org");
    expect(url.searchParams.get("other")).toBeNull();
    expect(url.searchParams.get("q")).toContain("&other=1");
  });
  it.each([
    "http://directory.example.org?q={query}&l={location}",
    "https://127.0.0.1?q={query}&l={location}",
    "https://user:pass@directory.example.org?q={query}&l={location}",
    "https://directory.example.org/search?q={query}",
  ])("rejects invalid directory templates %s", (value) => {
    expect(() => directoryUrl(value, brief)).toThrow();
  });
  it("accepts a fixed public directory without pretending it performs a search", () => {
    const source = "https://www.zimbabweyp.com/category/plumbers/city:Harare";
    expect(directoryUrl(source, brief)).toBe(source);
  });
  it("creates a bounded browser, reads with fixed code, and always deletes the session", async () => {
    const calls: {
      method: string;
      path: string;
      body: Record<string, unknown>;
    }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      calls.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: request.method === "POST" ? await request.json() : {},
      });
      return Response.json(
        calls.length === 1
          ? { session_id: "session-123" }
          : request.method === "DELETE"
            ? {}
            : { success: true, result: page },
      );
    };
    const browser = new KernelDirectory(
      new Kernel({ apiKey: "test-kernel", fetch: fetcher, maxRetries: 0 }),
    );
    const result = await browser.read(page.url);
    expect(result.sessionId).toBe("session-123");
    expect(calls[0].body).toMatchObject({
      timeout_seconds: 90,
      network: { allowed_hosts: ["directory.example.org"] },
    });
    expect(calls[1].body.code).toContain("page.goto(");
    expect(calls[2].method).toBe("DELETE");
  });
  it("deletes the browser when extraction fails", async () => {
    const methods: string[] = [];
    const client = new Kernel({
      apiKey: "test-kernel",
      maxRetries: 0,
      fetch: async (input, init) => {
        const req = new Request(input, init);
        methods.push(req.method);
        return Response.json(
          methods.length === 1
            ? { session_id: "session-fail" }
            : { success: false },
        );
      },
    });
    await expect(new KernelDirectory(client).read(page.url)).rejects.toThrow(
      "read failed",
    );
    expect(methods.at(-1)).toBe("DELETE");
  });
  it("keeps supported identities, source URLs and session evidence, without invented ratings", async () => {
    const result = await discoverBusinesses(
      brief,
      template,
      { read: async () => ({ sessionId: "proof", page }) },
      llm,
    );
    expect(result.businesses).toEqual([{ ...candidate, rating: null }]);
    expect(result.sessionId).toBe("proof");
  });
  it("rejects invented businesses, unsupported contacts and source links", async () => {
    const bad: LLM = {
      json: async (a) =>
        a.schema.parse([
          { ...candidate, name: "Invented Firm" },
          { ...candidate, phone: "+263779999999" },
          { ...candidate, sourceUrl: "https://madeup.example.org/listing" },
        ]),
    };
    const result = await discoverBusinesses(
      brief,
      template,
      { read: async () => ({ sessionId: "proof", page }) },
      bad,
    );
    expect(result.businesses).toEqual([]);
  });
  it("accepts an empty extraction rather than inventing three businesses", async () => {
    const empty: LLM = { json: async (a) => a.schema.parse([]) };
    const result = await discoverBusinesses(
      brief,
      template,
      { read: async () => ({ sessionId: "proof", page }) },
      empty,
    );
    expect(result.businesses).toEqual([]);
  });
});
describe("Direct directory listings", () => {
  const url = "https://www.zimbabweyp.com/category/plumbers/city:Harare";
  const listing = {
    name: "Evidence Plumbing",
    phone: "077 123 4567",
    address: "Avondale, Harare",
    sourceUrl: "https://www.zimbabweyp.com/company/123/Evidence_Plumbing",
  };
  const evidence = {
    url,
    text: "Evidence Plumbing\nAvondale, Harare\n077 123 4567",
    links: [listing.sourceUrl],
    listings: [listing],
  };
  it("reads evidenced cards without consuming another Gemini request", async () => {
    const json = vi.fn();
    const model: LLM = {
      json: async () => {
        json();
        throw new Error("quota exhausted");
      },
    };
    const result = await discoverBusinesses(
      brief,
      url,
      { read: async () => ({ sessionId: "live-proof", page: evidence }) },
      model,
    );
    expect(result.businesses).toEqual([
      { ...candidate, sourceUrl: listing.sourceUrl, rating: null },
    ]);
    expect(result.extractionMethod).toBe("directory-listings");
    expect(json).not.toHaveBeenCalled();
  });
  it("does not treat other trades or cities as supported by this source", async () => {
    const json = vi.fn();
    const model: LLM = {
      json: async (a) => {
        json();
        return a.schema.parse([]);
      },
    };
    await discoverBusinesses(
      { ...brief, task: "Repair a roof", location: "Bulawayo" },
      url,
      { read: async () => ({ sessionId: "proof", page: evidence }) },
      model,
    );
    expect(json).toHaveBeenCalledOnce();
  });
  it("rejects unsupported contacts, profiles and out-of-area cards", async () => {
    const json = vi.fn();
    const model: LLM = {
      json: async () => {
        json();
        throw new Error("must not call model");
      },
    };
    const result = await discoverBusinesses(
      brief,
      url,
      {
        read: async () => ({
          sessionId: "proof",
          page: {
            ...evidence,
            listings: [
              { ...listing, phone: "+263779999999" },
              { ...listing, sourceUrl: "https://madeup.example.org/profile" },
              { ...listing, address: "Bulawayo" },
            ],
          },
        }),
      },
      model,
    );
    expect(result.businesses).toEqual([]);
    expect(json).not.toHaveBeenCalled();
  });
});
describe("Channel3 advisory prices", () => {
  it("translates geyser searches and excludes unrelated oven or infrared parts", async () => {
    const fetcher = vi.fn(
      fetchProducts([
        {
          id: "heater",
          title: "Water Heater Immersion Element",
          offers: [offer(25)],
        },
        { id: "oven", title: "Oven Heating Element", offers: [offer(100)] },
        {
          id: "infrared",
          title: "Quartz Infrared Replacement Heating Element",
          offers: [offer(140)],
        },
      ]),
    );
    const result = await searchPartPrices(
      "geyser heating element",
      "test",
      fetcher,
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).query).toBe(
      "water heater heating element",
    );
    expect(result.offers.map((o) => o.productId)).toEqual(["heater"]);
    expect(result.medianCents).toBe(2500);
  });

  it("uses the real endpoint, private key header, USD locale and timeout", async () => {
    const fetcher = vi.fn(fetchProducts([]));
    await searchPartPrices("water heater element", "test-channel3", fetcher);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.trychannel3.com/v1/search");
    expect(new Headers(init?.headers).get("x-api-key")).toBe("test-channel3");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      query: "water heater element",
      config: { currency: "USD", country: "US" },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it("computes an integer-cent median with one lowest offer per distinct product", async () => {
    const result = await searchPartPrices(
      "element",
      "test",
      fetchProducts([
        { id: "a", title: "A", offers: [offer(50), offer(30)] },
        { id: "b", title: "B", offers: [offer(40)] },
        { id: "a", title: "duplicate", offers: [offer(1)] },
      ]),
    );
    expect(result.medianCents).toBe(3500);
    expect(result.offers).toHaveLength(2);
  });
  it("excludes non-USD, zero, unsafe, unavailable and invalid offers", async () => {
    const result = await searchPartPrices(
      "element",
      "test",
      fetchProducts([
        {
          id: "a",
          title: "A",
          offers: [
            offer(30, "ZAR"),
            offer(0),
            offer(20, "USD", "javascript:alert(1)"),
            { ...offer(10), availability: "OutOfStock" },
          ],
        },
      ]),
    );
    expect(result.offers).toEqual([]);
    expect(result.medianCents).toBeNull();
  });
  it("does not replace provider failure with fake prices", async () => {
    await expect(
      searchPartPrices(
        "element",
        "test",
        async () => new Response("secret response", { status: 401 }),
      ),
    ).rejects.toThrow("Channel3 HTTP 401");
    await expect(
      searchPartPrices("element", "test", async () =>
        Response.json({ wrong: [] }),
      ),
    ).rejects.toThrow();
  });
});
describe("Independent optional research", () => {
  it("runs offline and labels all illustrative evidence", async () => {
    const data = await researchJob(
      brief,
      { PARTNER_RESEARCH_MODE: "mock" },
      llm,
    );
    expect(partnerResearchSchema.parse(data).kernel.mode).toBe("mock");
    expect(data.channel3.data?.medianCents).toBe(3500);
  });
  it("reports missing configuration without any network calls", async () => {
    const fetcher = vi.fn();
    const data = await researchJob(
      brief,
      { PARTNER_RESEARCH_MODE: "live" },
      llm,
      { fetcher },
    );
    expect(data.kernel.status).toBe("unavailable");
    expect(data.channel3.status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps successful price research when directory research fails, without leaking errors", async () => {
    const data = await researchJob(
      brief,
      {
        PARTNER_RESEARCH_MODE: "live",
        KERNEL_API_KEY: "test",
        CHANNEL3_API_KEY: "test",
        DIRECTORY_URL_TEMPLATE: template,
      },
      llm,
      {
        browser: {
          read: async () => {
            throw new Error("secretkey and cdp url");
          },
        },
        fetcher: fetchProducts([{ id: "a", title: "A", offers: [offer(35)] }]),
      },
    );
    expect(data.kernel.status).toBe("failed");
    expect(data.channel3.status).toBe("complete");
    expect(JSON.stringify(data)).not.toContain("secretkey");
  });
  it("never guesses a replacement part when the brief has no part hint", async () => {
    const fetcher = vi.fn();
    const data = await researchJob(
      { ...brief, partHint: null },
      { PARTNER_RESEARCH_MODE: "live", CHANNEL3_API_KEY: "test" },
      llm,
      { fetcher },
    );
    expect(data.channel3.status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    "javascript:alert(1)",
    "https://localhost/foo",
    "https://169.254.169.254/foo",
    "https://[::1]/foo",
    "https://user:password@merchant.example.org/foo",
  ])("rejects unsafe source %s", (url) => {
    expect(publicUrl.safeParse(url).success).toBe(false);
  });
});

describe("Redacted research diagnostics", () => {
  it("keeps stage and numeric HTTP status without storing messages or provider data", () => {
    const cause = Object.assign(
      new Error("secret key and upstream request body"),
      { name: "APIError", status: 401 },
    );
    const result = safeResearchFailure(
      new DirectoryResearchError("browser", cause),
    );
    expect(result).toEqual({
      stage: "browser",
      errorClass: "APIError",
      httpStatus: 401,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("identifies model failures separately from browser failures", () => {
    const cause = Object.assign(new Error("private prompt"), {
      name: "APICallError",
      statusCode: 429,
    });
    expect(
      safeResearchFailure(
        new DirectoryResearchError(
          "extraction",
          new Error("wrapper", { cause }),
        ),
      ),
    ).toEqual({
      stage: "extraction",
      errorClass: "APICallError",
      httpStatus: 429,
    });
  });
  it("rejects unbounded error names and invalid status values", () => {
    const error = Object.assign(new Error("private"), {
      name: "unsafe-key-in-name!",
      status: 999,
    });
    expect(safeResearchFailure(error)).toEqual({
      stage: "lookup",
      errorClass: "UnknownError",
    });
  });
});
