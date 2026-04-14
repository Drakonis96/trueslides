/**
 * @jest-environment node
 */

/**
 * Tests for API error paths
 *
 * Covers: missing API key, invalid input, rate limiting, empty AI responses,
 * and upstream failures across multiple API routes.
 */

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("uuid", () => ({ v4: () => "error-test-uuid" }));

jest.mock("@/lib/session", () => ({
  getSessionId: jest.fn().mockResolvedValue("error-session"),
}));

const mockGetApiKey = jest.fn();
const mockGetImageSourceKey = jest.fn(() => null);
jest.mock("@/lib/key-store", () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
  getImageSourceKey: (...args: unknown[]) => mockGetImageSourceKey(...args),
}));

const mockAiCheck = jest.fn().mockReturnValue({ allowed: true });
const mockImageCheck = jest.fn().mockReturnValue({ allowed: true });
const mockUploadCheck = jest.fn().mockReturnValue({ allowed: true });
jest.mock("@/lib/rate-limit", () => ({
  rateLimiters: {
    ai: { check: (...args: unknown[]) => mockAiCheck(...args) },
    image: { check: (...args: unknown[]) => mockImageCheck(...args) },
    upload: { check: (...args: unknown[]) => mockUploadCheck(...args) },
  },
}));

jest.mock("@/lib/ai-client", () => ({
  callAI: jest.fn().mockResolvedValue(""),
  callAIVision: jest.fn().mockResolvedValue(""),
  sanitizeErrorMessage: jest.fn((msg: string) => msg),
}));

jest.mock("@/lib/state-store", () => ({
  getUserState: jest.fn().mockReturnValue(null),
  setUserState: jest.fn(),
}));

jest.mock("mammoth", () => ({
  extractRawText: jest.fn().mockRejectedValue(new Error("mammoth parse error")),
}));

jest.mock("pdf-parse", () => {
  const fn = jest.fn().mockRejectedValue(new Error("pdf-parse failure"));
  return { __esModule: true, default: fn };
});

import { NextRequest } from "next/server";
import { POST as generatePOST } from "@/app/api/generate/route";
import { POST as editPOST } from "@/app/api/edit/route";
import { POST as modelsPOST } from "@/app/api/models/route";
import { POST as imagesPOST } from "@/app/api/images/route";
import { POST as variantsPOST } from "@/app/api/slide-variants/route";
import { POST as parsePOST } from "@/app/api/parse/route";
import { imageSearchCache } from "@/lib/image-cache";

function createJsonRequest(url: string, body: object): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createFileRequest(fileName: string, content: string, type: string): NextRequest {
  const file = new File([content], fileName, { type });
  const formData = new FormData();
  formData.append("file", file);
  return new NextRequest("http://localhost:3000/api/parse", { method: "POST", body: formData });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockGetApiKey.mockReset().mockReturnValue("test-key");
  mockGetImageSourceKey.mockReset().mockReturnValue(null);
  mockAiCheck.mockReset().mockReturnValue({ allowed: true });
  mockImageCheck.mockReset().mockReturnValue({ allowed: true });
  mockUploadCheck.mockReset().mockReturnValue({ allowed: true });
  imageSearchCache.clear();
});

// ── /api/generate error paths ──

describe("POST /api/generate — error paths", () => {
  const validBody = {
    provider: "openrouter" as const,
    modelId: "openai/gpt-4",
    slideCount: 5,
    textDensity: 30,
    prompts: { design: "", text: "", notes: "" },
    sourceText: "Test content for slides.",
  };

  it("rejects missing API key", async () => {
    mockGetApiKey.mockReturnValue(null);
    const res = await generatePOST(createJsonRequest("http://localhost:3000/api/generate", validBody));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("required");
  });

  it("rejects empty source text", async () => {
    const res = await generatePOST(createJsonRequest("http://localhost:3000/api/generate", {
      ...validBody,
      sourceText: "   ",
    }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("required");
  });

  it("rejects when rate limited", async () => {
    mockAiCheck.mockReturnValue({ allowed: false, retryAfterMs: 5000 });
    const res = await generatePOST(createJsonRequest("http://localhost:3000/api/generate", validBody));
    const data = await res.json();
    expect(res.status).toBe(429);
    expect(data.error).toContain("Too many requests");
    expect(res.headers.get("Retry-After")).toBeDefined();
  });
});

// ── /api/edit error paths ──

describe("POST /api/edit — error paths", () => {
  const validBody = {
    provider: "openrouter" as const,
    modelId: "openai/gpt-4",
    instruction: "Make it better",
    slides: [{ id: "s1", index: 0, title: "T", bullets: ["B"], notes: "", section: "S" }],
    targetIndices: "all" as const,
  };

  it("rejects missing API key", async () => {
    mockGetApiKey.mockReturnValue(null);
    const res = await editPOST(createJsonRequest("http://localhost:3000/api/edit", validBody));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("required");
  });

  it("rejects empty instruction", async () => {
    const res = await editPOST(createJsonRequest("http://localhost:3000/api/edit", {
      ...validBody,
      instruction: "   ",
    }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("required");
  });

  it("handles AI returning empty response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "" } }] }),
    });
    const res = await editPOST(createJsonRequest("http://localhost:3000/api/edit", validBody));
    const data = await res.json();
    expect(res.status).toBe(502);
    expect(data.error).toContain("empty");
  });

  it("handles AI upstream failure (500)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });
    const res = await editPOST(createJsonRequest("http://localhost:3000/api/edit", validBody));
    const data = await res.json();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(data.error).toBeDefined();
  });

  it("rejects when rate limited", async () => {
    mockAiCheck.mockReturnValue({ allowed: false, retryAfterMs: 3000 });
    const res = await editPOST(createJsonRequest("http://localhost:3000/api/edit", validBody));
    const data = await res.json();
    expect(res.status).toBe(429);
  });
});

// ── /api/models error paths ──

describe("POST /api/models — error paths", () => {
  it("rejects missing API key", async () => {
    mockGetApiKey.mockReturnValue(null);
    const res = await modelsPOST(createJsonRequest("http://localhost:3000/api/models", { provider: "openrouter" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe("API key is required");
  });

  it("handles upstream API failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    const res = await modelsPOST(createJsonRequest("http://localhost:3000/api/models", { provider: "openrouter" }));
    const data = await res.json();
    expect(res.status).toBe(500);
    expect(data.error).toBeDefined();
  });

  it("handles network timeout / fetch rejection", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fetch failed: ETIMEDOUT"));
    const res = await modelsPOST(createJsonRequest("http://localhost:3000/api/models", { provider: "openrouter" }));
    const data = await res.json();
    expect(res.status).toBe(500);
    expect(data.error).toBeDefined();
  });
});

// ── /api/images error paths ──

describe("POST /api/images — error paths", () => {
  it("rejects non-array searchTerms", async () => {
    const res = await imagesPOST(createJsonRequest("http://localhost:3000/api/images", {
      searchTerms: "not an array",
    }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("array");
  });

  it("rejects when image rate limited", async () => {
    mockImageCheck.mockReturnValue({ allowed: false, retryAfterMs: 2000 });
    const res = await imagesPOST(createJsonRequest("http://localhost:3000/api/images", {
      searchTerms: [["test"]],
    }));
    const data = await res.json();
    expect(res.status).toBe(429);
  });

  it("handles Wikimedia API failure gracefully", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "Service Unavailable",
    });
    const res = await imagesPOST(createJsonRequest("http://localhost:3000/api/images", {
      searchTerms: [["artificial intelligence"]],
    }));
    // Should not crash — returns 200 with empty results
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.images).toBeDefined();
  });
});

// ── /api/slide-variants error paths ──

describe("POST /api/slide-variants — error paths", () => {
  const validBody = {
    provider: "openrouter" as const,
    modelId: "openai/gpt-4",
    slide: { title: "Test", bullets: ["A"], notes: "", section: "S" },
    count: 3,
  };

  it("rejects missing API key", async () => {
    mockGetApiKey.mockReturnValue(null);
    const res = await variantsPOST(createJsonRequest("http://localhost:3000/api/slide-variants", validBody));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("required");
  });

  it("rejects when rate limited", async () => {
    mockAiCheck.mockReturnValue({ allowed: false, retryAfterMs: 10000 });
    const res = await variantsPOST(createJsonRequest("http://localhost:3000/api/slide-variants", validBody));
    const data = await res.json();
    expect(res.status).toBe(429);
    expect(data.error).toContain("Too many requests");
  });
});

// ── /api/parse error paths ──

describe("POST /api/parse — error paths", () => {
  it("rejects when upload rate limited", async () => {
    mockUploadCheck.mockReturnValue({ allowed: false, retryAfterMs: 1000 });
    const req = createFileRequest("doc.txt", "content", "text/plain");
    const res = await parsePOST(req);
    const data = await res.json();
    expect(res.status).toBe(429);
    expect(data.error).toContain("Too many");
  });

  it("rejects missing file", async () => {
    const formData = new FormData();
    const req = new NextRequest("http://localhost:3000/api/parse", { method: "POST", body: formData });
    const res = await parsePOST(req);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe("No file provided");
  });

  it("rejects empty text file", async () => {
    const req = createFileRequest("empty.txt", "   ", "text/plain");
    const res = await parsePOST(req);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("empty");
  });

  it("rejects unsupported file type", async () => {
    const req = createFileRequest("data.csv", "a,b,c", "text/csv");
    const res = await parsePOST(req);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("Unsupported");
  });

  it("handles DOCX parse failure", async () => {
    const req = createFileRequest(
      "corrupt.docx",
      "corrupted-binary",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const res = await parsePOST(req);
    const data = await res.json();
    // mammoth mock throws, so this should be a 500 or handled error
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(data.error).toBeDefined();
  });

  it("handles PDF parse failure", async () => {
    const req = createFileRequest("corrupt.pdf", "corrupted", "application/pdf");
    const res = await parsePOST(req);
    const data = await res.json();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(data.error).toBeDefined();
  });
});
