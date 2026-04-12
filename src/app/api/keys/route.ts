import { NextRequest, NextResponse } from "next/server";
import { AIProvider, ImageSourceId, IMAGE_SOURCES } from "@/lib/types";
import {
  setApiKey, getApiKey, deleteApiKey, getKeyStatus,
  setImageSourceKey, deleteImageSourceKey, getImageSourceKeyStatus,
} from "@/lib/key-store";
import { getSessionId } from "@/lib/session";

const VALID_PROVIDERS: AIProvider[] = ["openrouter", "gemini", "claude", "openai"];
const VALID_IMAGE_SOURCES: ImageSourceId[] = IMAGE_SOURCES.filter((s) => s.needsKey).map((s) => s.id);

function isValidProvider(provider: string): provider is AIProvider {
  return VALID_PROVIDERS.includes(provider as AIProvider);
}

function isValidImageSource(source: string): source is ImageSourceId {
  return VALID_IMAGE_SOURCES.includes(source as ImageSourceId);
}

/**
 * GET /api/keys — returns which providers and image sources have keys set
 */
export async function GET() {
  try {
    const sessionId = await getSessionId();
    const status = getKeyStatus(sessionId);
    const imageSourceStatus = getImageSourceKeyStatus(sessionId);
    return NextResponse.json({ status, imageSourceStatus });
  } catch (err: unknown) {
    console.error("Keys GET error:", err);
    return NextResponse.json(
      { error: "Failed to get key status" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/keys — store an API key for a provider or image source
 * Body: { provider: AIProvider, apiKey: string } OR { imageSource: ImageSourceId, apiKey: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, imageSource, apiKey } = body;

    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }

    // Reject suspiciously large keys (max 512 chars covers all provider formats)
    if (apiKey.trim().length > 512) {
      return NextResponse.json(
        { error: "API key is too long" },
        { status: 400 }
      );
    }

    const sessionId = await getSessionId();

    if (imageSource) {
      if (!isValidImageSource(imageSource)) {
        return NextResponse.json(
          { error: "Invalid image source" },
          { status: 400 }
        );
      }
      setImageSourceKey(sessionId, imageSource, apiKey.trim());
      return NextResponse.json({ ok: true });
    }

    if (!provider || !isValidProvider(provider)) {
      return NextResponse.json(
        { error: "Invalid provider" },
        { status: 400 }
      );
    }

    setApiKey(sessionId, provider, apiKey.trim());
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("Keys POST error:", err);
    return NextResponse.json(
      { error: "Failed to store API key" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/keys — remove an API key for a provider or image source
 * Body: { provider: AIProvider } OR { imageSource: ImageSourceId }
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, imageSource } = body;

    const sessionId = await getSessionId();

    if (imageSource) {
      if (!isValidImageSource(imageSource)) {
        return NextResponse.json(
          { error: "Invalid image source" },
          { status: 400 }
        );
      }
      deleteImageSourceKey(sessionId, imageSource);
      return NextResponse.json({ ok: true });
    }

    if (!provider || !isValidProvider(provider)) {
      return NextResponse.json(
        { error: "Invalid provider" },
        { status: 400 }
      );
    }

    deleteApiKey(sessionId, provider);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("Keys DELETE error:", err);
    return NextResponse.json(
      { error: "Failed to delete API key" },
      { status: 500 }
    );
  }
}
