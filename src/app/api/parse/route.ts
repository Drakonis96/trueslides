import { NextRequest, NextResponse } from "next/server";

// Allow up to 60 seconds for large file parsing
export const maxDuration = 60;

// Parse uploaded files (PDF, DOCX, TXT) and return extracted text
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
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
