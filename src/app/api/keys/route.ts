import { NextRequest, NextResponse } from "next/server";
import { AIProvider, ImageSourceId, IMAGE_SOURCES } from "@/lib/types";
import {
  setApiKey, getApiKey, deleteApiKey, getKeyStatus,
  setImageSourceKey, deleteImageSourceKey, getImageSourceKeyStatus,
} from "@/lib/key-store";

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
    const status = getKeyStatus();
    const imageSourceStatus = getImageSourceKeyStatus();
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

    if (imageSource) {
      if (!isValidImageSource(imageSource)) {
        return NextResponse.json(
          { error: "Invalid image source" },
          { status: 400 }
        );
      }
      setImageSourceKey(imageSource, apiKey.trim());
      return NextResponse.json({ ok: true });
    }

    if (!provider || !isValidProvider(provider)) {
      return NextResponse.json(
        { error: "Invalid provider" },
        { status: 400 }
      );
    }

    setApiKey(provider, apiKey.trim());
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

    if (imageSource) {
      if (!isValidImageSource(imageSource)) {
        return NextResponse.json(
          { error: "Invalid image source" },
          { status: 400 }
        );
      }
      deleteImageSourceKey(imageSource);
      return NextResponse.json({ ok: true });
    }

    if (!provider || !isValidProvider(provider)) {
      return NextResponse.json(
        { error: "Invalid provider" },
        { status: 400 }
      );
    }

    deleteApiKey(provider);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("Keys DELETE error:", err);
    return NextResponse.json(
      { error: "Failed to delete API key" },
      { status: 500 }
    );
  }
}
