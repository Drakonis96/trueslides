import { NextRequest, NextResponse } from "next/server";
import { AIProvider } from "@/lib/types";
import { getApiKey } from "@/lib/key-store";
import { callAI, sanitizeErrorMessage } from "@/lib/ai-client";

export type ChatMode = "presenter-voice" | "bullet-reminders" | "brief-elaboration";

interface PresenterChatRequest {
  provider: AIProvider;
  modelId: string;
  mode: ChatMode;
  userMessage: string;
  /** All presenter notes concatenated or per-slide */
  allNotes: string;
  presentationTitle: string;
  currentSlideIndex: number;
  currentSlideTitle: string;
}

const MODE_INSTRUCTIONS: Record<ChatMode, string> = {
  "presenter-voice": `You are the presenter delivering this presentation live. Respond in FIRST PERSON as if you are the one presenting. Speak naturally and confidently, using "I", "we", "let me explain", etc. Your tone should be engaging and professional, as if you are addressing the audience directly.`,
  "bullet-reminders": `Provide a concise numbered list of the key points about the topic. Use a numbered markdown list (1. 2. 3. etc.) with 3-7 items. Each item should be a short, clear reminder — not a full sentence. Example format:
1. First key point
2. Second key point
3. Third key point`,
  "brief-elaboration": `Provide a brief elaboration on the requested topic. Keep it to a MAXIMUM of 3 short paragraphs. Be informative but concise. Draw from the presentation notes for context but add depth and clarity.`,
};

/**
 * If the AI returned raw JSON (array or object), convert it to readable markdown.
 */
function formatJsonResponse(text: string, mode: ChatMode): string {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      // Convert JSON array to numbered list
      return parsed.map((item, i) => `${i + 1}. ${String(item)}`).join("\n");
    }
    if (typeof parsed === "object" && parsed !== null) {
      // Handle { summary: [...] } or similar wrappers
      const values = Object.values(parsed);
      if (values.length === 1 && Array.isArray(values[0])) {
        return (values[0] as string[]).map((item, i) => `${i + 1}. ${String(item)}`).join("\n");
      }
      // Generic object: format as key-value list
      return Object.entries(parsed)
        .map(([k, v]) => `**${k}:** ${String(v)}`)
        .join("\n\n");
    }
  } catch {
    // Not JSON — return as-is
  }
  return text;
}

export async function POST(req: NextRequest) {
  try {
    const body: PresenterChatRequest = await req.json();
    const { provider, modelId, mode, userMessage, allNotes, presentationTitle, currentSlideIndex, currentSlideTitle } = body;

    if (!provider || !modelId || !userMessage) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const apiKey = getApiKey(provider);
    if (!apiKey) {
      return NextResponse.json({ error: "API key not configured for this provider" }, { status: 400 });
    }

    const modeInstruction = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS["presenter-voice"];

    const systemPrompt = `You are an AI assistant helping a presenter during a live presentation.

Presentation title: "${presentationTitle}"
Currently on slide ${currentSlideIndex + 1}: "${currentSlideTitle}"

${modeInstruction}

IMPORTANT: Always respond in plain readable text or markdown. NEVER respond with JSON, code blocks, arrays, or raw data structures.

Here are ALL the presenter notes for the entire presentation — use them as your knowledge base:

---
${allNotes}
---

Answer the user's question or request based on the presentation content above. Stay focused on the presentation topic. Be helpful and concise.`;

    // Stream the response via SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullText = "";
          await callAI(provider, modelId, apiKey, systemPrompt, userMessage, 2000, {
            stream: true,
            onTextChunk: (chunk) => {
              fullText += chunk;
              const sseData = `data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`;
              controller.enqueue(encoder.encode(sseData));
            },
          });

          // Post-process: if the full response was JSON, send a corrected version
          const formatted = formatJsonResponse(fullText, mode);
          if (formatted !== fullText) {
            const sseData = `data: ${JSON.stringify({ type: "replace", content: formatted })}\n\n`;
            controller.enqueue(encoder.encode(sseData));
          }

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
    console.error("[presenter-chat]", message);
    return NextResponse.json({ error: sanitizeErrorMessage(message) }, { status: 500 });
  }
}
