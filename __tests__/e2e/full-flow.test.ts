/**
 * @jest-environment node
 */

/**
 * E2E flow test: upload → parse → generate → images → PPTX
 *
 * Verifies the complete pipeline from document upload through
 * final PPTX export, using mocked external dependencies.
 */

import { EventEmitter } from "events";

// ── Helpers ──

function makePngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  Buffer.from("IHDR").copy(buf, 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8; buf[25] = 2; buf[26] = 0; buf[27] = 0; buf[28] = 0;
  buf.writeUInt32BE(0, 29);
  return buf;
}

const pngBuffer = makePngBuffer(800, 600);

// ── Mocks ──

jest.mock("node:https", () => ({
  get: (_url: string, _opts: unknown, cb: (res: EventEmitter & { statusCode: number; headers: Record<string, string> }) => void) => {
    const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> };
    res.statusCode = 200;
    res.headers = { "content-type": "image/png" };
    setTimeout(() => { res.emit("data", pngBuffer); res.emit("end"); }, 0);
    cb(res);
    return new EventEmitter();
  },
}));

jest.mock("node:http", () => ({
  get: (_url: string, _opts: unknown, cb: (res: EventEmitter & { statusCode: number; headers: Record<string, string> }) => void) => {
    const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> };
    res.statusCode = 200;
    res.headers = { "content-type": "image/png" };
    setTimeout(() => { res.emit("data", pngBuffer); res.emit("end"); }, 0);
    cb(res);
    return new EventEmitter();
  },
}));

jest.mock("mammoth", () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: "Extracted document about Artificial Intelligence and its applications in healthcare." }),
}));

jest.mock("pdf-parse", () => {
  const fn = jest.fn().mockResolvedValue({ text: "Extracted PDF text about renewable energy." });
  return { __esModule: true, default: fn };
});

jest.mock("@/lib/session", () => ({
  getSessionId: jest.fn().mockResolvedValue("e2e-session"),
}));

const mockGetApiKey = jest.fn().mockReturnValue("test-api-key");
jest.mock("@/lib/key-store", () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
  getImageSourceKey: jest.fn().mockReturnValue(null),
}));

jest.mock("@/lib/rate-limit", () => ({
  rateLimiters: {
    ai: { check: jest.fn().mockReturnValue({ allowed: true }) },
    image: { check: jest.fn().mockReturnValue({ allowed: true }) },
    upload: { check: jest.fn().mockReturnValue({ allowed: true }) },
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

jest.mock("uuid", () => ({ v4: () => "e2e-uuid" }));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const addImage = jest.fn();
const addText = jest.fn();
const addShape = jest.fn();
const addNotes = jest.fn();
const addSlide = jest.fn(() => ({ addImage, addText, addShape, addNotes, background: undefined }));
const write = jest.fn().mockResolvedValue(Buffer.from("pptx-binary-content"));

jest.mock("pptxgenjs", () => ({
  __esModule: true,
  default: class MockPptxGenJS {
    static ShapeType = { rect: "rect", roundRect: "roundRect", ellipse: "ellipse" };
    layout = "";
    author = "";
    title = "";
    addSlide = addSlide;
    write = write;
  },
}));

import { NextRequest } from "next/server";
import { POST as parsePOST } from "@/app/api/parse/route";
import { POST as buildPptxPOST } from "@/app/api/build-pptx/route";
import { POST as imagesPOST } from "@/app/api/images/route";
import { imageSearchCache } from "@/lib/image-cache";

// ── Helpers ──

function createParseRequest(fileName: string, content: string, type: string): NextRequest {
  const file = new File([content], fileName, { type });
  const formData = new FormData();
  formData.append("file", file);
  return new NextRequest("http://localhost:3000/api/parse", { method: "POST", body: formData });
}

function createJsonRequest(url: string, body: object): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  addImage.mockClear();
  addText.mockClear();
  addShape.mockClear();
  addNotes.mockClear();
  addSlide.mockClear();
  write.mockClear();
  imageSearchCache.clear();
});

describe("E2E: upload → parse → generate → images → PPTX", () => {
  it("completes the full pipeline from TXT upload to PPTX export", async () => {
    // Step 1: Parse a TXT file
    const parseReq = createParseRequest("doc.txt", "Artificial Intelligence is transforming healthcare.", "text/plain");
    const parseRes = await parsePOST(parseReq);
    const parseData = await parseRes.json();

    expect(parseRes.status).toBe(200);
    expect(parseData.text).toBe("Artificial Intelligence is transforming healthcare.");
    expect(parseData.fileName).toBe("doc.txt");

    // Step 2: Search images (using parsed content context)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "1": {
              title: "File:AI_Healthcare.jpg",
              imageinfo: [{
                url: "https://upload.wikimedia.org/ai-health.jpg",
                thumburl: "https://upload.wikimedia.org/ai-health_thumb.jpg",
                width: 1200,
                height: 800,
                mime: "image/jpeg",
              }],
            },
          },
        },
      }),
    });

    const imagesReq = createJsonRequest("http://localhost:3000/api/images", {
      searchTerms: [["artificial intelligence healthcare"]],
    });
    const imagesRes = await imagesPOST(imagesReq);
    const imagesData = await imagesRes.json();

    expect(imagesRes.status).toBe(200);
    expect(imagesData.images).toBeDefined();
    expect(imagesData.images.length).toBeGreaterThanOrEqual(1);

    // Step 3: Build PPTX with generated slides and images
    const slides = [
      {
        id: "slide-1",
        index: 0,
        title: "AI in Healthcare",
        bullets: ["Diagnosis assistance", "Drug discovery", "Patient monitoring"],
        notes: "Discuss how AI is transforming healthcare.",
        imageUrls: ["https://upload.wikimedia.org/ai-health.jpg"],
        section: "Introduction",
        slideLayout: "single",
      },
      {
        id: "slide-2",
        index: 1,
        title: "Future Outlook",
        bullets: ["Personalized medicine", "Robotic surgery"],
        notes: "Cover future trends.",
        imageUrls: [],
        section: "Conclusion",
        slideLayout: "single",
      },
    ];

    const pptxReq = createJsonRequest("http://localhost:3000/api/build-pptx", {
      presentation: {
        title: "AI in Healthcare",
        slides,
      },
    });
    const pptxRes = await buildPptxPOST(pptxReq);

    expect(pptxRes.status).toBe(200);
    expect(pptxRes.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(addSlide).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalled();
  });

  it("handles DOCX parsing through the pipeline", async () => {
    const parseReq = createParseRequest(
      "report.docx",
      "binary-docx-data",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const parseRes = await parsePOST(parseReq);
    const parseData = await parseRes.json();

    expect(parseRes.status).toBe(200);
    expect(parseData.text).toContain("Artificial Intelligence");
    expect(parseData.fileName).toBe("report.docx");
  });

  it("handles PDF parsing through the pipeline", async () => {
    const parseReq = createParseRequest("report.pdf", "binary-pdf-data", "application/pdf");
    const parseRes = await parsePOST(parseReq);
    const parseData = await parseRes.json();

    expect(parseRes.status).toBe(200);
    expect(parseData.text).toContain("renewable energy");
    expect(parseData.fileName).toBe("report.pdf");
  });

  it("rejects unsupported file types at parse stage", async () => {
    const parseReq = createParseRequest("photo.png", "image-data", "image/png");
    const parseRes = await parsePOST(parseReq);
    const parseData = await parseRes.json();

    expect(parseRes.status).toBe(400);
    expect(parseData.error).toContain("Unsupported");
  });

  it("recovers from empty image results and still builds a PPTX", async () => {
    // Images return nothing
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ query: { pages: {} } }),
    });

    const imagesReq = createJsonRequest("http://localhost:3000/api/images", {
      searchTerms: [["nonexistent-term-xyz"]],
    });
    const imagesRes = await imagesPOST(imagesReq);
    const imagesData = await imagesRes.json();

    expect(imagesRes.status).toBe(200);

    // PPTX still builds with no images
    const slides = [{
      id: "slide-1",
      index: 0,
      title: "No Images Available",
      bullets: ["Content still works"],
      notes: "",
      imageUrls: [],
      section: "Main",
      slideLayout: "single",
    }];

    const pptxReq = createJsonRequest("http://localhost:3000/api/build-pptx", {
      presentation: {
        title: "Test Deck",
        slides,
      },
    });
    const pptxRes = await buildPptxPOST(pptxReq);

    expect(pptxRes.status).toBe(200);
    expect(addSlide).toHaveBeenCalledTimes(1);
  });
});
