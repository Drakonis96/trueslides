/**
 * @jest-environment node
 */

/**
 * Tests for API route: /api/edit
 */

jest.mock("uuid", () => ({ v4: () => "mock-uuid-id" }));

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

import { POST } from "@/app/api/edit/route";
import { NextRequest } from "next/server";

function createRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseSlides = [
  {
    id: "slide-1",
    index: 0,
    title: "Introduction",
    bullets: ["Point A", "Point B"],
    notes: "Introduction notes",
    section: "Intro",
  },
  {
    id: "slide-2",
    index: 1,
    title: "Details",
    bullets: ["Detail 1", "Detail 2"],
    notes: "Details notes",
    section: "Main",
  },
];

const validBody = {
  provider: "openrouter" as const,
  modelId: "openai/gpt-4",
  instruction: "Make the bullets more concise",
  slides: baseSlides,
  targetIndices: "all" as const,
};

beforeEach(() => {
  mockFetch.mockReset();
  mockGetApiKey.mockReset();
  mockGetApiKey.mockReturnValue("test-key");
});

describe("POST /api/edit", () => {
  it("should reject missing API key", async () => {
    mockGetApiKey.mockReturnValue(null);
    const req = createRequest(validBody);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("required");
  });

  it("should reject empty instruction", async () => {
    const req = createRequest({ ...validBody, instruction: "  " });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("required");
  });

  it("should call AI and return edited slides", async () => {
    const editedResponse = JSON.stringify({
      slides: [
        {
          id: "slide-1",
          index: 0,
          title: "Introduction",
          bullets: ["A", "B"],
          notes: "Brief notes",
          section: "Intro",
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: editedResponse } }],
      }),
    });

    const req = createRequest(validBody);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.slides).toBeDefined();
    expect(data.slides[0].bullets).toEqual(["A", "B"]);
  });

  it("should handle AI returning empty response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "" } }],
      }),
    });

    const req = createRequest(validBody);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.error).toContain("empty");
  });

  it("should handle specific slide targeting", async () => {
    const editedResponse = JSON.stringify({
      slides: [
        {
          id: "slide-2",
          index: 1,
          title: "Updated Details",
          bullets: ["New 1"],
          notes: "Updated notes",
          section: "Main",
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: editedResponse } }],
      }),
    });

    const req = createRequest({
      ...validBody,
      targetIndices: [1],
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.slides[0].title).toBe("Updated Details");
  });
});
