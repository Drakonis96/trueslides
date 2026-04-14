import { NextRequest, NextResponse } from "next/server";
import https from "node:https";
import http from "node:http";
import { getSessionId } from "@/lib/session";
import { rateLimiters } from "@/lib/rate-limit";

export const maxDuration = 30;

// Maximum image size: 10 MB
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Rewrite a Wikimedia Commons original URL to a 1920px-wide thumbnail.
 */
function wikimediaThumbUrl(url: string, width = 1920): string | null {
  const m = url.match(
    /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)(\/[0-9a-f]\/[0-9a-f]{2})\/(.*)/i
  );
  if (!m) return null;
  if (url.includes("/thumb/")) return null;
  const [, base, hashPath, filename] = m;
  return `${base}/thumb${hashPath}/${filename}/${width}px-${filename}`;
}

/**
 * GET /api/image-proxy?url=...&w=800
 * Downloads an image from the given URL with proper User-Agent headers
 * and returns it as a binary response. This avoids Wikimedia 403 errors
 * that happen when node:https doesn't send a valid User-Agent.
 *
 * Optional `w` parameter: request a specific pixel width.
 * For Wikimedia Commons originals this rewrites to their thumb endpoint.
 */
export async function GET(req: NextRequest) {
  const sessionId = await getSessionId();

  const rl = rateLimiters.general.check(sessionId);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Optional requested width – used to pick Wikimedia thumbnails
  const wParam = req.nextUrl.searchParams.get("w");
  const requestedWidth = wParam ? Math.min(Math.max(Number(wParam) || 0, 64), 3840) : 0;

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
  // Derive origin-based Referer to bypass hotlink protection (museums, galleries)
  const referer = parsed.origin + "/";

  // If a width was requested, try to rewrite Wikimedia originals to thumbnails
  let fetchUrl = url;
  if (requestedWidth > 0) {
    const thumb = wikimediaThumbUrl(url, requestedWidth);
    if (thumb) fetchUrl = thumb;
  }

  try {
    const { data, remoteContentType } = await new Promise<{ data: Buffer; remoteContentType: string }>((resolve, reject) => {
      const doRequest = (requestUrl: string, redirects: number) => {
        if (redirects > 5) { reject(new Error("too many redirects")); return; }
        const mod = requestUrl.startsWith("https") ? https : http;
        const req = mod.get(requestUrl, {
          headers: {
            "User-Agent": UA,
            "Accept": "image/*,*/*;q=0.8",
            "Referer": referer,
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
          const ct = (res.headers["content-type"] ?? "").split(";")[0].trim();
          const declaredLength = Number(res.headers["content-length"] ?? 0);
          if (declaredLength && declaredLength > MAX_IMAGE_BYTES) {
            res.destroy();
            reject(new Error("Image too large"));
            return;
          }
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          res.on("data", (c: Buffer) => {
            totalBytes += c.length;
            if (totalBytes > MAX_IMAGE_BYTES) {
              res.destroy();
              reject(new Error("Image too large"));
              return;
            }
            chunks.push(c);
          });
          res.on("end", () => resolve({ data: Buffer.concat(chunks), remoteContentType: ct }));
          res.on("error", reject);
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      };
      doRequest(fetchUrl, 0);
    });

    // Use the remote Content-Type if it looks like an image; otherwise fall back to extension guess
    let contentType = remoteContentType;
    if (!contentType.startsWith("image/")) {
      const ext = url.match(/\.(png|gif|webp|svg|jpe?g|bmp|avif)/i);
      contentType = ext ? `image/${ext[1].toLowerCase().replace("jpg", "jpeg")}` : "image/jpeg";
    }

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If original image is too large, try a Wikimedia thumbnail
    if (msg.includes("too large")) {
      const thumbUrl = wikimediaThumbUrl(url);
      if (thumbUrl) {
        try {
          const thumbParsed = new URL(thumbUrl);
          const thumbReferer = thumbParsed.origin + "/";
          const { data: thumbData, remoteContentType: thumbCt } = await new Promise<{ data: Buffer; remoteContentType: string }>((resolve, reject) => {
            const doThumbReq = (requestUrl: string, redirects: number) => {
              if (redirects > 5) { reject(new Error("too many redirects")); return; }
              const mod = requestUrl.startsWith("https") ? https : http;
              const req = mod.get(requestUrl, {
                headers: { "User-Agent": UA, "Accept": "image/*,*/*;q=0.8", "Referer": thumbReferer },
                timeout: 15000,
              }, (res) => {
                if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
                  doThumbReq(res.headers.location, redirects + 1); return;
                }
                if (!res.statusCode || res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
                const chunks: Buffer[] = [];
                res.on("data", (c: Buffer) => chunks.push(c));
                res.on("end", () => resolve({ data: Buffer.concat(chunks), remoteContentType: (res.headers["content-type"] ?? "").split(";")[0].trim() }));
                res.on("error", reject);
              });
              req.on("error", reject);
              req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
            };
            doThumbReq(thumbUrl, 0);
          });
          let ct = thumbCt;
          if (!ct.startsWith("image/")) {
            const ext = thumbUrl.match(/\.(png|gif|webp|svg|jpe?g|bmp|avif)/i);
            ct = ext ? `image/${ext[1].toLowerCase().replace("jpg", "jpeg")}` : "image/jpeg";
          }
          return new NextResponse(thumbData, {
            status: 200,
            headers: { "Content-Type": ct, "Cache-Control": "public, max-age=86400" },
          });
        } catch (thumbErr) {
          console.warn(`[image-proxy] Thumbnail fallback also failed:`, thumbErr instanceof Error ? thumbErr.message : thumbErr);
        }
      }
    }
    console.warn(`[image-proxy] Error fetching ${url.substring(0, 80)}:`, msg);
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 502 });
  }
}
