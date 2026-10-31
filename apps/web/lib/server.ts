import { cookies } from "next/headers";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { loadEnv } from "@switchboard/shared";
import { getJob } from "@switchboard/db";
export function runtime() {
  return loadEnv();
}
export function session(create = false) {
  const env = runtime();
  const value = cookies().get("switchboard-session")?.value;
  const [id, signature] = value?.split(".") ?? [];
  if (id && signature) {
    const expected = Buffer.from(
      createHmac("sha256", env.SESSION_SECRET).update(id).digest("hex"),
    );
    const actual = Buffer.from(signature);
    if (actual.length === expected.length && timingSafeEqual(actual, expected))
      return id;
  }
  if (!create) throw new Error("Job not found");
  const next = randomUUID();
  const sig = createHmac("sha256", env.SESSION_SECRET)
    .update(next)
    .digest("hex");
  cookies().set("switchboard-session", next + "." + sig, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" && env.APP_URL.startsWith("https:"),
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return next;
}
export async function ownJob(id: string) {
  const job = await getJob(id);
  if (job.sessionId !== session()) throw new Error("Job not found");
  return job;
}
export async function worker(path: string, body: unknown) {
  const env = runtime();
  const res = await fetch(env.PUBLIC_WORKER_URL + "/internal/" + path, {
    method: "POST",
    headers: {
      authorization: "Bearer " + env.SESSION_SECRET,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok)
    throw new Error("Worker could not finish this action. Please retry.");
  return res.json();
}
