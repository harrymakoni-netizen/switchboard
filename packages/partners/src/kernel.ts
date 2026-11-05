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
});
export function directoryUrl(template: string, brief: JobBrief) {
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
export interface DirectoryBrowser {
  read(
    url: string,
  ): Promise<{ sessionId: string; page: z.infer<typeof pageEvidenceSchema> }>;
}
export class KernelDirectory implements DirectoryBrowser {
  constructor(private client = new Kernel({ maxRetries: 0, timeout: 45000 })) {}
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
          return {url: page.url(), text: (await page.locator('body').innerText()).slice(0,40000),
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
  const url = directoryUrl(template, brief);
  const { sessionId, page } = await browser.read(url);
  const evidence = pageEvidenceSchema.parse(page);
  if (new URL(evidence.url).hostname !== new URL(url).hostname)
    throw new Error("Directory redirected outside the configured host");
  const allowed = new Set([
    evidence.url,
    ...evidence.links.filter((link) => publicUrl.safeParse(link).success),
  ]);
  const found = await findBusinesses(llm, brief, JSON.stringify(evidence));
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
    businesses,
  };
}
