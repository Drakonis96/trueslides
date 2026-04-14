import { NextRequest, NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { createJob } from "@/lib/job-manager";
import { sanitizeErrorMessage } from "@/lib/ai-client";
import { runPresentationJob } from "@/lib/generate-full/presentation-job";
import type { GenerateFullRequest } from "@/lib/generate-full/types";
import { rateLimiters } from "@/lib/rate-limit";

export const maxDuration = 600; // 10 minutes — large presentations use chunked generation

export async function POST(req: NextRequest) {
  try {
    const body: GenerateFullRequest = await req.json();
    const sessionId = await getSessionId();

    const rl = rateLimiters.ai.check(sessionId);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    if (!body.jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    // Create a tracked background job
    createJob(body.jobId, "presentation");

    // Fire and forget — the generation runs in the background
    void runPresentationJob(body.jobId, body);

    return NextResponse.json({ jobId: body.jobId });
  } catch (err: unknown) {
    console.error("Generate-full error:", err);
    const message = err instanceof Error ? err.message : "Failed to generate presentation";
    return NextResponse.json({ error: sanitizeErrorMessage(message) }, { status: 500 });
  }
}
