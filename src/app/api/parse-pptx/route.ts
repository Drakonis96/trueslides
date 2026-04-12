import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";

export const maxDuration = 60;

interface ParsedSlide {
  index: number;
  texts: string[];
  imageBase64s: string[];
  presenterNotes: string;
}

// Extract all text nodes from a slide XML string
function extractTextsFromXml(xml: string): string[] {
  const texts: string[] = [];
  // Match <a:t>...</a:t> (text runs in OOXML)
  const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = match[1].trim();
    if (text) texts.push(text);
  }
  return texts;
}

// Extract image relationship IDs from slide XML
function extractImageRelIds(xml: string): string[] {
  const ids: string[] = [];
  // <a:blip r:embed="rId2" .../>
  const regex = /r:embed="(rId\d+)"/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    ids.push(match[1]);
  }
  return ids;
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

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".pptx")) {
      return NextResponse.json(
        { error: "Only .pptx files are supported" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);

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

      // Extract text
      const texts = extractTextsFromXml(slideXml);

      // Extract images
      const imageRelIds = extractImageRelIds(slideXml);
      const imageBase64s: string[] = [];

      if (imageRelIds.length > 0) {
        // Parse the slide's .rels file
        const slideNum = path.match(/slide(\d+)\.xml/)?.[1] || "1";
        const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
        const relsFile = zip.file(relsPath);

        if (relsFile) {
          const relsXml = await relsFile.async("string");
          const relsMap = parseRels(relsXml);

          for (const relId of imageRelIds) {
            const target = relsMap.get(relId);
            if (!target) continue;

            // Resolve relative path (../media/image1.png -> ppt/media/image1.png)
            const mediaPath = target.startsWith("../")
              ? "ppt/" + target.slice(3)
              : target.startsWith("/")
                ? target.slice(1)
                : "ppt/slides/" + target;

            const mediaFile = zip.file(mediaPath);
            if (mediaFile) {
              const data = await mediaFile.async("base64");
              const mime = mimeFromExt(mediaPath);
              imageBase64s.push(`data:${mime};base64,${data}`);
            }
          }
        }
      }

      // Extract presenter notes from the corresponding notesSlide
      let presenterNotes = "";
      const slideNum = path.match(/slide(\d+)\.xml/)?.[1] || "1";
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
