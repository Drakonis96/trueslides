import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";

export const maxDuration = 60;

// Build OOXML for a notes slide
function buildNotesXml(slideIndex: number, noteText: string): string {
  // Escape XML special characters
  const escaped = noteText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  // Split into paragraphs
  const paragraphs = escaped.split(/\n/).map(
    (line) => `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${line}</a:t></a:r></a:p>`
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
         xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
         xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Slide Image Placeholder 1"/>
          <p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="sldImg"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Notes Placeholder 2"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          ${paragraphs}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`;
}

// Build a .rels file for a notes slide
function buildNotesRels(slideIndex: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideIndex + 1}.xml"/>
</Relationships>`;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const notesJson = formData.get("notes") as string | null;

    if (!file || !notesJson) {
      return NextResponse.json({ error: "File and notes are required" }, { status: 400 });
    }

    const notes: string[] = JSON.parse(notesJson);
    const buffer = Buffer.from(await file.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);

    // Find slide count
    const slideFiles: number[] = [];
    zip.forEach((path) => {
      const match = path.match(/^ppt\/slides\/slide(\d+)\.xml$/);
      if (match) slideFiles.push(parseInt(match[1], 10));
    });
    slideFiles.sort((a, b) => a - b);

    // Ensure notesSlides folder exists in content types
    let contentTypesXml = await zip.file("[Content_Types].xml")!.async("string");

    for (let i = 0; i < slideFiles.length && i < notes.length; i++) {
      const slideNum = slideFiles[i];
      const noteText = notes[i];
      if (!noteText) continue;

      const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
      const notesRelsPath = `ppt/notesSlides/_rels/notesSlide${slideNum}.xml.rels`;

      // Check if notes slide already exists - if so, inject text into existing
      const existing = zip.file(notesPath);
      if (existing) {
        let existingXml = await existing.async("string");
        // Replace the body content of the notes placeholder
        const escaped = noteText
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");

        const paragraphs = escaped.split(/\n/).map(
          (line) => `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${line}</a:t></a:r></a:p>`
        ).join("");

        // Find the body placeholder (type="body" idx="1") and replace its txBody content
        const bodyMatch = existingXml.match(
          /(<p:sp>[\s\S]*?<p:nvPr><p:ph type="body" idx="1"\/><\/p:nvPr>[\s\S]*?<p:txBody>)([\s\S]*?)(<\/p:txBody>[\s\S]*?<\/p:sp>)/
        );
        if (bodyMatch) {
          existingXml = existingXml.replace(
            bodyMatch[0],
            `${bodyMatch[1]}<a:bodyPr/><a:lstStyle/>${paragraphs}${bodyMatch[3]}`
          );
        }
        zip.file(notesPath, existingXml);
      } else {
        // Create new notes slide
        zip.file(notesPath, buildNotesXml(i, noteText));
        zip.file(notesRelsPath, buildNotesRels(i));

        // Add relationship in the slide's .rels
        const slideRelsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
        const slideRelsFile = zip.file(slideRelsPath);
        if (slideRelsFile) {
          let slideRels = await slideRelsFile.async("string");
          // Find max rId
          const rIdMatches = [...slideRels.matchAll(/Id="rId(\d+)"/g)];
          const maxRId = rIdMatches.reduce((max, m) => Math.max(max, parseInt(m[1], 10)), 0);
          const newRId = `rId${maxRId + 1}`;

          slideRels = slideRels.replace(
            "</Relationships>",
            `  <Relationship Id="${newRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${slideNum}.xml"/>\n</Relationships>`
          );
          zip.file(slideRelsPath, slideRels);
        }

        // Add content type override if not present
        const override = `<Override PartName="/ppt/notesSlides/notesSlide${slideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`;
        if (!contentTypesXml.includes(`notesSlide${slideNum}.xml`)) {
          contentTypesXml = contentTypesXml.replace(
            "</Types>",
            `  ${override}\n</Types>`
          );
        }
      }
    }

    // Write updated content types
    zip.file("[Content_Types].xml", contentTypesXml);

    // Generate modified PPTX
    const outputBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    return new NextResponse(outputBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${file.name.replace(".pptx", "-notes.pptx")}"`,
      },
    });
  } catch (err: unknown) {
    console.error("Inject notes error:", err);
    return NextResponse.json(
      { error: "Failed to inject notes into PPTX" },
      { status: 500 }
    );
  }
}
