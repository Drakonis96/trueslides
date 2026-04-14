import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

/**
 * Serve PPTX-imported slide images stored on disk.
 * GET /api/slide-images/{uuid}.{png|jpg}
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;

  // Security: only allow UUID.{png,jpg} filenames (no path traversal)
  if (!/^[a-f0-9-]{36}\.(png|jpg)$/.test(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const filePath = path.resolve(process.cwd(), "data", "slide-images", filename);

  // Belt-and-suspenders path traversal check
  const expectedDir = path.resolve(process.cwd(), "data", "slide-images");
  if (!filePath.startsWith(expectedDir + path.sep)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = await readFile(filePath);
  const contentType = filename.endsWith(".jpg") ? "image/jpeg" : "image/png";

  return new NextResponse(data, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
