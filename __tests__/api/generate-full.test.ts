/**
 * @jest-environment node
 */

const createJob = jest.fn();
const getJob = jest.fn(() => ({ abortController: new AbortController() }));
const updateJobProgress = jest.fn();
const updateJobPartialSlides = jest.fn();
const completeJob = jest.fn();
const failJob = jest.fn();
const searchSlideImages = jest.fn();
const generateSlides = jest.fn();
const getImageFeedbackProfile = jest.fn(() => ({
  positiveUrls: {},
  negativeUrls: {},
  positiveSources: {},
  negativeSources: {},
  positiveTokens: {},
  negativeTokens: {},
}));

jest.mock("@/lib/session", () => ({
  getSessionId: jest.fn().mockResolvedValue("session-1"),
}));

jest.mock("@/lib/key-store", () => ({
  getApiKey: jest.fn().mockReturnValue("ai-key"),
  getImageSourceKey: jest.fn().mockReturnValue(null),
}));

jest.mock("@/lib/rate-limit", () => ({
  rateLimiters: {
    ai: { check: jest.fn().mockReturnValue({ allowed: true }) },
  },
}));

jest.mock("@/lib/job-manager", () => ({
  createJob: (...args: unknown[]) => createJob(...args),
  getJob: (...args: unknown[]) => getJob(...args),
  updateJobProgress: (...args: unknown[]) => updateJobProgress(...args),
  updateJobPartialSlides: (...args: unknown[]) => updateJobPartialSlides(...args),
  completeJob: (...args: unknown[]) => completeJob(...args),
  failJob: (...args: unknown[]) => failJob(...args),
}));

jest.mock("@/lib/generate-slides", () => ({
  generateSlides: (...args: unknown[]) => generateSlides(...args),
}));

jest.mock("@/lib/image-search", () => ({
  searchSlideImages: (...args: unknown[]) => searchSlideImages(...args),
}));

jest.mock("@/lib/image-feedback", () => ({
  getImageFeedbackProfile: (...args: unknown[]) => getImageFeedbackProfile(...args),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/generate-full/route";

function createRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/generate-full", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/generate-full", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getJob.mockReturnValue({ abortController: new AbortController() });
    generateSlides.mockResolvedValue({
      title: "Runtime Systems",
      slides: [
        {
          id: "slide-1",
          index: 0,
          title: "Java Virtual Machine",
          bullets: ["Managed execution environment"],
          notes: "",
          section: "Runtime",
          imageSearchTerms: ["java virtual machine", "jvm runtime", "bytecode"],
        },
      ],
    });
    searchSlideImages.mockResolvedValue([
      {
        title: "Java Virtual Machine architecture",
        url: "https://example.com/jvm.jpg",
        thumbUrl: "https://example.com/jvm-thumb.jpg",
        width: 1400,
        height: 900,
        source: "wikimedia",
      },
    ]);
  });

  it("passes aiConfig and feedback profile into final image selection", async () => {
    const res = await POST(createRequest({
      jobId: "job-1",
      provider: "openrouter",
      modelId: "model-1",
      slideCount: 1,
      textDensity: 20,
      prompts: { design: "", text: "", notes: "" },
      sourceText: "JVM internals and managed runtimes",
      imageLayout: "full",
      slideLayout: "single",
      enabledSources: ["wikimedia"],
    }));

    expect(res.status).toBe(200);

    await new Promise((resolve) => setImmediate(resolve));

    expect(searchSlideImages).toHaveBeenCalled();
    expect(
      searchSlideImages.mock.calls.some(
        (call) => call[6]?.apiKey === "ai-key" && call[6]?.modelId === "model-1" && call[6]?.provider === "openrouter"
      )
    ).toBe(true);
    expect(
      searchSlideImages.mock.calls.some((call) => call[8] === getImageFeedbackProfile.mock.results[0]?.value)
    ).toBe(true);
    expect(completeJob).toHaveBeenCalled();
    expect(failJob).not.toHaveBeenCalled();
  });

  it("uses each slide layout image count in smart mode", async () => {
    generateSlides.mockResolvedValue({
      title: "Runtime Systems",
      slides: [
        {
          id: "slide-1",
          index: 0,
          title: "Java Virtual Machine",
          bullets: ["Managed execution environment"],
          notes: "",
          section: "Runtime",
          slideLayout: "three-cards",
          imageSearchTerms: ["java virtual machine", "jvm runtime", "bytecode"],
        },
      ],
    });

    searchSlideImages.mockResolvedValue([
      {
        title: "Image 1",
        url: "https://example.com/1.jpg",
        thumbUrl: "https://example.com/1-thumb.jpg",
        width: 1000,
        height: 700,
        source: "wikimedia",
      },
      {
        title: "Image 2",
        url: "https://example.com/2.jpg",
        thumbUrl: "https://example.com/2-thumb.jpg",
        width: 1000,
        height: 700,
        source: "wikimedia",
      },
      {
        title: "Image 3",
        url: "https://example.com/3.jpg",
        thumbUrl: "https://example.com/3-thumb.jpg",
        width: 1000,
        height: 700,
        source: "wikimedia",
      },
      {
        title: "Image 4",
        url: "https://example.com/4.jpg",
        thumbUrl: "https://example.com/4-thumb.jpg",
        width: 1000,
        height: 700,
        source: "wikimedia",
      },
    ]);

    const res = await POST(createRequest({
      jobId: "job-2",
      provider: "openrouter",
      modelId: "model-1",
      slideCount: 1,
      textDensity: 20,
      prompts: { design: "", text: "", notes: "" },
      sourceText: "JVM internals and managed runtimes",
      imageLayout: "full",
      layoutMode: "smart",
      slideLayout: "single",
      enabledSources: ["wikimedia"],
    }));

    expect(res.status).toBe(200);

    await new Promise((resolve) => setImmediate(resolve));

    expect(completeJob).toHaveBeenCalled();
    const completedResult = completeJob.mock.calls[0]?.[1];
    expect(completedResult?.slides?.[0]?.imageUrls).toEqual([
      "https://example.com/1.jpg",
      "https://example.com/2.jpg",
      "https://example.com/3.jpg",
    ]);
  });
});