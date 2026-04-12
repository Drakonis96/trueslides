import { NextRequest, NextResponse } from "next/server";
import { AIProvider } from "@/lib/types";
import { getApiKey } from "@/lib/key-store";
import { getSessionId } from "@/lib/session";
import { callAI, sanitizeErrorMessage } from "@/lib/ai-client";

interface SlideVariantInput {
  title: string;
  bullets: string[];
  notes: string;
  section?: string;
  accentColor?: string;
  imageSearchTerms?: string[];
  slideLayout?: string;
}

interface SlideVariantsRequest {
  provider: AIProvider;
  modelId: string;
  slide: SlideVariantInput;
  count: number;
  language?: string;
  instruction?: string;
  presentationTitle?: string;
  totalSlides?: number;
}

function buildSystemPrompt(body: SlideVariantsRequest): string {
  const count = Math.max(2, Math.min(6, body.count || 3));
  const lang = body.language || "English";
  const extraInstruction = body.instruction?.trim()
    ? `\nUser instruction: ${body.instruction.trim()}`
    : "";

  return `Generate ${count} slide variants in ${lang}. Same core idea, different framing/wording/structure.
Context: "${body.presentationTitle || "Untitled"}" (${body.totalSlides || "?"} slides).
Rules: imageSearchTerms in English (2-3 words). accentColor hex without #. No id/index/imageUrls. Concise bullets.${extraInstruction}

Return ONLY valid JSON: {"variants":[{"title":"...","bullets":["..."],"notes":"...","section":"...","accentColor":"6366F1","imageSearchTerms":["..."],"slideLayout":"single"}]}`;
}

function buildUserPrompt(slide: SlideVariantInput): string {
  return `CURRENT SLIDE:\n${JSON.stringify(slide, null, 2)}`;
}

function sanitizeVariant(
  variant: Record<string, unknown>,
  fallback: SlideVariantInput,
): SlideVariantInput {
  const bullets = Array.isArray(variant.bullets)
    ? variant.bullets.filter((b): b is string => typeof b === "string")
    : fallback.bullets;

  const imageSearchTerms = Array.isArray(variant.imageSearchTerms)
    ? variant.imageSearchTerms
        .filter((term): term is string => typeof term === "string")
        .map((term) => term.trim())
        .filter(Boolean)
    : fallback.imageSearchTerms;

  const accentColor =
    typeof variant.accentColor === "string"
      ? variant.accentColor.replace("#", "").trim()
      : fallback.accentColor;

  return {
    title:
      typeof variant.title === "string" && variant.title.trim()
        ? variant.title
        : fallback.title,
    bullets,
    notes: typeof variant.notes === "string" ? variant.notes : fallback.notes,
    section:
      typeof variant.section === "string" ? variant.section : fallback.section,
    accentColor,
    imageSearchTerms,
    slideLayout:
      typeof variant.slideLayout === "string"
        ? variant.slideLayout
        : fallback.slideLayout,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body: SlideVariantsRequest = await req.json();

    const sessionId = await getSessionId();
    const apiKey = getApiKey(sessionId, body.provider);

    if (!apiKey) {
      return NextResponse.json({ error: "API key is required" }, { status: 400 });
    }

    if (!body.slide?.title?.trim()) {
      return NextResponse.json(
        { error: "Slide data is required" },
        { status: 400 },
      );
    }

    const count = Math.max(2, Math.min(6, body.count || 3));
    const systemPrompt = buildSystemPrompt({ ...body, count });
    const userPrompt = buildUserPrompt(body.slide);

    const maxTokens = count * 400 + 500; // ~400 tokens per variant + overhead

    const raw = await callAI(
      body.provider,
      body.modelId,
      apiKey,
      systemPrompt,
      userPrompt,
      maxTokens,
    );

    if (!raw.trim()) {
      return NextResponse.json(
        { error: "AI returned an empty response" },
        { status: 502 },
      );
    }

    let jsonStr = raw;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr) as { variants?: Record<string, unknown>[] };
    const variants = Array.isArray(parsed.variants)
      ? parsed.variants.map((variant) => sanitizeVariant(variant, body.slide)).slice(0, count)
      : [];

    if (variants.length === 0) {
      return NextResponse.json(
        { error: "AI response missing variants" },
        { status: 502 },
      );
    }

    return NextResponse.json({ variants });
  } catch (err: unknown) {
    console.error("Slide variants error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate slide variants";
    return NextResponse.json({ error: sanitizeErrorMessage(message) }, { status: 500 });
  }
}