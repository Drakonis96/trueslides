import { NextRequest, NextResponse } from "next/server";
import { AIProvider } from "@/lib/types";
import { getApiKey } from "@/lib/key-store";
import { getSessionId } from "@/lib/session";
import { generateSlides, GenerateRequest } from "@/lib/generate-slides";
import { sanitizeErrorMessage } from "@/lib/ai-client";

export async function POST(req: NextRequest) {
  try {
    const body: GenerateRequest = await req.json();

    const sessionId = await getSessionId();
    const apiKey = getApiKey(sessionId, body.provider);

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }
    if (!body.sourceText?.trim()) {
      return NextResponse.json(
        { error: "Source text is required" },
        { status: 400 }
      );
    }

    const presentation = await generateSlides(apiKey, body);

    return NextResponse.json(presentation);
  } catch (err: unknown) {
    console.error("Generate error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate presentation";
    const status = message.includes("empty response") ? 502 : 500;
    return NextResponse.json({ error: sanitizeErrorMessage(message) }, { status });
  }
}
