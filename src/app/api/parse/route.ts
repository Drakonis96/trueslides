import { NextRequest, NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { rateLimiters } from "@/lib/rate-limit";

// Allow up to 60 seconds for large file parsing
export const maxDuration = 60;

// Maximum upload size: 50 MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Parse uploaded files (PDF, DOCX, TXT) and return extracted text
export async function POST(req: NextRequest) {
  try {
    const sessionId = await getSessionId();

    const rl = rateLimiters.upload.check(sessionId);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many upload requests. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    // Check Content-Length before reading the body
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (contentLength > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
        { status: 413 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
        { status: 413 }
      );
    }

    const name = file.name.toLowerCase();
    let text = "";

    if (name.endsWith(".txt")) {
      text = await file.text();
    } else if (name.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (name.endsWith(".pdf")) {
      const pdfParseModule = await import("pdf-parse");
      const pdfParse = (pdfParseModule as unknown as { default?: (buf: Buffer) => Promise<{ text: string }> }).default || pdfParseModule;
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await (pdfParse as (buf: Buffer) => Promise<{ text: string }>)(buffer);
      text = result.text;
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload PDF, DOCX, or TXT." },
        { status: 400 }
      );
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "File appears to be empty or could not be parsed." },
        { status: 400 }
      );
    }

    return NextResponse.json({ text: text.trim(), fileName: file.name });
  } catch (err: unknown) {
    console.error("File parse error:", err);
    return NextResponse.json(
      { error: "Failed to parse file." },
      { status: 500 }
    );
  }
}
