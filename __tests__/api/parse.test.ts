/**
 * @jest-environment node
 */

/**
 * Tests for API route: /api/parse
 *
 * Since Next.js App Router route handlers need NextRequest,
 * we test the POST function directly by creating mock requests.
 */

// Mock the external modules before importing the route
jest.mock("mammoth", () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: "Extracted DOCX text" }),
}));

jest.mock("pdf-parse", () => {
  const fn = jest.fn().mockResolvedValue({ text: "Extracted PDF text" });
  return { __esModule: true, default: fn };
});

jest.mock("@/lib/session", () => ({
  getSessionId: jest.fn().mockResolvedValue("test-session-id"),
}));

jest.mock("@/lib/rate-limit", () => ({
  rateLimiters: {
    upload: { check: jest.fn().mockReturnValue({ allowed: true }) },
  },
}));

import { POST } from "@/app/api/parse/route";
import { NextRequest } from "next/server";

function createFileRequest(fileName: string, content: string, type: string): NextRequest {
  const file = new File([content], fileName, { type });
  const formData = new FormData();
  formData.append("file", file);

  return new NextRequest("http://localhost:3000/api/parse", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/parse", () => {
  it("should parse a TXT file", async () => {
    const req = createFileRequest("test.txt", "Hello World Content", "text/plain");
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.text).toBe("Hello World Content");
    expect(data.fileName).toBe("test.txt");
  });

  it("should parse a DOCX file via mammoth", async () => {
    const req = createFileRequest("test.docx", "binary-data", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.text).toBe("Extracted DOCX text");
  });

  it("should parse a PDF file via pdf-parse", async () => {
    const req = createFileRequest("test.pdf", "binary-data", "application/pdf");
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.text).toBe("Extracted PDF text");
  });

  it("should reject unsupported file types", async () => {
    const req = createFileRequest("test.jpg", "image-data", "image/jpeg");
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("Unsupported file type");
  });

  it("should reject requests without a file", async () => {
    const formData = new FormData();
    const req = new NextRequest("http://localhost:3000/api/parse", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("No file provided");
  });

  it("should reject empty TXT files", async () => {
    const req = createFileRequest("empty.txt", "   ", "text/plain");
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("empty");
  });
});
