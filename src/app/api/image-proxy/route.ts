import { NextRequest, NextResponse } from "next/server";
import https from "node:https";
import http from "node:http";

export const maxDuration = 30;

/**
 * GET /api/image-proxy?url=...
 * Downloads an image from the given URL with proper User-Agent headers
 * and returns it as a binary response. This avoids Wikimedia 403 errors
 * that happen when node:https doesn't send a valid User-Agent.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Validate URL format
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Only allow http/https protocols for image fetching
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Invalid protocol" }, { status: 400 });
  }

  const UA = "TrueSlides/0.1 (presentation builder; contact@trueslides.app)";

  try {
    const data = await new Promise<Buffer>((resolve, reject) => {
      const doRequest = (requestUrl: string, redirects: number) => {
        if (redirects > 5) { reject(new Error("too many redirects")); return; }
        const mod = requestUrl.startsWith("https") ? https : http;
        const req = mod.get(requestUrl, {
          headers: {
            "User-Agent": UA,
            "Accept": "image/*,*/*;q=0.8",
          },
          timeout: 15000,
        }, (res) => {
          if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
            doRequest(res.headers.location, redirects + 1);
            return;
          }
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      };
      doRequest(url, 0);
    });

    // Detect content type
    const ext = url.match(/\.(png|gif|webp|svg)/i);
    const contentType = ext ? `image/${ext[1].toLowerCase()}` : "image/jpeg";

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.warn(`[image-proxy] Error fetching ${url.substring(0, 80)}:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 502 });
  }
}
