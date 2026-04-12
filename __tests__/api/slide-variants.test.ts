/**
 * @jest-environment node
 */

/**
 * Tests for API route: /api/slide-variants
 */

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/session", () => ({
  getSessionId: jest.fn().mockResolvedValue("test-session-id"),
}));

const mockGetApiKey = jest.fn();
jest.mock("@/lib/key-store", () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
}));

import { POST } from "@/app/api/slide-variants/route";
import { NextRequest } from "next/server";

function createRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/slide-variants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  provider: "openrouter" as const,
  modelId: "openai/gpt-4",
  count: 3,
  language: "English",
  slide: {
    title: "Existing slide",
    bullets: ["Point 1", "Point 2"],
    notes: "Speaker notes",
    section: "Intro",
    accentColor: "6366F1",
    imageSearchTerms: ["city skyline", "urban night", "architecture"],
  },
};

beforeEach(() => {
  mockFetch.mockReset();
  mockGetApiKey.mockReset();
  mockGetApiKey.mockReturnValue("test-key");
});

describe("POST /api/slide-variants", () => {
  it("should reject missing API key", async () => {
    mockGetApiKey.mockReturnValue(null);

    const req = createRequest(validBody);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("required");
  });

  it("should reject missing slide", async () => {
    const req = createRequest({ ...validBody, slide: { ...validBody.slide, title: "" } });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("Slide data");
  });

  it("should return variants", async () => {
    const response = JSON.stringify({
      variants: [
        {
          title: "Variant A",
          bullets: ["A1", "A2"],
          notes: "Notes A",
          section: "Intro",
          imageSearchTerms: ["modern city", "night skyline", "urban lights"],
        },
        {
          title: "Variant B",
          bullets: ["B1", "B2"],
          notes: "Notes B",
          section: "Intro",
          imageSearchTerms: ["city street", "downtown", "architecture"],
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: response } }],
      }),
    });

    const req = createRequest({ ...validBody, count: 2 });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data.variants)).toBe(true);
    expect(data.variants).toHaveLength(2);
    expect(data.variants[0].title).toBe("Variant A");
  });
});