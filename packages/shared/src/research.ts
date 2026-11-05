import { z } from "zod";
import { cents } from "./types";
// All external links are HTTPS, without credentials or local/network destinations.
export const publicUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      host.includes(".") &&
      !host.includes(":") &&
      !/^\d+(\.\d+){3}$/.test(host) &&
      !/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host)
    );
  }, "Public HTTPS URL required");
export const directoryBusinessSchema = z.object({
  name: z.string().min(1).max(160),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  rating: z.number().min(0).max(5).nullable(),
  sourceUrl: publicUrl,
});
export type DirectoryBusiness = z.infer<typeof directoryBusinessSchema>;
export const directoryEvidenceSchema = z.object({
  sessionId: z.string().max(200),
  directoryUrl: publicUrl,
  checkedAt: z.string().datetime(),
  businesses: z.array(directoryBusinessSchema).max(6),
});
export type DirectoryEvidence = z.infer<typeof directoryEvidenceSchema>;
export const priceOfferSchema = z.object({
  productId: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  merchant: z.string().min(1).max(200),
  url: publicUrl,
  priceCents: cents.positive(),
  currency: z.literal("USD"),
});
export const priceAnchorSchema = z.object({
  query: z.string().min(1).max(300),
  checkedAt: z.string().datetime(),
  currency: z.literal("USD"),
  medianCents: cents.positive().nullable(),
  offers: z.array(priceOfferSchema).max(5),
});
export type PriceAnchor = z.infer<typeof priceAnchorSchema>;
const outcome = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    status: z.enum(["pending", "complete", "unavailable", "failed"]),
    mode: z.enum(["mock", "live"]),
    message: z.string().max(300).optional(),
    data: data.optional(),
  });
export const partnerResearchSchema = z.object({
  kernel: outcome(directoryEvidenceSchema),
  channel3: outcome(priceAnchorSchema),
});
export type PartnerResearch = z.infer<typeof partnerResearchSchema>;
