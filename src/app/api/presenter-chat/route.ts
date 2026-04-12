import { NextRequest, NextResponse } from "next/server";
import { AIProvider } from "@/lib/types";
import { getApiKey } from "@/lib/key-store";
import { getSessionId } from "@/lib/session";
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
  "bullet-reminders": `Provide a concise bullet-point summary of what has been said or should be said about the topic. Use short, clear bullet points (3-7 points). Each bullet should be a quick reminder, not a full sentence. Format as a markdown list.`,
  "brief-elaboration": `Provide a brief elaboration on the requested topic. Keep it to a MAXIMUM of 3 short paragraphs. Be informative but concise. Draw from the presentation notes for context but add depth and clarity.`,
};

export async function POST(req: NextRequest) {
  try {
    const body: PresenterChatRequest = await req.json();
    const { provider, modelId, mode, userMessage, allNotes, presentationTitle, currentSlideIndex, currentSlideTitle } = body;

    if (!provider || !modelId || !userMessage) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const sessionId = await getSessionId();
    const apiKey = getApiKey(sessionId, provider);
    if (!apiKey) {
      return NextResponse.json({ error: "API key not configured for this provider" }, { status: 400 });
    }

    const modeInstruction = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS["presenter-voice"];

    const systemPrompt = `You are an AI assistant helping a presenter during a live presentation.

Presentation title: "${presentationTitle}"
Currently on slide ${currentSlideIndex + 1}: "${currentSlideTitle}"

${modeInstruction}

Here are ALL the presenter notes for the entire presentation — use them as your knowledge base:

---
${allNotes}
---

Answer the user's question or request based on the presentation content above. Stay focused on the presentation topic. Be helpful and concise.`;

    const response = await callAI(provider, modelId, apiKey, systemPrompt, userMessage, 2000);

    return NextResponse.json({ response });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[presenter-chat]", message);
    return NextResponse.json({ error: sanitizeErrorMessage(message) }, { status: 500 });
  }
}
