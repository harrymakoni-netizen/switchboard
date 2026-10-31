import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  numeric,
  integer,
  boolean,
  bigserial,
} from "drizzle-orm/pg-core";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });
export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: text("session_id").notNull(),
  rawRequest: text("raw_request").notNull(),
  brief: jsonb("brief"),
  state: text("state").notNull().default("DRAFT"),
  chosenQuoteId: uuid("chosen_quote_id"),
  bookedSlot: time("booked_slot"),
  payoutEmailShownAt: time("payout_email_shown_at"),
  approvedBookAt: time("approved_book_at"),
  approvedDoneAt: time("approved_done_at"),
  createdAt: time("created_at").defaultNow().notNull(),
  updatedAt: time("updated_at").defaultNow().notNull(),
});
export const businesses = pgTable("businesses", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  rating: numeric("rating"),
  sourceUrl: text("source_url"),
  payoutEmail: text("payout_email"),
  isBot: boolean("is_bot").notNull().default(false),
});
export const calls = pgTable("calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  businessId: uuid("business_id").references(() => businesses.id),
  purpose: text("purpose").notNull(),
  providerSid: text("provider_sid").unique(),
  status: text("status").notNull().default("queued"),
  startedAt: time("started_at"),
  endedAt: time("ended_at"),
  consentToRecord: boolean("consent_to_record").notNull().default(false),
  recordingUrl: text("recording_url"),
  transcript: jsonb("transcript").notNull().default([]),
});
export const quotes = pgTable("quotes", {
  id: uuid("id").defaultRandom().primaryKey(),
  callId: uuid("call_id")
    .notNull()
    .unique()
    .references(() => calls.id),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  priceCents: integer("price_cents"),
  currency: text("currency").notNull().default("USD"),
  earliestSlot: time("earliest_slot"),
  includes: text("includes").array().notNull().default([]),
  guarantee: text("guarantee"),
  willingToNegotiate: boolean("willing_to_negotiate"),
  confidence: numeric("confidence").notNull(),
  declined: boolean("declined").notNull().default(false),
});
export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  kind: text("kind").notNull(),
  paypalId: text("paypal_id"),
  status: text("status").notNull(),
  amountCents: integer("amount_cents"),
  requestId: text("request_id").notNull().unique(),
  raw: jsonb("raw").notNull(),
  createdAt: time("created_at").defaultNow().notNull(),
});
export const events = pgTable("events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  type: text("type").notNull(),
  fromState: text("from_state"),
  toState: text("to_state"),
  payload: jsonb("payload"),
  createdAt: time("created_at").defaultNow().notNull(),
});
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  receivedAt: time("received_at").defaultNow().notNull(),
  payload: jsonb("payload").notNull(),
});
export const effects = pgTable("effects", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  name: text("name").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: time("created_at").defaultNow().notNull(),
  dispatchedAt: time("dispatched_at"),
});
