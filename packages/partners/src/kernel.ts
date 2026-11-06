import Kernel from "@onkernel/sdk";
import { z } from "zod";
import {
  publicUrl,
  directoryBusinessSchema,
  type JobBrief,
  type DirectoryEvidence,
} from "@switchboard/shared";
import { findBusinesses, type LLM } from "@switchboard/agents";

const pageEvidenceSchema = z.object({
  url: publicUrl,
  text: z.string().max(40000),
  links: z.array(z.string()).max(200),
  listings: z
    .array(
      z.object({
        name: z.string(),
        phone: z.string(),
        address: z.string(),
        sourceUrl: z.string(),
      }),
    )
    .max(30)
    .optional(),
});
export class DirectoryResearchError extends Error {
  constructor(
    readonly stage: "configuration" | "browser" | "extraction",
    cause: unknown,
  ) {
    super("Directory research failed", { cause });
    this.name = "DirectoryResearchError";
  }
}
async function atStage<T>(
  stage: DirectoryResearchError["stage"],
  run: () => Promise<T> | T,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new DirectoryResearchError(stage, error);
  }
}
export function directoryUrl(template: string, brief: JobBrief) {
  template = template.trim();
  const query = template.includes("{query}");
  const location = template.includes("{location}");
  if (query !== location || /\{(?!query\}|location\})[^}]*\}/.test(template))
    throw new Error(
      "Use a fixed directory URL or include both query and location placeholders",
    );
  return publicUrl.parse(
    template
      .replaceAll("{query}", encodeURIComponent(brief.task.slice(0, 300)))
      .replaceAll(
        "{location}",
        encodeURIComponent(brief.location.slice(0, 200)),
      ),
  );
}
function normalizeZimbabwePhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return "+" + digits;
  if (digits.startsWith("00")) return "+" + digits.slice(2);
  if (digits.startsWith("263")) return "+" + digits;
  if (digits.startsWith("0")) return "+263" + digits.slice(1);
  return "";
}
export interface DirectoryBrowser {
  read(
    url: string,
  ): Promise<{ sessionId: string; page: z.infer<typeof pageEvidenceSchema> }>;
}
export class KernelDirectory implements DirectoryBrowser {
  constructor(
    private client = new Kernel({
      apiKey: process.env.KERNEL_API_KEY?.trim(),
      maxRetries: 0,
      timeout: 45000,
    }),
  ) {}
  async read(url: string) {
    publicUrl.parse(url);
    const session = await this.client.browsers.create({
      timeout_seconds: 90,
      network: { allowed_hosts: [new URL(url).hostname] },
    });
    try {
      // Fixed, read-only code. No page content or LLM output is executed as code.
      const result = await this.client.browsers.playwright.execute(
        session.session_id,
        {
          code: `await page.goto(${JSON.stringify(url)}, {waitUntil: 'domcontentloaded', timeout: 30000});
          const listings = new URL(page.url()).hostname === 'www.zimbabweyp.com'
            ? await page.locator('div.company[data-cmpid]').evaluateAll(cards => cards.slice(0,30).map(card => ({
              name: card.querySelector('h3 a')?.textContent?.trim() || '',
              sourceUrl: card.querySelector('h3 a')?.href || '',
              phone: card.querySelector('.fa-phone')?.parentElement?.textContent?.trim() || '',
              address: card.querySelector('.address')?.textContent?.trim() || ''
            }))) : [];
          return {url: page.url(), text: (await page.locator('body').innerText()).slice(0,40000), listings,
          links: await page.locator('a[href]').evaluateAll(as => as.slice(0,200).map(a => a.href))};`,
        },
      );
      if (!result.success) throw new Error("Kernel directory read failed");
      return {
        sessionId: session.session_id,
        page: pageEvidenceSchema.parse(result.result),
      };
    } finally {
      // The inactivity timeout is the final bound even if the cleanup request fails.
      await this.client.browsers
        .deleteByID(session.session_id)
        .catch(() => undefined);
    }
  }
}
export async function discoverBusinesses(
  brief: JobBrief,
  template: string,
  browser: DirectoryBrowser,
  llm: LLM,
): Promise<DirectoryEvidence> {
  const url = await atStage("configuration", () =>
    directoryUrl(template, brief),
  );
  const { sessionId, page } = await atStage("browser", () => browser.read(url));
  const evidence = pageEvidenceSchema.parse(page);
  if (new URL(evidence.url).hostname !== new URL(url).hostname)
    throw new Error("Directory redirected outside the configured host");
  const allowed = new Set([
    evidence.url,
    ...evidence.links.filter((link) => publicUrl.safeParse(link).success),
  ]);
  const source = new URL(evidence.url);
  const structured =
    source.hostname === "www.zimbabweyp.com" &&
    decodeURIComponent(source.pathname).toLowerCase() ===
      "/category/plumbers/city:harare" &&
    /geyser|plumb|water[ -]?heater/i.test(brief.task) &&
    /harare|avondale/i.test(brief.location) &&
    Boolean(evidence.listings?.length);
  // Read the directory's actual listing cards; no model or synthetic fallback is needed.
  const found = structured
    ? evidence
        .listings!.filter((item) => /harare/i.test(item.address))
        .map((item) => ({
          name: item.name,
          phone: normalizeZimbabwePhone(item.phone),
          rating: null,
          sourceUrl: item.sourceUrl,
        }))
    : await atStage("extraction", () =>
        findBusinesses(llm, brief, JSON.stringify(evidence)),
      );

  const seen = new Set<string>();
  const businesses = found.flatMap((candidate) => {
    const sourceUrl = candidate.sourceUrl ?? evidence.url;
    const checked = directoryBusinessSchema.safeParse({
      ...candidate,
      sourceUrl,
      rating: null,
    });
    if (!checked.success || !allowed.has(sourceUrl)) return [];
    const digits = candidate.phone.replace(/\D/g, "");
    // Require both identity and contact evidence. Local-format numbers may omit country code.
    const nameAt = evidence.text
      .toLowerCase()
      .indexOf(candidate.name.toLowerCase());
    const contactText = evidence.text.slice(
      Math.max(0, nameAt - 100),
      nameAt + candidate.name.length + 400,
    );
    const phoneTokens = [
      ...contactText.matchAll(/\+?\d[\d \t().-]{6,}\d/g),
    ].map((match) => match[0].replace(/\D/g, ""));
    const localDigits = digits.startsWith("263")
      ? "0" + digits.slice(3)
      : digits;
    if (
      nameAt < 0 ||
      !phoneTokens.some(
        (number) =>
          number === digits ||
          number === localDigits ||
          number === "00" + digits,
      ) ||
      seen.has(candidate.phone)
    )
      return [];
    seen.add(candidate.phone);
    return [checked.data];
  });
  return {
    sessionId,
    directoryUrl: evidence.url,
    checkedAt: new Date().toISOString(),
    businesses: businesses.slice(0, 6),
    extractionMethod: structured ? "directory-listings" : "gemini",
  };
}
