import { NextRequest, NextResponse } from "next/server";
import { AIProvider } from "@/lib/types";
import { getApiKey } from "@/lib/key-store";
import { getSessionId } from "@/lib/session";
import { callAI, sanitizeErrorMessage } from "@/lib/ai-client";
import { rateLimiters } from "@/lib/rate-limit";

interface EditSlide {
  id: string;
  index: number;
  title: string;
  bullets: string[];
  notes: string;
  section?: string;
  accentColor?: string;
  imageSearchTerms?: string[];
}

interface EditRequest {
  provider: AIProvider;
  modelId: string;
  instruction: string;
  slides: EditSlide[];
  targetIndices: number[] | "all";
  language?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: EditRequest = await req.json();

    const sessionId = await getSessionId();

    const rl = rateLimiters.ai.check(sessionId);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    const apiKey = getApiKey(body.provider);

    if (!apiKey || !body.instruction?.trim()) {
      return NextResponse.json(
        { error: "API key and instruction are required" },
        { status: 400 }
      );
    }

    const targetSlides =
      body.targetIndices === "all"
        ? body.slides
        : body.slides.filter((s) =>
            (body.targetIndices as number[]).includes(s.index)
          );

    const lang = body.language || "en";

    const systemPrompt = `You are an expert presentation editor with deep control over every aspect of a slide deck.

The user will give you existing slide data and an instruction. You MUST apply the requested changes surgically and return the modified slides.

## Editable fields per slide

| Field | Type | Description |
|-------|------|-------------|
| id | string | **Never change.** |
| index | number | **Never change.** |
| title | string | The slide headline. |
| bullets | string[] | Bullet points. Can be empty [], or contain structured outline text, numbered lists, etc. |
| notes | string | Presenter notes shown below the slide. |
| section | string | Small label shown above the title (e.g. "INTRODUCTION", "CHAPTER 1"). |
| accentColor | string or null | Hex color WITHOUT # (e.g. "6366F1", "EF4444"). Controls the section badge, accent bars, and bullet markers. null = use default. |
| imageSearchTerms | string[] or null | When the user wants to ADD, REPLACE, or CHANGE images, provide 2-3 highly specific Wikimedia Commons search terms. null or omit = keep existing images unchanged. |

## Rules
1. Return ALL target slides, even those you did not modify.
2. Keep id and index identical to the input.
3. If the user changes text content, rewrite it naturally — don't just swap words.
4. If the user asks to add images or change image layout, set imageSearchTerms with descriptive, specific English terms suitable for Wikimedia Commons search (e.g. "vintage film camera close-up", "1920s photography studio").
5. If the user asks to remove images, set imageSearchTerms to [].
6. If the user asks to change colors, set accentColor with the hex value (no #).
7. You can restructure bullets into outlines, numbered lists, or hierarchical text using indentation markers like "  • " or "  1. ".
8. All text content MUST be in: ${lang}.

Respond ONLY with valid JSON — no markdown fences, no commentary:
{
  "slides": [ { ...slide fields... } ]
}`;

    const userPrompt = `CURRENT SLIDES:
${JSON.stringify(targetSlides, null, 2)}

USER INSTRUCTION: ${body.instruction}`;

    const raw = await callAI(
      body.provider,
      body.modelId,
      apiKey,
      systemPrompt,
      userPrompt
    );

    if (!raw.trim()) {
      return NextResponse.json(
        { error: "AI returned an empty response" },
        { status: 502 }
      );
    }

    let jsonStr = raw;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr);

    return NextResponse.json(parsed);
  } catch (err: unknown) {
    console.error("Edit error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to edit slides";
    return NextResponse.json({ error: sanitizeErrorMessage(message) }, { status: 500 });
  }
}
