import { z } from "zod";
import { priceOfferSchema, type PriceAnchor } from "@switchboard/shared";
// Raw HTTP response shape, as documented by Channel3 (SDK Pages use a different wrapper).
const searchSchema = z.object({
  products: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().nullish(),
        offers: z.array(z.unknown()).optional(),
      }),
    )
    .max(30),
});
const offerSchema = z.object({
  url: z.string(),
  domain: z.string(),
  availability: z.string().nullish(),
  price: z.object({
    price: z.number().finite().positive(),
    currency: z.string(),
  }),
});
export async function searchPartPrices(
  query: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<PriceAnchor> {
  query = z.string().trim().min(2).max(300).parse(query);
  // The configured US catalogue uses "water heater" for the regional term "geyser".
  query = query.replace(/\bgeyser\b/gi, "water heater");
  const waterHeater = /water[ -]?heater/i.test(query);
  const response = await fetcher("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      query,
      limit: 5,
      config: { currency: "USD", country: "US" },
    }),
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Channel3 HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 1000000) throw new Error("Channel3 response too large");
  const result = searchSchema.parse(JSON.parse(body));
  const offers: PriceAnchor["offers"] = [];
  for (const product of result.products) {
    if (
      waterHeater &&
      !/water[ -]?heater|immersion|geyser/i.test(
        product.title + " " + (product.description ?? ""),
      )
    )
      continue;
    const candidates = (product.offers ?? [])
      .flatMap((raw) => {
        const checked = offerSchema.safeParse(raw);
        if (
          !checked.success ||
          checked.data.price.currency !== "USD" ||
          checked.data.availability === "OutOfStock"
        )
          return [];
        const offer = priceOfferSchema.safeParse({
          productId: product.id,
          title: product.title,
          merchant: checked.data.domain,
          url: checked.data.url,
          priceCents: Math.round(checked.data.price.price * 100),
          currency: "USD",
        });
        return offer.success ? [offer.data] : [];
      })
      .sort((a, b) => a.priceCents - b.priceCents);
    // One lowest offer per product: multiple merchants for one SKU do not dominate the median.
    if (candidates[0] && !offers.some((o) => o.productId === product.id))
      offers.push(candidates[0]);
    if (offers.length === 5) break;
  }
  const prices = offers.map((o) => o.priceCents).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const medianCents = prices.length
    ? prices.length % 2
      ? prices[mid]
      : Math.round((prices[mid - 1] + prices[mid]) / 2)
    : null;
  return {
    query,
    checkedAt: new Date().toISOString(),
    currency: "USD",
    medianCents,
    offers,
  };
}
