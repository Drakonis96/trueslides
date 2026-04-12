import { NextRequest, NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { PresentationData, ManualElementData, ImageAdjustment, ImageLayout, SlideLayoutId, SLIDE_LAYOUTS } from "@/lib/types";
import { clampImageAdjustment } from "@/lib/image-adjustments";
import https from "node:https";
import http from "node:http";

interface ImageDimensions {
  width: number;
  height: number;
}

interface ResolvedImageAsset {
  data: string;
  dimensions: ImageDimensions | null;
}

interface SlideImageAsset {
  asset: ResolvedImageAsset;
  adjustment: ImageAdjustment | undefined;
}

// ── Image download helpers ──

function getImageDimensionsFromDataUri(dataUri: string): ImageDimensions | null {
  // Avoid regex on the full data URI — large base64 strings (>3 MB) can cause
  // "Maximum call stack size exceeded" from the regex engine when the route handler's
  // remaining stack is limited by Next.js middleware depth.
  const commaIdx = dataUri.indexOf(",");
  if (commaIdx === -1) return null;
  const header = dataUri.substring(0, commaIdx);
  const headerMatch = header.match(/^data:([^;]+);base64$/);
  if (!headerMatch) return null;

  const mimeType = headerMatch[1].toLowerCase();
  const buffer = Buffer.from(dataUri.substring(commaIdx + 1), "base64");

  if (mimeType === "image/png" && buffer.length >= 24) {
    const signature = buffer.subarray(0, 8);
    if (signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
      };
    }
  }

  if (mimeType === "image/gif" && buffer.length >= 10) {
    return {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    };
  }

  if (mimeType === "image/webp" && buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunkType = buffer.toString("ascii", 12, 16);
    if (chunkType === "VP8X") {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    if (chunkType === "VP8 " && buffer.length >= 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    if (chunkType === "VP8L" && buffer.length >= 25) {
      const widthMinusOne = buffer[21] | ((buffer[22] & 0x3f) << 8);
      const heightMinusOne = ((buffer[22] & 0xc0) >> 6) | (buffer[23] << 2) | ((buffer[24] & 0x0f) << 10);
      return {
        width: widthMinusOne + 1,
        height: heightMinusOne + 1,
      };
    }
  }

  if ((mimeType === "image/jpeg" || mimeType === "image/jpg") && buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const blockLength = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += blockLength + 2;
    }
  }

  return null;
}

async function downloadImageOnce(url: string): Promise<ResolvedImageAsset | null> {
  const UA = "TrueSlides/0.1 (presentation builder; contact@trueslides.app)";

  // Pass through data: URLs
  if (url.startsWith("data:")) {
    return {
      data: url,
      dimensions: getImageDimensionsFromDataUri(url),
    };
  }

  const data = await new Promise<Buffer>((resolve, reject) => {
    const doRequest = (requestUrl: string, redirects: number) => {
      if (redirects > 5) { reject(new Error("too many redirects")); return; }
      const mod = requestUrl.startsWith("https") ? https : http;
      const req = mod.get(requestUrl, {
        headers: {
          "User-Agent": UA,
          "Accept": "image/*,*/*;q=0.8",
        },
        timeout: 12000,
      }, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
          doRequest(res.headers.location, redirects + 1);
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${requestUrl.substring(0, 80)}`));
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

  const mimeType = url.match(/\.(png|gif|webp)/) ? `image/${url.match(/\.(png|gif|webp)/)![1]}` : "image/jpeg";
  const dataUri = `data:${mimeType};base64,${data.toString("base64")}`;
  return {
    data: dataUri,
    dimensions: getImageDimensionsFromDataUri(dataUri),
  };
}

async function downloadImage(url: string): Promise<ResolvedImageAsset | null> {
  // Retry once on failure
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await downloadImageOnce(url);
      if (result) return result;
    } catch (err) {
      if (attempt === 0) {
        // Brief pause before retry to help with rate-limiting
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      console.warn(`[downloadImage] Error after retries:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

async function resolveAllImages(
  slides: PresentationData["slides"]
): Promise<Map<string, ResolvedImageAsset>> {
  const urls = new Set<string>();
  for (const s of slides) {
    for (const u of s.imageUrls) if (u) urls.add(u);
    if (s.manualElements) {
      for (const el of s.manualElements) {
        if (el.type === "image" && el.content) urls.add(el.content);
      }
    }
  }
  const map = new Map<string, ResolvedImageAsset>();
  const arr = [...urls];
  // Smaller batches + delay between them to avoid rate-limiting
  const batchSize = 4;
  for (let i = 0; i < arr.length; i += batchSize) {
    const chunk = arr.slice(i, i + batchSize);
    const results = await Promise.all(chunk.map(downloadImage));
    chunk.forEach((u, j) => {
      if (results[j]) {
        map.set(u, results[j]!);
      }
    });
    // Small delay between batches to be kind to image servers
    if (i + batchSize < arr.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return map;
}

// Allow up to 3 minutes for image downloads + PPTX generation
export const maxDuration = 180;

interface BuildRequest {
  presentation: PresentationData;
  imageLayout: ImageLayout;
  slideLayout?: SlideLayoutId;
  stretchImages: boolean;
  textDensity: number;
  slideBgColor?: string;
  slideAccentColor?: string;
  headingFontFace?: string;
  bodyFontFace?: string;
  overlaySectionFontSize?: number;
  overlayTitleFontSize?: number;
  overlaySectionColor?: string;
  overlayTitleColor?: string;
  overlayTextGap?: number;
}

interface ThemeFontFaces {
  heading: string;
  body: string;
}

interface OverlayTextOptions {
  sectionFontSize: number;
  titleFontSize: number;
  sectionColor: string;
  titleColor: string;
  gap: number;
}

const SLIDE_W = 13.33;
const SLIDE_H = 7.5;

type PptSlide = ReturnType<InstanceType<typeof PptxGenJS>["addSlide"]>;

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Layout helpers ──

function resolveImageLayout(
  imageLayout: ImageLayout,
  imageCount: number
): Exclude<ImageLayout, "combined"> {
  if (imageLayout !== "combined") return imageLayout;
  if (imageCount >= 4) return "collage";
  if (imageCount === 3) return "three";
  if (imageCount === 2) return "two";
  return "full";
}

function getImageFrames(
  imageLayout: ImageLayout,
  imageCount: number,
  region: Frame
): Frame[] {
  if (imageCount === 0) return [];
  const layout = resolveImageLayout(imageLayout, imageCount);
  const gap = 0.12;

  if (layout === "full") return [region];

  if (layout === "two") {
    if (region.w >= region.h) {
      const cw = (region.w - gap) / 2;
      return [
        { x: region.x, y: region.y, w: cw, h: region.h },
        { x: region.x + cw + gap, y: region.y, w: cw, h: region.h },
      ];
    }
    const ch = (region.h - gap) / 2;
    return [
      { x: region.x, y: region.y, w: region.w, h: ch },
      { x: region.x, y: region.y + ch + gap, w: region.w, h: ch },
    ];
  }

  if (layout === "three") {
    if (region.w >= region.h) {
      const pw = region.w * 0.58;
      const sw = region.w - pw - gap;
      const sh = (region.h - gap) / 2;
      return [
        { x: region.x, y: region.y, w: pw, h: region.h },
        { x: region.x + pw + gap, y: region.y, w: sw, h: sh },
        { x: region.x + pw + gap, y: region.y + sh + gap, w: sw, h: sh },
      ];
    }
    const ph = region.h * 0.58;
    const sh = region.h - ph - gap;
    const sw = (region.w - gap) / 2;
    return [
      { x: region.x, y: region.y, w: region.w, h: ph },
      { x: region.x, y: region.y + ph + gap, w: sw, h: sh },
      { x: region.x + sw + gap, y: region.y + ph + gap, w: sw, h: sh },
    ];
  }

  // collage (2×2)
  const cw = (region.w - gap) / 2;
  const ch = (region.h - gap) / 2;
  return [
    { x: region.x, y: region.y, w: cw, h: ch },
    { x: region.x + cw + gap, y: region.y, w: cw, h: ch },
    { x: region.x, y: region.y + ch + gap, w: cw, h: ch },
    { x: region.x + cw + gap, y: region.y + ch + gap, w: cw, h: ch },
  ];
}

/** Convert normalised (0-1) slideLayout slots into absolute frames within a region */
function getSlideLayoutFrames(layoutId: SlideLayoutId, region: Frame): Frame[] {
  const layout = SLIDE_LAYOUTS.find((l) => l.id === layoutId);
  if (!layout) return [region];
  return layout.slots.map((slot) => ({
    x: region.x + slot.x * region.w,
    y: region.y + slot.y * region.h,
    w: slot.w * region.w,
    h: slot.h * region.h,
  }));
}

function isDarkColor(hex: string): boolean {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

// ── Rendering primitives (match the web preview) ──

/**
 * Compute PptxGenJS addImage params that reproduce the CSS behaviour:
 *   object-fit:cover  +  object-position:(50-offX)% (50-offY)%  +  transform:scale(s)
 *
 * PptxGenJS's crop function computes <a:srcRect> percentages as fractions of
 * the addImage w/h, then sets the display element extent to sizing.w × sizing.h.
 *
 * Strategy:
 *  - Set addImage w/h to a "virtual canvas" that is proportional to the source
 *    image and large enough that the frame-sized crop window fits inside it.
 *  - Set sizing.w/h = frame dimensions so the display element fills the frame.
 *  - Set sizing.x/y to position the crop window within the virtual canvas.
 *
 * Returns null when image dimensions are unavailable.
 */
function getAdjustedCropParams(
  asset: ResolvedImageAsset,
  frame: Frame,
  adjustment?: ImageAdjustment,
): { outerW: number; outerH: number; cropX: number; cropY: number } | null {
  if (!asset.dimensions) return null;

  const adj = clampImageAdjustment(adjustment);
  const { width: imgW, height: imgH } = asset.dimensions;
  const imgAspect = imgW / imgH;
  const frameAspect = frame.w / frame.h;

  // "Cover" crop: the largest rectangle with the frame's aspect ratio
  // that fits inside the source image.
  let coverW: number, coverH: number;
  if (imgAspect >= frameAspect) {
    coverH = imgH;
    coverW = imgH * frameAspect;
  } else {
    coverW = imgW;
    coverH = imgW / frameAspect;
  }

  const s = adj.scale;

  // Virtual canvas: source image scaled so that the cover-crop × zoom
  // maps onto frame dimensions.  outerW/outerH maintains the source
  // aspect ratio and is always >= frame dimensions.
  const outerW = frame.w * imgW * s / coverW;
  const outerH = frame.h * imgH * s / coverH;

  // CSS object-position: (50 - offsetX)% (50 - offsetY)%
  const opx = (50 - adj.offsetX) / 100;
  const opy = (50 - adj.offsetY) / 100;

  // Excess space in each axis (pannable range)
  const excessW = outerW - frame.w;
  const excessH = outerH - frame.h;

  // Crop origin from object-position mapping
  const cropX = Math.max(0, Math.min(excessW, excessW * opx));
  const cropY = Math.max(0, Math.min(excessH, excessH * opy));

  return { outerW, outerH, cropX, cropY };
}

function addImage(slide: PptSlide, imageAsset: ResolvedImageAsset, frame: Frame, adjustment?: ImageAdjustment, rotation?: number) {
  const params = getAdjustedCropParams(imageAsset, frame, adjustment);
  if (params) {
    slide.addImage({
      data: imageAsset.data,
      x: frame.x,
      y: frame.y,
      w: params.outerW,
      h: params.outerH,
      sizing: {
        type: "crop" as const,
        x: params.cropX,
        y: params.cropY,
        w: frame.w,
        h: frame.h,
      },
      ...(rotation ? { rotate: rotation } : {}),
    });
  } else {
    slide.addImage({
      data: imageAsset.data,
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      ...(rotation ? { rotate: rotation } : {}),
    });
  }
}

function addAccentBar(slide: PptSlide, accent: string) {
  // Thin accent bar at the very bottom — matches web's h-0.5 bar
  slide.addShape("rect" as unknown as PptxGenJS.ShapeType, {
    x: 0,
    y: SLIDE_H - 0.06,
    w: "100%",
    h: 0.06,
    fill: { color: accent },
    line: { color: accent, transparency: 100 },
  });
}

function renderImages(
  slide: PptSlide,
  imageAssets: SlideImageAsset[],
  imageLayout: ImageLayout,
  region: Frame
) {
  const frames = getImageFrames(imageLayout, imageAssets.length, region);
  imageAssets.slice(0, frames.length).forEach(({ asset, adjustment }, index) => {
    addImage(slide, asset, frames[index], adjustment);
  });
}

function renderSlideLayoutImages(
  slide: PptSlide,
  imageAssets: Array<SlideImageAsset | null>,
  layoutId: SlideLayoutId,
  region: Frame
) {
  const frames = getSlideLayoutFrames(layoutId, region);
  frames.forEach((frame, index) => {
    const image = imageAssets[index];
    if (!image) return;
    addImage(slide, image.asset, frame, image.adjustment);
  });
}

// ── Text rendering (matches web's SlidePreview) ──

function renderTextSlide(
  slide: PptSlide,
  slideData: PresentationData["slides"][number],
  textDensity: number,
  accent: string,
  bgColor: string,
  hasImages: boolean,
  fonts: ThemeFontFaces
) {
  const dark = isDarkColor(bgColor);
  const titleColor = dark ? "F8FAFC" : "1E293B";
  const bulletColor = dark ? "CBD5E1" : "475569";
  const sectionColor = accent;
  const bulletAccent = accent;

  // Text occupies left portion when images present, full width otherwise
  const textX = 0.5;
  const textW = hasImages ? 7.0 : 12.0;

  const effectiveDensity = Math.max(textDensity, 10);
  const contentTop = 0.35;
  const contentBottom = SLIDE_H - 0.35;

  const titleSize = effectiveDensity <= 10 ? 28 : effectiveDensity <= 30 ? 34 : 38;
  const bulletFontSize = effectiveDensity <= 10 ? 16 : effectiveDensity <= 30 ? 20 : 22;
  const sectionSize = 11;

  const maxBullets = effectiveDensity <= 10 ? 3 : effectiveDensity <= 30 ? 5 : 7;
  const bullets = slideData.bullets.filter(Boolean).slice(0, maxBullets);

  const hasSection = !!slideData.section?.trim();
  const sectionH = hasSection ? 0.32 : 0;
  const gapAfterSection = hasSection ? 0.18 : 0;
  const titleH = 1.0;
  const gapAfterTitle = bullets.length > 0 ? 0.2 : 0;

  // Estimate bullets block height to vertically center the whole text composition.
  const bulletLineHInches = (bulletFontSize * 1.35) / 72;
  const bulletBlockEstimate = bullets.length > 0
    ? Math.min(4.2, bullets.length * (bulletLineHInches + 0.14) + 0.25)
    : 0;

  const compositionH = sectionH + gapAfterSection + titleH + gapAfterTitle + bulletBlockEstimate;
  const availableH = contentBottom - contentTop;
  let curY = contentTop + Math.max(0, (availableH - compositionH) / 2);

  // Section label (small uppercase, accent colored)
  if (slideData.section?.trim()) {
    slide.addText(slideData.section.toUpperCase(), {
      x: textX,
      y: curY,
      w: textW,
      h: sectionH,
      fontSize: sectionSize,
      color: sectionColor,
      fontFace: fonts.heading,
      bold: true,
      charSpacing: 3,
      margin: 0,
    });
    curY += sectionH + gapAfterSection;
  }

  // Title
  slide.addText(slideData.title, {
    x: textX,
    y: curY,
    w: textW,
    h: titleH,
    fontSize: titleSize,
    color: titleColor,
    fontFace: fonts.heading,
    bold: true,
    margin: 0,
  });
  curY += titleH + gapAfterTitle;

  // Bullets
  if (bullets.length > 0) {
    const bulletItems = bullets.map((b) => ({
      text: b,
      options: {
        fontSize: bulletFontSize,
        color: bulletColor,
        bullet: { code: "25CF", color: bulletAccent } as const,
        paraSpaceBefore: 14,
        paraSpaceAfter: 8,
      },
    }));

    slide.addText(bulletItems, {
      x: textX,
      y: curY,
      w: textW,
      h: Math.max(0.8, contentBottom - curY),
      fontFace: fonts.body,
      valign: "top",
      margin: 0,
    });
  }
}

/** Render title overlay at bottom of image-only slides (matches web's gradient overlay) */
function renderImageOnlyOverlay(
  slide: PptSlide,
  slideData: PresentationData["slides"][number],
  presentationTitle: string,
  isFirstSlide: boolean,
  accent: string,
  options: OverlayTextOptions,
  fonts: ThemeFontFaces
) {
  const overlayY = SLIDE_H - 1.4;

  // Section label
  if (slideData.section?.trim()) {
    slide.addText(slideData.section.toUpperCase(), {
      x: 0.5,
      y: overlayY,
      w: 10,
      h: 0.25,
      fontSize: options.sectionFontSize,
      color: options.sectionColor,
      fontFace: fonts.heading,
      bold: true,
      charSpacing: 3,
      margin: 0,
    });
  }

  // Title
  const titleText = isFirstSlide ? presentationTitle : slideData.title;
  slide.addText(titleText, {
    x: 0.5,
    y: slideData.section ? overlayY + options.gap : overlayY + 0.1,
    w: 12,
    h: 0.9,
    fontSize: options.titleFontSize,
    color: options.titleColor,
    fontFace: fonts.heading,
    bold: true,
    margin: 0,
  });

  // Accent bar
  addAccentBar(slide, accent);
}

/** Render a manual slide using exact element positions (percentage-based) */
async function renderManualSlide(
  slide: PptSlide,
  elements: ManualElementData[],
  imageAssetByData: Map<string, ResolvedImageAsset>,
  accent: string,
  fonts: ThemeFontFaces
) {
  // Sort by zIndex so lower elements render first
  const sorted = [...elements].sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1));

  for (const el of sorted) {
    const x = (el.x / 100) * SLIDE_W;
    const y = (el.y / 100) * SLIDE_H;
    const w = (el.w / 100) * SLIDE_W;
    const h = (el.h / 100) * SLIDE_H;
    const rot = el.rotation || 0;

    if (el.type === "image") {
      if (!el.content) continue;
      const asset = imageAssetByData.get(el.content);
      if (!asset) continue;
      addImage(slide, asset, { x, y, w, h }, el.imageAdjustment, rot);
    } else if (el.type === "shape") {
      const fill = el.shapeFill || "6366F1";
      const opacity = ((el.shapeOpacity ?? 100) / 100);
      const kind = el.shapeKind || "rectangle";
      const borderColor = el.shapeBorderColor || "";
      const borderWidth = el.shapeBorderWidth || 0;
      const shapeType = kind === "ellipse" ? "ellipse" : "rect";
      const rectRadius = kind === "rounded-rect" ? 0.1 : 0;

      if (kind === "line") {
        slide.addShape("line" as unknown as PptxGenJS.ShapeType, {
          x, y: y + h / 2, w, h: 0,
          line: { color: fill, width: Math.max(1, borderWidth || 2), dashType: "solid" },
          ...(rot ? { rotate: rot } : {}),
        });
      } else {
        const shapeOpts: Record<string, unknown> = {
          x, y, w, h,
          fill: { color: fill, transparency: Math.round((1 - opacity) * 100) },
          rectRadius,
        };
        if (borderWidth > 0 && borderColor) {
          shapeOpts.line = { color: borderColor, width: borderWidth };
        }
        if (rot) shapeOpts.rotate = rot;
        slide.addShape(shapeType as unknown as PptxGenJS.ShapeType, shapeOpts);
      }
    } else if (el.type === "youtube") {
      // Use PptxGenJS addMedia({ type: "online" }) to embed a playable YouTube
      // video. PowerPoint 2016+ / 365 will render it as an inline player.
      const embedUrl = el.content || el.youtubeUrl;
      if (!embedUrl) continue;
      const videoIdMatch = embedUrl.match(/(?:embed\/|v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
      const videoId = videoIdMatch?.[1];
      if (!videoId) continue;

      // Download a thumbnail to use as the cover image
      let coverData: string | undefined;
      for (const thumbPath of [
        `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      ]) {
        const thumbAsset = await downloadImage(thumbPath);
        if (thumbAsset) { coverData = thumbAsset.data; break; }
      }

      const mediaOpts: PptxGenJS.MediaProps = {
        type: "online",
        link: `https://www.youtube.com/embed/${videoId}`,
        x, y, w, h,
      };
      if (coverData) mediaOpts.cover = coverData;

      slide.addMedia(mediaOpts);
    } else if (el.type === "connector") {
      // Render connector as a line shape in PPTX
      const lineColor = (el.connectorColor || "6366F1").replace("#", "");
      const lineWidth = el.connectorWidth || 2;

      // Map arrowhead types to PptxGenJS arrow types
      const mapArrowHead = (head: string | undefined): string | undefined => {
        switch (head) {
          case "arrow": return "arrow";
          case "dot": return "oval";
          case "diamond": return "diamond";
          default: return undefined;
        }
      };

      const beginArrow = mapArrowHead(el.arrowStart);
      const endArrow = mapArrowHead(el.arrowEnd);

      const lineOpts: Record<string, unknown> = {
        color: lineColor,
        width: lineWidth,
        dashType: "solid",
      };
      if (beginArrow) lineOpts.beginArrowType = beginArrow;
      if (endArrow) lineOpts.endArrowType = endArrow;

      // For all connector styles, render as a straight line in PPTX
      // (elbow/curved styles degrade to straight lines since PptxGenJS
      // doesn't support custom path connectors)
      slide.addShape("line" as unknown as PptxGenJS.ShapeType, {
        x, y: y + h / 2, w, h: 0,
        line: lineOpts,
        ...(rot ? { rotate: rot } : {}),
      });
    } else {
      // Text elements: title, subtitle, text, bullets
      const fontSize = el.fontSize || (el.type === "title" ? 32 : el.type === "subtitle" ? 18 : 16);
      const isBold = el.fontWeight === "bold" || el.type === "title";
      const fontFace = el.fontFamily || ((el.type === "title" || el.type === "subtitle") ? fonts.heading : fonts.body);
      const color = el.color || (el.type === "subtitle" ? "D1D5DB" : "FFFFFF");
      const align = el.textAlign || "left";
      // PptxGenJS lineSpacePts: pts between lines. Convert multiplier → pts (approx: fontSize * multiplier)
      const lineSpacePts = el.lineHeight ? Math.round(fontSize * el.lineHeight) : undefined;

      if (el.type === "bullets" && el.content) {
        const lines = el.content.split("\n").filter(Boolean);
        const bulletItems = lines.map((line) => ({
          text: line.replace(/^[-•]\s*/, ""),
          options: {
            fontSize,
            color,
            bullet: { code: "25CF", color: accent } as const,
            paraSpaceBefore: 8,
            paraSpaceAfter: 4,
            align,
            ...(lineSpacePts ? { lineSpacePts } : {}),
          },
        }));
        slide.addText(bulletItems, {
          x, y, w, h,
          fontFace,
          valign: "top",
          margin: 0,
          ...(rot ? { rotate: rot } : {}),
        });
      } else {
        slide.addText(el.content || "", {
          x, y, w, h,
          fontSize,
          color,
          fontFace,
          bold: isBold,
          margin: 0,
          valign: "top",
          align,
          ...(lineSpacePts ? { lineSpacePts } : {}),
          ...(rot ? { rotate: rot } : {}),
        });
      }
    }
  }

  addAccentBar(slide, accent);
}

export async function POST(req: NextRequest) {
  try {
    const body: BuildRequest = await req.json();
    const { presentation, imageLayout, slideLayout, stretchImages, textDensity, slideBgColor, slideAccentColor, headingFontFace, bodyFontFace, overlaySectionFontSize, overlayTitleFontSize, overlaySectionColor, overlayTitleColor, overlayTextGap } = body;

    if (!presentation?.slides?.length) {
      return NextResponse.json(
        { error: "No presentation data provided" },
        { status: 400 }
      );
    }

    const bgColor = slideBgColor || "0F172A";
    const overlayOptions: OverlayTextOptions = {
      sectionFontSize: Math.max(8, Math.min(48, overlaySectionFontSize ?? 16)),
      titleFontSize: Math.max(10, Math.min(72, overlayTitleFontSize ?? 20)),
      sectionColor: (overlaySectionColor || "D1D5DB").replace("#", ""),
      titleColor: (overlayTitleColor || "FFFFFF").replace("#", ""),
      gap: Math.max(0.05, Math.min(0.6, overlayTextGap ?? 0.2)),
    };
    const themeFonts: ThemeFontFaces = {
      heading: headingFontFace || "Aptos Display",
      body: bodyFontFace || "Aptos",
    };

    // Download and embed images as base64 data
    const imageMap = await resolveAllImages(presentation.slides);
    console.log(`[build-pptx] Downloaded ${imageMap.size} / ${new Set(presentation.slides.flatMap(s => s.imageUrls).filter(Boolean)).size} images`);
    const imageAssetByData = new Map<string, ResolvedImageAsset>();
    imageMap.forEach((asset) => {
      imageAssetByData.set(asset.data, asset);
    });

    for (const s of presentation.slides) {
      s.imageUrls = s.imageUrls.map((url) => imageMap.get(url)?.data || "");
      if (s.manualElements) {
        for (const el of s.manualElements) {
          if (el.type === "image" && el.content) {
            const resolved = imageMap.get(el.content);
            if (resolved) el.content = resolved.data;
          }
        }
      }
    }

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "TrueSlides";
    pptx.title = presentation.title;

    for (const slideData of presentation.slides) {
      const slide = pptx.addSlide();
      // Use per-slide bgColor for manual slides, else global
      const slideBg = slideData.bgColor || bgColor;
      slide.background = { color: slideBg };
      const accent = slideData.accentColor || slideAccentColor || "6366F1";

      if (slideData.notes) {
        slide.addNotes(slideData.notes);
      }

      const slotImages = slideData.imageUrls.map((url, index) => {
        if (!url) return null;
        const asset = imageAssetByData.get(url);
        if (!asset) return null;
        return {
          asset,
          adjustment: slideData.imageAdjustments?.[index],
        } satisfies SlideImageAsset;
      });
      const imageAssets = slotImages.filter((entry): entry is SlideImageAsset => !!entry);
      const hasImages = imageAssets.length > 0;
      const imageOnly = textDensity === 0;
      const effectiveLayout = slideData.slideLayout || slideLayout || "single";
      const isFirstSlide = slideData.index === 0;

      try {
        if (slideData.manualElements && slideData.manualElements.length > 0) {
          // Manual slide: render elements at their exact positions
          await renderManualSlide(slide, slideData.manualElements, imageAssetByData, accent, themeFonts);
        } else if (imageOnly) {
          // ── Image-only mode (matches web's image-only preview) ──
          if (hasImages) {
            const isSingle = effectiveLayout === "single" || imageAssets.length === 1;

            if (isSingle || stretchImages) {
              // Full-bleed single image
              addImage(slide, imageAssets[0].asset, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }, imageAssets[0].adjustment);
            } else {
              // Multi-image layout
              const fullRegion = { x: 0.12, y: 0.12, w: SLIDE_W - 0.24, h: SLIDE_H - 0.24 };
              if (effectiveLayout !== "single" as string) {
                renderSlideLayoutImages(slide, slotImages, effectiveLayout as Exclude<SlideLayoutId, "single">, fullRegion);
              } else {
                renderImages(slide, imageAssets, imageLayout, fullRegion);
              }
            }

            // Title overlay at bottom, no dark effects
            renderImageOnlyOverlay(slide, slideData, presentation.title, isFirstSlide, accent, overlayOptions, themeFonts);
          } else {
            // No images available — clean fallback with text centered
            const dark = isDarkColor(bgColor);
            const titleColor = dark ? "F8FAFC" : "1E293B";

            if (slideData.section?.trim()) {
              slide.addText(slideData.section.toUpperCase(), {
                x: 1.5,
                y: SLIDE_H / 2 - 1.2,
                w: SLIDE_W - 3,
                h: 0.3,
                fontSize: 10,
                color: accent,
                fontFace: themeFonts.heading,
                bold: true,
                charSpacing: 3,
                align: "center",
                margin: 0,
              });
            }

            slide.addText(isFirstSlide ? presentation.title : slideData.title, {
              x: 1.5,
              y: SLIDE_H / 2 - 0.6,
              w: SLIDE_W - 3,
              h: 1.2,
              fontSize: isFirstSlide ? 36 : 28,
              color: titleColor,
              fontFace: themeFonts.heading,
              bold: true,
              align: "center",
              valign: "middle",
              margin: 0,
            });

            addAccentBar(slide, accent);
          }
        } else {
          // ── Text mode (matches web's text + image layout) ──
          if (hasImages) {
            // Images on the right ~1/3 of the slide
            const imgRegion = { x: 8.2, y: 0.4, w: 4.73, h: 6.6 };
            if (effectiveLayout !== "single") {
              renderSlideLayoutImages(slide, slotImages, effectiveLayout, imgRegion);
            } else {
              renderImages(slide, imageAssets, imageLayout, imgRegion);
            }
          }

          // Text content on the left
          renderTextSlide(slide, slideData, textDensity, accent, bgColor, hasImages, themeFonts);
          addAccentBar(slide, accent);
        }
      } catch (err) {
        console.warn("Slide rendering error:", err);
        // Fallback: just add title
        const dark = isDarkColor(bgColor);
        slide.addText(slideData.title, {
          x: 1, y: 2, w: 11, h: 2,
          fontSize: 28,
          color: dark ? "F8FAFC" : "1E293B",
          fontFace: themeFonts.heading,
          bold: true,
          align: "center",
          valign: "middle",
        });
        addAccentBar(slide, accent);
      }
    }

    const output = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    const uint8 = new Uint8Array(output);

    return new NextResponse(uint8, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${(presentation.title || "presentation").replace(/[^a-zA-Z0-9 ]/g, "")}.pptx"`,
      },
    });
  } catch (err: unknown) {
    console.error("PPTX build error:", err);
    return NextResponse.json(
      { error: "Failed to build PPTX" },
      { status: 500 }
    );
  }
}
