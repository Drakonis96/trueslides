import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getSessionId } from "@/lib/session";
import { rateLimiters } from "@/lib/rate-limit";

export const maxDuration = 60;

// Maximum upload size: 100 MB (PPTX with embedded images can be large)
const MAX_FILE_SIZE = 100 * 1024 * 1024;

// EMU (English Metric Units) conversion: 914400 EMU = 1 inch
// Standard slide: 10" x 7.5" = 9144000 x 6858000 EMU
const DEFAULT_SLIDE_W_EMU = 9144000;
const DEFAULT_SLIDE_H_EMU = 6858000;

interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number; // pt
  color?: string; // hex without #
  fontFamily?: string;
}

interface TextParagraph {
  runs: TextRun[];
  alignment?: "l" | "ctr" | "r" | "just";
  isBullet?: boolean;
}

interface ParsedShape {
  type: "text" | "image" | "table";
  // Position & size in percent (0-100)
  x: number;
  y: number;
  w: number;
  h: number;
  // For text shapes
  paragraphs?: TextParagraph[];
  // For image shapes
  imageBase64?: string;
  // Dominant formatting (most common across runs)
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  fontFamily?: string;
  color?: string; // hex without #
  textAlign?: "left" | "center" | "right" | "justify";
}

interface ParsedSlide {
  index: number;
  texts: string[];
  imageBase64s: string[];
  presenterNotes: string;
  // Rich shape data for improved import
  shapes: ParsedShape[];
  bgColor?: string; // hex without #
  slideWidthEmu?: number;
  slideHeightEmu?: number;
}

// ── XML helpers ──

// Extract all text nodes from XML (for backward compat / notes)
function extractTextsFromXml(xml: string): string[] {
  const texts: string[] = [];
  const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = match[1].trim();
    if (text) texts.push(text);
  }
  return texts;
}

// Parse .rels file to map rId -> target path
function parseRels(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const regex = /<Relationship\s+[^>]*Id="(rId\d+)"[^>]*Target="([^"]+)"[^>]*\/>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    map.set(match[1], match[2]);
  }
  return map;
}

function mimeFromExt(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    bmp: "image/bmp",
    tiff: "image/tiff",
    emf: "image/x-emf",
    wmf: "image/x-wmf",
  };
  return map[ext] || "image/png";
}

function emuToPercent(emu: number, totalEmu: number): number {
  return Math.round(((emu / totalEmu) * 100) * 100) / 100;
}

function parseColorHex(xmlFragment: string): string | undefined {
  // <a:srgbClr val="FF0000"/>
  const srgb = xmlFragment.match(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
  if (srgb) return srgb[1];
  return undefined;
}

// Extract text paragraphs with formatting from a shape XML (<p:sp> or <p:txBody>)
function extractParagraphs(txBodyXml: string): TextParagraph[] {
  const paragraphs: TextParagraph[] = [];
  // Split by <a:p> paragraphs
  const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let pMatch;
  while ((pMatch = pRegex.exec(txBodyXml)) !== null) {
    const pContent = pMatch[1];
    const runs: TextRun[] = [];

    // Check paragraph properties for alignment and bullets
    let alignment: TextParagraph["alignment"] | undefined;
    let isBullet = false;
    const pPrMatch = pContent.match(/<a:pPr([^>]*)>([\s\S]*?)<\/a:pPr>|<a:pPr([^>]*)\/>/);
    if (pPrMatch) {
      const attrs = pPrMatch[1] || pPrMatch[3] || "";
      const body = pPrMatch[2] || "";
      const algn = attrs.match(/algn="([^"]+)"/);
      if (algn) alignment = algn[1] as TextParagraph["alignment"];
      // Check for bullet list markers
      if (body.includes("<a:buChar") || body.includes("<a:buAutoNum") || body.includes("<a:buFont")) {
        isBullet = true;
      }
    }

    // Extract text runs <a:r>
    const rRegex = /<a:r>([\s\S]*?)<\/a:r>/g;
    let rMatch;
    while ((rMatch = rRegex.exec(pContent)) !== null) {
      const rContent = rMatch[1];
      const textMatch = rContent.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/);
      if (!textMatch) continue;
      const text = textMatch[1];
      if (!text) continue;

      const run: TextRun = { text };

      // Run properties <a:rPr>
      const rPrMatch = rContent.match(/<a:rPr([^>]*)>([\s\S]*?)<\/a:rPr>|<a:rPr([^>]*)\/>/);
      if (rPrMatch) {
        const attrs = rPrMatch[1] || rPrMatch[3] || "";
        const body = rPrMatch[2] || "";
        // Bold
        if (attrs.includes('b="1"')) run.bold = true;
        // Italic
        if (attrs.includes('i="1"')) run.italic = true;
        // Font size (in hundredths of a point, e.g. 2400 = 24pt)
        const szMatch = attrs.match(/sz="(\d+)"/);
        if (szMatch) run.fontSize = Math.round(parseInt(szMatch[1], 10) / 100);
        // Color
        const color = parseColorHex(body || attrs);
        if (color) run.color = color;
        // Font family
        const latinMatch = (body || "").match(/<a:latin[^>]*typeface="([^"]+)"/);
        if (latinMatch) run.fontFamily = latinMatch[1];
      }

      runs.push(run);
    }

    // Also grab field text (e.g., <a:fld>)
    const fldRegex = /<a:fld[^>]*>([\s\S]*?)<\/a:fld>/g;
    let fldMatch;
    while ((fldMatch = fldRegex.exec(pContent)) !== null) {
      const textMatch = fldMatch[1].match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/);
      if (textMatch && textMatch[1]) {
        runs.push({ text: textMatch[1] });
      }
    }

    if (runs.length > 0) {
      paragraphs.push({ runs, alignment, isBullet });
    }
  }
  return paragraphs;
}

// Extract shapes from a slide XML
function extractShapes(
  slideXml: string,
  relsMap: Map<string, string>,
  imageMap: Map<string, string>, // media path -> base64 data URI
  slideWEmu: number,
  slideHEmu: number,
): ParsedShape[] {
  const shapes: ParsedShape[] = [];

  // Match shape trees: <p:sp>, <p:pic>, and grouped shapes <p:grpSp>
  // Process <p:pic> (picture shapes)
  const picRegex = /<p:pic\b[^>]*>([\s\S]*?)<\/p:pic>/g;
  let picMatch;
  while ((picMatch = picRegex.exec(slideXml)) !== null) {
    const picXml = picMatch[1];
    // Position
    const offMatch = picXml.match(/<a:off\s+x="(\d+)"\s+y="(\d+)"/);
    const extMatch = picXml.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/);
    if (!offMatch || !extMatch) continue;

    const x = emuToPercent(parseInt(offMatch[1], 10), slideWEmu);
    const y = emuToPercent(parseInt(offMatch[2], 10), slideHEmu);
    const w = emuToPercent(parseInt(extMatch[1], 10), slideWEmu);
    const h = emuToPercent(parseInt(extMatch[2], 10), slideHEmu);

    // Image reference
    const embedMatch = picXml.match(/r:embed="(rId\d+)"/);
    if (embedMatch) {
      const target = relsMap.get(embedMatch[1]);
      if (target) {
        const mediaPath = target.startsWith("../")
          ? "ppt/" + target.slice(3)
          : target.startsWith("/") ? target.slice(1) : "ppt/slides/" + target;
        const base64 = imageMap.get(mediaPath);
        if (base64) {
          shapes.push({ type: "image", x, y, w, h, imageBase64: base64 });
        }
      }
    }
  }

  // Process <p:sp> (text/shape elements)
  const spRegex = /<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g;
  let spMatch;
  while ((spMatch = spRegex.exec(slideXml)) !== null) {
    const spXml = spMatch[1];

    // Check if this is a placeholder (title, subtitle, body, etc.)
    const phMatch = spXml.match(/<p:ph\s+([^/]*?)\/>/);
    const phType = phMatch ? (phMatch[1].match(/type="([^"]+)"/) || [])[1] || "body" : undefined;

    // Position & size
    const offMatch = spXml.match(/<a:off\s+x="(\d+)"\s+y="(\d+)"/);
    const extMatch = spXml.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/);

    // Default position for shapes without explicit position (placeholders)
    let x = 4, y = 4, w = 92, h = 20;
    if (offMatch && extMatch) {
      x = emuToPercent(parseInt(offMatch[1], 10), slideWEmu);
      y = emuToPercent(parseInt(offMatch[2], 10), slideHEmu);
      w = emuToPercent(parseInt(extMatch[1], 10), slideWEmu);
      h = emuToPercent(parseInt(extMatch[2], 10), slideHEmu);
    }

    // Has a blip fill (image inside a shape)?
    const blipMatch = spXml.match(/r:embed="(rId\d+)"/);
    if (blipMatch && !spXml.includes("<p:txBody>")) {
      const target = relsMap.get(blipMatch[1]);
      if (target) {
        const mediaPath = target.startsWith("../")
          ? "ppt/" + target.slice(3)
          : target.startsWith("/") ? target.slice(1) : "ppt/slides/" + target;
        const base64 = imageMap.get(mediaPath);
        if (base64) {
          shapes.push({ type: "image", x, y, w, h, imageBase64: base64 });
          continue;
        }
      }
    }

    // Text body
    const txBodyMatch = spXml.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/);
    if (!txBodyMatch) continue;

    const paragraphs = extractParagraphs(txBodyMatch[1]);
    if (paragraphs.length === 0) continue;

    // Compute plain text to skip empty/whitespace-only shapes
    const plainText = paragraphs.map(p => p.runs.map(r => r.text).join("")).join("").trim();
    if (!plainText) continue;

    // Determine dominant formatting from runs
    let dominantFontSize: number | undefined;
    let dominantBold = false;
    let dominantColor: string | undefined;
    let dominantFamily: string | undefined;
    let dominantAlign: ParsedShape["textAlign"] | undefined;

    const allRuns = paragraphs.flatMap(p => p.runs);
    if (allRuns.length > 0) {
      // Most common font size
      const sizes = allRuns.filter(r => r.fontSize).map(r => r.fontSize!);
      if (sizes.length > 0) dominantFontSize = sizes[0];
      // Bold if majority are bold
      dominantBold = allRuns.filter(r => r.bold).length > allRuns.length / 2;
      // First non-undefined color
      dominantColor = allRuns.find(r => r.color)?.color;
      // First non-undefined font family
      dominantFamily = allRuns.find(r => r.fontFamily)?.fontFamily;
    }

    // Alignment from first paragraph
    const firstAlign = paragraphs[0]?.alignment;
    if (firstAlign) {
      const alignMap: Record<string, ParsedShape["textAlign"]> = {
        l: "left", ctr: "center", r: "right", just: "justify",
      };
      dominantAlign = alignMap[firstAlign];
    }

    // If no explicit font size, infer from placeholder type
    if (!dominantFontSize && phType) {
      if (phType === "title" || phType === "ctrTitle") dominantFontSize = 36;
      else if (phType === "subTitle") dominantFontSize = 24;
      else dominantFontSize = 18;
    }

    shapes.push({
      type: "text",
      x, y, w, h,
      paragraphs,
      fontSize: dominantFontSize,
      fontWeight: dominantBold ? "bold" : "normal",
      fontFamily: dominantFamily,
      color: dominantColor,
      textAlign: dominantAlign,
    });
  }

  return shapes;
}

// Extract slide background color
function extractBgColor(slideXml: string): string | undefined {
  // <p:bg> -> <p:bgPr> -> <a:solidFill> -> <a:srgbClr val="..."/>
  const bgMatch = slideXml.match(/<p:bg\b[^>]*>([\s\S]*?)<\/p:bg>/);
  if (bgMatch) {
    return parseColorHex(bgMatch[1]);
  }
  return undefined;
}

// Get slide dimensions from presentation.xml
function parseSlideDimensions(presXml: string): { w: number; h: number } {
  const match = presXml.match(/<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/);
  if (match) {
    return { w: parseInt(match[1], 10), h: parseInt(match[2], 10) };
  }
  return { w: DEFAULT_SLIDE_W_EMU, h: DEFAULT_SLIDE_H_EMU };
}

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

    if (!file.name.toLowerCase().endsWith(".pptx")) {
      return NextResponse.json(
        { error: "Only .pptx files are supported" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);

    // Read slide dimensions from presentation.xml
    let slideWEmu = DEFAULT_SLIDE_W_EMU;
    let slideHEmu = DEFAULT_SLIDE_H_EMU;
    const presFile = zip.file("ppt/presentation.xml");
    if (presFile) {
      const presXml = await presFile.async("string");
      const dims = parseSlideDimensions(presXml);
      slideWEmu = dims.w;
      slideHEmu = dims.h;
    }

    // Pre-load all media files into memory for quick lookup
    const imageMap = new Map<string, string>();
    const mediaFiles = Object.keys(zip.files).filter(p => p.startsWith("ppt/media/"));
    await Promise.all(mediaFiles.map(async (mediaPath) => {
      const f = zip.file(mediaPath);
      if (f) {
        const data = await f.async("base64");
        const mime = mimeFromExt(mediaPath);
        imageMap.set(mediaPath, `data:${mime};base64,${data}`);
      }
    }));

    // Find all slide files (slide1.xml, slide2.xml, ...)
    const slideFiles: { index: number; path: string }[] = [];
    zip.forEach((relativePath) => {
      const match = relativePath.match(/^ppt\/slides\/slide(\d+)\.xml$/);
      if (match) {
        slideFiles.push({ index: parseInt(match[1], 10), path: relativePath });
      }
    });

    slideFiles.sort((a, b) => a.index - b.index);

    if (slideFiles.length === 0) {
      return NextResponse.json(
        { error: "No slides found in PPTX file" },
        { status: 400 }
      );
    }

    const slides: ParsedSlide[] = [];

    for (let i = 0; i < slideFiles.length; i++) {
      const { path } = slideFiles[i];
      const slideXml = await zip.file(path)!.async("string");

      // Extract text (flat, for backward compat)
      const texts = extractTextsFromXml(slideXml);

      // Parse rels for this slide
      const slideNum = path.match(/slide(\d+)\.xml/)?.[1] || "1";
      const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
      const relsFile = zip.file(relsPath);
      const relsMap = relsFile ? parseRels(await relsFile.async("string")) : new Map<string, string>();

      // Extract image base64s (flat, for backward compat)
      const imageBase64s: string[] = [];
      const imageRelIds: string[] = [];
      const embedRegex = /r:embed="(rId\d+)"/g;
      let emMatch;
      while ((emMatch = embedRegex.exec(slideXml)) !== null) {
        imageRelIds.push(emMatch[1]);
      }
      for (const relId of imageRelIds) {
        const target = relsMap.get(relId);
        if (!target) continue;
        const mediaPath = target.startsWith("../")
          ? "ppt/" + target.slice(3)
          : target.startsWith("/") ? target.slice(1) : "ppt/slides/" + target;
        const base64 = imageMap.get(mediaPath);
        if (base64 && !imageBase64s.includes(base64)) {
          imageBase64s.push(base64);
        }
      }

      // Extract rich shapes with positions and formatting
      const shapes = extractShapes(slideXml, relsMap, imageMap, slideWEmu, slideHEmu);

      // Background color
      const bgColor = extractBgColor(slideXml);

      // Presenter notes
      let presenterNotes = "";
      const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
      const notesFile = zip.file(notesPath);
      if (notesFile) {
        const notesXml = await notesFile.async("string");
        presenterNotes = extractTextsFromXml(notesXml).join("\n").trim();
      }

      slides.push({
        index: i,
        texts,
        imageBase64s,
        presenterNotes,
        shapes,
        bgColor,
        slideWidthEmu: slideWEmu,
        slideHeightEmu: slideHEmu,
      });
    }

    return NextResponse.json({
      fileName: file.name,
      slideCount: slides.length,
      slides,
    });
  } catch (err: unknown) {
    console.error("PPTX parse error:", err);
    return NextResponse.json(
      { error: "Failed to parse PPTX file." },
      { status: 500 }
    );
  }
}
