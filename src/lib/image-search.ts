import { callAI, callAIVision } from "@/lib/ai-client";
import { imageSearchCache, ImageSearchCache } from "@/lib/image-cache";
import { type SearchFeedbackProfile } from "@/lib/image-feedback";
import {
  buildSearchPlan,
  computeSelectionConfidence,
  mergeRankedWithFallback,
  normalizeQuery,
  rankImageCandidate,
  selectDiverseImages,
  tokenize,
} from "@/lib/image-selection";
import { AIProvider, DEFAULT_SPEED_OPTIONS, ImageSearchSpeedOptions, ImageSourceId } from "@/lib/types";
import { Agent, setGlobalDispatcher } from "undici";

// Keep outbound HTTP connections alive to reduce repeated TLS handshakes.
setGlobalDispatcher(new Agent({
  connections: 64,
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
}));

export interface ImageCandidate {
  title: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  source: ImageSourceId;
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

export interface ImageSearchAiConfig {
  provider: AIProvider;
  modelId: string;
  apiKey: string;
}

export interface VerificationConfig {
  descriptorProvider: AIProvider;
  descriptorModelId: string;
  descriptorApiKey: string;
  orchestratorProvider: AIProvider;
  orchestratorModelId: string;
  orchestratorApiKey: string;
}

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

async function searchWikimediaQuery(
  query: string,
  limit: number = 6,
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
    { headers: { "User-Agent": WIKIMEDIA_UA } },
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

async function searchWikimediaByCategory(
  topic: string,
  limit: number = 6,
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
      { headers: { "User-Agent": WIKIMEDIA_UA } },
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
      { headers: { "User-Agent": WIKIMEDIA_UA } },
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

async function searchUnsplash(
  query: string,
  apiKey: string,
  limit: number = 6,
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
      { headers: { Authorization: `Client-ID ${apiKey}` } },
    );
    if (!res.ok) return [];

    const data = await res.json();
    return (data.results || []).map(
      (photo: {
        description?: string;
        alt_description?: string;
        urls: { regular: string; small?: string; thumb?: string };
        width: number;
        height: number;
        user?: { name?: string };
        links?: { html?: string };
      }) => ({
        title: photo.description || photo.alt_description || query,
        url: photo.urls.regular,
        thumbUrl: photo.urls.thumb || photo.urls.small || photo.urls.regular,
        width: photo.width,
        height: photo.height,
        source: "unsplash",
        description: photo.alt_description || photo.description || undefined,
        author: photo.user?.name || undefined,
        pageUrl: photo.links?.html || undefined,
        license: "Unsplash License",
      }),
    );
  } catch {
    return [];
  }
}

async function searchPexels(
  query: string,
  apiKey: string,
  limit: number = 6,
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
      { headers: { Authorization: apiKey } },
    );
    if (!res.ok) return [];

    const data = await res.json();
    return (data.photos || []).map(
      (photo: {
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
        title: photo.alt || query,
        url: photo.src.large || photo.src.large2x || photo.src.original || "",
        thumbUrl: photo.src.small || photo.src.medium || photo.src.large || photo.src.large2x || photo.src.original || "",
        width: photo.width,
        height: photo.height,
        source: "pexels",
        author: photo.photographer || undefined,
        pageUrl: photo.url || undefined,
        license: "Pexels License",
      }),
    );
  } catch {
    return [];
  }
}

async function searchPixabay(
  query: string,
  apiKey: string,
  limit: number = 6,
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
      `https://pixabay.com/api/?${params.toString()}`,
    );
    if (!res.ok) return [];

    const data = await res.json();
    return (data.hits || []).map(
      (photo: {
        tags?: string;
        webformatURL: string;
        largeImageURL: string;
        imageWidth: number;
        imageHeight: number;
        user?: string;
        pageURL?: string;
      }) => ({
        title: photo.tags || query,
        url: photo.largeImageURL,
        thumbUrl: photo.webformatURL,
        width: photo.imageWidth,
        height: photo.imageHeight,
        source: "pixabay",
        author: photo.user || undefined,
        pageUrl: photo.pageURL || undefined,
        license: "Pixabay License",
      }),
    );
  } catch {
    return [];
  }
}

async function searchOpenverse(
  query: string,
  limit: number = 6,
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
      },
    );
    if (!res.ok) return [];

    const data = await res.json();
    return (data.results || [])
      .filter((photo: { width: number; height: number }) => photo.width >= 400 && photo.height >= 300)
      .map(
        (photo: {
          title?: string;
          url: string;
          thumbnail?: string;
          width: number;
          height: number;
          creator?: string;
          foreign_landing_url?: string;
          license?: string;
        }) => ({
          title: photo.title || query,
          url: photo.url,
          thumbUrl: photo.thumbnail || photo.url,
          width: photo.width,
          height: photo.height,
          source: "openverse",
          author: photo.creator || undefined,
          pageUrl: photo.foreign_landing_url || undefined,
          license: photo.license ? `CC ${photo.license.toUpperCase()}` : "Creative Commons",
        }),
      );
  } catch {
    return [];
  }
}

async function searchFlickr(
  query: string,
  apiKey: string,
  limit: number = 6,
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
      content_type: "1",
      media: "photos",
      extras: "url_l,url_m,url_c,o_dims",
      safe_search: "1",
      license: "1,2,3,4,5,6,9,10",
    });

    const res = await fetch(
      `https://www.flickr.com/services/rest/?${params.toString()}`,
    );
    if (!res.ok) return [];

    const data = await res.json();
    if (data.stat !== "ok") return [];

    return (data.photos?.photo || [])
      .filter(
        (photo: { url_l?: string; url_c?: string; url_m?: string }) =>
          photo.url_l || photo.url_c || photo.url_m,
      )
      .map(
        (photo: {
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
          const url = photo.url_l || photo.url_c || photo.url_m || "";
          const thumbUrl = photo.url_c || photo.url_m || photo.url_l || "";
          const width = photo.width_l || photo.width_c || 800;
          const height = photo.height_l || photo.height_c || 600;

          return {
            title: photo.title || query,
            url,
            thumbUrl,
            width,
            height,
            source: "flickr" as const,
            pageUrl: photo.id ? `https://www.flickr.com/photos/${photo.owner || "_"}/${photo.id}` : undefined,
            license: "Creative Commons",
          };
        },
      );
  } catch {
    return [];
  }
}

async function searchLOC(
  query: string,
  limit: number = 6,
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
      },
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

      let bestUrl = urls[urls.length - 1];
      let thumbUrl = urls[0];
      let width = 800;
      let height = 600;

      const fragmentMatch = bestUrl.match(/#.*?w=(\d+).*?h=(\d+)|#.*?h=(\d+).*?w=(\d+)/);
      if (fragmentMatch) {
        width = Number(fragmentMatch[1] || fragmentMatch[4]) || 800;
        height = Number(fragmentMatch[2] || fragmentMatch[3]) || 600;
      }

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

async function searchEuropeana(
  query: string,
  apiKey: string,
  limit: number = 6,
  countryFilter?: string,
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
      `https://api.europeana.eu/record/v2/search.json?${params.toString()}`,
    );
    if (!res.ok) return [];

    const data = await res.json();
    return (data.items || [])
      .filter(
        (item: { edmPreview?: string[]; edmIsShownBy?: string[] }) =>
          (item.edmPreview && item.edmPreview.length > 0) ||
          (item.edmIsShownBy && item.edmIsShownBy.length > 0),
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
        },
      );
  } catch {
    return [];
  }
}

const VISION_UA = "TrueSlides/0.1 (presentation builder; contact@trueslides.app)";
const MAX_VISION_IMAGE_BYTES = 512_000;

function getVisionCandidateUrl(candidate: ImageCandidate): string | null {
  if (candidate.url.startsWith("data:")) return candidate.url;

  const thumbUrl = candidate.thumbUrl?.trim();
  if (thumbUrl && thumbUrl !== candidate.url) return thumbUrl;

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

async function downloadImageAsBase64(url: string): Promise<string | null> {
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
      if (redirects > 5) {
        finish(null);
        return;
      }

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
        res.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_VISION_IMAGE_BYTES) {
            res.destroy();
            finish(null);
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (settled) return;
          const buffer = Buffer.concat(chunks);
          const contentType = res.headers["content-type"]?.split(";")[0]?.trim() || "image/jpeg";
          const mime = contentType.startsWith("image/") ? contentType : "image/jpeg";
          finish(`data:${mime};base64,${buffer.toString("base64")}`);
        });
        res.on("error", () => finish(null));
      });
      req.on("error", () => finish(null));
      req.on("timeout", () => {
        req.destroy();
        finish(null);
      });
    };

    doRequest(url, 0);
  });
}

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
    const downloadResults = await Promise.all(
      topCandidates.map((candidate) => {
        const visionUrl = getVisionCandidateUrl(candidate);
        return visionUrl ? downloadImageAsBase64(visionUrl) : Promise.resolve(null);
      }),
    );

    const validEntries: { candidate: ImageCandidate; dataUri: string }[] = [];
    for (let index = 0; index < topCandidates.length; index++) {
      if (downloadResults[index]) {
        validEntries.push({ candidate: topCandidates[index], dataUri: downloadResults[index]! });
      }
    }

    if (validEntries.length <= 1) return candidates.slice(0, limit);

    const imageDataUris = validEntries.map((entry) => entry.dataUri);
    const imageLabels = validEntries
      .map((entry, position) => `Image ${position}: "${entry.candidate.title}" (${entry.candidate.source})`)
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

    const descriptionLines = validEntries.map((entry, position) => {
      const description = extractVisionDescription(descriptions, position, entry.candidate.title);
      return `[${position}] Title: "${entry.candidate.title}" (${entry.candidate.source}) — Visual: ${description}`;
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
      .filter((index) => index >= 0 && index < validEntries.length)
      .map((index) => validEntries[index].candidate)
      .slice(0, limit);

    return selected.length > 0 ? selected : candidates.slice(0, limit);
  } catch (error) {
    console.warn("[images] AI visual verification failed, falling back:", error);
    return candidates.slice(0, limit);
  }
}

async function aiSelectBestImages(
  candidates: ImageCandidate[],
  slideContext: SlideContext,
  presentationTopic: string,
  provider: AIProvider,
  modelId: string,
  apiKey: string,
  limit: number,
): Promise<ImageCandidate[]> {
  if (candidates.length <= limit) return candidates;

  try {
    const candidateList = candidates.slice(0, 20).map((candidate, index) => ({
      index,
      title: candidate.title,
      source: candidate.source,
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
${candidateList.map((candidate) => `[${candidate.index}] "${candidate.title}" (${candidate.source})`).join("\n")}

Best ${limit} indices:`;

    const response = await callAI(
      provider,
      modelId,
      apiKey,
      systemPrompt,
      userPrompt,
    );

    const match = response.match(/\[[\d\s,]+\]/);
    if (!match) return candidates.slice(0, limit);

    const indices: number[] = JSON.parse(match[0]);
    const selected = indices
      .filter((index) => index >= 0 && index < candidates.length)
      .map((index) => candidates[index])
      .slice(0, limit);

    return selected.length > 0 ? selected : candidates.slice(0, limit);
  } catch {
    return candidates.slice(0, limit);
  }
}

export async function searchSlideImages(
  queries: string[],
  presentationTopic: string | undefined,
  slideContext: SlideContext | undefined,
  limit: number = 4,
  enabledSources: Set<ImageSourceId> = new Set(["wikimedia"]),
  sourceKeys: Partial<Record<ImageSourceId, string>> = {},
  aiConfig?: ImageSearchAiConfig,
  speedOptions?: ImageSearchSpeedOptions,
  feedbackProfile?: SearchFeedbackProfile,
  verificationConfig?: VerificationConfig,
): Promise<ImageCandidate[]> {
  const speed = speedOptions ?? DEFAULT_SPEED_OPTIONS;
  const effectiveLimit = speed.lowerFetchLimit ? Math.max(limit, 4) : Math.max(limit * 2, 8);
  const allCandidates: ImageCandidate[] = [];
  const seen = new Set<string>();

  const addCandidates = (images: ImageCandidate[]) => {
    for (const image of images) {
      if (seen.has(image.url)) continue;
      seen.add(image.url);
      allCandidates.push(image);
    }
  };

  const queryCandidates = getPlanQueries(queries, presentationTopic, slideContext, feedbackProfile);
  const effectiveQueries = speed.reduceQueryCandidates
    ? queryCandidates.slice(0, 2)
    : queryCandidates.slice(0, 4);
  const primaryQuery = effectiveQueries[0] || queries[0] || "";

  const phase1: Promise<ImageCandidate[]>[] = [];

  if (enabledSources.has("wikimedia")) {
    for (const query of effectiveQueries) {
      phase1.push(cachedSearch("wikimedia", query, () => searchWikimediaQuery(query, effectiveLimit)));
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
  for (const result of phase1Results) addCandidates(result);

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

        for (const fallback of fallbacks) {
          if (!fallback || fallbackCount >= maxAttempts) continue;
          const images = await cachedSearch("wikimedia", fallback, () => searchWikimediaQuery(fallback, effectiveLimit));
          addCandidates(images);
          fallbackCount++;
          if (allCandidates.length >= limit * 2) break;
        }
        if (allCandidates.length >= limit * 2) break;
      }
    }

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
      for (const result of fallbackResults) addCandidates(result);
    }
  }

  let plan = buildSearchPlan(queries, presentationTopic, slideContext, feedbackProfile);
  let ranked = allCandidates
    .map((image) => rankImageCandidate(image, plan, feedbackProfile))
    .sort((left, right) => right.score - left.score);

  let confidence = computeSelectionConfidence(ranked);

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
        .map((image) => rankImageCandidate(image, plan, feedbackProfile))
        .sort((left, right) => right.score - left.score);
      confidence = computeSelectionConfidence(ranked);
      void confidence;
    }
  }

  let preferred = ranked.slice(0, Math.max(limit * 4, 12)).map((entry) => entry.image);

  if (verificationConfig && slideContext && preferred.length > limit) {
    preferred = await aiVerifyAndSelectImages(
      preferred,
      slideContext,
      presentationTopic || "",
      verificationConfig,
      limit,
    );
  } else if (aiConfig && slideContext && preferred.length > limit) {
    preferred = await aiSelectBestImages(
      preferred,
      slideContext,
      presentationTopic || "",
      aiConfig.provider,
      aiConfig.modelId,
      aiConfig.apiKey,
      Math.max(limit * 2, limit),
    );
  }

  const preferredSet = new Set(preferred.map((image) => image.url));
  const preferredRanked = ranked.filter((entry) => preferredSet.has(entry.image.url));
  const diversified = selectDiverseImages(preferredRanked.length > 0 ? preferredRanked : ranked, limit);
  return mergeRankedWithFallback(diversified, ranked, limit);
}