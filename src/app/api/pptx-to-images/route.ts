import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, readdir, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { getSessionId } from "@/lib/session";
import { rateLimiters } from "@/lib/rate-limit";
import JSZip from "jszip";

const execFileAsync = promisify(execFile);

export const maxDuration = 300;

const MAX_FILE_SIZE = 100 * 1024 * 1024;

// Known paths for LibreOffice
const SOFFICE_PATHS = [
  "soffice",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/local/bin/soffice",
  "/opt/homebrew/bin/soffice",
];

// Known paths for pdftoppm (poppler-utils)
const PDFTOPPM_PATHS = [
  "pdftoppm",
  "/usr/bin/pdftoppm",
  "/opt/homebrew/bin/pdftoppm",
  "/usr/local/bin/pdftoppm",
];

// Known paths for pdfinfo (poppler-utils)
const PDFINFO_PATHS = [
  "pdfinfo",
  "/usr/bin/pdfinfo",
  "/opt/homebrew/bin/pdfinfo",
  "/usr/local/bin/pdfinfo",
];

/** Try to find a binary at one of the candidate paths. */
async function findCommand(candidates: string[]): Promise<string | null> {
  for (const cmd of candidates) {
    try {
      await execFileAsync(cmd, ["--version"], { timeout: 5000 });
      return cmd;
    } catch (err: unknown) {
      const e = err as { code?: string };
      // ENOENT = binary not found at all → try next
      if (e.code === "ENOENT") continue;
      // Any other error means the binary exists (just --version might fail)
      return cmd;
    }
  }
  return null;
}

/** Get page count from a PDF using pdfinfo, or fall back to slideCount. */
async function getPdfPageCount(pdfPath: string, pdfinfo: string | null, fallback: number): Promise<number> {
  if (!pdfinfo) return fallback;
  try {
    const { stdout } = await execFileAsync(pdfinfo, [pdfPath], { timeout: 10_000 });
    const match = stdout.match(/Pages:\s*(\d+)/);
    if (match) return parseInt(match[1], 10);
  } catch { /* ignore */ }
  return fallback;
}

/** Extract presenter notes from PPTX using JSZip (light XML parsing). */
async function extractNotes(buffer: Buffer): Promise<{ notes: string[]; slideCount: number }> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles: { index: number; path: string }[] = [];
  zip.forEach((relativePath) => {
    const match = relativePath.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (match) {
      slideFiles.push({ index: parseInt(match[1], 10), path: relativePath });
    }
  });
  slideFiles.sort((a, b) => a.index - b.index);

  const notes: string[] = [];
  for (const sf of slideFiles) {
    const slideNum = sf.path.match(/slide(\d+)\.xml/)?.[1] || "1";
    const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    const notesFile = zip.file(notesPath);
    if (notesFile) {
      const xml = await notesFile.async("string");
      const texts: string[] = [];
      const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
      let m;
      while ((m = regex.exec(xml)) !== null) {
        const t = m[1].trim();
        if (t) texts.push(t);
      }
      notes.push(texts.join("\n").trim());
    } else {
      notes.push("");
    }
  }
  return { notes, slideCount: slideFiles.length };
}

/** SSE helper: format a server-sent event */
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  // ── Pre-stream validation (can return JSON errors) ──
  const sessionId = await getSessionId();
  const rl = rateLimiters.upload.check(sessionId);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large." }, { status: 413 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large." }, { status: 413 });
  }
  if (!file.name.toLowerCase().endsWith(".pptx")) {
    return NextResponse.json({ error: "Only .pptx files are supported" }, { status: 400 });
  }

  const soffice = await findCommand(SOFFICE_PATHS);
  if (!soffice) {
    return NextResponse.json({
      error: "LibreOffice is required for image conversion.\n• macOS: brew install --cask libreoffice\n• Alpine: apk add libreoffice-impress",
    }, { status: 501 });
  }

  const pdftoppm = await findCommand(PDFTOPPM_PATHS);
  if (!pdftoppm) {
    return NextResponse.json({
      error: "poppler-utils is required for image conversion.\n• macOS: brew install poppler\n• Alpine: apk add poppler-utils",
    }, { status: 501 });
  }

  const pdfinfo = await findCommand(PDFINFO_PATHS);

  const fileName = file.name;
  const buffer = Buffer.from(await file.arrayBuffer());

  // ── SSE streaming response ──
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      const workDir = path.join(tmpdir(), `trueslides-pptx2img-${randomUUID()}`);
      await mkdir(workDir, { recursive: true });

      try {
        // Step 1: Extract notes
        send("progress", { step: "extracting_notes", percent: 0 });
        const { notes: presenterNotes, slideCount: pptxSlideCount } = await extractNotes(buffer);

        // Step 2: PPTX → PDF
        send("progress", { step: "converting_pdf", percent: 5 });
        const pptxPath = path.join(workDir, "input.pptx");
        await writeFile(pptxPath, buffer);

        const userProfile = `file://${path.join(workDir, "lo_profile")}`;
        await execFileAsync(soffice, [
          "--headless",
          "--norestore",
          "--convert-to", "pdf",
          "--outdir", workDir,
          `-env:UserInstallation=${userProfile}`,
          pptxPath,
        ], { timeout: 120_000 });

        const pdfPath = path.join(workDir, "input.pdf");
        if (!existsSync(pdfPath)) {
          send("error", { error: "LibreOffice failed to produce a PDF. Check the file is valid." });
          controller.close();
          return;
        }

        send("progress", { step: "pdf_done", percent: 15 });

        // Get total page count
        const totalPages = await getPdfPageCount(pdfPath, pdfinfo, pptxSlideCount);
        send("progress", { step: "converting_images", percent: 15, totalSlides: totalPages, currentSlide: 0 });

        // Step 3: Convert each page individually for progress tracking
        const images: string[] = [];
        const slidePrefix = path.join(workDir, "slide");
        const slideImagesDir = path.resolve(process.cwd(), "data", "slide-images");
        await mkdir(slideImagesDir, { recursive: true });

        for (let page = 1; page <= totalPages; page++) {
          await execFileAsync(pdftoppm, [
            "-png",
            "-r", "150",
            "-f", String(page),
            "-l", String(page),
            pdfPath,
            slidePrefix,
          ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });

          // Find the generated PNG for this page
          const allFiles = await readdir(workDir);
          const pngFiles = allFiles
            .filter((f) => f.startsWith("slide-") && f.endsWith(".png"))
            .sort((a, b) => {
              const na = parseInt(a.match(/slide-0*(\d+)/)?.[1] || "0", 10);
              const nb = parseInt(b.match(/slide-0*(\d+)/)?.[1] || "0", 10);
              return na - nb;
            });

          // Save PNGs we haven't saved yet to persistent storage
          while (images.length < pngFiles.length) {
            const f = pngFiles[images.length];
            const data = await readFile(path.join(workDir, f));
            const imageId = randomUUID();
            const destPath = path.join(slideImagesDir, `${imageId}.png`);
            await writeFile(destPath, data);
            images.push(`/api/slide-images/${imageId}.png`);
          }

          const percent = 15 + Math.round((page / totalPages) * 80);
          send("progress", {
            step: "converting_images",
            percent,
            totalSlides: totalPages,
            currentSlide: page,
          });
        }

        if (images.length === 0) {
          send("error", { error: "No slide images were generated." });
          controller.close();
          return;
        }

        // Step 3b: Generate low-res JPEG thumbnails in one batch for filmstrip previews
        const thumbnails: string[] = [];
        const thumbPrefix = path.join(workDir, "thumb");
        try {
          await execFileAsync(pdftoppm, [
            "-jpeg",
            "-r", "36",
            pdfPath,
            thumbPrefix,
          ], { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });

          const thumbFiles = (await readdir(workDir))
            .filter((f) => f.startsWith("thumb-") && f.endsWith(".jpg"))
            .sort((a, b) => {
              const na = parseInt(a.match(/thumb-0*(\d+)/)?.[1] || "0", 10);
              const nb = parseInt(b.match(/thumb-0*(\d+)/)?.[1] || "0", 10);
              return na - nb;
            });

          for (const f of thumbFiles) {
            const data = await readFile(path.join(workDir, f));
            const thumbId = randomUUID();
            const destPath = path.join(slideImagesDir, `${thumbId}.jpg`);
            await writeFile(destPath, data);
            thumbnails.push(`/api/slide-images/${thumbId}.jpg`);
          }
        } catch (thumbErr) {
          console.warn("[pptx-to-images] Thumbnail generation failed, using full images:", thumbErr);
        }

        // Step 4: Done – send the final result
        send("progress", { step: "done", percent: 100, totalSlides: images.length, currentSlide: images.length });
        send("result", {
          fileName,
          slideCount: images.length,
          images,
          thumbnails: thumbnails.length === images.length ? thumbnails : [],
          presenterNotes,
        });

        controller.close();
      } catch (err) {
        console.error("PPTX to images error:", err);
        send("error", { error: "Failed to convert PPTX to images." });
        controller.close();
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
