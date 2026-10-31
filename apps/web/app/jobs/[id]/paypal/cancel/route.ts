import { NextRequest, NextResponse } from "next/server";
import { ownJob, runtime } from "../../../../../lib/server";
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  await ownJob(params.id);
  return NextResponse.redirect(
    new URL(
      "/jobs/" + params.id + "?notice=approval_cancelled",
      runtime().APP_URL,
    ),
  );
}
