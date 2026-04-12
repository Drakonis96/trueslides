import { NextRequest, NextResponse } from "next/server";
import { AIProvider } from "@/lib/types";
import { getApiKey } from "@/lib/key-store";
import { getSessionId } from "@/lib/session";
import { callAI } from "@/lib/ai-client";

interface TranslateRequest {
  provider: AIProvider;
  modelId: string;
  text: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: TranslateRequest = await req.json();

    const sessionId = await getSessionId();
    const apiKey = getApiKey(sessionId, body.provider);

    if (!apiKey || !body.text?.trim()) {
      return NextResponse.json(
        { error: "API key and text are required" },
        { status: 400 },
      );
    }

    const systemPrompt = `You are a translator. Translate the user's text to English for use as an image search query. Return ONLY valid JSON: {"translated":"<english text>"}. No markdown, no commentary.`;

    const raw = await callAI(
      body.provider,
      body.modelId,
      apiKey,
      systemPrompt,
      body.text.trim(),
      200,
    );

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] || raw) as { translated?: string };
    const translated = parsed.translated?.trim();

    if (!translated) {
      return NextResponse.json({ translated: body.text.trim() });
    }

    return NextResponse.json({ translated });
  } catch (err) {
    console.error("Translate query error:", err);
    return NextResponse.json(
      { error: "Translation failed" },
      { status: 500 },
    );
  }
}
