import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import type { Job, Snapshot, Payment } from "@switchboard/shared";
export const sql = postgres(
  process.env.DATABASE_URL ??
    "postgres://switchboard:switchboard@localhost:5432/switchboard",
  { transform: postgres.camel, max: 10 },
);
export const db = drizzle(sql, { schema });
export type Tx = postgres.TransactionSql;
export async function createJob(
  sessionId: string,
  request: string,
): Promise<Job> {
  const [job] = await sql<
    Job[]
  >`insert into jobs(session_id,raw_request) values(${sessionId},${request}) returning *`;
  return job;
}
export async function getJob(id: string): Promise<Job> {
  const [job] = await sql<Job[]>`select * from jobs where id=${id}`;
  if (!job) throw new Error("Job not found");
  return job;
}
export async function snapshot(id: string): Promise<Snapshot> {
  const job = await getJob(id);
  const [businesses, calls, quotes, payments] = await Promise.all([
    sql`select *,rating::float8 as rating from businesses where job_id=${id} order by name`,
    sql`select id,job_id,business_id,purpose,provider_sid,status,started_at,ended_at,consent_to_record,recording_url from calls where job_id=${id}`,
    sql`select q.*,q.confidence::float8 as confidence from quotes q join businesses b on b.id=q.business_id where b.job_id=${id}`,
    sql`select * from payments where job_id=${id} order by created_at`,
  ]);
  return { job, businesses, calls, quotes, payments } as unknown as Snapshot;
}
export async function emit(
  jobId: string,
  type: string,
  data: unknown,
  tx: Tx | typeof sql = sql,
) {
  await tx`insert into events(job_id,type,payload) values(${jobId},${type},${JSON.stringify(data)}::jsonb)`;
  await tx`select pg_notify(${`job_${jobId.replaceAll("-", "_")}`},${JSON.stringify({ type, data })})`;
}
export async function recordPayment(
  p: Omit<Payment, "id" | "createdAt">,
  tx: Tx | typeof sql = sql,
): Promise<Payment> {
  const rows = await tx<
    Payment[]
  >`insert into payments(job_id,kind,paypal_id,status,amount_cents,request_id,raw) values(${p.jobId},${p.kind},${p.paypalId},${p.status},${p.amountCents},${p.requestId},${JSON.stringify(p.raw)}::jsonb) on conflict(request_id) do nothing returning *`;
  if (rows[0]) {
    await emit(p.jobId, "payment.updated", p, tx);
    return rows[0];
  }
  const [existing] = await tx<
    Payment[]
  >`select * from payments where request_id=${p.requestId}`;
  if (
    existing.jobId !== p.jobId ||
    existing.kind !== p.kind ||
    existing.amountCents !== p.amountCents
  )
    throw new Error("Idempotency key mismatch");
  return existing;
}
