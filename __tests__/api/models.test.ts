/**
 * @jest-environment node
 */

/**
 * Tests for API route: /api/models
 */

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock server-side key store and session
jest.mock("@/lib/session", () => ({
  getSessionId: jest.fn().mockResolvedValue("test-session-id"),
}));

const mockGetApiKey = jest.fn();
jest.mock("@/lib/key-store", () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
}));

import { POST } from "@/app/api/models/route";
import { NextRequest } from "next/server";

function createRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockGetApiKey.mockReset();
  mockGetApiKey.mockReturnValue("test-key");
});

describe("POST /api/models", () => {
  it("should reject missing API key", async () => {
    mockGetApiKey.mockReturnValue(null);
    const req = createRequest({ provider: "openrouter" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("API key is required");
  });

  it("should return Claude models via API call", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" },
          { id: "claude-3-5-haiku-20241022", display_name: "Claude 3.5 Haiku" },
        ],
      }),
    });

    const req = createRequest({ provider: "claude" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.models.length).toBe(2);
    expect(data.models[0].id).toContain("claude");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should fetch OpenRouter models", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "openai/gpt-4",
            name: "GPT-4",
            pricing: { prompt: "0.00003", completion: "0.00006" },
          },
          {
            id: "anthropic/claude-3",
            name: "Claude 3",
            pricing: { prompt: "0.000015", completion: "0.000075" },
          },
        ],
      }),
    });

    const req = createRequest({ provider: "openrouter" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.models).toHaveLength(2);
    expect(data.models[0].id).toBe("openai/gpt-4");
    expect(data.models[0].inputPrice).toBeDefined();
    expect(data.models[0].outputPrice).toBeDefined();

    // Verify the correct API was called
    expect(mockFetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-key" },
      })
    );
  });

  it("should fetch Gemini models and filter by generateContent", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          {
            name: "models/gemini-pro",
            displayName: "Gemini Pro",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/embedding-001",
            displayName: "Embedding",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      }),
    });

    const req = createRequest({ provider: "gemini" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.models).toHaveLength(1);
    expect(data.models[0].id).toBe("gemini-pro");
    expect(data.models[0].name).toBe("Gemini Pro");
  });

  it("should fetch OpenAI models and filter by gpt/o/chatgpt prefixes", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: "gpt-4", owned_by: "openai" },
          { id: "gpt-3.5-turbo", owned_by: "openai" },
          { id: "dall-e-3", owned_by: "openai" },
          { id: "whisper-1", owned_by: "openai" },
          { id: "o1-preview", owned_by: "openai" },
        ],
      }),
    });

    const req = createRequest({ provider: "openai" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    // Only gpt-* and o* models should be included
    const ids = data.models.map((m: { id: string }) => m.id);
    expect(ids).toContain("gpt-4");
    expect(ids).toContain("gpt-3.5-turbo");
    expect(ids).toContain("o1-preview");
    expect(ids).not.toContain("dall-e-3");
    expect(ids).not.toContain("whisper-1");
  });

  it("should handle API error from OpenRouter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    const req = createRequest({ provider: "openrouter" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toContain("OpenRouter API error");
  });

  it("should handle unknown provider", async () => {
    const req = createRequest({ provider: "unknown" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Unknown provider");
  });
});
