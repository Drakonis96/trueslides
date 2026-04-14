"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { UI_TEXT } from "@/lib/presets";
import { ImageAdjustment, SlideData, OutputLanguage, OUTPUT_LANGUAGE_NAMES, SLIDE_LAYOUTS, SlideLayoutId } from "@/lib/types";
import { DEFAULT_IMAGE_ADJUSTMENT, getImageAdjustmentStyle, setSlideImageAdjustment } from "@/lib/image-adjustments";
import { fetchImagesWithCache } from "@/lib/image-cache-idb";
import { prefetchImageBlob, getCachedBlob } from "@/lib/image-blob-cache";
import { LayoutThumbnail, LAYOUT_LABELS } from "./LayoutSelector";
import { IconRefresh, IconChevronLeft, IconChevronRight, IconImage, IconUndo, IconLayout, IconSparkles, IconLoader, IconSearch, IconWand, IconFullscreen, IconCrop } from "./Icons";
import ImageGenModal from "./ImageGenModal";
import { Grid as VirtualGrid, CellComponentProps } from "react-window";
import ImageSearchModal from "./ImageSearchModal";
import FullscreenEditor from "./FullscreenEditor";

interface SlideVariant {
  title: string;
  bullets: string[];
  notes: string;
  section?: string;
  accentColor?: string;
  imageSearchTerms?: string[];
  slideLayout?: SlideLayoutId;
  imageUrls?: string[];
}

// ── Helper: detect dark colors for text contrast ──
function isDarkColor(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

// ── Color presets for accent picker ──
const COLOR_PRESETS = [
  { hex: "6366F1", label: "Indigo" },
  { hex: "38BDF8", label: "Sky" },
  { hex: "22C55E", label: "Green" },
  { hex: "EF4444", label: "Red" },
  { hex: "F59E0B", label: "Amber" },
  { hex: "EC4899", label: "Pink" },
  { hex: "8B5CF6", label: "Violet" },
  { hex: "14B8A6", label: "Teal" },
  { hex: "F97316", label: "Orange" },
  { hex: "FFFFFF", label: "White" },
];

// ── Shimmer overlay for loading states ──
function ShimmerOverlay() {
  return (
    <div className="absolute inset-0 z-20 overflow-hidden">
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)",
          animation: "shimmer 1.5s ease-in-out infinite",
        }}
      />
    </div>
  );
}

// ── Slide Preview with clickable images ──
function SlidePreview({
  slide,
  onImageClick,
  onImageDrop,
  onSlideClick,
  refreshingIndex,
  isUpdating,
  viewMode = "grid",
}: {
  slide: SlideData;
  onImageClick?: (imgIndex: number) => void;
  onImageDrop?: (imgIndex: number, url: string, source: string) => void;
  onSlideClick?: () => void;
  refreshingIndex?: number | null;
  isUpdating?: boolean;
  viewMode?: "grid" | "focus";
}) {
  const textDensity = useAppStore((s) => s.textDensity);
  const layoutMode = useAppStore((s) => s.layoutMode);
  const globalLayout = useAppStore((s) => s.slideLayout);
  const slideBgColor = useAppStore((s) => s.slideBgColor);
  const headingFontFamily = useAppStore((s) => s.headingFontFamily);
  const bodyFontFamily = useAppStore((s) => s.bodyFontFamily);
  const overlaySectionColor = useAppStore((s) => s.overlaySectionColor);
  const overlayTitleColor = useAppStore((s) => s.overlayTitleColor);
  const showImageSource = useAppStore((s) => s.showImageSource);
  const imageSourceFontColor = useAppStore((s) => s.imageSourceFontColor);
  const lang = useAppStore((s) => s.settings.language);
  const imageOnly = textDensity === 0;
  const accent = slide.accentColor ? `#${slide.accentColor}` : "var(--accent)";
  const layoutId =
    layoutMode === "fixed"
      ? globalLayout || "single"
      : slide.slideLayout || globalLayout || "single";
  const isFocus = viewMode === "focus";
  const canInteractWithImages = isFocus && typeof onImageClick === "function";

  // ── Resolve image URLs from blob cache for instant rendering ──
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const urls = slide.imageUrls.filter((u) => u && !u.startsWith("data:"));
    if (urls.length === 0) { setResolvedUrls({}); return; }
    void (async () => {
      const map: Record<string, string> = {};
      await Promise.all(
        urls.map(async (url) => {
          const cached = await getCachedBlob(url);
          if (cached && !cancelled) map[url] = cached;
        }),
      );
      if (!cancelled) setResolvedUrls(map);
    })();
    return () => { cancelled = true; };
  }, [slide.imageUrls]);

  // Use cached blob data URIs when available, otherwise fall back to original URL
  const resolvedSlide = {
    ...slide,
    imageUrls: slide.imageUrls.map((u) => resolvedUrls[u] || u),
  };

  const layoutDef = SLIDE_LAYOUTS.find((l) => l.id === layoutId);
  const expectedImages = layoutDef?.imageCount ?? 1;
  const effectiveBg = slide.bgColor || slideBgColor || "000000";
  const bgHex = `#${effectiveBg}`;
  // Detect if bg is dark to adjust text colors
  const bgIsDark = isDarkColor(effectiveBg);
  const titleColor = bgIsDark ? "text-white" : "text-slate-900";
  const bulletColor = bgIsDark ? "text-slate-300" : "text-slate-600";
  const sectionColor = bgIsDark ? "" : "brightness-75";

  // Get image style with adjustments applied
  const getImageStyle = (index: number): React.CSSProperties => {
    return getImageAdjustmentStyle(slide.imageAdjustments?.[index]);
  };

  // ── Drag-and-drop state ──
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const canDrop = isFocus && typeof onImageDrop === "function";

  const handleDragOver = (e: React.DragEvent) => {
    if (!canDrop) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent, slotIndex: number) => {
    if (!canDrop) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverSlot(null);

    // Try to extract a URL first (covers browser image drags)
    const uriList = e.dataTransfer.getData("text/uri-list");
    const html = e.dataTransfer.getData("text/html");
    const plainText = e.dataTransfer.getData("text/plain");

    // Extract src from <img> in html payload
    const htmlSrc = html ? html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] : null;

    const droppedUrl = (uriList || htmlSrc || plainText || "").split("\n")[0].trim();

    if (droppedUrl && /^https?:\/\//i.test(droppedUrl)) {
      onImageDrop!(slotIndex, droppedUrl, "web");
      return;
    }

    // File from computer (or browser fallback as blob)
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          onImageDrop!(slotIndex, reader.result, "local");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const dragSlotProps = (slotIndex: number) =>
    canDrop
      ? {
          onDragOver: handleDragOver,
          onDragEnter: (e: React.DragEvent) => { e.preventDefault(); setDragOverSlot(slotIndex); },
          onDragLeave: () => setDragOverSlot(null),
          onDrop: (e: React.DragEvent) => handleDrop(e, slotIndex),
        }
      : {};

  // Render an image slot (with image or placeholder)
  const renderImageSlot = (index: number, className?: string, style?: React.CSSProperties) => {
    const url = resolvedSlide.imageUrls[index];
    const source = slide.imageSources?.[index];
    const isRefreshing = refreshingIndex === index;

    const isDragOver = dragOverSlot === index;

    if (!url) {
      if (canInteractWithImages) {
        return (
          <button
            key={index}
            className={`flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${isDragOver ? "border-[var(--accent)] bg-[var(--accent)]/10 scale-[1.02]" : "border-[var(--border)] bg-black/5 hover:bg-black/10"} ${className || ""}`}
            style={style}
            onClick={() => onImageClick?.(index)}
            {...dragSlotProps(index)}
          >
            {isRefreshing ? (
              <IconRefresh size={20} className="animate-spin text-[var(--muted)]" />
            ) : (
              <>
                <IconImage size={20} className="text-[var(--muted)]" />
                <span className="text-[9px] text-[var(--muted)]">
                  {lang === "en" ? "Click to load" : "Click para cargar"}
                </span>
              </>
            )}
          </button>
        );
      }

      return (
        <div
          key={index}
          className={`flex items-center justify-center border-2 border-dashed border-[var(--border)] rounded-lg bg-black/5 ${className || ""}`}
          style={style}
        >
          <IconImage size={18} className="text-[var(--muted)]" />
        </div>
      );
    }

    if (!canInteractWithImages) {
      return (
        <div
          key={index}
          className={`overflow-hidden rounded-lg relative ${className || ""}`}
          style={style}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="w-full h-full" loading="lazy" style={getImageStyle(index)} />
          {showImageSource && source && (
            <div className="absolute top-2 right-2 z-5 text-[9px] font-medium max-w-[calc(100%-16px)] truncate" style={{ color: `#${imageSourceFontColor}` }}>
              {source.replace(/\b\w/g, (c: string) => c.toUpperCase())}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        key={index}
        className={`overflow-hidden rounded-lg group relative ${isDragOver ? "ring-2 ring-[var(--accent)] scale-[1.02]" : ""} ${className || ""}`}
        style={style}
        onClick={() => onImageClick?.(index)}
        {...dragSlotProps(index)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="w-full h-full" loading="lazy" style={getImageStyle(index)} />
        {isRefreshing ? (
          <div className="absolute inset-0 z-10">
            <div className="absolute inset-0 bg-black/50" />
            <div
              className="absolute inset-0"
              style={{
                background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)",
                animation: "shimmer 1.5s ease-in-out infinite",
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <IconRefresh size={14} className="animate-spin text-white" />
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
            <span className="bg-black/60 text-white text-[10px] px-2 py-1 rounded flex items-center gap-1">
              <IconRefresh size={10} />
            </span>
          </div>
        )}
        {/* Image source overlay */}
        {showImageSource && source && (
          <div className="absolute top-2 right-2 z-5 text-[9px] font-medium max-w-[calc(100%-16px)] truncate" style={{ color: `#${imageSourceFontColor}` }}>
            {source.replace(/\b\w/g, (c: string) => c.toUpperCase())}
          </div>
        )}
      </button>
    );
  };

  return (
    <div
      data-slide-preview="true"
      data-slide-id={slide.id}
      data-slide-index={slide.index}
      className={`rounded-xl aspect-video flex flex-col relative overflow-hidden transition-all duration-300 ${
        isUpdating ? "ring-2 ring-[var(--accent)]/50" : ""
      } ${
        onSlideClick ? "cursor-pointer hover:ring-2 hover:ring-[var(--accent)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40" : ""
      }`}
      style={{ backgroundColor: bgHex }}
      role={onSlideClick ? "button" : undefined}
      tabIndex={onSlideClick ? 0 : undefined}
      aria-label={onSlideClick ? (lang === "en" ? `Open slide ${slide.index + 1}` : `Abrir diapositiva ${slide.index + 1}`) : undefined}
      onClick={onSlideClick}
      onKeyDown={onSlideClick ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSlideClick();
        }
      } : undefined}
    >
      {/* Full-slide updating overlay */}
      {isUpdating && <ShimmerOverlay />}

      {/* ── Image-only: single full-bleed ── */}
      {imageOnly && layoutId === "single" && (
        <div className="absolute inset-0">
          {resolvedSlide.imageUrls[0] ? (
            canInteractWithImages ? (
              <button
                className={`w-full h-full relative group ${dragOverSlot === 0 ? "ring-4 ring-inset ring-[var(--accent)]" : ""}`}
                onClick={() => onImageClick?.(0)}
                {...dragSlotProps(0)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resolvedSlide.imageUrls[0]} alt="" className="w-full h-full" loading="lazy" style={getImageStyle(0)} />
                <div className="absolute inset-0 bg-black/30" />
                {refreshingIndex === 0 ? (
                  <div className="absolute inset-0 z-10">
                    <div className="absolute inset-0 bg-black/50" />
                    <div className="absolute inset-0" style={{
                      background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)",
                      animation: "shimmer 1.5s ease-in-out infinite",
                    }} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="bg-black/70 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                        <IconRefresh size={12} className="animate-spin" />
                        {lang === "en" ? "Loading..." : "Cargando..."}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                      <IconRefresh size={12} />
                    </span>
                  </div>
                )}
                {/* Image source overlay for full-bleed */}
                {showImageSource && slide.imageSources?.[0] && (
                  <div className="absolute top-3 right-3 z-5 text-xs font-medium max-w-[calc(100%-24px)] truncate" style={{ color: `#${imageSourceFontColor}` }}>
                    {slide.imageSources[0].replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  </div>
                )}
              </button>
            ) : (
              <div className="w-full h-full relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resolvedSlide.imageUrls[0]} alt="" className="w-full h-full" loading="lazy" style={getImageStyle(0)} />
                <div className="absolute inset-0 bg-black/30" />
                {showImageSource && slide.imageSources?.[0] && (
                  <div className="absolute top-3 right-3 z-5 text-xs font-medium max-w-[calc(100%-24px)] truncate" style={{ color: `#${imageSourceFontColor}` }}>
                    {slide.imageSources[0].replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  </div>
                )}
              </div>
            )
          ) : (
            /* Placeholder for missing single image */
            canInteractWithImages ? (
              <button
                className={`w-full h-full flex flex-col items-center justify-center gap-2 transition-colors ${dragOverSlot === 0 ? "bg-[var(--accent)]/10 border-2 border-dashed border-[var(--accent)]" : "bg-black/5 hover:bg-black/10"}`}
                onClick={() => onImageClick?.(0)}
                {...dragSlotProps(0)}
              >
                {refreshingIndex === 0 ? (
                  <IconRefresh size={28} className="animate-spin text-[var(--muted)]" />
                ) : (
                  <>
                    <IconImage size={28} className="text-[var(--muted)]" />
                    <span className="text-xs text-[var(--muted)]">
                      {lang === "en" ? "Click to load image" : "Click para cargar imagen"}
                    </span>
                  </>
                )}
              </button>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-black/5">
                <IconImage size={28} className="text-[var(--muted)]" />
              </div>
            )
          )}
        </div>
      )}

      {/* ── Image-only: multi layout ── */}
      {imageOnly && layoutId !== "single" && layoutDef && (
        <div className="absolute inset-0 p-1.5">
          {layoutDef.slots.map((slot, i) =>
            renderImageSlot(i, "absolute", {
              left: `${slot.x * 100}%`,
              top: `${slot.y * 100}%`,
              width: `${slot.w * 100}%`,
              height: `${slot.h * 100}%`,
            })
          )}
        </div>
      )}

      {/* ── Text content slides ── */}
      {!imageOnly && (
        <div className={`flex flex-col h-full relative z-10 ${isFocus ? "p-6" : "p-4"}`}>
          {/* Section badge */}
          {slide.section && (
            <span
              className={`uppercase tracking-widest font-bold shrink-0 ${sectionColor} ${isFocus ? "text-xs mb-3" : "text-[10px] mb-1.5"}`}
              style={{ color: accent, fontFamily: headingFontFamily }}
            >
              {slide.section}
            </span>
          )}

          {/* Title */}
          <h3
            className={`font-bold leading-tight shrink-0 ${titleColor} ${isFocus ? "text-[clamp(1.8rem,2.6vw,3rem)] mb-5" : "text-lg mb-3"}`}
            style={{ fontFamily: headingFontFamily }}
          >
            {slide.title}
          </h3>

          {/* Bullets + images row */}
          <div className="flex flex-1 gap-3 min-h-0 overflow-hidden">
            {/* Bullets */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <ul className={isFocus ? "space-y-3" : "space-y-1.5"}>
                {slide.bullets.map((b, i) => (
                  <li
                    key={i}
                    className={`flex items-start gap-1.5 ${bulletColor} ${isFocus ? "text-[clamp(1.05rem,1.3vw,1.45rem)]" : "text-xs"}`}
                    style={{ fontFamily: bodyFontFamily }}
                  >
                    <span className={isFocus ? "mt-1 shrink-0" : "mt-0.5 shrink-0"} style={{ color: accent }}>●</span>
                    <span className={isFocus ? "line-clamp-3" : "line-clamp-2"}>{b}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Image thumbnails — show expected slots including placeholders */}
            <div className={`w-1/3 shrink-0 grid grid-cols-1 auto-rows-fr ${isFocus ? "gap-2" : "gap-1"}`}>
              {Array.from({ length: Math.min(expectedImages, 4) }).map((_, i) =>
                renderImageSlot(i, "min-h-0")
              )}
            </div>
          </div>
        </div>
      )}

      {/* Title overlay for image-only slides */}
      {imageOnly && (() => {
        const pos = slide.overlayPosition;
        const overlayStyle: React.CSSProperties = pos
          ? { position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -100%)", maxWidth: "80%", zIndex: 10 }
          : { position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 10 };
        return (
          <div className={pos ? "px-3 py-1" : "p-3 bg-gradient-to-t from-black/70 to-transparent"} style={overlayStyle}>
            {pos && <div className="bg-gradient-to-t from-black/60 to-transparent rounded-lg px-2 py-1">
              {slide.section && (
                <span className="text-[9px] uppercase tracking-widest font-bold block mb-0.5" style={{ color: `#${overlaySectionColor || "D1D5DB"}`, fontFamily: headingFontFamily }}>
                  {slide.section}
                </span>
              )}
              <h3 className="text-sm font-bold leading-tight" style={{ color: `#${overlayTitleColor || "FFFFFF"}`, fontFamily: headingFontFamily }}>
                {slide.title}
              </h3>
            </div>}
            {!pos && <>
              {slide.section && (
                <span className="text-[9px] uppercase tracking-widest font-bold block mb-0.5" style={{ color: `#${overlaySectionColor || "D1D5DB"}`, fontFamily: headingFontFamily }}>
                  {slide.section}
                </span>
              )}
              <h3 className="text-sm font-bold leading-tight" style={{ color: `#${overlayTitleColor || "FFFFFF"}`, fontFamily: headingFontFamily }}>
                {slide.title}
              </h3>
            </>}
          </div>
        );
      })()}

      {/* Accent bar */}
      <div
        className="absolute bottom-0 left-0 right-0 h-0.5 z-20"
        style={{ backgroundColor: accent }}
      />
    </div>
  );
}

// ── Per-slide Layout Picker (button → modal) ──
function SlideLayoutPicker({
  currentLayout,
  onChange,
  lang,
}: {
  currentLayout: SlideLayoutId;
  onChange: (id: SlideLayoutId) => void;
  lang: "en" | "es";
}) {
  const [open, setOpen] = useState(false);
  const currentDef = SLIDE_LAYOUTS.find((l) => l.id === currentLayout);

  return (
    <div>
      <label className="block text-xs text-[var(--muted)] mb-1.5">
        {lang === "en" ? "Slide Layout" : "Disposición"}
      </label>

      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2.5 bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--accent)] rounded-lg px-3 py-2 transition-colors"
      >
        {currentDef && (
          <div className="shrink-0">
            <LayoutThumbnail layout={currentDef} active />
          </div>
        )}
        <span className="flex-1 text-left text-xs font-medium truncate">
          {LAYOUT_LABELS[currentLayout]?.[lang] || currentLayout}
        </span>
        <IconLayout size={14} className="text-[var(--muted)] shrink-0" />
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl p-5 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold mb-4">
              {lang === "en" ? "Choose Layout" : "Elige Disposición"}
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {SLIDE_LAYOUTS.map((layout) => {
                const active = currentLayout === layout.id;
                return (
                  <button
                    key={layout.id}
                    onClick={() => {
                      onChange(layout.id);
                      setOpen(false);
                    }}
                    className={`rounded-xl p-2 transition-all flex flex-col items-center gap-1.5 ${
                      active
                        ? "ring-2 ring-[var(--accent)] bg-[var(--accent)]/10"
                        : "hover:bg-[var(--surface-2)] bg-transparent"
                    }`}
                  >
                    <LayoutThumbnail layout={layout} active={active} />
                    <span
                      className="text-[10px] leading-tight text-center"
                      style={{ color: active ? "var(--accent)" : "var(--muted)" }}
                    >
                      {LAYOUT_LABELS[layout.id][lang]}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="mt-4 w-full text-xs text-[var(--muted)] hover:text-[var(--fg)] py-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
            >
              {lang === "en" ? "Close" : "Cerrar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Color Picker ──
function AccentColorPicker({
  currentColor,
  onApplyToSlide,
  onApplyToAll,
  t,
}: {
  currentColor?: string;
  onApplyToSlide: (color: string) => void;
  onApplyToAll: (color: string) => void;
  t: Record<string, string>;
}) {
  const [hexInput, setHexInput] = useState(currentColor ? `#${currentColor}` : "#6366F1");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleHexChange = (val: string) => {
    const clean = val.startsWith("#") ? val : `#${val}`;
    setHexInput(clean.slice(0, 7));
  };

  const resolvedHex = () => {
    const raw = hexInput.replace("#", "").toUpperCase();
    return /^[0-9A-F]{6}$/.test(raw) ? raw : null;
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-[var(--muted)]">{t.accentColor}</h4>
      <div className="flex flex-wrap gap-1.5">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c.hex}
            title={c.label}
            onClick={() => {
              setHexInput(`#${c.hex}`);
              onApplyToSlide(c.hex);
            }}
            className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
            style={{
              backgroundColor: `#${c.hex}`,
              borderColor:
                currentColor?.toUpperCase() === c.hex ? "white" : "transparent",
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hexInput.length === 7 ? hexInput : "#6366F1"}
          onChange={(e) => {
            const hex = e.target.value.replace("#", "").toUpperCase();
            setHexInput(e.target.value.toUpperCase());
            onApplyToSlide(hex);
          }}
          className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent shrink-0"
        />
        <input
          ref={inputRef}
          type="text"
          value={hexInput}
          onChange={(e) => handleHexChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const hex = resolvedHex();
              if (hex) onApplyToSlide(hex);
            }
          }}
          placeholder={t.hexPlaceholder}
          className="flex-1 min-w-0 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:border-[var(--accent)]"
        />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => {
            const hex = resolvedHex();
            if (hex) onApplyToSlide(hex);
          }}
          disabled={!resolvedHex()}
          className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-white rounded-lg py-1.5 text-[10px] font-medium transition-colors text-center"
        >
          {t.applyToSlide}
        </button>
        <button
          onClick={() => {
            const hex = resolvedHex();
            if (hex) onApplyToAll(hex);
          }}
          disabled={!resolvedHex()}
          className="bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--accent)] disabled:opacity-40 text-[var(--fg)] rounded-lg py-1.5 text-[10px] font-medium transition-colors text-center"
        >
          {t.applyToAll}
        </button>
      </div>
    </div>
  );
}

// ── Presenter Notes with "view full" modal ──
function PresenterNotesBlock({
  notes,
  lang,
  t,
}: {
  notes?: string;
  lang: "en" | "es";
  t: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const text = notes || "—";
  const hasContent = !!notes?.trim();

  return (
    <div className="bg-[var(--surface-2)] rounded-xl p-3 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-[var(--muted)]">
          {t.presenterNotes}
        </h4>
        {hasContent && (
          <button
            onClick={() => setOpen(true)}
            className="text-[10px] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
          >
            {lang === "en" ? "View all" : "Ver todo"}
          </button>
        )}
      </div>
      <p className="text-sm text-[var(--fg)] leading-relaxed line-clamp-5 flex-1">
        {text}
      </p>

      {/* Full notes modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold mb-3 shrink-0">
              {t.presenterNotes}
            </h3>
            <div className="flex-1 overflow-y-auto">
              <p className="text-sm text-[var(--fg)] leading-relaxed whitespace-pre-wrap">
                {text}
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="mt-4 w-full text-xs text-[var(--muted)] hover:text-[var(--fg)] py-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors shrink-0"
            >
              {lang === "en" ? "Close" : "Cerrar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Virtualized grid for "all slides" view ──

const VIRTUAL_THRESHOLD = 8; // Slides below this count use a plain grid
const GRID_GAP = 16; // gap-4 = 16px
const ASPECT_RATIO = 9 / 16;

interface SlideCellProps {
  slides: SlideData[];
  columnCount: number;
  onSlideClick: (index: number) => void;
}

function SlideCell({
  columnIndex,
  rowIndex,
  style,
  slides,
  columnCount,
  onSlideClick,
}: CellComponentProps<SlideCellProps>) {
  const idx = rowIndex * columnCount + columnIndex;
  if (idx >= slides.length) return null;
  const s = slides[idx];
  return (
    <div style={{ ...style, paddingRight: columnIndex < columnCount - 1 ? GRID_GAP : 0, paddingBottom: GRID_GAP }}>
      <SlidePreview
        slide={s}
        onSlideClick={() => onSlideClick(s.index)}
      />
    </div>
  );
}

function VirtualizedSlideGrid({
  slides,
  onSlideClick,
}: {
  slides: SlideData[];
  onSlideClick: (index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Responsive column count (matches md:grid-cols-2)
  const columnCount = containerWidth >= 768 ? 2 : 1;

  if (slides.length < VIRTUAL_THRESHOLD) {
    return (
      <div ref={containerRef} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {slides.map((s) => (
          <SlidePreview
            key={s.id}
            slide={s}
            onSlideClick={() => onSlideClick(s.index)}
          />
        ))}
      </div>
    );
  }

  const colWidth = containerWidth > 0
    ? (containerWidth - GRID_GAP * (columnCount - 1)) / columnCount
    : 300;
  const rowHeight = Math.round(colWidth * ASPECT_RATIO) + GRID_GAP;
  const rowCount = Math.ceil(slides.length / columnCount);
  const gridHeight = Math.min(rowCount * rowHeight, 720);

  return (
    <div ref={containerRef}>
      {containerWidth > 0 && (
        <VirtualGrid
          cellComponent={SlideCell}
          cellProps={{ slides, columnCount, onSlideClick }}
          columnCount={columnCount}
          columnWidth={colWidth + (columnCount > 1 ? GRID_GAP / columnCount : 0)}
          rowCount={rowCount}
          rowHeight={rowHeight}
          style={{ height: gridHeight, overflowX: "hidden" }}
          overscanCount={2}
        />
      )}
    </div>
  );
}

// ── Main Editor ──
export default function SlideEditor() {
  const {
    settings,
    presentation,
    selectedSlideIndex,
    layoutMode,
    slideLayout: globalSlideLayout,
    overlaySectionFontSize,
    overlayTitleFontSize,
    overlaySectionColor,
    overlayTitleColor,
    overlayTextGap,
    showImageSource,
    imageSourceFontColor,
    setOverlaySectionFontSize,
    setOverlayTitleFontSize,
    setOverlaySectionColor,
    setOverlayTitleColor,
    setOverlayTextGap,
    setShowImageSource,
    setImageSourceFontColor,
    setSlideLayout,
    setSelectedSlideIndex,
    setError,
    getEffectiveSelection,
    updateSlide,
    updateAllSlidesAccent,
  } = useAppStore();

  const lang = settings.language;
  const t = UI_TEXT[lang];
  const [refreshingImage, setRefreshingImage] = useState<number | null>(null);
  // Track previous image per slot so the user can undo a bad refresh
  const [previousImage, setPreviousImage] = useState<{
    slideIndex: number;
    slotIndex: number;
    url: string;
    source?: string;
    adjustment?: ImageAdjustment;
    replacedUrl?: string;
  } | null>(null);
  // AI image generation state
  const [showImageGenModal, setShowImageGenModal] = useState(false);
  const [imageGenSlot, setImageGenSlot] = useState<number>(0);
  const [generatingAiImage, setGeneratingAiImage] = useState<number | null>(null);
  // Manual image search state
  const [showImageSearchModal, setShowImageSearchModal] = useState(false);
  const [imageSearchSlot, setImageSearchSlot] = useState<number>(0);
  const [imageSearchNeedsSlotChoice, setImageSearchNeedsSlotChoice] = useState(false);
  const [lastChosenSearchSlotBySlide, setLastChosenSearchSlotBySlide] = useState<Record<number, number>>({});
  const [regeneratingSlide, setRegeneratingSlide] = useState<number | null>(null);
  const [variantCount, setVariantCount] = useState<number>(3);
  const [showVariantsModal, setShowVariantsModal] = useState(false);
  const [generatingVariants, setGeneratingVariants] = useState(false);
  const [slideVariants, setSlideVariants] = useState<SlideVariant[]>([]);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [fullscreenTab, setFullscreenTab] = useState<"images" | "style" | "notes" | "slide">("style");
  const [fullscreenImageSlot, setFullscreenImageSlot] = useState(0);

  const labels = {
    title: lang === "en" ? "PPTX Overlay Text" : "Texto Overlay PPTX",
    upperSize: lang === "en" ? "Upper text size" : "Tamano texto superior",
    lowerSize: lang === "en" ? "Lower text size" : "Tamano texto inferior",
    upperColor: lang === "en" ? "Upper color" : "Color superior",
    lowerColor: lang === "en" ? "Lower color" : "Color inferior",
    gap: lang === "en" ? "Vertical gap" : "Separacion vertical",
    sourceLabel: lang === "en" ? "Source label color" : "Color etiqueta fuente",
    showSource: lang === "en" ? "Show image source" : "Mostrar fuente de imagen",
  };

  if (!presentation) return null;

  const currentSlide =
    selectedSlideIndex === "all"
      ? null
      : presentation.slides[selectedSlideIndex as number];

  const slideIdx = typeof selectedSlideIndex === "number" ? selectedSlideIndex : -1;
  const canGoPrev = slideIdx > 0;
  const canGoNext = slideIdx >= 0 && slideIdx < presentation.slides.length - 1;

  const getEffectiveLayoutId = useCallback(
    (slide: SlideData): SlideLayoutId =>
      layoutMode === "fixed"
        ? globalSlideLayout
        : slide.slideLayout || globalSlideLayout,
    [layoutMode, globalSlideLayout],
  );

  const getPreferredImageSlot = useCallback((slide: SlideData) => {
    const layoutId = getEffectiveLayoutId(slide);
    const layoutDef = SLIDE_LAYOUTS.find((l) => l.id === layoutId);
    const maxSlots = Math.max(1, layoutDef?.imageCount ?? 1);
    const rememberedSlot = Math.min(
      Math.max(lastChosenSearchSlotBySlide[slide.index] ?? 0, 0),
      maxSlots - 1,
    );

    if (slide.imageUrls[rememberedSlot]) return rememberedSlot;

    const firstFilled = slide.imageUrls.findIndex(Boolean);
    return firstFilled >= 0 ? Math.min(firstFilled, maxSlots - 1) : rememberedSlot;
  }, [getEffectiveLayoutId, lastChosenSearchSlotBySlide]);

  const openFullscreenEditor = useCallback((tab: "images" | "style" | "notes" | "slide" = "style", slotIndex?: number) => {
    if (!currentSlide) return;
    setFullscreenTab(tab);
    setFullscreenImageSlot(typeof slotIndex === "number" ? slotIndex : getPreferredImageSlot(currentSlide));
    setShowFullscreen(true);
  }, [currentSlide, getPreferredImageSlot]);

  const resetImageAdjustmentForSlot = useCallback((slide: SlideData, slotIndex: number) => (
    setSlideImageAdjustment(slide, slotIndex, DEFAULT_IMAGE_ADJUSTMENT)
  ), []);

  const restoreImageAdjustmentForSlot = useCallback((slide: SlideData, slotIndex: number, adjustment?: ImageAdjustment) => (
    setSlideImageAdjustment(slide, slotIndex, adjustment ?? DEFAULT_IMAGE_ADJUSTMENT)
  ), []);

  const recordImageFeedback = useCallback(async (payload: Record<string, unknown>) => {
    try {
      await fetch("/api/images/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // Best-effort feedback only.
    }
  }, []);

  // ── Refresh a single image slot ──
  const handleRefreshImage = async (imgSlotIndex: number) => {
    if (!currentSlide || refreshingImage !== null) return;
    setRefreshingImage(imgSlotIndex);

    try {
      const aiTerms = (currentSlide.imageSearchTerms ?? []).filter((t) => t?.trim());
      const titleTerm = currentSlide.title || "";
      const sectionTerm = currentSlide.section || "";
      const contextQuery = [titleTerm, sectionTerm].filter(Boolean).join(" ");
      const terms = [
        contextQuery,
        ...aiTerms,
        titleTerm,
      ].filter(Boolean).slice(0, 4);

      const currentUrls = currentSlide.imageUrls.filter(Boolean);

      const { provider: effProvider, modelId: effModelId } = getEffectiveSelection();

      const imgData = await fetchImagesWithCache({
          searchTerms: [terms],
          presentationTopic: presentation.title,
          slideContexts: [{
            title: currentSlide.title,
            bullets: currentSlide.bullets,
            section: currentSlide.section || "",
          }],
          exclude: currentUrls,
          aiConfig: { provider: effProvider, modelId: effModelId },
          enabledSources: settings.enabledImageSources,
          imageVerification: settings.imageVerification,
        });

      if (imgData.ok && imgData.images?.[0]) {
        const candidates = imgData.images[0] as { url: string; thumbUrl: string; title?: string; source?: string }[];
        const currentUrl = currentSlide.imageUrls[imgSlotIndex];
        // Pick a URL that isn't the current one (double-check client-side)
        const replacement = candidates.find((c) => c.url !== currentUrl && c.thumbUrl !== currentUrl);
        if (replacement) {
          // Save previous image for undo
          if (currentUrl) {
            setPreviousImage({
              slideIndex: currentSlide.index,
              slotIndex: imgSlotIndex,
              url: currentUrl,
              source: currentSlide.imageSources?.[imgSlotIndex],
              adjustment: currentSlide.imageAdjustments?.[imgSlotIndex],
              replacedUrl: replacement.url,
            });
            void recordImageFeedback({
              action: "rejected",
              imageUrl: currentUrl,
              presentationTopic: presentation.title,
              slideContext: {
                title: currentSlide.title,
                bullets: currentSlide.bullets,
                section: currentSlide.section || "",
              },
              queryTerms: terms,
            });
          }
          const newUrls = [...currentSlide.imageUrls];
          // Use the full image URL to keep quality and avoid visible deformation when scaling.
          newUrls[imgSlotIndex] = replacement.url;
          const newSources = [...(currentSlide.imageSources || Array(currentSlide.imageUrls.length).fill(""))];
          newSources[imgSlotIndex] = replacement.source;
          updateSlide(currentSlide.index, {
            imageUrls: newUrls,
            imageSources: newSources,
            imageAdjustments: resetImageAdjustmentForSlot(currentSlide, imgSlotIndex),
          });
          // Pre-download image blob in background for faster preview & PPTX export
          prefetchImageBlob(replacement.url);
          void recordImageFeedback({
            action: "selected",
            imageUrl: replacement.url,
            imageTitle: replacement.title,
            imageSource: replacement.source,
            presentationTopic: presentation.title,
            slideContext: {
              title: currentSlide.title,
              bullets: currentSlide.bullets,
              section: currentSlide.section || "",
            },
            queryTerms: terms,
          });
        }
      }
    } catch {
      // silently fail
    } finally {
      setRefreshingImage(null);
    }
  };

  // ── Undo last image refresh ──
  const handleUndoImage = () => {
    if (!previousImage || !presentation) return;
    const slide = presentation.slides[previousImage.slideIndex];
    if (!slide) return;
    const newUrls = [...slide.imageUrls];
    newUrls[previousImage.slotIndex] = previousImage.url;
    const newSources = [...(slide.imageSources || Array(slide.imageUrls.length).fill(""))];
    newSources[previousImage.slotIndex] = previousImage.source || "";
    updateSlide(previousImage.slideIndex, {
      imageUrls: newUrls,
      imageSources: newSources,
      imageAdjustments: restoreImageAdjustmentForSlot(slide, previousImage.slotIndex, previousImage.adjustment),
    });
    void recordImageFeedback({
      action: "restored",
      imageUrl: previousImage.url,
      presentationTopic: presentation.title,
      slideContext: {
        title: slide.title,
        bullets: slide.bullets,
        section: slide.section || "",
      },
      queryTerms: slide.imageSearchTerms,
    });
    if (previousImage.replacedUrl) {
      void recordImageFeedback({
        action: "rejected",
        imageUrl: previousImage.replacedUrl,
        presentationTopic: presentation.title,
        slideContext: {
          title: slide.title,
          bullets: slide.bullets,
          section: slide.section || "",
        },
        queryTerms: slide.imageSearchTerms,
      });
    }
    setPreviousImage(null);
  };

  // ── Open AI image generation modal for a specific slot ──
  const openImageGenModal = (slotIndex: number) => {
    setImageGenSlot(slotIndex);
    setShowImageGenModal(true);
  };

  const rememberImageSearchSlot = (slideIndex: number, slotIndex: number) => {
    setLastChosenSearchSlotBySlide((prev) => ({
      ...prev,
      [slideIndex]: slotIndex,
    }));
  };

  // ── Open manual image search modal for a specific slot (or remembered slot) ──
  const openImageSearchModal = (slotIndex?: number) => {
    if (!currentSlide) return;
    const layoutId = getEffectiveLayoutId(currentSlide);
    const layoutDef = SLIDE_LAYOUTS.find((l) => l.id === layoutId);
    const maxSlots = layoutDef?.imageCount ?? 1;
    const rememberedSlot = Math.min(
      Math.max(lastChosenSearchSlotBySlide[currentSlide.index] ?? 0, 0),
      Math.max(0, maxSlots - 1),
    );
    const resolvedSlot = typeof slotIndex === "number"
      ? Math.min(Math.max(slotIndex, 0), Math.max(0, maxSlots - 1))
      : rememberedSlot;

    setImageSearchSlot(resolvedSlot);
    rememberImageSearchSlot(currentSlide.index, resolvedSlot);
    setImageSearchNeedsSlotChoice(typeof slotIndex !== "number" && maxSlots > 1);
    setShowImageSearchModal(true);
  };

  // ── Handle image selection from search modal ──
  const handleImageSearchSelect = (image: {
    url: string;
    title: string;
    source: string;
  }, targetSlotIndex: number) => {
    if (!currentSlide) return;
    const currentUrl = currentSlide.imageUrls[targetSlotIndex];
    if (currentUrl) {
      setPreviousImage({
        slideIndex: currentSlide.index,
        slotIndex: targetSlotIndex,
        url: currentUrl,
        source: currentSlide.imageSources?.[targetSlotIndex],
        adjustment: currentSlide.imageAdjustments?.[targetSlotIndex],
        replacedUrl: image.url,
      });
      void recordImageFeedback({
        action: "rejected",
        imageUrl: currentUrl,
        presentationTopic: presentation.title,
        slideContext: {
          title: currentSlide.title,
          bullets: currentSlide.bullets,
          section: currentSlide.section || "",
        },
        queryTerms: currentSlide.imageSearchTerms,
      });
    }
    const newUrls = [...currentSlide.imageUrls];
    newUrls[targetSlotIndex] = image.url;
    const newSources = [...(currentSlide.imageSources || Array(currentSlide.imageUrls.length).fill(""))];
    newSources[targetSlotIndex] = image.source;
    updateSlide(currentSlide.index, {
      imageUrls: newUrls,
      imageSources: newSources,
      imageAdjustments: resetImageAdjustmentForSlot(currentSlide, targetSlotIndex),
    });
    // Pre-download image blob in background for faster preview & PPTX export
    prefetchImageBlob(image.url);
    setImageSearchSlot(targetSlotIndex);
    rememberImageSearchSlot(currentSlide.index, targetSlotIndex);
    void recordImageFeedback({
      action: "selected",
      imageUrl: image.url,
      imageTitle: image.title,
      imageSource: image.source,
      presentationTopic: presentation.title,
      slideContext: {
        title: currentSlide.title,
        bullets: currentSlide.bullets,
        section: currentSlide.section || "",
      },
      queryTerms: currentSlide.imageSearchTerms,
    });
    setImageSearchNeedsSlotChoice(false);
    setShowImageSearchModal(false);
  };

  // ── Handle image drop from computer or web ──
  const handleImageDrop = (slotIndex: number, url: string, source: string) => {
    if (!currentSlide) return;
    const newUrls = [...currentSlide.imageUrls];
    newUrls[slotIndex] = url;
    const newSources = [...(currentSlide.imageSources || Array(currentSlide.imageUrls.length).fill(""))];
    newSources[slotIndex] = source;
    updateSlide(currentSlide.index, {
      imageUrls: newUrls,
      imageSources: newSources,
      imageAdjustments: resetImageAdjustmentForSlot(currentSlide, slotIndex),
    });
    if (!url.startsWith("data:")) {
      prefetchImageBlob(url);
    }
  };

  // ── Generate AI image ──
  const handleGenerateAiImage = async (opts: {
    provider: "gemini" | "openai";
    modelId: string;
    prompt?: string;
    autoPrompt: boolean;
    slideContext: {
      title: string;
      bullets: string[];
      notes: string;
      section: string;
      presentationTopic: string;
    };
  }) => {
    if (!currentSlide) return;
    const slotIdx = imageGenSlot;
    setShowImageGenModal(false);
    setGeneratingAiImage(slotIdx);

    try {
      const { provider: textProvider, modelId: textModelId } = getEffectiveSelection();

      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: opts.provider,
          modelId: opts.modelId,
          prompt: opts.prompt,
          autoPrompt: opts.autoPrompt,
          slideContext: opts.slideContext,
          textAiConfig: opts.autoPrompt
            ? { provider: textProvider, modelId: textModelId }
            : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to generate image");
        return;
      }

      if (data.imageUrl) {
        const currentUrl = currentSlide.imageUrls[slotIdx];
        if (currentUrl) {
          setPreviousImage({
            slideIndex: currentSlide.index,
            slotIndex: slotIdx,
            url: currentUrl,
            source: currentSlide.imageSources?.[slotIdx],
            adjustment: currentSlide.imageAdjustments?.[slotIdx],
          });
        }
        const newUrls = [...currentSlide.imageUrls];
        newUrls[slotIdx] = data.imageUrl;
        const newSources = [...(currentSlide.imageSources || Array(currentSlide.imageUrls.length).fill(""))];
        newSources[slotIdx] = ""; // AI-generated images have no source
        updateSlide(currentSlide.index, {
          imageUrls: newUrls,
          imageSources: newSources,
          imageAdjustments: resetImageAdjustmentForSlot(currentSlide, slotIdx),
        });
        // Pre-download image blob in background for faster preview & PPTX export
        prefetchImageBlob(data.imageUrl);
      }
    } catch {
      setError("Failed to generate image");
    } finally {
      setGeneratingAiImage(null);
    }
  };

  // ── Change layout and auto-fetch missing images ──
  const handleLayoutChange = async (slideIndex: number, newLayoutId: SlideLayoutId) => {
    const slide = presentation!.slides[slideIndex];
    if (!slide) return;

    // In fixed mode, layout picker controls the global layout for all slides.
    if (layoutMode === "fixed") {
      setSlideLayout(newLayoutId);
      return;
    }

    const newLayoutDef = SLIDE_LAYOUTS.find((l) => l.id === newLayoutId);
    const needed = newLayoutDef?.imageCount ?? 1;
    const existingUrls = slide.imageUrls.filter(Boolean);

    // Apply the layout immediately so the preview updates
    updateSlide(slideIndex, { slideLayout: newLayoutId });

    // If we already have enough images, nothing more to do
    if (existingUrls.length >= needed) return;

    // Fetch additional images to fill the new slots
    const missing = needed - existingUrls.length;
    try {
      const aiTerms = (slide.imageSearchTerms ?? []).filter((t) => t?.trim());
      const contextQuery = [slide.title, slide.section || ""].filter(Boolean).join(" ");
      const terms = [contextQuery, ...aiTerms, slide.title || ""].filter(Boolean).slice(0, 4);

      const imgData = await fetchImagesWithCache({
          searchTerms: [terms],
          presentationTopic: presentation!.title,
          slideContexts: [{
            title: slide.title,
            bullets: slide.bullets,
            section: slide.section || "",
          }],
          exclude: existingUrls,
          enabledSources: settings.enabledImageSources,
          imageVerification: settings.imageVerification,
        });

      if (imgData.ok && imgData.images?.[0]) {
        const candidates = imgData.images[0] as { url: string; thumbUrl: string }[];
        const newUrls = candidates
          .filter((c) => !existingUrls.includes(c.url) && !existingUrls.includes(c.thumbUrl))
          .slice(0, missing)
          .map((c) => c.url);

        if (newUrls.length > 0) {
          updateSlide(slideIndex, {
            imageUrls: [...existingUrls, ...newUrls],
          });
          // Pre-download new image blobs in background
          for (const u of newUrls) prefetchImageBlob(u);
        }
      }
    } catch {
      // Silently fail — placeholders remain clickable
    }
  };

  // ── Fetch images for edited slides ──
  const fetchImagesForSlides = async (
    slides: SlideData[]
  ): Promise<Map<number, string[]>> => {
    const slidesNeedingImages = slides.filter(
      (s) => s.imageSearchTerms && s.imageSearchTerms.length > 0
    );
    if (slidesNeedingImages.length === 0) return new Map();

    const searchTerms = slidesNeedingImages.map((s) => s.imageSearchTerms!);

    try {
      const imgData = await fetchImagesWithCache({
          searchTerms,
          presentationTopic: presentation!.title,
          slideContexts: slidesNeedingImages.map((s) => ({
            title: s.title,
            bullets: s.bullets,
            section: s.section || "",
          })),
          enabledSources: settings.enabledImageSources,
          imageVerification: settings.imageVerification,
        });
      const imageMap = new Map<number, string[]>();

      if (imgData.ok && imgData.images) {
        slidesNeedingImages.forEach((slide, i) => {
          const imgs = (imgData.images![i] || []) as { url: string; thumbUrl: string }[];
          const urls = imgs.slice(0, 4).map((img) => img.url);
          imageMap.set(slide.index, urls);
          // Pre-download image blobs in background
          for (const u of urls) prefetchImageBlob(u);
        });
      }
      return imageMap;
    } catch {
      return new Map();
    }
  };

  const fetchImagesForVariant = async (variant: SlideVariant): Promise<string[]> => {
    const terms = (variant.imageSearchTerms ?? []).filter((term) => term?.trim());
    if (terms.length === 0) return [];

    try {
      const imgData = await fetchImagesWithCache({
          searchTerms: [terms],
          presentationTopic: presentation!.title,
          slideContexts: [{
            title: variant.title,
            bullets: variant.bullets,
            section: variant.section || "",
          }],
          enabledSources: settings.enabledImageSources,
          imageVerification: settings.imageVerification,
        });
      if (!imgData.ok || !imgData.images?.[0]) return [];

      const imgs = (imgData.images[0] || []) as { url: string }[];
      return imgs.slice(0, 4).map((img) => img.url);
    } catch {
      return [];
    }
  };

  const handleRegenerateSlide = async () => {
    if (!currentSlide || regeneratingSlide !== null) return;

    const { provider: effectiveProvider, modelId: effectiveModelId } =
      getEffectiveSelection();
    const provider = settings.providers.find((p) => p.id === effectiveProvider);
    if (!provider?.hasKey || !effectiveModelId) {
      setError("No API key configured");
      return;
    }

    setRegeneratingSlide(currentSlide.index);
    try {
      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: effectiveProvider,
          modelId: effectiveModelId,
          instruction: "Regenerate this slide from scratch with a clearly different angle while preserving the deck narrative, topic relevance, and language.",
          slides: presentation.slides,
          targetIndices: [currentSlide.index],
          language:
            OUTPUT_LANGUAGE_NAMES[settings.outputLanguage as OutputLanguage] || "English",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to regenerate slide");
        return;
      }

      const editedSlide = (data.slides || [])[0] as SlideData | undefined;
      if (!editedSlide) {
        setError("Failed to regenerate slide");
        return;
      }

      const newImageMap = await fetchImagesForSlides([editedSlide]);
      let finalImageUrls = currentSlide.imageUrls;
      if (newImageMap.has(currentSlide.index)) {
        finalImageUrls = newImageMap.get(currentSlide.index)!;
      } else if (editedSlide.imageSearchTerms && editedSlide.imageSearchTerms.length === 0) {
        finalImageUrls = [];
      }

      updateSlide(currentSlide.index, {
        ...editedSlide,
        id: currentSlide.id,
        index: currentSlide.index,
        imageUrls: finalImageUrls,
      });
    } catch {
      setError("Failed to regenerate slide");
    } finally {
      setRegeneratingSlide(null);
    }
  };

  const handleGenerateVariants = async () => {
    if (!currentSlide || generatingVariants) return;

    const { provider: effectiveProvider, modelId: effectiveModelId } =
      getEffectiveSelection();
    const provider = settings.providers.find((p) => p.id === effectiveProvider);
    if (!provider?.hasKey || !effectiveModelId) {
      setError("No API key configured");
      return;
    }

    setShowVariantsModal(true);
    setGeneratingVariants(true);
    setSlideVariants([]);

    try {
      const res = await fetch("/api/slide-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: effectiveProvider,
          modelId: effectiveModelId,
          slide: {
            title: currentSlide.title,
            bullets: currentSlide.bullets,
            notes: currentSlide.notes,
            section: currentSlide.section,
            accentColor: currentSlide.accentColor,
            imageSearchTerms: currentSlide.imageSearchTerms,
            slideLayout: getEffectiveLayoutId(currentSlide),
          },
          count: variantCount,
          language:
            OUTPUT_LANGUAGE_NAMES[settings.outputLanguage as OutputLanguage] || "English",
          presentationTitle: presentation.title,
          totalSlides: presentation.slides.length,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to generate variants");
        setShowVariantsModal(false);
        return;
      }

      const variants = (data.variants || []) as SlideVariant[];
      const variantsWithImages = await Promise.all(
        variants.map(async (variant) => ({
          ...variant,
          imageUrls: await fetchImagesForVariant(variant),
        }))
      );

      setSlideVariants(variantsWithImages);
    } catch {
      setError("Failed to generate variants");
      setShowVariantsModal(false);
    } finally {
      setGeneratingVariants(false);
    }
  };

  const handleApplyVariant = (variant: SlideVariant) => {
    if (!currentSlide) return;

    updateSlide(currentSlide.index, {
      title: variant.title,
      bullets: variant.bullets,
      notes: variant.notes,
      section: variant.section,
      accentColor: variant.accentColor,
      imageSearchTerms: variant.imageSearchTerms,
      slideLayout: variant.slideLayout,
      imageUrls: variant.imageUrls && variant.imageUrls.length > 0
        ? variant.imageUrls
        : currentSlide.imageUrls,
      imageAdjustments: variant.imageUrls && variant.imageUrls.length > 0
        ? undefined
        : currentSlide.imageAdjustments,
    });

    setShowVariantsModal(false);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">{t.editor}</h2>

      {/* Slide selector chips */}
      <div className="flex gap-2 flex-wrap">
        <button
          data-slide-chip="all"
          onClick={() => setSelectedSlideIndex("all")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            selectedSlideIndex === "all"
              ? "bg-[var(--accent)] text-white"
              : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
          }`}
        >
          {t.allSlides}
        </button>
        {presentation.slides.map((s, i) => (
          <button
            key={s.id}
            data-slide-chip={String(i)}
            onClick={() => setSelectedSlideIndex(i)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selectedSlideIndex === i
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Main editor area */}
      {selectedSlideIndex === "all" ? (
        /* ── Grid view for "all" — virtualized for large decks ── */
        <VirtualizedSlideGrid
          slides={presentation.slides}
          onSlideClick={(index) => setSelectedSlideIndex(index)}
        />
      ) : (
        currentSlide && (
          <div className="space-y-4">
            {/* ── Slide preview with narrow nav arrows ── */}
            <div className="flex items-stretch gap-2">
              {/* Prev arrow */}
              <button
                disabled={!canGoPrev}
                onClick={() => canGoPrev && setSelectedSlideIndex(slideIdx - 1)}
                className="w-10 shrink-0 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--border)] disabled:opacity-20 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-[var(--muted)]"
                title={lang === "en" ? "Previous slide" : "Diapositiva anterior"}
              >
                <IconChevronLeft size={20} />
              </button>

              {/* Slide preview */}
              <div className="flex-1 min-w-0">
                <SlidePreview
                  slide={currentSlide}
                  onImageClick={(slot) => openImageSearchModal(slot)}
                  onImageDrop={handleImageDrop}
                  refreshingIndex={refreshingImage}
                  viewMode="focus"
                />
              </div>

              {/* Next arrow */}
              <button
                disabled={!canGoNext}
                onClick={() => canGoNext && setSelectedSlideIndex(slideIdx + 1)}
                className="w-10 shrink-0 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--border)] disabled:opacity-20 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-[var(--muted)]"
                title={lang === "en" ? "Next slide" : "Diapositiva siguiente"}
              >
                <IconChevronRight size={20} />
              </button>
            </div>

            {/* Fullscreen edit button */}
            <div className="flex justify-end gap-3">
              {currentSlide.imageUrls.some(Boolean) && (
                <button
                  onClick={() => openFullscreenEditor("images")}
                  className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                  title={lang === "en" ? "Adjust image crop" : "Ajustar recorte de imagen"}
                >
                  <IconCrop size={14} />
                  {lang === "en" ? "Adjust image" : "Ajustar imagen"}
                </button>
              )}
              <button
                onClick={() => openFullscreenEditor("style")}
                className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                title={lang === "en" ? "Edit fullscreen" : "Editar a pantalla completa"}
              >
                <IconFullscreen size={14} />
                {lang === "en" ? "Fullscreen editor" : "Editor a pantalla completa"}
              </button>
            </div>

            {/* Undo last image refresh + AI generate button */}
            <div className="flex items-center gap-3">
              {previousImage && previousImage.slideIndex === slideIdx && (
                <button
                  onClick={handleUndoImage}
                  className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                >
                  <IconUndo size={14} />
                  {lang === "en" ? "Undo image change" : "Deshacer cambio de imagen"}
                </button>
              )}
              <button
                onClick={() => openImageGenModal(0)}
                disabled={generatingAiImage !== null}
                className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors disabled:opacity-50"
                title={t.generateAiImage}
              >
                {generatingAiImage !== null ? (
                  <IconLoader size={14} className="animate-spin" />
                ) : (
                  <IconSparkles size={14} />
                )}
                {generatingAiImage !== null ? t.aiImageGenerating : t.generateAiImage}
              </button>
              <button
                onClick={() => openImageSearchModal()}
                className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                title={t.imageSearchTitle}
              >
                <IconSearch size={14} />
                {t.imageSearchTitle}
              </button>
              <button
                onClick={handleRegenerateSlide}
                disabled={regeneratingSlide === slideIdx || generatingVariants}
                className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors disabled:opacity-50"
                title={t.slideRegenerate}
              >
                {regeneratingSlide === slideIdx ? (
                  <IconLoader size={14} className="animate-spin" />
                ) : (
                  <IconRefresh size={14} />
                )}
                {regeneratingSlide === slideIdx ? t.slideRegenerating : t.slideRegenerate}
              </button>
              <div className="ml-auto flex items-center gap-2">
                <label className="text-xs text-[var(--muted)]">{t.slideVariantsCount}</label>
                <select
                  value={variantCount}
                  onChange={(e) => setVariantCount(Number(e.target.value) || 3)}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs"
                >
                  {[2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <button
                  onClick={handleGenerateVariants}
                  disabled={generatingVariants || regeneratingSlide === slideIdx}
                  className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors disabled:opacity-50"
                  title={t.slideVariants}
                >
                  {generatingVariants ? (
                    <IconLoader size={14} className="animate-spin" />
                  ) : (
                    <IconWand size={14} />
                  )}
                  {t.slideVariants}
                </button>
              </div>
            </div>

            {/* ── Below preview: color + layout + notes side-by-side ── */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* Accent color */}
              <div className="bg-[var(--surface-2)] rounded-xl p-3">
                <AccentColorPicker
                  currentColor={currentSlide.accentColor}
                  onApplyToSlide={(color) => updateSlide(slideIdx, { accentColor: color })}
                  onApplyToAll={(color) => updateAllSlidesAccent(color)}
                  t={t}
                />
              </div>

              {/* Per-slide layout picker */}
              <div className="bg-[var(--surface-2)] rounded-xl p-3">
                <SlideLayoutPicker
                  currentLayout={getEffectiveLayoutId(currentSlide)}
                  onChange={(id) => handleLayoutChange(slideIdx, id)}
                  lang={lang}
                />
              </div>

              {/* Presenter Notes */}
              <PresenterNotesBlock notes={currentSlide.notes} lang={lang} t={t} />

              {/* PPTX overlay text controls */}
              <div className="bg-[var(--surface-2)] rounded-xl p-3 space-y-2">
                <h4 className="text-xs font-medium text-[var(--muted)]">{labels.title}</h4>

                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-[var(--muted)]">
                    {labels.upperSize}
                    <input
                      type="number"
                      min={8}
                      max={48}
                      value={overlaySectionFontSize}
                      onChange={(e) => setOverlaySectionFontSize(Number(e.target.value) || 16)}
                      className="mt-1 w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="text-[11px] text-[var(--muted)]">
                    {labels.lowerSize}
                    <input
                      type="number"
                      min={10}
                      max={72}
                      value={overlayTitleFontSize}
                      onChange={(e) => setOverlayTitleFontSize(Number(e.target.value) || 20)}
                      className="mt-1 w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-[var(--muted)]">
                    {labels.upperColor}
                    <input
                      type="color"
                      value={`#${overlaySectionColor}`}
                      onChange={(e) => setOverlaySectionColor(e.target.value.replace("#", "").toUpperCase())}
                      className="mt-1 h-8 w-full bg-transparent border border-[var(--border)] rounded"
                    />
                  </label>
                  <label className="text-[11px] text-[var(--muted)]">
                    {labels.lowerColor}
                    <input
                      type="color"
                      value={`#${overlayTitleColor}`}
                      onChange={(e) => setOverlayTitleColor(e.target.value.replace("#", "").toUpperCase())}
                      className="mt-1 h-8 w-full bg-transparent border border-[var(--border)] rounded"
                    />
                  </label>
                </div>

                <label className="text-[11px] text-[var(--muted)] block">
                  {labels.gap}: {overlayTextGap.toFixed(2)}
                  <input
                    type="range"
                    min={0.05}
                    max={0.6}
                    step={0.01}
                    value={overlayTextGap}
                    onChange={(e) => setOverlayTextGap(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </label>

                {/* Image source label controls */}
                <div className="border-t border-[var(--border)]/50 pt-2 mt-2 space-y-1.5">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showImageSource}
                      onChange={(e) => setShowImageSource(e.target.checked)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="text-[11px] text-[var(--muted)]">{labels.showSource}</span>
                  </label>
                  {showImageSource && (
                    <label className="text-[11px] text-[var(--muted)]">
                      {labels.sourceLabel}
                      <input
                        type="color"
                        value={`#${imageSourceFontColor}`}
                        onChange={(e) => setImageSourceFontColor(e.target.value.replace("#", "").toUpperCase())}
                        className="mt-1 h-8 w-full bg-transparent border border-[var(--border)] rounded"
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      )}

      {/* AI Image Generation Modal */}
      {showImageGenModal && currentSlide && (
        <ImageGenModal
          slotIndex={imageGenSlot}
          slideContext={{
            title: currentSlide.title,
            bullets: currentSlide.bullets,
            notes: currentSlide.notes,
            section: currentSlide.section || "",
            presentationTopic: presentation.title,
          }}
          onGenerate={handleGenerateAiImage}
          onClose={() => setShowImageGenModal(false)}
        />
      )}

      {/* Manual Image Search Modal */}
      {showImageSearchModal && currentSlide && (
        <ImageSearchModal
          slotIndex={imageSearchSlot}
          expectedSlots={SLIDE_LAYOUTS.find((l) => l.id === getEffectiveLayoutId(currentSlide))?.imageCount ?? 1}
          layoutId={getEffectiveLayoutId(currentSlide)}
          currentImageUrls={currentSlide.imageUrls}
          requireSlotSelectionOnSelect={imageSearchNeedsSlotChoice}
          slideTitle={currentSlide.title}
          presentationTopic={presentation.title}
          onSelect={handleImageSearchSelect}
          onSlotChange={(slot) => rememberImageSearchSlot(currentSlide.index, slot)}
          onClose={() => {
            setImageSearchNeedsSlotChoice(false);
            setShowImageSearchModal(false);
          }}
        />
      )}

      {/* Slide variants modal */}
      {showVariantsModal && currentSlide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => !generatingVariants && setShowVariantsModal(false)}
        >
          <div
            className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl p-5 w-full max-w-6xl mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold">{t.slideVariantsTitle}</h3>
              <button
                onClick={() => setShowVariantsModal(false)}
                className="text-xs text-[var(--muted)] hover:text-[var(--fg)]"
              >
                {t.close}
              </button>
            </div>

            {generatingVariants ? (
              <div className="py-16 flex flex-col items-center justify-center gap-3 text-[var(--muted)]">
                <IconLoader size={24} className="animate-spin" />
                <p className="text-sm">{t.slideVariantsGenerating}</p>
              </div>
            ) : slideVariants.length === 0 ? (
              <p className="text-sm text-[var(--muted)] py-6">{t.slideVariantsNone}</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {slideVariants.map((variant, idx) => (
                  <div key={idx} className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-3 space-y-3">
                    <SlidePreview
                      slide={{
                        ...currentSlide,
                        title: variant.title,
                        bullets: variant.bullets,
                        notes: variant.notes,
                        section: variant.section,
                        accentColor: variant.accentColor,
                        imageSearchTerms: variant.imageSearchTerms,
                        slideLayout: variant.slideLayout,
                        imageUrls: variant.imageUrls || [],
                        id: `variant-${idx}`,
                        index: idx,
                      }}
                    />
                    <button
                      onClick={() => handleApplyVariant(variant)}
                      className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg py-2 text-xs font-medium transition-colors"
                    >
                      {t.slideVariantsApply}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Fullscreen Editor Modal ── */}
      {showFullscreen && slideIdx >= 0 && (
        <FullscreenEditor
          slideIndex={slideIdx}
          onClose={() => setShowFullscreen(false)}
          onPrev={() => {
            if (canGoPrev) setSelectedSlideIndex(slideIdx - 1);
          }}
          onNext={() => {
            if (canGoNext) setSelectedSlideIndex(slideIdx + 1);
          }}
          canPrev={canGoPrev}
          canNext={canGoNext}
          initialTab={fullscreenTab}
          initialImageSlot={fullscreenImageSlot}
        />
      )}
    </div>
  );
}
