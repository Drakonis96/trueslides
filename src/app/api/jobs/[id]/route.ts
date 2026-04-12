import { NextRequest, NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { getJob, getJobInfo, getSessionJobs, cancelJob } from "@/lib/job-manager";

/**
 * GET /api/jobs/[id]
 * Returns job status. Use id="all" to list all session jobs.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionId = await getSessionId();
  const { id } = await params;

  if (id === "all") {
    return NextResponse.json({ jobs: getSessionJobs(sessionId) });
  }

  const job = getJob(id, sessionId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(getJobInfo(job));
}

/**
 * DELETE /api/jobs/[id]
 * Cancels a running job.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionId = await getSessionId();
  const { id } = await params;

  const cancelled = cancelJob(id, sessionId);
  if (!cancelled) {
    return NextResponse.json(
      { error: "Job not found or not running" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
