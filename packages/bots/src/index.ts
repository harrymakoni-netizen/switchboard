import type { JobBrief } from "@switchboard/shared";
export interface Bot {
  key: string;
  name: string;
  phone: string;
  rating: number;
  payoutEmail: string;
  priceCents: number | null;
  slot: string | null;
  lines: string[];
}
export function bots(brief: JobBrief): Bot[] {
  const first = new Date(brief.windowStart);
  const slow = new Date(first.getTime() + 86400000);
  const time = (date: Date) =>
    new Date(date.getTime() + 2 * 3600000).toISOString().slice(0, 10) +
    "T09:00:00+02:00";
  return [
    {
      key: "tendai",
      name: "Tendai Plumbing",
      phone: "+12025550101",
      rating: 4.8,
      payoutEmail:
        process.env.TENDAI_PAYOUT_EMAIL ?? "tendai-sandbox@example.com",
      priceCents: 9500,
      slot: time(slow),
      lines: [
        "Yes, happy to help. What needs fixing?",
        `Labour and element replacement costs $95. I can come at ${time(slow)}. 30 days guarantee.`,
      ],
    },
    {
      key: "quickfix",
      name: "QuickFix Geysers",
      phone: "+12025550102",
      rating: 4.9,
      payoutEmail:
        process.env.QUICKFIX_PAYOUT_EMAIL ?? "quickfix-sandbox@example.com",
      priceCents: 11000,
      slot: time(first),
      lines: [
        "Of course. We specialise in geyser repairs.",
        `Labour and element replacement costs $110. I can come at ${time(first)}. 90 days guarantee.`,
      ],
    },
    {
      key: "avondale",
      name: "Avondale Handyman",
      phone: "+12025550103",
      rating: 4.6,
      payoutEmail: "avondale-sandbox@example.com",
      priceCents: null,
      slot: null,
      lines: [
        "Thanks for calling. We are too busy this week, so cannot take the job.",
      ],
    },
  ];
}
