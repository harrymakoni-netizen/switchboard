import { z } from "zod";
export type Cents = number;
export const cents = z.number().int().nonnegative().max(100000000);
export const briefSchema = z.object({
  task: z.string().min(1),
  category: z.literal("home_repair"),
  location: z.string().min(1),
  windowStart: z.string().datetime({ offset: true }),
  windowEnd: z.string().datetime({ offset: true }),
  budgetCents: cents,
  currency: z.literal("USD"),
  partHint: z.string().nullable().optional(),
});
export type JobBrief = z.infer<typeof briefSchema>;
export interface Business {
  id: string;
  jobId: string;
  name: string;
  phone: string;
  rating: number | null;
  sourceUrl: string | null;
  payoutEmail: string | null;
  isBot: boolean;
}
export interface Quote {
  id: string;
  callId: string;
  businessId: string;
  priceCents: Cents | null;
  currency: "USD";
  earliestSlot: string | null;
  includes: string[];
  guarantee: string | null;
  willingToNegotiate: boolean | null;
  confidence: number;
  declined: boolean;
}
export type State =
  | "DRAFT"
  | "FINDING"
  | "CALLING"
  | "QUOTED"
  | "BOOK_APPROVED"
  | "FUNDS_HELD"
  | "CONFIRMED"
  | "AWAITING_COMPLETION"
  | "COMPLETED"
  | "PAID_OUT"
  | "CLOSED"
  | "ISSUE"
  | "CANCELLED";
export type JobEvent =
  | { type: "BRIEF_READY"; brief: JobBrief }
  | { type: "BUSINESSES_FOUND"; count: number }
  | { type: "CALLS_FINISHED" }
  | { type: "USER_BOOKED"; quoteId: string }
  | { type: "PAYPAL_AUTHORIZED"; authorizationId: string }
  | { type: "BUSINESS_CONFIRMED"; payoutEmail: string; slot: string }
  | { type: "BUSINESS_DECLINED" }
  | { type: "SLOT_PASSED" }
  | { type: "USER_CONFIRMED_DONE" }
  | { type: "USER_REPORTED_NOT_DONE"; note?: string }
  | { type: "CAPTURE_COMPLETED"; captureId: string }
  | { type: "CAPTURE_DECLINED" }
  | { type: "PAYOUT_SETTLED"; status: "SUCCEEDED" | "UNCLAIMED" }
  | { type: "PAYOUT_FAILED" }
  | { type: "USER_CANCELLED" };
export interface Job {
  id: string;
  sessionId: string;
  rawRequest: string;
  brief: JobBrief | null;
  state: State;
  chosenQuoteId: string | null;
  bookedSlot: string | null;
  payoutEmailShownAt: string | null;
  approvedBookAt: string | null;
  approvedDoneAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface TranscriptLine {
  speaker: "agent" | "party";
  text: string;
  at: string;
}
export interface Call {
  id: string;
  jobId: string;
  businessId: string | null;
  purpose: "quote" | "confirm" | "completion";
  providerSid: string | null;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  consentToRecord: boolean;
  recordingUrl: string | null;
  transcript: TranscriptLine[];
}
export interface Payment {
  id: string;
  jobId: string;
  kind:
    | "order"
    | "authorization"
    | "reauthorization"
    | "capture"
    | "void"
    | "payout"
    | "invoice";
  paypalId: string | null;
  status: string;
  amountCents: number | null;
  requestId: string;
  raw: unknown;
  createdAt: string;
}
export interface Snapshot {
  job: Job;
  businesses: Business[];
  calls: Omit<Call, "transcript">[];
  quotes: Quote[];
  payments: Payment[];
}
export function toCents(value: string): Cents {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Invalid monetary amount");
  const [whole, fraction = ""] = value.split(".");
  return cents.parse(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
}
export function fromCents(value: Cents): string {
  cents.parse(value);
  return (value / 100).toFixed(2);
}
