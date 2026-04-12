import { NextRequest, NextResponse } from "next/server";
import { AIProvider, DEFAULT_SPEED_OPTIONS, ImageSearchSpeedOptions, ImageSourceId } from "@/lib/types";
import { getApiKey, getImageSourceKey } from "@/lib/key-store";
import { getSessionId } from "@/lib/session";
import { callAI, callAIVision } from "@/lib/ai-client";
import { getImageFeedbackProfile, type SearchFeedbackProfile } from "@/lib/image-feedback";
import { imageSearchCache, ImageSearchCache } from "@/lib/image-cache";
import {
  buildSearchPlan,
  computeSelectionConfidence,
  mergeRankedWithFallback,
  normalizeQuery,
  rankImageCandidate,
  selectDiverseImages,
  tokenize,
} from "@/lib/image-selection";
import { Agent, setGlobalDispatcher } from "undici";

// Keep outbound HTTP connections alive to reduce repeated TLS handshakes.
setGlobalDispatcher(new Agent({
  connections: 64,
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
}));

// ── Types ──

export interface ImageCandidate {
  title: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  source: "wikimedia" | "openverse" | "unsplash" | "pexels" | "pixabay" | "flickr" | "loc" | "europeana" | "hispana";
  description?: string;
  author?: string;
  pageUrl?: string;
  license?: string;
}

export interface SlideContext {
  title: string;
  bullets: string[];
  section: string;
}

// ── Constants ──

const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXCLUDED_TITLE_PATTERN = /\b(?:logo|icon|crest|flag|diagram|map|symbol|vector|emblem)\b|\bseal\b(?=\s+(?:of|emblem|official|government|state|city|county|university|wax))/i;
const WIKIMEDIA_UA =
  "TrueSlides/v0.01 (https://github.com/trueslides; trueslides@example.com)";

const inFlightSearches = new Map<string, Promise<ImageCandidate[]>>();

async function cachedSearch(
  source: string,
  query: string,
  fetcher: () => Promise<ImageCandidate[]>,
): Promise<ImageCandidate[]> {
  const key = ImageSearchCache.key(query, source);
  const cached = imageSearchCache.get(key) as ImageCandidate[] | undefined;
  if (cached) return cached;

  const inFlight = inFlightSearches.get(key);
  if (inFlight) return inFlight;

  const promise = fetcher()
    .then((results) => {
      imageSearchCache.set(key, results);
      return results;
    })
    .finally(() => {
      inFlightSearches.delete(key);
    });

  inFlightSearches.set(key, promise);
  return promise;
}

// ── Query Planning Helpers ──

function getPlanQueries(
  queries: string[],
  presentationTopic?: string,
  slideContext?: SlideContext,
  feedbackProfile?: SearchFeedbackProfile,
): string[] {
  return buildSearchPlan(queries, presentationTopic, slideContext, feedbackProfile).queries.map((item) => item.query);
}

async function aiSuggestRefinedQueries(
  queries: string[],
  presentationTopic: string | undefined,
  slideContext: SlideContext,
  provider: AIProvider,
  modelId: string,
  apiKey: string,
): Promise<string[]> {
  const plan = buildSearchPlan(queries, presentationTopic, slideContext);
  const systemPrompt = `You are refining image search queries for a presentation slide.
Return ONLY valid JSON with this shape:
{"queries":["query one","query two","query three"]}

Rules:
- Queries must be in English.
- Use 1-4 words per query.
- Prefer concrete visible subjects, named entities, places, objects, artifacts, or scenes.
- Avoid abstract business language.
- When the current query is ambiguous, disambiguate it using the slide context.
- Produce queries that are materially different from the existing ones.`;

  const userPrompt = `Presentation topic: ${presentationTopic || ""}
Slide title: ${slideContext.title}
Section: ${slideContext.section}
Bullets: ${slideContext.bullets.slice(0, 4).join("; ")}
Intent: ${plan.intent}
Anchor phrases: ${plan.anchorPhrases.join(", ")}
Existing queries: ${queries.join(", ")}

Return 3 better search queries.`;

  try {
    const raw = await callAI(provider, modelId, apiKey, systemPrompt, userPrompt, 800);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] || raw) as { queries?: string[] };
    return (parsed.queries || [])
      .filter((query): query is string => typeof query === "string")
      .map((query) => normalizeQuery(query))
      .filter(Boolean)
      .filter((query) => !queries.some((existing) => existing.toLowerCase() === query.toLowerCase()))
      .slice(0, 4);
  } catch {
    return [];
  }
}

// ── Wikimedia Commons Text Search ──

async function searchWikimediaQuery(
  query: string,
  limit: number = 6
): Promise<ImageCandidate[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap -logo -icon -diagram -map -flag`,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iiurlwidth: "1280",
    origin: "*",
  });

  const res = await fetch(
    `https://commons.wikimedia.org/w/api.php?${params.toString()}`,
    { headers: { "User-Agent": WIKIMEDIA_UA } }
  );

  if (!res.ok) {
    console.error("Wikimedia API error:", res.status);
    return [];
  }

  const data = await res.json();
  const pages = data.query?.pages;

  if (!pages) return [];

  const images: ImageCandidate[] = [];
  for (const page of Object.values(pages) as Record<string, unknown>[]) {
    const info = (page.imageinfo as Record<string, unknown>[])?.[0];
    if (!info) continue;
    const mime = info.mime as string;
    if (!ACCEPTED_MIME_TYPES.has(mime)) continue;

    const width = Number(info.width) || 0;
    const height = Number(info.height) || 0;
    const title = String(page.title || "");

    if (width < 500 || height < 300) continue;
    if (EXCLUDED_TITLE_PATTERN.test(title)) continue;

    const pageName = title.replace(/^File:/, "");
    images.push({
      title,
      url: info.url as string,
      thumbUrl: (info.thumburl as string) || (info.url as string),
      width,
      height,
      source: "wikimedia",
      pageUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(pageName)}`,
      license: "Wikimedia Commons",
    });
  }

  return images;
}

// ── Wikimedia Category Search (Improvement 4) ──

async function searchWikimediaByCategory(
  topic: string,
  limit: number = 6
): Promise<ImageCandidate[]> {
  const catParams = new URLSearchParams({
    action: "query",
    format: "json",
    list: "search",
    srsearch: topic,
    srnamespace: "14",
    srlimit: "3",
    origin: "*",
  });

  try {
    const catRes = await fetch(
      `https://commons.wikimedia.org/w/api.php?${catParams.toString()}`,
      { headers: { "User-Agent": WIKIMEDIA_UA } }
    );
    if (!catRes.ok) return [];

    const catData = await catRes.json();
    const categories = catData.query?.search;
    if (!categories?.length) return [];

    const bestCategory = categories[0].title as string;
    const imgParams = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "categorymembers",
      gcmtitle: bestCategory,
      gcmtype: "file",
      gcmlimit: String(limit),
      prop: "imageinfo",
      iiprop: "url|size|mime",
      iiurlwidth: "1280",
      origin: "*",
    });

    const imgRes = await fetch(
      `https://commons.wikimedia.org/w/api.php?${imgParams.toString()}`,
      { headers: { "User-Agent": WIKIMEDIA_UA } }
    );
    if (!imgRes.ok) return [];

    const imgData = await imgRes.json();
    const pages = imgData.query?.pages;
    if (!pages) return [];

    const images: ImageCandidate[] = [];
    for (const page of Object.values(pages) as Record<string, unknown>[]) {
      const info = (page.imageinfo as Record<string, unknown>[])?.[0];
      if (!info) continue;
      const mime = info.mime as string;
      if (!ACCEPTED_MIME_TYPES.has(mime)) continue;

      const width = Number(info.width) || 0;
      const height = Number(info.height) || 0;
      const title = String(page.title || "");

      if (width < 500 || height < 300) continue;
      if (EXCLUDED_TITLE_PATTERN.test(title)) continue;

      const pageName = title.replace(/^File:/, "");
      images.push({
        title,
        url: info.url as string,
        thumbUrl: (info.thumburl as string) || (info.url as string),
        width,
        height,
        source: "wikimedia",
        pageUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(pageName)}`,
        license: "Wikimedia Commons",
      });
    }

    return images;
  } catch {
    return [];
  }
}

// ── Unsplash Search (Improvement 6) ──

async function searchUnsplash(
  query: string,
  apiKey: string,
  limit: number = 6
): Promise<ImageCandidate[]> {
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      query,
      per_page: String(limit),
      orientation: "landscape",
    });

    const res = await fetch(
      `https://api.unsplash.com/search/photos?${params.toString()}`,
      { headers: { Authorization: `Client-ID ${apiKey}` } }
    );
    if (!res.ok) return [];

    const data = await res.json();
    return (data.results || []).map(
      (p: {
        description?: string;
        alt_description?: string;
        urls: { regular: string; small?: string; thumb?: string };
        width: number;
        height: number;
        user?: { name?: string };
        links?: { html?: string };
      }) => ({
        title: p.description || p.alt_description || query,
        url: p.urls.regular,
        thumbUrl: p.urls.thumb || p.urls.small || p.urls.regular,
        width: p.width,
        height: p.height,
        source: "unsplash" as const,
        description: p.alt_description || p.description || undefined,
        author: p.user?.name || undefined,
        pageUrl: p.links?.html || undefined,
        license: "Unsplash License",
      })
    );
  } catch {
    return [];
  }
}

// ── Pexels Search (Improvement 6) ──

async function searchPexels(
  query: string,
  apiKey: string,
  limit: number = 6
): Promise<ImageCandidate[]> {
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      query,
      per_page: String(limit),
      orientation: "landscape",
    });

    const res = await fetch(
      `https://api.pexels.com/v1/search?${params.toString()}`,
      { headers: { Authorization: apiKey } }
    );
    if (!res.ok) return [];

    const data = await res.json();
    return (data.photos || []).map(
      (p: {
        alt?: string;
        src: {
          original?: string;
          large2x?: string;
          large?: string;
          medium?: string;
          small?: string;
        };
        width: number;
        height: number;
        photographer?: string;
        url?: string;
      }) => ({
        title: p.alt || query,
        url: p.src.large || p.src.large2x || p.src.original || "",
        thumbUrl: p.src.small || p.src.medium || p.src.large || p.src.large2x || p.src.original || "",
        width: p.width,
        height: p.height,
        source: "pexels" as const,
        author: p.photographer || undefined,
        pageUrl: p.url || undefined,
        license: "Pexels License",
      })
    );
  } catch {
    return [];
  }
}

// ── Pixabay Search ──

async function searchPixabay(
  query: string,
  apiKey: string,
  limit: number = 6
): Promise<ImageCandidate[]> {
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      key: apiKey,
      q: query,
      image_type: "photo",
      orientation: "horizontal",
      per_page: String(limit),
      safesearch: "true",
    });

    const res = await fetch(
      `https://pixabay.com/api/?${params.toString()}`
    );
    if (!res.ok) return [];

    const data = await res.json();
    return (data.hits || []).map(
      (p: {
        tags?: string;
        webformatURL: string;
        largeImageURL: string;
        imageWidth: number;
        imageHeight: number;
        user?: string;
        pageURL?: string;
      }) => ({
        title: p.tags || query,
        url: p.largeImageURL,
        thumbUrl: p.webformatURL,
        width: p.imageWidth,
        height: p.imageHeight,
        source: "pixabay" as const,
        author: p.user || undefined,
        pageUrl: p.pageURL || undefined,
        license: "Pixabay License",
      })
    );
  } catch {
    return [];
  }
}

// ── Openverse Search (CC-licensed images, no API key needed) ──

async function searchOpenverse(
  query: string,
  limit: number = 6
): Promise<ImageCandidate[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      page_size: String(limit),
      license_type: "commercial",
      extension: "jpg,png,webp",
    });

    const res = await fetch(
      `https://api.openverse.org/v1/images/?${params.toString()}`,
      {
        headers: {
          "User-Agent": "TrueSlides/1.0 (https://github.com/trueslides)",
        },
      }
    );
    if (!res.ok) return [];

    const data = await res.json();
    return (data.results || [])
      .filter((p: { width: number; height: number }) => p.width >= 400 && p.height >= 300)
      .map(
        (p: {
          title?: string;
          url: string;
          thumbnail?: string;
          width: number;
          height: number;
          creator?: string;
          foreign_landing_url?: string;
          license?: string;
        }) => ({
          title: p.title || query,
          url: p.url,
          thumbUrl: p.thumbnail || p.url,
          width: p.width,
          height: p.height,
          source: "openverse" as const,
          author: p.creator || undefined,
          pageUrl: p.foreign_landing_url || undefined,
          license: p.license ? `CC ${p.license.toUpperCase()}` : "Creative Commons",
        })
      );
  } catch {
    return [];
  }
}

// ── Flickr Search ──

async function searchFlickr(
  query: string,
  apiKey: string,
  limit: number = 6
): Promise<ImageCandidate[]> {
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      method: "flickr.photos.search",
      api_key: apiKey,
      text: query,
      format: "json",
      nojsoncallback: "1",
      per_page: String(limit),
      sort: "relevance",
      content_type: "1", // photos only
      media: "photos",
      extras: "url_l,url_m,url_c,o_dims",
      safe_search: "1",
      license: "1,2,3,4,5,6,9,10", // Creative Commons licenses
    });

    const res = await fetch(
      `https://www.flickr.com/services/rest/?${params.toString()}`
    );
    if (!res.ok) return [];

    const data = await res.json();
    if (data.stat !== "ok") return [];

    return (data.photos?.photo || [])
      .filter(
        (p: { url_l?: string; url_c?: string; url_m?: string }) =>
          p.url_l || p.url_c || p.url_m
      )
      .map(
        (p: {
          title?: string;
          id?: string;
          owner?: string;
          url_l?: string;
          url_c?: string;
          url_m?: string;
          width_l?: number;
          height_l?: number;
          width_c?: number;
          height_c?: number;
        }) => {
          const url = p.url_l || p.url_c || p.url_m || "";
          const thumbUrl = p.url_c || p.url_m || p.url_l || "";
          const width = p.width_l || p.width_c || 800;
          const height = p.height_l || p.height_c || 600;
          return {
            title: p.title || query,
            url,
            thumbUrl,
            width,
            height,
            source: "flickr" as const,
            pageUrl: p.id ? `https://www.flickr.com/photos/${p.owner || "_"}/${p.id}` : undefined,
            license: "Creative Commons",
          };
        }
      );
  } catch {
    return [];
  }
}

// ── Library of Congress Search (free, no API key) ──

async function searchLOC(
  query: string,
  limit: number = 6
): Promise<ImageCandidate[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      fa: "online-format:image",
      fo: "json",
      c: String(limit),
    });

    const res = await fetch(
      `https://www.loc.gov/search/?${params.toString()}`,
      {
        headers: {
          "User-Agent": "TrueSlides/1.0 (https://github.com/trueslides)",
        },
      }
    );
    if (!res.ok) return [];

    const data = await res.json();
    const results = data.results || [];

    const images: ImageCandidate[] = [];
    for (const item of results) {
      const urls: string[] = item.image_url || [];
      if (urls.length === 0) continue;

      const title = String(item.title || query);
      if (EXCLUDED_TITLE_PATTERN.test(title)) continue;

      // Pick the largest available image URL; LOC appends #h=N&w=N fragments
      let bestUrl = urls[urls.length - 1]; // usually highest-res last
      let thumbUrl = urls[0]; // usually 150px first
      let width = 800;
      let height = 600;

      // Parse dimensions from URL fragment like #h=524&w=1024
      const fragMatch = bestUrl.match(/#.*?w=(\d+).*?h=(\d+)|#.*?h=(\d+).*?w=(\d+)/);
      if (fragMatch) {
        width = Number(fragMatch[1] || fragMatch[4]) || 800;
        height = Number(fragMatch[2] || fragMatch[3]) || 600;
      }

      // Strip fragment from URLs for clean image loading
      bestUrl = bestUrl.replace(/#.*$/, "");
      thumbUrl = thumbUrl.replace(/#.*$/, "");

      if (width < 200 && height < 200) continue;

      images.push({
        title,
        url: bestUrl,
        thumbUrl,
        width,
        height,
        source: "loc",
        description: item.description?.[0] || undefined,
        author: item.contributor?.[0] || undefined,
        pageUrl: item.url || undefined,
        license: "Public Domain",
      });
    }

    return images;
  } catch {
    return [];
  }
}

// ── Europeana Search (requires free API key) ──

async function searchEuropeana(
  query: string,
  apiKey: string,
  limit: number = 6,
  countryFilter?: string
): Promise<ImageCandidate[]> {
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      wskey: apiKey,
      query,
      media: "true",
      thumbnail: "true",
      rows: String(limit),
    });
    params.append("qf", "TYPE:IMAGE");
    if (countryFilter) {
      params.append("qf", `COUNTRY:${countryFilter}`);
    }

    const res = await fetch(
      `https://api.europeana.eu/record/v2/search.json?${params.toString()}`
    );
    if (!res.ok) return [];

    const data = await res.json();
    return (data.items || [])
      .filter(
        (item: { edmPreview?: string[]; edmIsShownBy?: string[] }) =>
          (item.edmPreview && item.edmPreview.length > 0) ||
          (item.edmIsShownBy && item.edmIsShownBy.length > 0)
      )
      .map(
        (item: {
          title?: string[];
          edmPreview?: string[];
          edmIsShownBy?: string[];
          dcCreator?: string[];
          guid?: string;
        }) => {
          const title = item.title?.[0] || query;
          const thumbUrl = item.edmPreview?.[0] || item.edmIsShownBy?.[0] || "";
          const url = item.edmIsShownBy?.[0] || item.edmPreview?.[0] || "";
          const source: "europeana" | "hispana" = countryFilter === "spain" ? "hispana" : "europeana";
          return {
            title,
            url,
            thumbUrl,
            width: 800,
            height: 600,
            source,
            author: item.dcCreator?.[0] || undefined,
            pageUrl: item.guid || undefined,
            license: "Europeana",
          };
        }
      );
  } catch {
    return [];
  }
}

// ── AI Visual Verification ──

interface VerificationConfig {
  descriptorProvider: AIProvider;
  descriptorModelId: string;
  descriptorApiKey: string;
  orchestratorProvider: AIProvider;
  orchestratorModelId: string;
  orchestratorApiKey: string;
}

const VISION_UA = "TrueSlides/0.1 (presentation builder; contact@trueslides.app)";
const MAX_VISION_IMAGE_BYTES = 512_000;

function getVisionCandidateUrl(candidate: ImageCandidate): string | null {
  if (candidate.url.startsWith("data:")) return candidate.url;

  const thumbUrl = candidate.thumbUrl?.trim();
  if (thumbUrl && thumbUrl !== candidate.url) return thumbUrl;

  // Only fall back to the original when the asset dimensions are already moderate.
  if (candidate.width > 0 && candidate.height > 0 && candidate.width <= 1600 && candidate.height <= 1200) {
    return candidate.url;
  }

  return null;
}

function extractVisionDescription(response: string, position: number, fallbackTitle: string): string {
  const pattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:\*\*)?Image\s*${position}(?:\*\*)?\s*[:\-](?:\*\*)?\s*([\s\S]+?)(?=(?:\n\s*(?:\*\*)?Image\s*\d+(?:\*\*)?\s*[:\-](?:\*\*)?\s*)|$)`,
    "i",
  );
  const match = response.match(pattern);
  return match?.[1]?.replace(/\*\*/g, "").trim() || `(${fallbackTitle})`;
}

/**
 * Download an image URL to a base64 data URI, following redirects
 * and sending a proper User-Agent so Wikimedia (and others) accept us.
 * Returns null on failure.
 */
async function downloadImageAsBase64(url: string): Promise<string | null> {
  // Already a data URI — pass through.
  if (url.startsWith("data:")) return url;

  const nodeHttp = await import("node:http");
  const nodeHttps = await import("node:https");

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const doRequest = (requestUrl: string, redirects: number) => {
      if (redirects > 5) { finish(null); return; }
      const mod = requestUrl.startsWith("https") ? nodeHttps : nodeHttp;
      const req = mod.get(requestUrl, {
        headers: { "User-Agent": VISION_UA, Accept: "image/*,*/*;q=0.8" },
        timeout: 10_000,
      }, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
          const redirectedUrl = new URL(res.headers.location, requestUrl).toString();
          res.resume();
          doRequest(redirectedUrl, redirects + 1);
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume();
          finish(null);
          return;
        }

        const declaredLength = Number(res.headers["content-length"] ?? 0);
        if (declaredLength && declaredLength > MAX_VISION_IMAGE_BYTES) {
          res.destroy();
          finish(null);
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        res.on("data", (c: Buffer) => {
          totalBytes += c.length;
          if (totalBytes > MAX_VISION_IMAGE_BYTES) {
            res.destroy();
            finish(null);
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          if (settled) return;
          const buf = Buffer.concat(chunks);
          const ct = res.headers["content-type"]?.split(";")[0]?.trim() || "image/jpeg";
          const mime = ct.startsWith("image/") ? ct : "image/jpeg";
          finish(`data:${mime};base64,${buf.toString("base64")}`);
        });
        res.on("error", () => finish(null));
      });
      req.on("error", () => finish(null));
      req.on("timeout", () => { req.destroy(); finish(null); });
    };
    doRequest(url, 0);
  });
}

/**
 * Visual verification: download candidate thumbnails to base64, send them
 * ALL in a single batched vision call to get numbered descriptions, then
 * let the orchestrator model pick the best ones.
 *
 * This uses exactly 2 LLM calls per slide (1 vision + 1 text) regardless
 * of how many candidates there are.
 */
async function aiVerifyAndSelectImages(
  candidates: ImageCandidate[],
  slideContext: SlideContext,
  presentationTopic: string,
  verificationConfig: VerificationConfig,
  limit: number,
): Promise<ImageCandidate[]> {
  if (candidates.length <= limit) return candidates;

  const topCandidates = candidates.slice(0, Math.min(candidates.length, 6));

  try {
    // Step 1: Download all thumbnails to base64 in parallel
    const downloadResults = await Promise.all(
      topCandidates.map((candidate) => {
        const visionUrl = getVisionCandidateUrl(candidate);
        return visionUrl ? downloadImageAsBase64(visionUrl) : Promise.resolve(null);
      })
    );

    // Keep only candidates whose images downloaded successfully
    const validEntries: { candidate: ImageCandidate; dataUri: string }[] = [];
    for (let i = 0; i < topCandidates.length; i++) {
      if (downloadResults[i]) {
        validEntries.push({ candidate: topCandidates[i], dataUri: downloadResults[i]! });
      }
    }

    // If too few images downloaded, fall back to title-based selection
    if (validEntries.length <= 1) return candidates.slice(0, limit);

    // Step 2: Single batched vision call — all images in one request
    const imageDataUris = validEntries.map((e) => e.dataUri);
    const imageLabels = validEntries
      .map((e, pos) => `Image ${pos}: "${e.candidate.title}" (${e.candidate.source})`)
      .join("\n");

    const descriptions = await callAIVision(
      verificationConfig.descriptorProvider,
      verificationConfig.descriptorModelId,
      verificationConfig.descriptorApiKey,
      `You are an image description assistant for presentations. You will receive ${validEntries.length} numbered images. For EACH image, write a 1-2 sentence description of what you see. Focus on the main subject, setting, and visual content.

Respond in this exact format:
Image 0: <description>
Image 1: <description>
...`,
      `Describe each of these ${validEntries.length} images:\n${imageLabels}`,
      imageDataUris,
      Math.min(validEntries.length * 80, 600),
    );

    // Step 3: Parse descriptions and ask the orchestrator to pick the best
    const descriptionLines = validEntries.map((e, pos) => {
      const desc = extractVisionDescription(descriptions, pos, e.candidate.title);
      return `[${pos}] Title: "${e.candidate.title}" (${e.candidate.source}) — Visual: ${desc}`;
    });

    const systemPrompt = `You are an image curator for presentations. Based on VISUAL descriptions of real images, select the ${limit} best images for a slide.

Consider:
1. How well the ACTUAL visual content matches the slide topic — not just the title
2. Concrete, relevant imagery over generic or tangential content
3. Visual diversity when selecting multiple images

Respond ONLY with a JSON array of indices, e.g. [0, 3, 5].`;

    const userPrompt = `Slide: "${slideContext.title}" (${slideContext.section})
Points: ${slideContext.bullets.slice(0, 4).join("; ")}
Presentation theme: ${presentationTopic}

Image candidates (with AI-generated visual descriptions):
${descriptionLines.join("\n")}

Select the ${limit} best indices:`;

    const response = await callAI(
      verificationConfig.orchestratorProvider,
      verificationConfig.orchestratorModelId,
      verificationConfig.orchestratorApiKey,
      systemPrompt,
      userPrompt,
      300,
    );

    const match = response.match(/\[[\d\s,]+\]/);
    if (!match) return candidates.slice(0, limit);

    const indices: number[] = JSON.parse(match[0]);
    const selected = indices
      .filter((i) => i >= 0 && i < validEntries.length)
      .map((i) => validEntries[i].candidate)
      .slice(0, limit);

    return selected.length > 0 ? selected : candidates.slice(0, limit);
  } catch (err) {
    console.warn("[images] AI visual verification failed, falling back:", err);
    return candidates.slice(0, limit);
  }
}

// ── LLM Image Selection (Improvement 5) ──

async function aiSelectBestImages(
  candidates: ImageCandidate[],
  slideContext: SlideContext,
  presentationTopic: string,
  provider: AIProvider,
  modelId: string,
  apiKey: string,
  limit: number
): Promise<ImageCandidate[]> {
  if (candidates.length <= limit) return candidates;

  try {
    const candidateList = candidates.slice(0, 20).map((c, i) => ({
      index: i,
      title: c.title,
      source: c.source,
    }));

    const systemPrompt = `You are an image curator for presentations. Select the ${limit} best images for a slide.

Consider:
1. Exact topical match to the slide and the overall presentation
2. Concrete, visible subject matter instead of vague concepts
3. Prefer photographic or archival material over generic illustrations when possible
4. If selecting multiple images, prefer complementary images instead of near-duplicates

Respond ONLY with a JSON array of indices, e.g. [0, 3, 5].`;

    const userPrompt = `Slide: "${slideContext.title}" (${slideContext.section})
Points: ${slideContext.bullets.slice(0, 4).join("; ")}
Presentation theme: ${presentationTopic}

Candidates:
${candidateList.map((c) => `[${c.index}] "${c.title}" (${c.source})`).join("\n")}

Best ${limit} indices:`;

    const response = await callAI(
      provider,
      modelId,
      apiKey,
      systemPrompt,
      userPrompt
    );

    const match = response.match(/\[[\d\s,]+\]/);
    if (!match) return candidates.slice(0, limit);

    const indices: number[] = JSON.parse(match[0]);
    const selected = indices
      .filter((i) => i >= 0 && i < candidates.length)
      .map((i) => candidates[i])
      .slice(0, limit);

    return selected.length > 0 ? selected : candidates.slice(0, limit);
  } catch {
    return candidates.slice(0, limit);
  }
}

// ── Main Search Per Slide ──

export async function searchSlideImages(
  queries: string[],
  presentationTopic: string | undefined,
  slideContext: SlideContext | undefined,
  limit: number = 4,
  enabledSources: Set<ImageSourceId> = new Set(["wikimedia"]),
  sourceKeys: Partial<Record<ImageSourceId, string>> = {},
  aiConfig?: { provider: AIProvider; modelId: string; apiKey: string },
  speedOptions?: ImageSearchSpeedOptions,
  feedbackProfile?: SearchFeedbackProfile,
  verificationConfig?: VerificationConfig,
): Promise<ImageCandidate[]> {
  const speed = speedOptions ?? DEFAULT_SPEED_OPTIONS;
  const effectiveLimit = speed.lowerFetchLimit ? Math.max(limit, 4) : Math.max(limit * 2, 8);
  const allCandidates: ImageCandidate[] = [];
  const seen = new Set<string>();

  const addCandidates = (images: ImageCandidate[]) => {
    for (const img of images) {
      if (seen.has(img.url)) continue;
      seen.add(img.url);
      allCandidates.push(img);
    }
  };

  const queryCandidates = getPlanQueries(queries, presentationTopic, slideContext, feedbackProfile);
  const effectiveQueries = speed.reduceQueryCandidates
    ? queryCandidates.slice(0, 2)
    : queryCandidates.slice(0, 4);
  const primaryQuery = effectiveQueries[0] || queries[0] || "";

  // Phase 1: Parallel search across enabled sources
  const phase1: Promise<ImageCandidate[]>[] = [];

  if (enabledSources.has("wikimedia")) {
    for (const q of effectiveQueries) {
      phase1.push(cachedSearch("wikimedia", q, () => searchWikimediaQuery(q, effectiveLimit)));
    }
    if (!speed.skipCategorySearch && primaryQuery) {
      phase1.push(cachedSearch("wikimedia-category", primaryQuery, () => searchWikimediaByCategory(primaryQuery, limit)));
    }
  }
  if (enabledSources.has("unsplash") && sourceKeys.unsplash && primaryQuery) {
    phase1.push(cachedSearch("unsplash", primaryQuery, () => searchUnsplash(primaryQuery, sourceKeys.unsplash!, limit)));
  }
  if (enabledSources.has("pexels") && sourceKeys.pexels && primaryQuery) {
    phase1.push(cachedSearch("pexels", primaryQuery, () => searchPexels(primaryQuery, sourceKeys.pexels!, limit)));
  }
  if (enabledSources.has("pixabay") && sourceKeys.pixabay && primaryQuery) {
    phase1.push(cachedSearch("pixabay", primaryQuery, () => searchPixabay(primaryQuery, sourceKeys.pixabay!, limit)));
  }
  if (enabledSources.has("openverse") && primaryQuery) {
    phase1.push(cachedSearch("openverse", primaryQuery, () => searchOpenverse(primaryQuery, limit)));
  }
  if (enabledSources.has("flickr") && sourceKeys.flickr && primaryQuery) {
    phase1.push(cachedSearch("flickr", primaryQuery, () => searchFlickr(primaryQuery, sourceKeys.flickr!, limit)));
  }
  if (enabledSources.has("loc") && primaryQuery) {
    phase1.push(cachedSearch("loc", primaryQuery, () => searchLOC(primaryQuery, limit)));
  }
  if (enabledSources.has("europeana") && sourceKeys.europeana && primaryQuery) {
    phase1.push(cachedSearch("europeana", primaryQuery, () => searchEuropeana(primaryQuery, sourceKeys.europeana!, limit)));
  }
  if (enabledSources.has("hispana") && sourceKeys.hispana && primaryQuery) {
    phase1.push(cachedSearch("hispana", primaryQuery, () => searchEuropeana(primaryQuery, sourceKeys.hispana!, limit, "spain")));
  }

  const phase1Results = await Promise.all(phase1);
  for (const r of phase1Results) addCandidates(r);

  // Phase 2: Fallback if not enough results
  if (allCandidates.length < limit && speed.maxFallbackAttempts > 0) {
    let fallbackCount = 0;
    const maxAttempts = speed.maxFallbackAttempts;

    if (enabledSources.has("wikimedia")) {
      for (const query of queryCandidates.slice(1)) {
        if (fallbackCount >= maxAttempts) break;
        const words = tokenize(query);
        const fallbacks = [
          words.slice(0, 3).join(" "),
          words.slice(0, 2).join(" "),
          words[0],
        ].filter(Boolean);

        for (const fb of fallbacks) {
          if (!fb || fallbackCount >= maxAttempts) continue;
          const images = await cachedSearch("wikimedia", fb, () => searchWikimediaQuery(fb, effectiveLimit));
          addCandidates(images);
          fallbackCount++;
          if (allCandidates.length >= limit * 2) break;
        }
        if (allCandidates.length >= limit * 2) break;
      }
    }

    // Broader searches as secondary fallback
    if (allCandidates.length < limit && effectiveQueries.length > 1) {
      const broader = effectiveQueries[effectiveQueries.length - 1];
      const fallbackPromises: Promise<ImageCandidate[]>[] = [];
      if (enabledSources.has("unsplash") && sourceKeys.unsplash) {
        fallbackPromises.push(cachedSearch("unsplash", broader, () => searchUnsplash(broader, sourceKeys.unsplash!, limit)));
      }
      if (enabledSources.has("pexels") && sourceKeys.pexels) {
        fallbackPromises.push(cachedSearch("pexels", broader, () => searchPexels(broader, sourceKeys.pexels!, limit)));
      }
      if (enabledSources.has("pixabay") && sourceKeys.pixabay) {
        fallbackPromises.push(cachedSearch("pixabay", broader, () => searchPixabay(broader, sourceKeys.pixabay!, limit)));
      }
      if (enabledSources.has("openverse")) {
        fallbackPromises.push(cachedSearch("openverse", broader, () => searchOpenverse(broader, limit)));
      }
      if (enabledSources.has("flickr") && sourceKeys.flickr) {
        fallbackPromises.push(cachedSearch("flickr", broader, () => searchFlickr(broader, sourceKeys.flickr!, limit)));
      }
      if (enabledSources.has("loc")) {
        fallbackPromises.push(cachedSearch("loc", broader, () => searchLOC(broader, limit)));
      }
      if (enabledSources.has("europeana") && sourceKeys.europeana) {
        fallbackPromises.push(cachedSearch("europeana", broader, () => searchEuropeana(broader, sourceKeys.europeana!, limit)));
      }
      if (enabledSources.has("hispana") && sourceKeys.hispana) {
        fallbackPromises.push(cachedSearch("hispana", broader, () => searchEuropeana(broader, sourceKeys.hispana!, limit, "spain")));
      }
      const fallbackResults = await Promise.all(fallbackPromises);
      for (const r of fallbackResults) addCandidates(r);
    }
  }

  let plan = buildSearchPlan(queries, presentationTopic, slideContext, feedbackProfile);
  let ranked = allCandidates
    .map((img) => rankImageCandidate(img, plan, feedbackProfile))
    .sort((a, b) => b.score - a.score);

  let confidence = computeSelectionConfidence(ranked);

  // Phase 3b: If confidence is weak, ask the LLM for better concrete queries and retry.
  if (aiConfig && slideContext && confidence < 0.48) {
    const refinedQueries = await aiSuggestRefinedQueries(
      queryCandidates,
      presentationTopic,
      slideContext,
      aiConfig.provider,
      aiConfig.modelId,
      aiConfig.apiKey,
    );

    if (refinedQueries.length > 0) {
      const refinementPromises: Promise<ImageCandidate[]>[] = [];
      const refinementSet = new Set(refinedQueries.slice(0, speed.reduceQueryCandidates ? 2 : 3));

      for (const query of refinementSet) {
        if (enabledSources.has("wikimedia")) {
          refinementPromises.push(cachedSearch("wikimedia", query, () => searchWikimediaQuery(query, effectiveLimit)));
        }
        if (enabledSources.has("openverse")) {
          refinementPromises.push(cachedSearch("openverse", query, () => searchOpenverse(query, limit)));
        }
        if (enabledSources.has("loc")) {
          refinementPromises.push(cachedSearch("loc", query, () => searchLOC(query, limit)));
        }
        if (enabledSources.has("unsplash") && sourceKeys.unsplash) {
          refinementPromises.push(cachedSearch("unsplash", query, () => searchUnsplash(query, sourceKeys.unsplash!, limit)));
        }
        if (enabledSources.has("pexels") && sourceKeys.pexels) {
          refinementPromises.push(cachedSearch("pexels", query, () => searchPexels(query, sourceKeys.pexels!, limit)));
        }
        if (enabledSources.has("pixabay") && sourceKeys.pixabay) {
          refinementPromises.push(cachedSearch("pixabay", query, () => searchPixabay(query, sourceKeys.pixabay!, limit)));
        }
        if (enabledSources.has("flickr") && sourceKeys.flickr) {
          refinementPromises.push(cachedSearch("flickr", query, () => searchFlickr(query, sourceKeys.flickr!, limit)));
        }
        if (enabledSources.has("europeana") && sourceKeys.europeana) {
          refinementPromises.push(cachedSearch("europeana", query, () => searchEuropeana(query, sourceKeys.europeana!, limit)));
        }
        if (enabledSources.has("hispana") && sourceKeys.hispana) {
          refinementPromises.push(cachedSearch("hispana", query, () => searchEuropeana(query, sourceKeys.hispana!, limit, "spain")));
        }
      }

      const refinementResults = await Promise.all(refinementPromises);
      for (const result of refinementResults) addCandidates(result);

      plan = buildSearchPlan([...queryCandidates, ...refinedQueries], presentationTopic, slideContext, feedbackProfile);
      ranked = allCandidates
        .map((img) => rankImageCandidate(img, plan, feedbackProfile))
        .sort((a, b) => b.score - a.score);
      confidence = computeSelectionConfidence(ranked);
      void confidence;
    }
  }

  let preferred = ranked.slice(0, Math.max(limit * 4, 12)).map((entry) => entry.image);

  // Phase 4 / 5: When visual verification is enabled it replaces the text-only
  // LLM reranking so the wider pool goes straight to the vision step.
  if (verificationConfig && slideContext && preferred.length > limit) {
    // Phase 5 (visual verification) on the full shortlist — skips Phase 4.
    preferred = await aiVerifyAndSelectImages(
      preferred,
      slideContext,
      presentationTopic || "",
      verificationConfig,
      limit,
    );
  } else if (aiConfig && slideContext && preferred.length > limit) {
    // Phase 4: text-only LLM reranking (no verification available).
    preferred = await aiSelectBestImages(
      preferred,
      slideContext,
      presentationTopic || "",
      aiConfig.provider,
      aiConfig.modelId,
      aiConfig.apiKey,
      Math.max(limit * 2, limit)
    );
  }

  const preferredSet = new Set(preferred.map((img) => img.url));
  const preferredRanked = ranked.filter((entry) => preferredSet.has(entry.image.url));
  const diversified = selectDiverseImages(preferredRanked.length > 0 ? preferredRanked : ranked, limit);
  return mergeRankedWithFallback(diversified, ranked, limit);
}

// ── POST Handler ──

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      searchTerms,
      presentationTopic,
      slideContexts,
      exclude,
      aiConfig: aiConfigInput,
      enabledSources: enabledSourcesInput,
      limit: limitInput,
      imageVerification: imageVerificationInput,
      speedOptions: speedOptionsInput,
    } = body as {
      searchTerms: string[][];
      presentationTopic?: string;
      slideContexts?: SlideContext[];
      exclude?: string[];
      aiConfig?: { provider: AIProvider; modelId: string };
      enabledSources?: ImageSourceId[];
      limit?: number;
      imageVerification?: {
        enabled: boolean;
        descriptorProvider: AIProvider;
        descriptorModelId: string;
      };
      speedOptions?: ImageSearchSpeedOptions;
    };

    if (!Array.isArray(searchTerms)) {
      return NextResponse.json(
        { error: "searchTerms must be an array of string arrays" },
        { status: 400 }
      );
    }

    const excludeSet = new Set(exclude ?? []);
    const effectiveLimit = Math.min(Math.max(limitInput ?? 8, 1), 30);
    // For pagination/load-more flows, search a deeper pool before exclusion.
    // Otherwise deterministic/cached top results can all be excluded and return empty.
    const searchDepthLimit = Math.min(
      80,
      Math.max(effectiveLimit, effectiveLimit + excludeSet.size + 8),
    );
    const enabledSources = new Set<ImageSourceId>(
      enabledSourcesInput ?? ["wikimedia", "openverse", "loc"]
    );

    // Resolve image source API keys from key-store
    const sourceKeys: Partial<Record<ImageSourceId, string>> = {};
    const sessionId = await getSessionId();
    try {
      for (const src of enabledSources) {
        if (src === "wikimedia" || src === "openverse" || src === "loc") continue; // no key needed
        const key = getImageSourceKey(sessionId, src);
        if (key) sourceKeys[src] = key;
      }
    } catch {
      /* keys unavailable — sources without keys will be skipped */
    }

    // Resolve AI config for LLM selection (Improvement 5)
    let aiConfig:
      | { provider: AIProvider; modelId: string; apiKey: string }
      | undefined;
    if (aiConfigInput?.provider && aiConfigInput?.modelId) {
      try {
        const key = getApiKey(sessionId, aiConfigInput.provider);
        if (key) aiConfig = { ...aiConfigInput, apiKey: key };
      } catch {
        /* AI selection skipped if key unavailable */
      }
    }

    // Resolve AI visual verification config
    let resolvedVerification: VerificationConfig | undefined;
    if (
      imageVerificationInput?.enabled &&
      imageVerificationInput.descriptorProvider &&
      imageVerificationInput.descriptorModelId &&
      aiConfigInput?.provider &&
      aiConfigInput?.modelId
    ) {
      try {
        const descriptorKey = getApiKey(sessionId, imageVerificationInput.descriptorProvider);
        const orchestratorKey = aiConfig?.apiKey ?? getApiKey(sessionId, aiConfigInput.provider);
        if (descriptorKey && orchestratorKey) {
          resolvedVerification = {
            descriptorProvider: imageVerificationInput.descriptorProvider,
            descriptorModelId: imageVerificationInput.descriptorModelId,
            descriptorApiKey: descriptorKey,
            orchestratorProvider: aiConfigInput.provider,
            orchestratorModelId: aiConfigInput.modelId,
            orchestratorApiKey: orchestratorKey,
          };
        }
      } catch {
        /* verification skipped if keys unavailable */
      }
    }

    // Fetch images for each slide (with concurrency limit)
    const results: ImageCandidate[][] = [];
    const batchSize = 5;

    for (let i = 0; i < searchTerms.length; i += batchSize) {
      const batch = searchTerms.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (queries, batchIdx) => {
          const slideIdx = i + batchIdx;
          if (!queries || queries.length === 0) return [];
          const slideContext = slideContexts?.[slideIdx];
          const feedbackProfile = getImageFeedbackProfile(sessionId, presentationTopic, slideContext);
          const images = await searchSlideImages(
            queries,
            presentationTopic,
            slideContext,
            searchDepthLimit,
            enabledSources,
            sourceKeys,
            aiConfig,
            speedOptionsInput,
            feedbackProfile,
            resolvedVerification,
          );
          // Filter out excluded URLs so the caller gets fresh results
          const fresh = images.filter(
            (img) => !excludeSet.has(img.url) && !excludeSet.has(img.thumbUrl)
          );
          return fresh.slice(0, effectiveLimit);
        })
      );
      results.push(...batchResults);
    }

    return NextResponse.json({ images: results });
  } catch (err: unknown) {
    console.error("Image search error:", err);
    return NextResponse.json(
      { error: "Failed to fetch images" },
      { status: 500 }
    );
  }
}
