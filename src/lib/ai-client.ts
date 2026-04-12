import { AIProvider } from "./types";

const AI_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes — large presentations need time

// ── Error sanitisation ──

/** Redact potential API keys / tokens from error details before they reach clients. */
export function sanitizeErrorMessage(raw: string): string {
  // Strip common key patterns: Bearer tokens, API keys, long hex/base64 strings in URLs
  let safe = raw
    .replace(/key=[^&\s"'}]+/gi, "key=[REDACTED]")
    .replace(/Bearer\s+[^\s"'}]+/gi, "Bearer [REDACTED]")
    .replace(/x-api-key:\s*[^\s"'}]+/gi, "x-api-key: [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, "[REDACTED]");
  return safe;
}

interface CallAIOptions {
  stream?: boolean;
  onTextChunk?: (chunk: string) => void;
  /** When true, ask providers that support it for guaranteed JSON output. */
  jsonMode?: boolean;
  /**
   * Static user-message prefix to cache (e.g. source document).
   * Claude / OpenRouter→Claude: marked with cache_control breakpoints.
   * OpenAI: automatic prefix caching (prefix simply prepended).
   * Gemini: no explicit caching API, prefix simply prepended.
   */
  cachedUserPrefix?: string;
}

async function readSSEContent(
  res: Response,
  extractContent: (payload: Record<string, unknown>) => string,
  onTextChunk?: (chunk: string) => void,
): Promise<string> {
  if (!res.body) return "";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;

      const payloadStr = line.slice(5).trim();
      if (!payloadStr || payloadStr === "[DONE]") continue;

      try {
        const payload = JSON.parse(payloadStr) as Record<string, unknown>;
        const chunk = extractContent(payload);
        if (!chunk) continue;
        fullText += chunk;
        onTextChunk?.(chunk);
      } catch {
        // Ignore malformed SSE lines and continue reading.
      }
    }
  }

  return fullText;
}

export async function callAI(
  provider: AIProvider,
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 16000,
  options?: CallAIOptions,
): Promise<string> {
  const signal = AbortSignal.timeout(AI_TIMEOUT_MS);
  switch (provider) {
    case "openrouter": {
      const orCache = options?.cachedUserPrefix;
      const orMessages = [
        { role: "system" as const, content: orCache
          ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
          : systemPrompt },
        { role: "user" as const, content: orCache
          ? [
              { type: "text", text: orCache, cache_control: { type: "ephemeral" } },
              { type: "text", text: userPrompt },
            ]
          : userPrompt },
      ];
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://trueslides.app",
          "X-Title": "TrueSlides",
        },
        body: JSON.stringify({
          model: modelId,
          messages: orMessages,
          max_tokens: maxTokens,
          temperature: 0.7,
          stream: Boolean(options?.stream),
          ...(options?.jsonMode && { response_format: { type: "json_object" } }),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(sanitizeErrorMessage(`OpenRouter error ${res.status}: ${JSON.stringify(errData)}`));
      }
      if (options?.stream) {
        return readSSEContent(
          res,
          (payload) => {
            const choices = payload.choices as Array<Record<string, unknown>> | undefined;
            const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
            return (delta?.content as string | undefined) || "";
          },
          options.onTextChunk,
        );
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "";
    }

    case "gemini": {
      const isStream = Boolean(options?.stream);
      const geminiUserPrompt = options?.cachedUserPrefix
        ? `${options.cachedUserPrefix}\n\n${userPrompt}` : userPrompt;
      const endpoint = isStream ? "streamGenerateContent" : "generateContent";
      const queryParams = isStream ? `?alt=sse` : ``;
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:${endpoint}${queryParams}`,
        {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: geminiUserPrompt }] }],
            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature: 0.7,
              responseMimeType: "application/json",
            },
          }),
        }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(sanitizeErrorMessage(`Gemini error ${res.status}: ${JSON.stringify(errData)}`));
      }
      if (isStream) {
        return readSSEContent(
          res,
          (payload) => {
            const candidates = payload.candidates as Array<Record<string, unknown>> | undefined;
            const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
            const parts = content?.parts as Array<Record<string, unknown>> | undefined;
            return (parts?.[0]?.text as string | undefined) || "";
          },
          options?.onTextChunk,
        );
      }
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    case "claude": {
      const isStream = Boolean(options?.stream);
      const clCache = options?.cachedUserPrefix;
      const clSystem: string | Array<Record<string, unknown>> = clCache
        ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
        : systemPrompt;
      const clUser: string | Array<Record<string, unknown>> = clCache
        ? [
            { type: "text", text: clCache, cache_control: { type: "ephemeral" } },
            { type: "text", text: userPrompt },
          ]
        : userPrompt;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: maxTokens,
          system: clSystem,
          messages: [{ role: "user", content: clUser }],
          ...(isStream && { stream: true }),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(sanitizeErrorMessage(`Claude error ${res.status}: ${JSON.stringify(errData)}`));
      }
      if (isStream) {
        return readSSEContent(
          res,
          (payload) => {
            if (payload.type !== "content_block_delta") return "";
            const delta = payload.delta as Record<string, unknown> | undefined;
            return (delta?.text as string | undefined) || "";
          },
          options?.onTextChunk,
        );
      }
      const data = await res.json();
      return data.content?.[0]?.text || "";
    }

    case "openai": {
      // OpenAI caches automatically by longest matching prefix
      const oaiUserPrompt = options?.cachedUserPrefix
        ? `${options.cachedUserPrefix}\n\n${userPrompt}` : userPrompt;
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: oaiUserPrompt },
          ],
          max_tokens: maxTokens,
          temperature: 0.7,
          response_format: { type: "json_object" },
          stream: Boolean(options?.stream),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(sanitizeErrorMessage(`OpenAI error ${res.status}: ${JSON.stringify(errData)}`));
      }
      if (options?.stream) {
        return readSSEContent(
          res,
          (payload) => {
            const choices = payload.choices as Array<Record<string, unknown>> | undefined;
            const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
            return (delta?.content as string | undefined) || "";
          },
          options.onTextChunk,
        );
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "";
    }

    default:
      throw new Error("Unknown provider");
  }
}

/**
 * Call an AI model with a vision prompt (images + text).
 * Images MUST be passed as base64 data URIs (e.g. "data:image/jpeg;base64,...")
 * so that every provider can handle them reliably without URL-fetching issues.
 */
export async function callAIVision(
  provider: AIProvider,
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  textPrompt: string,
  imageDataUris: string[],
  maxTokens: number = 1000,
  options?: { cachedUserPrefix?: string },
): Promise<string> {
  const signal = AbortSignal.timeout(AI_TIMEOUT_MS);

  switch (provider) {
    case "openrouter": {
      const vrCache = options?.cachedUserPrefix;
      const userContent: Array<Record<string, unknown>> = [];
      if (vrCache) {
        userContent.push({ type: "text", text: vrCache, cache_control: { type: "ephemeral" } });
      }
      for (const dataUri of imageDataUris) {
        userContent.push({ type: "image_url", image_url: { url: dataUri } });
      }
      userContent.push({ type: "text", text: textPrompt });

      const vrSystemContent = vrCache
        ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
        : systemPrompt;

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://trueslides.app",
          "X-Title": "TrueSlides",
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: "system", content: vrSystemContent },
            { role: "user", content: userContent },
          ],
          max_tokens: maxTokens,
          temperature: 0.3,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(sanitizeErrorMessage(`OpenRouter vision error ${res.status}: ${JSON.stringify(errData)}`));
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "";
    }

    case "gemini": {
      const geminiVParts: Array<Record<string, unknown>> = [];
      if (options?.cachedUserPrefix) {
        geminiVParts.push({ text: options.cachedUserPrefix });
      }
      for (const dataUri of imageDataUris) {
        const match = dataUri.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
        if (match) {
          geminiVParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
      }
      geminiVParts.push({ text: textPrompt });

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`,
        {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: geminiVParts }],
            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature: 0.3,
            },
          }),
        }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(sanitizeErrorMessage(`Gemini vision error ${res.status}: ${JSON.stringify(errData)}`));
      }
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    case "claude": {
      const cvCache = options?.cachedUserPrefix;
      const claudeContent: Array<Record<string, unknown>> = [];
      if (cvCache) {
        claudeContent.push({ type: "text", text: cvCache, cache_control: { type: "ephemeral" } });
      }
      for (const dataUri of imageDataUris) {
        const match = dataUri.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
        if (match) {
          claudeContent.push({
            type: "image",
            source: { type: "base64", media_type: match[1], data: match[2] },
          });
        }
      }
      claudeContent.push({ type: "text", text: textPrompt });

      const cvSystem: string | Array<Record<string, unknown>> = cvCache
        ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
        : systemPrompt;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: maxTokens,
          system: cvSystem,
          messages: [{ role: "user", content: claudeContent }],
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(sanitizeErrorMessage(`Claude vision error ${res.status}: ${JSON.stringify(errData)}`));
      }
      const data = await res.json();
      return data.content?.[0]?.text || "";
    }

    case "openai": {
      const oaiVContent: Array<Record<string, unknown>> = [];
      // OpenAI caches by prefix automatically — put cached context first
      if (options?.cachedUserPrefix) {
        oaiVContent.push({ type: "text", text: options.cachedUserPrefix });
      }
      for (const dataUri of imageDataUris) {
        oaiVContent.push({ type: "image_url", image_url: { url: dataUri } });
      }
      oaiVContent.push({ type: "text", text: textPrompt });

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: oaiVContent },
          ],
          max_tokens: maxTokens,
          temperature: 0.3,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(sanitizeErrorMessage(`OpenAI vision error ${res.status}: ${JSON.stringify(errData)}`));
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "";
    }

    default:
      throw new Error("Unknown provider");
  }
}
