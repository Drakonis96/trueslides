import { NextRequest, NextResponse } from "next/server";
import { AIProvider } from "@/lib/types";
import { getApiKey } from "@/lib/key-store";
import { sanitizeErrorMessage } from "@/lib/ai-client";

interface ModelsRequest {
  provider: AIProvider;
}

export async function POST(req: NextRequest) {
  try {
    const body: ModelsRequest = await req.json();
    const { provider } = body;

    const apiKey = getApiKey(provider);

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }

    let models: { id: string; name: string; inputPrice?: number; outputPrice?: number }[] = [];

    switch (provider) {
      case "openrouter": {
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);
        const data = await res.json();
        models = (data.data || []).map((m: Record<string, unknown>) => ({
          id: m.id as string,
          name: (m.name as string) || (m.id as string),
          inputPrice: m.pricing
            ? parseFloat((m.pricing as Record<string, string>).prompt || "0") * 1_000_000
            : undefined,
          outputPrice: m.pricing
            ? parseFloat((m.pricing as Record<string, string>).completion || "0") * 1_000_000
            : undefined,
        }));
        break;
      }

      case "gemini": {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models`,
          { headers: { "x-goog-api-key": apiKey } }
        );
        if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
        const data = await res.json();
        models = (data.models || [])
          .filter((m: Record<string, unknown>) =>
            (m.supportedGenerationMethods as string[] || []).includes("generateContent")
          )
          .map((m: Record<string, unknown>) => ({
            id: (m.name as string).replace("models/", ""),
            name: (m.displayName as string) || (m.name as string),
          }));
        break;
      }

      case "claude": {
        // Anthropic models endpoint
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        });
        if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
        const data = await res.json();
        models = (data.data || [])
          .map((m: Record<string, string>) => ({
            id: m.id,
            name: m.display_name || m.id,
          }))
          .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
        break;
      }

      case "openai": {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
        const data = await res.json();
        models = (data.data || [])
          .filter((m: Record<string, string>) =>
            m.id.startsWith("gpt-") || m.id.startsWith("o") || m.id.startsWith("chatgpt-")
          )
          .map((m: Record<string, string>) => ({
            id: m.id,
            name: m.id,
          }))
          .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
        break;
      }

      default:
        return NextResponse.json(
          { error: "Unknown provider" },
          { status: 400 }
        );
    }

    return NextResponse.json({ models });
  } catch (err: unknown) {
    console.error("Models fetch error:", err);
    const raw = err instanceof Error ? err.message : "Failed to fetch models";
    const message = sanitizeErrorMessage(raw);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
