import type { JobBrief, PartnerResearch } from "@switchboard/shared";
import type { LLM } from "@switchboard/agents";
import {
  discoverBusinesses,
  KernelDirectory,
  DirectoryResearchError,
  type DirectoryBrowser,
} from "./kernel";
import { searchPartPrices } from "./channel3";

export function safeResearchFailure(
  error: unknown,
): NonNullable<PartnerResearch["kernel"]["failure"]> {
  const stage =
    error instanceof DirectoryResearchError ? error.stage : "lookup";
  let current = error;
  let errorClass = "UnknownError";
  let httpStatus: number | undefined;
  for (
    let depth = 0;
    depth < 5 && current && typeof current === "object";
    depth++
  ) {
    if (
      current instanceof Error &&
      /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(current.name)
    )
      errorClass = current.name;
    const code =
      "statusCode" in current
        ? current.statusCode
        : "status" in current
          ? current.status
          : undefined;
    if (
      typeof code === "number" &&
      Number.isInteger(code) &&
      code >= 400 &&
      code < 600
    )
      httpStatus = code;
    current = "cause" in current ? current.cause : undefined;
  }
  return { stage, errorClass, ...(httpStatus ? { httpStatus } : {}) };
}
export type ResearchConfig = {
  PARTNER_RESEARCH_MODE: "off" | "mock" | "live";
  KERNEL_API_KEY?: string;
  CHANNEL3_API_KEY?: string;
  DIRECTORY_URL_TEMPLATE?: string;
};
export function pendingResearch(mode: "mock" | "live"): PartnerResearch {
  return {
    kernel: { status: "pending", mode },
    channel3: { status: "pending", mode },
  };
}
export async function researchJob(
  brief: JobBrief,
  config: ResearchConfig,
  llm: LLM,
  dependencies: { browser?: DirectoryBrowser; fetcher?: typeof fetch } = {},
): Promise<PartnerResearch> {
  const mode = config.PARTNER_RESEARCH_MODE;
  if (mode === "off") throw new Error("Partner research is disabled");
  if (mode === "mock")
    return {
      kernel: {
        status: "complete",
        mode,
        data: {
          sessionId: "MOCK-KERNEL",
          directoryUrl: "https://directory.switchboard.demo/providers",
          checkedAt: new Date().toISOString(),
          businesses: [
            {
              name: "Example Plumbing A",
              phone: "+12025550111",
              rating: null,
              sourceUrl: "https://directory.switchboard.demo/providers/a",
            },
            {
              name: "Example Plumbing B",
              phone: "+12025550112",
              rating: null,
              sourceUrl: "https://directory.switchboard.demo/providers/b",
            },
            {
              name: "Example Plumbing C",
              phone: "+12025550113",
              rating: null,
              sourceUrl: "https://directory.switchboard.demo/providers/c",
            },
          ],
        },
      },
      channel3: brief.partHint?.trim()
        ? {
            status: "complete",
            mode,
            data: {
              query: brief.partHint.slice(0, 300),
              checkedAt: new Date().toISOString(),
              currency: "USD",
              medianCents: 3500,
              offers: [
                {
                  productId: "MOCK-PART",
                  title: "Example replacement element",
                  merchant: "Demo merchant",
                  url: "https://catalog.switchboard.demo/element",
                  priceCents: 3500,
                  currency: "USD",
                },
              ],
            },
          }
        : {
            status: "unavailable",
            mode,
            message: "No replacement part was identified in this brief.",
          },
    };
  const [kernel, channel3] = await Promise.all([
    (async (): Promise<PartnerResearch["kernel"]> => {
      if (!config.KERNEL_API_KEY || !config.DIRECTORY_URL_TEMPLATE)
        return {
          status: "unavailable",
          mode,
          message: "Directory research has not been configured yet.",
        };
      try {
        const browser = dependencies.browser ?? new KernelDirectory();
        const data = await discoverBusinesses(
          brief,
          config.DIRECTORY_URL_TEMPLATE,
          browser,
          llm,
        );
        return { status: "complete", mode, data };
      } catch (error) {
        return {
          status: "failed",
          mode,
          failure: safeResearchFailure(error),
          message:
            "Directory research could not be verified. Existing quotes and payments are unchanged.",
        };
      }
    })(),
    (async (): Promise<PartnerResearch["channel3"]> => {
      if (!brief.partHint?.trim())
        return {
          status: "unavailable",
          mode,
          message: "No replacement part was identified in this brief.",
        };
      if (!config.CHANNEL3_API_KEY)
        return {
          status: "unavailable",
          mode,
          message: "Parts-price research has not been configured yet.",
        };
      try {
        const data = await searchPartPrices(
          brief.partHint.slice(0, 300),
          config.CHANNEL3_API_KEY,
          dependencies.fetcher,
        );
        return { status: "complete", mode, data };
      } catch (error) {
        return {
          status: "failed",
          mode,
          failure: safeResearchFailure(error),
          message:
            "Parts prices are unavailable. You can still compare the providers’ actual quotes.",
        };
      }
    })(),
  ]);
  return { kernel, channel3 };
}
