import { NextRequest, NextResponse } from "next/server";
import { AIProvider } from "@/lib/types";
import { getApiKey } from "@/lib/key-store";
import { getSessionId } from "@/lib/session";
import { callAI, sanitizeErrorMessage } from "@/lib/ai-client";
import { rateLimiters } from "@/lib/rate-limit";

export const maxDuration = 120;

// ── Types ──

type ImageGenProvider = "openai" | "gemini";

interface GenerateImageRequest {
  provider: ImageGenProvider;
  modelId: string;
  prompt?: string;
  autoPrompt?: boolean;
  slideContext?: {
    title: string;
    bullets: string[];
    notes: string;
    section: string;
    presentationTopic: string;
  };
  /** Provider + model to use for auto-prompt generation (text LLM) */
  textAiConfig?: {
    provider: AIProvider;
    modelId: string;
  };
}

// ── Auto-prompt generation ──

async function generateAutoPrompt(
  slideContext: NonNullable<GenerateImageRequest["slideContext"]>,
  textProvider: AIProvider,
  textModelId: string,
  textApiKey: string
): Promise<string> {
  const systemPrompt = `You are an expert at writing image generation prompts for presentation slides. 
Generate a single, detailed prompt for creating a high-quality, photorealistic image suitable for a presentation slide.
The image should be landscape-oriented, professional, and visually compelling.
Do NOT include any text in the image.
Respond with ONLY the image generation prompt, nothing else.`;

  const userPrompt = `Presentation topic: "${slideContext.presentationTopic}"
Slide title: "${slideContext.title}"
Section: "${slideContext.section}"
Key points: ${slideContext.bullets.slice(0, 4).join("; ")}
${slideContext.notes ? `Presenter notes: ${slideContext.notes.slice(0, 300)}` : ""}

Write an optimal image generation prompt for this slide:`;

  const response = await callAI(
    textProvider,
    textModelId,
    textApiKey,
    systemPrompt,
    userPrompt
  );

  return response.trim().replace(/^["']|["']$/g, "").slice(0, 1000);
}

// ── OpenAI Image Generation ──

async function generateWithOpenAI(
  apiKey: string,
  modelId: string,
  prompt: string
): Promise<{ imageBase64: string; mimeType: string }> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      prompt,
      n: 1,
      size: "1536x1024",
      quality: "medium",
      response_format: "b64_json",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err.error?.message || `OpenAI image API error: ${res.status}`
    );
  }

  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data returned from OpenAI");

  return { imageBase64: b64, mimeType: "image/png" };
}

// ── Gemini Image Generation ──

async function generateWithGemini(
  apiKey: string,
  modelId: string,
  prompt: string
): Promise<{ imageBase64: string; mimeType: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE", "TEXT"],
        imageConfig: {
          aspectRatio: "16:9",
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err.error?.message || `Gemini image API error: ${res.status}`
    );
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error("No response parts from Gemini");

  for (const part of parts) {
    if (part.inlineData?.data) {
      return {
        imageBase64: part.inlineData.data,
        mimeType: part.inlineData.mimeType || "image/png",
      };
    }
  }

  throw new Error("No image data in Gemini response");
}

// ── POST Handler ──

export async function POST(req: NextRequest) {
  try {
    const body: GenerateImageRequest = await req.json();
    const { provider, modelId, autoPrompt, slideContext, textAiConfig } = body;
    let { prompt } = body;

    if (!provider || !modelId) {
      return NextResponse.json(
        { error: "Provider and model are required" },
        { status: 400 }
      );
    }

    const sessionId = await getSessionId();

    const rl = rateLimiters.ai.check(sessionId);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    // Map image gen provider to key-store provider
    const keyProvider: AIProvider = provider === "openai" ? "openai" : "gemini";
    const apiKey = getApiKey(keyProvider);
    if (!apiKey) {
      return NextResponse.json(
        { error: `No API key found for ${provider}. Please set it in Settings.` },
        { status: 401 }
      );
    }

    // Auto-generate prompt if requested
    if (autoPrompt && slideContext && textAiConfig) {
      const textKey = getApiKey(textAiConfig.provider);
      if (textKey) {
        prompt = await generateAutoPrompt(
          slideContext,
          textAiConfig.provider,
          textAiConfig.modelId,
          textKey
        );
      }
    }

    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: "A prompt is required (either manual or auto-generated)" },
        { status: 400 }
      );
    }

    let result: { imageBase64: string; mimeType: string };

    if (provider === "openai") {
      result = await generateWithOpenAI(apiKey, modelId, prompt);
    } else {
      result = await generateWithGemini(apiKey, modelId, prompt);
    }

    // Return as data URI for direct use in slides
    const dataUri = `data:${result.mimeType};base64,${result.imageBase64}`;

    return NextResponse.json({
      imageUrl: dataUri,
      prompt,
    });
  } catch (err: unknown) {
    console.error("AI image generation error:", err);
    const raw =
      err instanceof Error ? err.message : "Failed to generate image";
    return NextResponse.json({ error: sanitizeErrorMessage(raw) }, { status: 500 });
  }
}
