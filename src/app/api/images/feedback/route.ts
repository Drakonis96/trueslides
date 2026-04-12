import { NextRequest, NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { recordImageFeedback } from "@/lib/image-feedback";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = await getSessionId();

    if (!body?.action || !body?.imageUrl) {
      return NextResponse.json(
        { error: "action and imageUrl are required" },
        { status: 400 },
      );
    }

    recordImageFeedback(sessionId, {
      action: body.action,
      imageUrl: body.imageUrl,
      imageTitle: body.imageTitle,
      imageSource: body.imageSource,
      presentationTopic: body.presentationTopic,
      slideContext: body.slideContext,
      queryTerms: Array.isArray(body.queryTerms) ? body.queryTerms : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Image feedback error:", err);
    return NextResponse.json(
      { error: "Failed to record image feedback" },
      { status: 500 },
    );
  }
}