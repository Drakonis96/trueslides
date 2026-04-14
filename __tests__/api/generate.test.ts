/**
 * @jest-environment node
 */

/**
 * Tests for API route: /api/generate
 */

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("uuid", () => ({
  v4: () => "test-uuid-1234",
}));

// Mock server-side key store and session
jest.mock("@/lib/session", () => ({
  getSessionId: jest.fn().mockResolvedValue("test-session-id"),
}));

const mockGetApiKey = jest.fn();
jest.mock("@/lib/key-store", () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
}));

jest.mock("@/lib/rate-limit", () => ({
  rateLimiters: {
    ai: { check: jest.fn().mockReturnValue({ allowed: true }) },
  },
}));

import { POST } from "@/app/api/generate/route";
import { NextRequest } from "next/server";

function createRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  provider: "openrouter" as const,
  modelId: "openai/gpt-4",
  slideCount: 5,
  textDensity: 30,
  prompts: {
    design: "Corporate style",
    text: "Detailed content",
    notes: "Detailed presenter notes",
  },
  sourceText: "This is a test document about artificial intelligence and its applications.",
};

const validAIResponse = JSON.stringify({
  title: "AI Applications",
  slides: [
    {
      title: "Introduction to AI",
      bullets: ["What is AI?", "History", "Key concepts"],
      notes: "Start with an overview of AI.",
      section: "Introduction",
      imageSearchTerms: ["artificial intelligence", "neural network"],
    },
    {
      title: "Applications",
      bullets: ["Healthcare", "Finance", "Education"],
      notes: "Discuss practical applications.",
      section: "Applications",
      imageSearchTerms: ["AI healthcare", "machine learning"],
    },
  ],
});

beforeEach(() => {
  mockFetch.mockReset();
  mockGetApiKey.mockReset();
  mockGetApiKey.mockReturnValue("test-key");
});

/** Create a mock fetch response that simulates SSE streaming (OpenRouter/OpenAI). */
function createSSEMock(content: string) {
  let readCount = 0;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  if (content) {
    const payload = JSON.stringify({ choices: [{ delta: { content } }] });
    chunks.push(encoder.encode(`data: ${payload}\n\n`));
  }
  chunks.push(encoder.encode(`data: [DONE]\n\n`));

  return {
    ok: true,
    body: {
      getReader() {
        return {
          read(): Promise<{ done: boolean; value?: Uint8Array }> {
            if (readCount < chunks.length) {
              return Promise.resolve({ done: false, value: chunks[readCount++] });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    },
  };
}

describe("POST /api/generate", () => {
  it("should reject request without API key", async () => {
    mockGetApiKey.mockReturnValue(null);
    const req = createRequest(validBody);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("API key is required");
  });

  it("should reject request without source text", async () => {
    const req = createRequest({ ...validBody, sourceText: "" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Source text is required");
  });

  it("should generate presentation via OpenRouter", async () => {
    mockFetch.mockResolvedValueOnce(createSSEMock(validAIResponse));

    const req = createRequest(validBody);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.title).toBe("AI Applications");
    expect(data.slides).toHaveLength(2);
    expect(data.slides[0].title).toBe("Introduction to AI");
    expect(data.slides[0].bullets).toHaveLength(3);
    expect(data.slides[0].notes).toBeTruthy();
    expect(data.slides[0].imageSearchTerms).toBeDefined();
  });

  it("should generate presentation via Gemini", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: validAIResponse }] } },
        ],
      }),
    });

    const req = createRequest({ ...validBody, provider: "gemini", modelId: "gemini-pro" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.title).toBe("AI Applications");

    // Verify Gemini API endpoint was called
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("generativelanguage.googleapis.com"),
      expect.anything()
    );
  });

  it("should generate presentation via Claude", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: validAIResponse }],
      }),
    });

    const req = createRequest({ ...validBody, provider: "claude", modelId: "claude-sonnet-4-20250514" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.title).toBe("AI Applications");

    // Verify Claude API endpoint
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "test-key",
          "anthropic-version": "2023-06-01",
        }),
      })
    );
  });

  it("should generate presentation via OpenAI", async () => {
    mockFetch.mockResolvedValueOnce(createSSEMock(validAIResponse));

    const req = createRequest({ ...validBody, provider: "openai", modelId: "gpt-4" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.title).toBe("AI Applications");

    // Verify OpenAI endpoint with json_object response format
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.response_format).toEqual({ type: "json_object" });
  });

  it("should handle empty AI response", async () => {
    mockFetch.mockResolvedValueOnce(createSSEMock(""));

    const req = createRequest(validBody);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.error).toContain("empty response");
  });

  it("should handle AI API failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal error" }),
    });

    const req = createRequest(validBody);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBeTruthy();
  });

  it("should handle malformed AI JSON response", async () => {
    mockFetch.mockResolvedValueOnce(createSSEMock("This is not JSON at all"));

    const req = createRequest(validBody);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBeTruthy();
  });

  it("should extract JSON from markdown code block in response", async () => {
    const wrappedResponse = "```json\n" + validAIResponse + "\n```";
    mockFetch.mockResolvedValueOnce(createSSEMock(wrappedResponse));

    const req = createRequest(validBody);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.title).toBe("AI Applications");
  });

  it("should send correct headers for OpenRouter", async () => {
    mockFetch.mockResolvedValueOnce(createSSEMock(validAIResponse));

    const req = createRequest(validBody);
    await POST(req);

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["Authorization"]).toBe("Bearer test-key");
    expect(headers["HTTP-Referer"]).toBe("https://trueslides.app");
    expect(headers["X-Title"]).toBe("TrueSlides");
  });

  it("should backfill image search terms when the model omits them", async () => {
    mockFetch.mockResolvedValueOnce(createSSEMock(JSON.stringify({
      title: "Visual Deck",
      slides: [
        {
          title: "Smart Factory",
          bullets: ["Automation", "Sensors"],
          notes: "Talk about industrial automation.",
          section: "Manufacturing",
        },
      ],
    })));

    const req = createRequest(validBody);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.slides[0].imageSearchTerms).toEqual([
      "Manufacturing Smart Factory",
      "Smart Factory",
    ]);
  });
});
