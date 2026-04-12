/**
 * @jest-environment node
 */

import { EventEmitter } from "events";

// Helper: build a minimal valid PNG buffer with given width/height
function makePngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  // PNG signature
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  // IHDR chunk length (13 bytes)
  buf.writeUInt32BE(13, 8);
  // IHDR type
  Buffer.from("IHDR").copy(buf, 12);
  // Width & Height
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  // Bit depth, color type, compression, filter, interlace
  buf[24] = 8; buf[25] = 2; buf[26] = 0; buf[27] = 0; buf[28] = 0;
  // Fake CRC
  buf.writeUInt32BE(0, 29);
  return buf;
}

const pngBuffer = makePngBuffer(200, 100); // 2:1 landscape

// Mock node:https to return a fake image for any download
jest.mock("node:https", () => {
  return {
    get: (_url: string, _opts: unknown, cb: (res: EventEmitter & { statusCode: number; headers: Record<string, string> }) => void) => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> };
      res.statusCode = 200;
      res.headers = { "content-type": "image/png" };
      setTimeout(() => {
        res.emit("data", pngBuffer);
        res.emit("end");
      }, 0);
      cb(res);
      const req = new EventEmitter();
      return req;
    },
  };
});

jest.mock("node:http", () => {
  return {
    get: (_url: string, _opts: unknown, cb: (res: EventEmitter & { statusCode: number; headers: Record<string, string> }) => void) => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> };
      res.statusCode = 200;
      res.headers = { "content-type": "image/png" };
      setTimeout(() => {
        res.emit("data", pngBuffer);
        res.emit("end");
      }, 0);
      cb(res);
      const req = new EventEmitter();
      return req;
    },
  };
});

const addImage = jest.fn();
const addText = jest.fn();
const addShape = jest.fn();
const addNotes = jest.fn();
const addSlide = jest.fn(() => ({
  addImage,
  addText,
  addShape,
  addNotes,
  background: undefined,
}));
const write = jest.fn().mockResolvedValue(Buffer.from("pptx"));

jest.mock("pptxgenjs", () => {
  return {
    __esModule: true,
    default: class MockPptxGenJS {
      static ShapeType = {
        rect: "rect",
        roundRect: "roundRect",
        ellipse: "ellipse",
      };

      layout = "";
      author = "";
      title = "";
      addSlide = addSlide;
      write = write;
    },
  };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/build-pptx/route";

function createRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/build-pptx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  addImage.mockClear();
  addText.mockClear();
  addShape.mockClear();
  addNotes.mockClear();
  addSlide.mockClear();
  write.mockClear();
});

describe("POST /api/build-pptx", () => {
  it("should render image-only slides when text density is 0 and images exist", async () => {
    const req = createRequest({
      presentation: {
        title: "Visual Deck",
        slides: [
          {
            id: "slide-1",
            index: 0,
            title: "Hero",
            bullets: ["Point A", "Point B"],
            notes: "Speaker notes",
            section: "Intro",
            imageUrls: ["https://upload.wikimedia.org/example.png"],
          },
        ],
      },
      imageLayout: "full",
      stretchImages: true,
      textDensity: 0,
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(addImage).toHaveBeenCalledTimes(1);
    // Cover slide (index 0) adds title overlay text even in image-only mode
    // Verify no renderTextContent is called (no bullet text), only the cover title overlay
    const textCalls = addText.mock.calls;
    const hasBulletText = textCalls.some(
      (call: unknown[]) => Array.isArray(call[0]) && call[0].some((item: { options?: { bullet?: unknown } }) => item?.options?.bullet)
    );
    expect(hasBulletText).toBe(false);
    expect(addNotes).toHaveBeenCalledWith("Speaker notes");
  });

  it("should place slide images using crop sizing for visual layouts", async () => {
    const req = createRequest({
      presentation: {
        title: "Styled Deck",
        slides: [
          {
            id: "slide-2",
            index: 1,
            title: "Operations Overview",
            bullets: ["Supply chain", "Warehousing", "Delivery"],
            notes: "Operational details",
            section: "Operations",
            imageUrls: [
              "https://upload.wikimedia.org/example-1.png",
              "https://upload.wikimedia.org/example-2.png",
            ],
          },
        ],
      },
      imageLayout: "two",
      stretchImages: false,
      textDensity: 30,
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(addImage).toHaveBeenCalled();
    expect(addText).toHaveBeenCalled();
    expect(addImage.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sizing: expect.objectContaining({ type: "crop" }),
      })
    );
  });

  it("should preserve saved image crop adjustments in PPTX output", async () => {
    const req = createRequest({
      presentation: {
        title: "Crop Deck",
        slides: [
          {
            id: "slide-3",
            index: 0,
            title: "Adjusted Image",
            bullets: [],
            notes: "",
            section: "Focus",
            imageUrls: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nW3cAAAAASUVORK5CYII="],
            imageAdjustments: [{ scale: 2, offsetX: 0, offsetY: 20 }],
          },
        ],
      },
      imageLayout: "full",
      stretchImages: false,
      textDensity: 0,
      slideLayout: "single",
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(addImage).toHaveBeenCalledTimes(1);
    expect(addImage.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sizing: expect.objectContaining({ type: "crop" }),
      })
    );
  });
});