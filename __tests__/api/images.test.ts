/**
 * @jest-environment node
 */

/**
 * Tests for API route: /api/images
 */

const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock server-side dependencies used by the enhanced images route
jest.mock("@/lib/session", () => ({
  getSessionId: jest.fn().mockResolvedValue("test-session-id"),
}));
jest.mock("@/lib/key-store", () => ({
  getApiKey: jest.fn().mockReturnValue(null),
  getImageSourceKey: jest.fn().mockReturnValue(null),
}));
jest.mock("@/lib/ai-client", () => ({
  callAI: jest.fn().mockResolvedValue(""),
  callAIVision: jest.fn().mockResolvedValue(""),
}));
jest.mock("@/lib/state-store", () => ({
  getUserState: jest.fn().mockReturnValue(null),
  setUserState: jest.fn(),
}));

import { POST } from "@/app/api/images/route";
import { callAI } from "@/lib/ai-client";
import { getApiKey, getImageSourceKey } from "@/lib/key-store";
import { imageSearchCache } from "@/lib/image-cache";
import { NextRequest } from "next/server";

function createRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  imageSearchCache.clear();
  (callAI as jest.Mock).mockReset().mockResolvedValue("");
  (getApiKey as jest.Mock).mockReset().mockReturnValue(null);
  (getImageSourceKey as jest.Mock).mockReset().mockReturnValue(null);
});

describe("POST /api/images", () => {
  it("should reject invalid searchTerms", async () => {
    const req = createRequest({ searchTerms: "not an array" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("array");
  });

  it("should fetch images from Wikimedia Commons", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "123": {
              title: "File:Test.jpg",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/test.jpg",
                  thumburl: "https://upload.wikimedia.org/test_thumb.jpg",
                  width: 800,
                  height: 600,
                  mime: "image/jpeg",
                },
              ],
            },
          },
        },
      }),
    });

    const req = createRequest({
      searchTerms: [["artificial intelligence"]],
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.images).toHaveLength(1);
    expect(data.images[0]).toHaveLength(1);
    expect(data.images[0][0].thumbUrl).toContain("wikimedia");
  });

  it("should handle multiple slides worth of search terms", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "1": {
              title: "File:Img.png",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/img.png",
                  thumburl: "https://upload.wikimedia.org/img_thumb.png",
                  width: 400,
                  height: 300,
                  mime: "image/png",
                },
              ],
            },
          },
        },
      }),
    });

    const req = createRequest({
      searchTerms: [
        ["term1", "term2"],
        ["term3", "term4"],
        ["term5"],
      ],
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.images).toHaveLength(3);
  });

  it("should handle empty search terms for a slide", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ query: { pages: {} } }),
    });

    const req = createRequest({
      searchTerms: [[], ["term1"]],
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.images).toHaveLength(2);
    expect(data.images[0]).toEqual([]);
  });

  it("should handle Wikimedia API returning no pages", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}), // No query.pages
    });

    const req = createRequest({
      searchTerms: [["nonexistent term"]],
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.images[0]).toEqual([]);
  });

  it("should filter out non-image mime types", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "1": {
              title: "File:Video.mp4",
              imageinfo: [
                {
                  url: "https://example.com/video.mp4",
                  width: 1920,
                  height: 1080,
                  mime: "video/mp4",
                },
              ],
            },
            "2": {
              title: "File:Image.jpg",
              imageinfo: [
                {
                  url: "https://example.com/img.jpg",
                  thumburl: "https://example.com/img_thumb.jpg",
                  width: 800,
                  height: 600,
                  mime: "image/jpeg",
                },
              ],
            },
          },
        },
      }),
    });

    const req = createRequest({
      searchTerms: [["test"]],
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    // Only the image, not the video
    expect(data.images[0]).toHaveLength(1);
    expect(data.images[0][0].title).toBe("File:Image.jpg");
  });

  it("should handle Wikimedia API HTTP failure gracefully", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const req = createRequest({
      searchTerms: [["test"]],
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.images[0]).toEqual([]);
  });

  it("should try fallback queries until images are found", async () => {
    // First call returns empty, second returns an image, rest return empty
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        return {
          ok: true,
          json: async () => ({
            query: {
              pages: {
                "1": {
                  title: "File:Landscape.jpg",
                  imageinfo: [
                    {
                      url: "https://upload.wikimedia.org/landscape.jpg",
                      thumburl: "https://upload.wikimedia.org/landscape_thumb.jpg",
                      width: 1600,
                      height: 900,
                      mime: "image/jpeg",
                    },
                  ],
                },
              },
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ query: { pages: {} } }),
      };
    });

    const req = createRequest({
      searchTerms: [["overly specific search", "broad fallback"]],
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    // Multiple queries tried (text search + category search + fallbacks)
    expect(mockFetch).toHaveBeenCalled();
    expect(data.images[0].length).toBeGreaterThanOrEqual(1);
    expect(data.images[0][0].title).toBe("File:Landscape.jpg");
  });

  it("should dedupe concurrent identical lookups across slides", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "1": {
              title: "File:Daguerreotype.jpg",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/daguerreotype.jpg",
                  thumburl: "https://upload.wikimedia.org/daguerreotype_thumb.jpg",
                  width: 1400,
                  height: 900,
                  mime: "image/jpeg",
                },
              ],
            },
          },
        },
      }),
    });

    const req = createRequest({
      searchTerms: [["daguerreotype"], ["daguerreotype"]],
      enabledSources: ["wikimedia"],
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.images).toHaveLength(2);
    // Shared in-flight cache should keep the number of network calls bounded even with richer query planning.
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should refine low-confidence queries with AI and return a better match", async () => {
    (getApiKey as jest.Mock).mockReturnValue("test-ai-key");
    (callAI as jest.Mock).mockResolvedValue(
      JSON.stringify({ queries: ["harp seal", "seal pup arctic", "ringed seal ice"] })
    );

    const emptyResponse = {
      ok: true,
      json: async () => ({ query: { pages: {} } }),
    };

    const refinedResponse = {
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "1": {
              title: "File:Harp seal on Arctic ice.jpg",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/harp-seal.jpg",
                  thumburl: "https://upload.wikimedia.org/harp-seal-thumb.jpg",
                  width: 1600,
                  height: 1000,
                  mime: "image/jpeg",
                },
              ],
            },
          },
        },
      }),
    };

    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/harp/i.test(url)) {
        return refinedResponse;
      }
      return emptyResponse;
    });

    const req = createRequest({
      searchTerms: [["seal"]],
      presentationTopic: "Arctic marine biology",
      slideContexts: [
        {
          title: "Seal population decline",
          bullets: ["Ice breeding grounds are shrinking"],
          section: "Conservation",
        },
      ],
      enabledSources: ["wikimedia"],
      aiConfig: { provider: "openrouter", modelId: "test-model" },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(callAI).toHaveBeenCalled();
    expect(data.images[0]).toHaveLength(1);
    expect(data.images[0][0].title).toBe("File:Harp seal on Arctic ice.jpg");
  });

  it("should refine low-confidence queries across enabled keyed sources", async () => {
    (getApiKey as jest.Mock).mockReturnValue("test-ai-key");
    (getImageSourceKey as jest.Mock).mockImplementation((_: string, source: string) =>
      source === "pixabay" ? "pixabay-key" : null
    );
    (callAI as jest.Mock).mockResolvedValue(
      JSON.stringify({ queries: ["harp seal"] })
    );

    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/pixabay\.com\/api/.test(url) && /harp(?:\+|%20)seal/i.test(url)) {
        return {
          ok: true,
          json: async () => ({
            hits: [
              {
                tags: "harp seal, arctic",
                webformatURL: "https://cdn.example.com/harp-seal-thumb.jpg",
                largeImageURL: "https://cdn.example.com/harp-seal.jpg",
                imageWidth: 1280,
                imageHeight: 720,
              },
            ],
          }),
        };
      }

      if (/pixabay\.com\/api/.test(url)) {
        return {
          ok: true,
          json: async () => ({ hits: [] }),
        };
      }

      return {
        ok: true,
        json: async () => ({ query: { pages: {} } }),
      };
    });

    const req = createRequest({
      searchTerms: [["seal"]],
      presentationTopic: "Arctic marine biology",
      slideContexts: [
        {
          title: "Seal population decline",
          bullets: ["Ice breeding grounds are shrinking"],
          section: "Conservation",
        },
      ],
      enabledSources: ["pixabay"],
      aiConfig: { provider: "openrouter", modelId: "test-model" },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(callAI).toHaveBeenCalled();
    expect(data.images[0]).toHaveLength(1);
    expect(data.images[0][0].source).toBe("pixabay");
    expect(data.images[0][0].thumbUrl).toBe("https://cdn.example.com/harp-seal-thumb.jpg");
  });
});
