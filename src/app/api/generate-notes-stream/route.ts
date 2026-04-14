import { NextRequest, NextResponse } from "next/server";
import { AIProvider, OutputLanguage, OUTPUT_LANGUAGE_NAMES } from "@/lib/types";
import { getApiKey } from "@/lib/key-store";
import { callAI, sanitizeErrorMessage } from "@/lib/ai-client";

export const maxDuration = 120;

interface StreamNotesRequest {
  provider: AIProvider;
  modelId: string;
  prompt: string;
  context: string;
  outputLanguage?: OutputLanguage;
}

export async function POST(req: NextRequest) {
  try {
    const body: StreamNotesRequest = await req.json();
    const { provider, modelId, prompt, context } = body;

    if (!provider || !modelId || !prompt) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const apiKey = getApiKey(provider);
    if (!apiKey) {
      return NextResponse.json({ error: "API key not configured for this provider" }, { status: 400 });
    }

    const outputLanguage = body.outputLanguage ?? "en";
    const langName = OUTPUT_LANGUAGE_NAMES[outputLanguage];

    const systemPrompt = `You are an expert presenter and presentation coach.

Your task: Generate presenter notes based on the user's instructions and the context provided.

CRITICAL RULES:
1. Write ALL output in ${langName}.
2. Follow the user's prompt instructions exactly.
3. Output ONLY plain text — the actual notes the presenter will read aloud.
4. NEVER wrap the output in JSON, arrays, objects, code fences, or any structured format.
5. NEVER include keys like "presenter_notes", "notes", "text", or similar.
6. Do NOT truncate or cut the text short. Write complete, finished notes that end naturally with a proper closing sentence.
7. Start writing the notes directly — no preamble, no explanation.`;

    const userPrompt = `INSTRUCTIONS:\n${prompt}\n\nCONTEXT:\n${context}`;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await callAI(provider, modelId, apiKey, systemPrompt, userPrompt, 16000, {
            stream: true,
            onTextChunk: (chunk) => {
              const sseData = `data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`;
              controller.enqueue(encoder.encode(sseData));
            },
          });

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          controller.close();
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          const sseData = `data: ${JSON.stringify({ type: "error", content: sanitizeErrorMessage(message) })}\n\n`;
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[generate-notes-stream]", message);
    return NextResponse.json({ error: sanitizeErrorMessage(message) }, { status: 500 });
  }
}
