import { NextRequest, NextResponse } from "next/server";
import { ownJob, worker, runtime } from "../../../../../lib/server";
import { z } from "zod";
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const jobId = z.string().uuid().parse(params.id);
    await ownJob(jobId);
    const token = z
      .string()
      .min(1)
      .parse(req.nextUrl.searchParams.get("token"));
    await worker("authorize", { jobId, token });
    return NextResponse.redirect(new URL("/jobs/" + jobId, runtime().APP_URL));
  } catch {
    return NextResponse.redirect(
      new URL(
        "/jobs/" + params.id + "?notice=approval_failed",
        runtime().APP_URL,
      ),
    );
  }
}
