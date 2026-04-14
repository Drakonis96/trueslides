"use client";

import React from "react";
import { SlideData, SLIDE_LAYOUTS, ManualElementData } from "@/lib/types";
import { getImageAdjustmentStyle } from "@/lib/image-adjustments";

/* ── Image proxy helper ── */

/**
 * Route an image URL through /api/image-proxy with an optional width hint.
 * For Wikimedia originals the proxy rewrites to their CDN thumbnail endpoint,
 * drastically reducing decoded-pixel memory in the browser.
 */
function proxyUrl(src: string, width?: number): string {
  if (!src) return src;
  // Skip data URIs, blob URLs, and local API URLs (already served optimally)
  if (src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("/api/")) return src;
  const params = new URLSearchParams({ url: src });
  if (width && width > 0) params.set("w", String(Math.round(width)));
  return `/api/image-proxy?${params.toString()}`;
}

/* ── YouTube helpers ── */

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
  } catch { /* not a URL */ }
  return null;
}

function YouTubeEmbed({ url, className, style }: { url: string; className?: string; style?: React.CSSProperties }) {
  const videoId = extractYouTubeId(url);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  if (!videoId) return null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0&enablejsapi=1${origin ? `&origin=${encodeURIComponent(origin)}` : ""}`;
  return (
    <div className={className} style={style}>
      <iframe
        ref={iframeRef}
        src={src}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="w-full h-full border-0 rounded"
        title="YouTube video"
        onLoad={() => {
          // Initiate YouTube JS API postMessage handshake so play/pause commands work
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ event: "listening", id: videoId }),
            "*"
          );
        }}
      />
    </div>
  );
}

/* ── Detect YouTube links in bullets ── */

function containsYouTubeLink(text: string): string | null {
  const match = text.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/);
  return match ? match[0] : null;
}

/* ── Manual element renderer ── */

function ManualElement({ el, containerW, containerH }: { el: ManualElementData; containerW: number; containerH: number }) {
  const x = (el.x / 100) * containerW;
  const y = (el.y / 100) * containerH;
  const w = (el.w / 100) * containerW;
  const h = (el.h / 100) * containerH;
  const fs = el.fontSize ? el.fontSize * (containerH / 540) : 16 * (containerH / 540);

  const base: React.CSSProperties = {
    position: "absolute",
    left: x,
    top: y,
    width: w,
    height: h,
    zIndex: el.zIndex || 1,
    color: el.color ? `#${el.color}` : undefined,
    fontSize: fs,
    fontWeight: el.fontWeight || "normal",
    fontFamily: el.fontFamily || undefined,
    textAlign: el.textAlign || "left",
    lineHeight: el.lineHeight || 1.3,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    overflow: "hidden",
  };

  if (el.type === "youtube" && el.youtubeUrl) {
    return <YouTubeEmbed url={el.youtubeUrl} style={base} />;
  }

  if (el.type === "image" && el.content) {
    const imgStyle = el.imageAdjustment ? getImageAdjustmentStyle(el.imageAdjustment) : {};
    const elW = (el.w / 100) * containerW;
    return (
      <div style={base}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={proxyUrl(el.content, Math.round(elW * 2))} alt="" loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: "cover", ...imgStyle }} />
      </div>
    );
  }

  if (el.type === "shape") {
    const fill = el.shapeFill ? `#${el.shapeFill}` : "transparent";
    const opacity = (el.shapeOpacity ?? 100) / 100;
    const borderColor = el.shapeBorderColor ? `#${el.shapeBorderColor}` : "transparent";
    const borderWidth = el.shapeBorderWidth ?? 0;
    const borderRadius = el.shapeKind === "ellipse" ? "50%" : el.shapeKind === "rounded-rect" ? "12px" : 0;
    return (
      <div style={{ ...base, backgroundColor: fill, opacity, border: `${borderWidth}px solid ${borderColor}`, borderRadius }} />
    );
  }

  if (el.type === "bullets") {
    const items = el.content.split("\n").filter(Boolean);
    return (
      <div style={base}>
        <ul style={{ margin: 0, paddingLeft: "1.2em", listStyle: "disc" }}>
          {items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      </div>
    );
  }

  if (el.type === "connector") {
    return <div style={base} />;
  }

  // title, subtitle, text
  return (
    <div style={base}>
      <span>{el.content}</span>
    </div>
  );
}

/* ── Main SlideRenderer ── */

interface SlideRendererProps {
  slide: SlideData;
  width: number;
  height: number;
  bgColor?: string;
  headingFont?: string;
  bodyFont?: string;
  accentColor?: string;
  overlayTitleColor?: string;
  overlaySectionColor?: string;
  textDensity?: number;
  layoutMode?: "fixed" | "smart";
  globalLayout?: string;
}

const SlideRenderer = React.memo(function SlideRenderer({
  slide,
  width,
  height,
  bgColor = "FFFFFF",
  headingFont,
  bodyFont,
  accentColor,
  overlayTitleColor = "FFFFFF",
  overlaySectionColor = "D1D5DB",
  textDensity = 50,
  layoutMode = "fixed",
  globalLayout = "single",
}: SlideRendererProps) {
  const accent = accentColor ? `#${accentColor}` : slide.accentColor ? `#${slide.accentColor}` : "#6366F1";
  const bg = slide.bgColor ? `#${slide.bgColor}` : `#${bgColor}`;
  const imageOnly = textDensity === 0;
  const layoutId = layoutMode === "fixed" ? globalLayout : (slide.slideLayout || globalLayout);
  const layoutDef = SLIDE_LAYOUTS.find((l) => l.id === layoutId);
  const isManual = slide.manualElements && slide.manualElements.length > 0;

  const isDark = (() => {
    const hex = (slide.bgColor || bgColor).replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
  })();

  const titleColor = isDark ? "#FFFFFF" : "#0F172A";
  const bulletColor = isDark ? "#CBD5E1" : "#475569";

  const getImgStyle = (i: number): React.CSSProperties => getImageAdjustmentStyle(slide.imageAdjustments?.[i]);

  /* Manual slides */
  if (isManual) {
    return (
      <div style={{ width, height, backgroundColor: bg, position: "relative", overflow: "hidden", borderRadius: 8 }}>
        {slide.manualElements!.map((el, i) => (
          <ManualElement key={i} el={el} containerW={width} containerH={height} />
        ))}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, backgroundColor: accent, zIndex: 20 }} />
      </div>
    );
  }

  /* AI-generated slides */
  return (
    <div style={{ width, height, backgroundColor: bg, position: "relative", overflow: "hidden", borderRadius: 8, display: "flex", flexDirection: "column" }}>
      {/* Image-only mode */}
      {imageOnly && (
        <div style={{ position: "absolute", inset: 0 }}>
          {layoutId === "single" ? (
            slide.imageUrls[0] ? (() => {
              const ytUrl = containsYouTubeLink(slide.imageUrls[0]);
              if (ytUrl) return <YouTubeEmbed url={ytUrl} style={{ width: "100%", height: "100%" }} />;
              return (
                <div style={{ width: "100%", height: "100%", position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={proxyUrl(slide.imageUrls[0], width * 2)} alt="" decoding="async" style={{ width: "100%", height: "100%", ...getImgStyle(0) }} />
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(transparent 50%, rgba(0,0,0,0.4))" }} />
                </div>
              );
            })() : <div style={{ width: "100%", height: "100%", background: "#1118" }} />
          ) : layoutDef && (
            <div style={{ position: "absolute", inset: 0, padding: 4 }}>
              {layoutDef.slots.map((slot, i) => {
                const url = slide.imageUrls[i];
                return (
                  <div key={i} style={{ position: "absolute", left: `${slot.x * 100}%`, top: `${slot.y * 100}%`, width: `${slot.w * 100}%`, height: `${slot.h * 100}%`, borderRadius: 6, overflow: "hidden" }}>
                    {url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={proxyUrl(url, Math.round(slot.w * width * 2))} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", ...getImgStyle(i) }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", background: "#0001" }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Overlay title */}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px 20px", background: "linear-gradient(transparent, rgba(0,0,0,0.7))", zIndex: 10 }}>
            {slide.section && (
              <span style={{ fontSize: Math.max(10, height * 0.018), textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 700, color: `#${overlaySectionColor}`, fontFamily: headingFont, display: "block", marginBottom: 2 }}>
                {slide.section}
              </span>
            )}
            <h3 style={{ fontSize: Math.max(14, height * 0.035), fontWeight: 700, color: `#${overlayTitleColor}`, fontFamily: headingFont, lineHeight: 1.2, margin: 0 }}>
              {slide.title}
            </h3>
          </div>
        </div>
      )}

      {/* Text content slides */}
      {!imageOnly && (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative", zIndex: 10, padding: height * 0.05 }}>
          {slide.section && (
            <span style={{ textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 700, fontSize: Math.max(9, height * 0.02), color: accent, fontFamily: headingFont, marginBottom: height * 0.01, flexShrink: 0 }}>
              {slide.section}
            </span>
          )}
          <h3 style={{ fontWeight: 700, fontSize: Math.max(14, height * 0.045), color: titleColor, fontFamily: headingFont, lineHeight: 1.2, marginBottom: height * 0.03, flexShrink: 0, margin: 0 }}>
            {slide.title}
          </h3>
          <div style={{ display: "flex", flex: 1, gap: 12, minHeight: 0, overflow: "hidden", marginTop: height * 0.02 }}>
            <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {slide.bullets.map((b, i) => {
                  const ytUrl = containsYouTubeLink(b);
                  if (ytUrl) {
                    return (
                      <li key={i} style={{ marginBottom: 8 }}>
                        <YouTubeEmbed url={ytUrl} style={{ width: "100%", aspectRatio: "16/9", maxHeight: height * 0.25 }} />
                      </li>
                    );
                  }
                  return (
                    <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, color: bulletColor, fontSize: Math.max(11, height * 0.028), fontFamily: bodyFont, marginBottom: height * 0.012, lineHeight: 1.4 }}>
                      <span style={{ color: accent, marginTop: 2, flexShrink: 0 }}>●</span>
                      <span>{b}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            {/* Image thumbnails */}
            {slide.imageUrls.length > 0 && (
              <div style={{ width: "33%", flexShrink: 0, display: "grid", gridTemplateColumns: "1fr", gap: 4 }}>
                {slide.imageUrls.slice(0, 4).map((url, i) => (
                  <div key={i} style={{ borderRadius: 6, overflow: "hidden", minHeight: 0 }}>
                    {url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={proxyUrl(url, Math.round(width * 0.33 * 2))} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", ...getImgStyle(i) }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", background: "#0001" }} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Accent bar */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, backgroundColor: accent, zIndex: 20 }} />
    </div>
  );
});

export default SlideRenderer;
