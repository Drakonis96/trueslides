"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { SlideData, ImageAdjustment, SLIDE_LAYOUTS, SlideLayoutId } from "@/lib/types";
import { DEFAULT_IMAGE_ADJUSTMENT, getImageAdjustmentStyle, getMaxImageOffset, setSlideImageAdjustment, OBJECT_FIT_OPTIONS } from "@/lib/image-adjustments";
import { getCachedBlob } from "@/lib/image-blob-cache";
import {
  IconChevronLeft,
  IconChevronRight,
  IconMinimize,
  IconZoomIn,
  IconZoomOut,
  IconReset,
  IconCrop,
  IconImage,
  IconMove,
  IconType,
  IconTrash,
  IconPlus,
  IconCopy,
} from "./Icons";
import { X, ChevronUp, ChevronDown, Paintbrush, StickyNote, Layers } from "lucide-react";

/* ── Constants ── */

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
  { hex: "000000", label: "Black" },
  { hex: "0F172A", label: "Slate 900" },
];

const BG_PRESETS = [
  { hex: "FFFFFF", label: "White" },
  { hex: "F8FAFC", label: "Slate 50" },
  { hex: "F1F5F9", label: "Slate 100" },
  { hex: "1E293B", label: "Slate 800" },
  { hex: "0F172A", label: "Slate 900" },
  { hex: "000000", label: "Black" },
  { hex: "1A1A2E", label: "Navy" },
  { hex: "FFF7ED", label: "Warm" },
];

type EditorMode = "edit" | "move";
type PanelTab = "images" | "style" | "notes" | "slide";

/* ── Helpers ── */

function getAdj(slide: SlideData, idx: number): ImageAdjustment {
  return slide.imageAdjustments?.[idx] ?? DEFAULT_IMAGE_ADJUSTMENT;
}

function isDarkColor(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

/* ── ImageAdjuster: zoom + pan per image slot ── */
function ImageAdjuster({
  url,
  adj,
  onChange,
  onReset,
  lang,
}: {
  url: string;
  adj: ImageAdjustment;
  onChange: (a: ImageAdjustment) => void;
  onReset: () => void;
  lang: "en" | "es";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, ox: adj.offsetX, oy: adj.offsetY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = ((e.clientX - dragStart.current.x) / (containerRef.current?.offsetWidth || 400)) * 100;
    const dy = ((e.clientY - dragStart.current.y) / (containerRef.current?.offsetHeight || 225)) * 100;
    const maxOffset = getMaxImageOffset(adj.scale);
    const ox = Math.max(-maxOffset, Math.min(maxOffset, dragStart.current.ox + dx));
    const oy = Math.max(-maxOffset, Math.min(maxOffset, dragStart.current.oy + dy));
    onChange({ ...adj, offsetX: Math.round(ox * 10) / 10, offsetY: Math.round(oy * 10) / 10 });
  };

  const handlePointerUp = () => {
    dragging.current = false;
  };

  return (
    <div className="space-y-2">
      {/* Preview with draggable image */}
      <div
        ref={containerRef}
        className="relative w-full aspect-video rounded-lg overflow-hidden border border-white/20 bg-black cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          draggable={false}
          style={getImageAdjustmentStyle(adj)}
        />
        {/* Crosshair indicator */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-6 h-px bg-white/40" />
          <div className="absolute w-px h-6 bg-white/40" />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange({ ...adj, scale: Math.max(1, adj.scale - 0.1) })}
          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white/80"
          title={lang === "en" ? "Zoom out" : "Alejar"}
        >
          <IconZoomOut size={14} />
        </button>
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={adj.scale}
          onChange={(e) => {
            const newScale = Number(e.target.value);
            const maxOffset = getMaxImageOffset(newScale);
            onChange({
              scale: newScale,
              offsetX: Math.max(-maxOffset, Math.min(maxOffset, adj.offsetX)),
              offsetY: Math.max(-maxOffset, Math.min(maxOffset, adj.offsetY)),
            });
          }}
          className="flex-1 accent-blue-400"
        />
        <button
          onClick={() => onChange({ ...adj, scale: Math.min(3, adj.scale + 0.1) })}
          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white/80"
          title={lang === "en" ? "Zoom in" : "Acercar"}
        >
          <IconZoomIn size={14} />
        </button>
        <span className="text-[10px] text-white/60 font-mono w-10 text-center">
          {Math.round(adj.scale * 100)}%
        </span>
        <button
          onClick={onReset}
          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white/80"
          title={lang === "en" ? "Reset" : "Reiniciar"}
        >
          <IconReset size={14} />
        </button>
      </div>

      {/* Fitting mode selector */}
      <div className="space-y-1.5">
        <span className="text-[10px] text-white/40 uppercase tracking-wider">
          {lang === "en" ? "Fitting" : "Ajuste"}
        </span>
        <div className="grid grid-cols-4 gap-1">
          {(["cover", "contain", "fill", "none"] as const).map((mode) => {
            const labels: Record<string, { en: string; es: string; icon: string }> = {
              cover:   { en: "Fill",     es: "Rellenar",  icon: "⊞" },
              contain: { en: "Fit",      es: "Contener",  icon: "⊡" },
              fill:    { en: "Stretch",  es: "Estirar",   icon: "⤢" },
              none:    { en: "Original", es: "Original",  icon: "1:1" },
            };
            const info = labels[mode];
            const isActive = (adj.objectFit || "cover") === mode;
            return (
              <button
                key={mode}
                onClick={() => onChange({ ...adj, objectFit: mode })}
                className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[10px] transition-colors ${
                  isActive
                    ? "bg-blue-500/30 text-blue-300 ring-1 ring-blue-400/40"
                    : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70"
                }`}
                title={info[lang]}
              >
                <span className="text-sm leading-none">{info.icon}</span>
                <span>{info[lang]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Inline editable text ── */
function EditableText({
  value,
  onChange,
  className,
  style,
  multiline,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  style?: React.CSSProperties;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (!editing) {
    return (
      <div
        ref={wrapperRef}
        tabIndex={disabled ? undefined : 0}
        className={`${disabled ? "cursor-default" : "cursor-text hover:ring-2 hover:ring-blue-400/40"} rounded px-1 -mx-1 transition-all ${className || ""}`}
        style={style}
        onClick={() => !disabled && setEditing(true)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        {value || <span className="opacity-40 italic">{placeholder || "Click to edit"}</span>}
      </div>
    );
  }

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) onChange(trimmed);
    setEditing(false);
    // Return focus to the wrapper element so it doesn't jump to document root
    requestAnimationFrame(() => wrapperRef.current?.focus());
  };

  if (multiline) {
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        className={`w-full bg-transparent border border-blue-400/50 rounded px-1 -mx-1 outline-none resize-none ${className || ""}`}
        style={{ ...style, minHeight: "3em" }}
        rows={3}
      />
    );
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
      }}
      className={`w-full bg-transparent border border-blue-400/50 rounded px-1 -mx-1 outline-none ${className || ""}`}
      style={style}
    />
  );
}

/* ── Small color picker row ── */
function MiniColorPicker({
  value,
  presets,
  onChange,
  label,
}: {
  value: string;
  presets: { hex: string; label: string }[];
  onChange: (hex: string) => void;
  label: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-[10px] text-white/50 font-medium">{label}</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {presets.slice(0, 8).map((c) => (
          <button
            key={c.hex}
            title={c.label}
            onClick={() => onChange(c.hex)}
            className="w-5 h-5 rounded-full border transition-transform hover:scale-110 shrink-0"
            style={{
              backgroundColor: `#${c.hex}`,
              borderColor: value.toUpperCase() === c.hex ? "#60A5FA" : "rgba(255,255,255,0.2)",
              borderWidth: value.toUpperCase() === c.hex ? 2 : 1,
            }}
          />
        ))}
        <input
          type="color"
          value={`#${value || "6366F1"}`}
          onChange={(e) => onChange(e.target.value.replace("#", "").toUpperCase())}
          className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent shrink-0"
        />
      </div>
    </div>
  );
}

/* ── Main Fullscreen Editor ── */
export default function FullscreenEditor({
  slideIndex,
  onClose,
  onPrev,
  onNext,
  canPrev,
  canNext,
  initialTab = "style",
  initialImageSlot = 0,
}: {
  slideIndex: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  initialTab?: PanelTab;
  initialImageSlot?: number;
}) {
  const { presentation, updateSlide, updateAllSlidesAccent, setPresentation } = useAppStore();
  const textDensity = useAppStore((s) => s.textDensity);
  const layoutMode = useAppStore((s) => s.layoutMode);
  const globalLayout = useAppStore((s) => s.slideLayout);
  const slideBgColor = useAppStore((s) => s.slideBgColor);
  const setSlideBgColor = useAppStore((s) => s.setSlideBgColor);
  const headingFontFamily = useAppStore((s) => s.headingFontFamily);
  const bodyFontFamily = useAppStore((s) => s.bodyFontFamily);
  const overlaySectionColor = useAppStore((s) => s.overlaySectionColor);
  const overlayTitleColor = useAppStore((s) => s.overlayTitleColor);
  const setOverlaySectionColor = useAppStore((s) => s.setOverlaySectionColor);
  const setOverlayTitleColor = useAppStore((s) => s.setOverlayTitleColor);
  const lang = useAppStore((s) => s.settings.language);

  const [mode, setMode] = useState<EditorMode>("edit");
  const [activeTab, setActiveTab] = useState<PanelTab>(initialTab);
  const [selectedImageSlot, setSelectedImageSlot] = useState(initialImageSlot);
  const [bgPickerColor, setBgPickerColor] = useState(() => {
    const s = presentation?.slides[slideIndex];
    return s?.bgColor || slideBgColor || "000000";
  });

  const slide = presentation?.slides[slideIndex];
  const canvasRef = useRef<HTMLDivElement>(null);

  // ── Resolve image URLs from blob cache for instant rendering ──
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const urls = slide?.imageUrls.filter((u) => u && !u.startsWith("data:")) || [];
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
  }, [slide?.imageUrls]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, slideIndex]);

  useEffect(() => {
    setSelectedImageSlot(initialImageSlot);
  }, [initialImageSlot, slideIndex]);

  // Sync bg picker color when switching slides
  useEffect(() => {
    setBgPickerColor(slide?.bgColor || slideBgColor || "000000");
  }, [slideIndex, slide?.bgColor, slideBgColor]);

  // Move-mode dragging state for overlay
  const overlayDragging = useRef(false);
  const overlayDragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // Keyboard navigation — skip when editing text
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && canPrev) onPrev();
      if (e.key === "ArrowRight" && canNext) onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onPrev, onNext, canPrev, canNext]);

  // ── Derived ──
  const isImageOnly = textDensity === 0;
  const layoutId: SlideLayoutId = slide
    ? layoutMode === "fixed"
      ? globalLayout || "single"
      : slide.slideLayout || globalLayout || "single"
    : "single";
  const layoutDef = SLIDE_LAYOUTS.find((l) => l.id === layoutId);
  const expectedImages = layoutDef?.imageCount ?? 1;
  const effectiveBg = slide?.bgColor || slideBgColor || "000000";
  const bgHex = `#${effectiveBg}`;
  const bgIsDark = isDarkColor(effectiveBg);
  const accent = slide?.accentColor ? `#${slide.accentColor}` : "#6366F1";
  const accentRaw = slide?.accentColor || "6366F1";

  // ── Callbacks ──
  const updateImageAdj = useCallback(
    (slotIdx: number, adj: ImageAdjustment) => {
      if (!slide) return;
      const adjs = setSlideImageAdjustment(slide, slotIdx, adj);
      updateSlide(slide.index, { imageAdjustments: adjs });
    },
    [slide, updateSlide],
  );
  const resetImageAdj = useCallback(
    (slotIdx: number) => updateImageAdj(slotIdx, { ...DEFAULT_IMAGE_ADJUSTMENT }),
    [updateImageAdj],
  );
  const handleTitleChange = useCallback(
    (v: string) => slide && updateSlide(slide.index, { title: v }),
    [slide, updateSlide],
  );
  const handleSectionChange = useCallback(
    (v: string) => slide && updateSlide(slide.index, { section: v }),
    [slide, updateSlide],
  );
  const handleBulletChange = useCallback(
    (idx: number, v: string) => {
      if (!slide) return;
      const bullets = [...slide.bullets];
      if (v === "" && bullets.length > 1) bullets.splice(idx, 1);
      else bullets[idx] = v;
      updateSlide(slide.index, { bullets });
    },
    [slide, updateSlide],
  );
  const addBullet = useCallback(() => {
    if (!slide) return;
    updateSlide(slide.index, { bullets: [...slide.bullets, ""] });
  }, [slide, updateSlide]);
  const moveBullet = useCallback(
    (idx: number, dir: -1 | 1) => {
      if (!slide) return;
      const bullets = [...slide.bullets];
      const target = idx + dir;
      if (target < 0 || target >= bullets.length) return;
      [bullets[idx], bullets[target]] = [bullets[target], bullets[idx]];
      updateSlide(slide.index, { bullets });
    },
    [slide, updateSlide],
  );
  const deleteBullet = useCallback(
    (idx: number) => {
      if (!slide || slide.bullets.length <= 1) return;
      const bullets = slide.bullets.filter((_, i) => i !== idx);
      updateSlide(slide.index, { bullets });
    },
    [slide, updateSlide],
  );
  const handleNotesChange = useCallback(
    (v: string) => slide && updateSlide(slide.index, { notes: v }),
    [slide, updateSlide],
  );
  const handleAccentChange = useCallback(
    (hex: string) => slide && updateSlide(slide.index, { accentColor: hex }),
    [slide, updateSlide],
  );
  const handleOverlayPositionChange = useCallback(
    (x: number, y: number) => slide && updateSlide(slide.index, { overlayPosition: { x, y } }),
    [slide, updateSlide],
  );
  const resetOverlayPosition = useCallback(
    () => slide && updateSlide(slide.index, { overlayPosition: undefined }),
    [slide, updateSlide],
  );

  const duplicateSlide = useCallback(() => {
    if (!slide || !presentation) return;
    const newSlide: SlideData = {
      ...JSON.parse(JSON.stringify(slide)),
      id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      index: slide.index + 1,
    };
    const slides = [...presentation.slides];
    slides.splice(slide.index + 1, 0, newSlide);
    slides.forEach((s, i) => { s.index = i; });
    setPresentation({ ...presentation, slides });
  }, [slide, presentation, setPresentation]);

  const deleteSlide = useCallback(() => {
    if (!presentation || presentation.slides.length <= 1) return;
    const slides = presentation.slides.filter((_, i) => i !== slideIndex);
    slides.forEach((s, i) => { s.index = i; });
    setPresentation({ ...presentation, slides });
    if (slideIndex >= slides.length && canPrev) onPrev();
  }, [presentation, slideIndex, setPresentation, canPrev, onPrev]);

  if (!slide) return null;

  // ── Image style with adjustments ──
  const imageStyle = (slotIdx: number): React.CSSProperties => {
    return getImageAdjustmentStyle(getAdj(slide, slotIdx));
  };

  // ── Overlay drag handlers ──
  const overlayPos = slide.overlayPosition || { x: 50, y: 85 };

  const handleOverlayPointerDown = (e: React.PointerEvent) => {
    if (mode !== "move") return;
    e.preventDefault();
    e.stopPropagation();
    overlayDragging.current = true;
    overlayDragStart.current = { x: e.clientX, y: e.clientY, ox: overlayPos.x, oy: overlayPos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const handleOverlayPointerMove = (e: React.PointerEvent) => {
    if (!overlayDragging.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const dx = ((e.clientX - overlayDragStart.current.x) / rect.width) * 100;
    const dy = ((e.clientY - overlayDragStart.current.y) / rect.height) * 100;
    const nx = Math.max(5, Math.min(95, overlayDragStart.current.ox + dx));
    const ny = Math.max(5, Math.min(95, overlayDragStart.current.oy + dy));
    handleOverlayPositionChange(Math.round(nx), Math.round(ny));
  };
  const handleOverlayPointerUp = () => { overlayDragging.current = false; };

  // ── Render image slot ──
  const renderImgSlot = (idx: number, className?: string, posStyle?: React.CSSProperties) => {
    const url = resolvedUrls[slide.imageUrls[idx]] || slide.imageUrls[idx];
    if (!url) {
      return (
        <div
          key={idx}
          className={`flex items-center justify-center bg-black/20 border border-dashed border-white/20 rounded-lg ${className || ""}`}
          style={posStyle}
        >
          <IconImage size={24} className="text-white/30" />
        </div>
      );
    }
    return (
      <div
        key={idx}
        className={`overflow-hidden rounded-lg cursor-pointer group relative ${className || ""}`}
        style={posStyle}
        onClick={() => { setSelectedImageSlot(idx); setActiveTab("images"); }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="w-full h-full pointer-events-none select-none" draggable={false} style={imageStyle(idx)} />
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 flex items-center justify-center">
          <span className="bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
            <IconCrop size={12} /> {lang === "en" ? "Adjust" : "Ajustar"}
          </span>
        </div>
        {expectedImages > 1 && (
          <div className="absolute top-1.5 left-1.5 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-medium z-10">
            {idx + 1}
          </div>
        )}
      </div>
    );
  };

  // Overlay positioning CSS
  const overlayCSS: React.CSSProperties = {
    position: "absolute",
    left: `${overlayPos.x}%`,
    top: `${overlayPos.y}%`,
    transform: "translate(-50%, -100%)",
    maxWidth: "80%",
    zIndex: 10,
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col select-none">
      {/* ═══ Top toolbar ═══ */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-white/10 shrink-0">
        {/* Left: close + mode toggle */}
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white">
            <IconMinimize size={16} />
          </button>
          <span className="text-white/50 text-xs font-medium">
            {slideIndex + 1} / {presentation?.slides.length}
          </span>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <div className="flex bg-white/5 rounded-lg p-0.5">
            <button
              onClick={() => setMode("edit")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                mode === "edit" ? "bg-blue-500/80 text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              <IconType size={13} />
              {lang === "en" ? "Edit" : "Editar"}
            </button>
            <button
              onClick={() => setMode("move")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                mode === "move" ? "bg-blue-500/80 text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              <IconMove size={13} />
              {lang === "en" ? "Move" : "Mover"}
            </button>
          </div>
        </div>

        {/* Center: nav */}
        <div className="flex items-center gap-1">
          <button disabled={!canPrev} onClick={onPrev} className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-20 transition-colors text-white/60">
            <IconChevronLeft size={16} />
          </button>
          <button disabled={!canNext} onClick={onNext} className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-20 transition-colors text-white/60">
            <IconChevronRight size={16} />
          </button>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1">
          <button onClick={duplicateSlide} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/50 hover:text-white" title={lang === "en" ? "Duplicate slide" : "Duplicar diapositiva"}>
            <IconCopy size={15} />
          </button>
          <button
            onClick={deleteSlide}
            disabled={!presentation || presentation.slides.length <= 1}
            className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors text-white/50 hover:text-red-400 disabled:opacity-20"
            title={lang === "en" ? "Delete slide" : "Eliminar diapositiva"}
          >
            <IconTrash size={15} />
          </button>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ═══ Main body ═══ */}
      <div className="flex-1 min-h-0 flex">
        {/* ── Slide canvas ── */}
        <div className="flex-1 min-w-0 flex items-center justify-center p-6">
          <div
            ref={canvasRef}
            className="w-full max-w-5xl aspect-video rounded-2xl overflow-hidden relative shadow-2xl"
            style={{ backgroundColor: bgHex }}
          >
            {/* ══ IMAGE-ONLY: single full-bleed ══ */}
            {isImageOnly && layoutId === "single" && (
              <div className="absolute inset-0">
                {slide.imageUrls[0] ? (
                  <div
                    className="w-full h-full relative cursor-pointer group"
                    onClick={() => { setSelectedImageSlot(0); setActiveTab("images"); }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={resolvedUrls[slide.imageUrls[0]] || slide.imageUrls[0]} alt="" className="w-full h-full pointer-events-none select-none" draggable={false} style={imageStyle(0)} />
                    <div className="absolute inset-0 bg-black/30" />
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 flex items-center justify-center">
                      <span className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                        <IconCrop size={14} /> {lang === "en" ? "Adjust image" : "Ajustar imagen"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-black/10">
                    <IconImage size={48} className="text-white/20" />
                  </div>
                )}
              </div>
            )}

            {/* ══ IMAGE-ONLY: multi layout ══ */}
            {isImageOnly && layoutId !== "single" && layoutDef && (
              <div className="absolute inset-0 p-2">
                {layoutDef.slots.map((slot, i) =>
                  renderImgSlot(i, "absolute", {
                    left: `${slot.x * 100}%`,
                    top: `${slot.y * 100}%`,
                    width: `${slot.w * 100}%`,
                    height: `${slot.h * 100}%`,
                  })
                )}
              </div>
            )}

            {/* ══ TEXT CONTENT slides ══ */}
            {!isImageOnly && (
              <div className="flex flex-col h-full relative z-10 p-8">
                {/* Section */}
                <EditableText
                  value={slide.section || ""}
                  onChange={handleSectionChange}
                  placeholder={lang === "en" ? "Section name" : "Nombre de sección"}
                  disabled={mode === "move"}
                  className="uppercase tracking-widest font-bold text-xs mb-3 shrink-0"
                  style={{ color: accent, fontFamily: headingFontFamily }}
                />

                {/* Title */}
                <EditableText
                  value={slide.title}
                  onChange={handleTitleChange}
                  placeholder={lang === "en" ? "Slide title" : "Título"}
                  disabled={mode === "move"}
                  className={`font-bold leading-tight text-3xl mb-6 shrink-0 ${bgIsDark ? "text-white" : "text-slate-900"}`}
                  style={{ fontFamily: headingFontFamily }}
                />

                {/* Bullets + images */}
                <div className="flex flex-1 gap-6 min-h-0 overflow-hidden">
                  <div className="flex-1 min-w-0 overflow-auto space-y-1">
                    {slide.bullets.map((b, i) => (
                      <div key={i} className="flex items-start gap-1 group/bullet">
                        {/* Reorder / delete controls */}
                        <div className="flex flex-col shrink-0 mt-0.5 opacity-0 group-hover/bullet:opacity-100 transition-opacity">
                          <button onClick={() => moveBullet(i, -1)} disabled={i === 0} className="text-white/40 hover:text-white/80 disabled:opacity-20 p-0">
                            <ChevronUp size={12} />
                          </button>
                          <button onClick={() => moveBullet(i, 1)} disabled={i === slide.bullets.length - 1} className="text-white/40 hover:text-white/80 disabled:opacity-20 p-0">
                            <ChevronDown size={12} />
                          </button>
                        </div>
                        <span className="mt-1.5 shrink-0 text-lg" style={{ color: accent }}>●</span>
                        <EditableText
                          value={b}
                          onChange={(v) => handleBulletChange(i, v)}
                          placeholder={lang === "en" ? "Bullet point" : "Punto"}
                          disabled={mode === "move"}
                          className={`text-base leading-relaxed flex-1 ${bgIsDark ? "text-slate-300" : "text-slate-600"}`}
                          style={{ fontFamily: bodyFontFamily }}
                        />
                        <button
                          onClick={() => deleteBullet(i)}
                          className="shrink-0 opacity-0 group-hover/bullet:opacity-100 transition-opacity p-0.5 text-red-400/60 hover:text-red-400"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <button onClick={addBullet} className="text-xs text-blue-400/60 hover:text-blue-400 transition-colors mt-1 pl-6 flex items-center gap-1">
                      <IconPlus size={11} /> {lang === "en" ? "Add bullet" : "Añadir punto"}
                    </button>
                  </div>

                  {/* Image slots */}
                  <div className={`w-1/3 shrink-0 grid auto-rows-fr gap-2 ${expectedImages > 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                    {Array.from({ length: Math.min(expectedImages, 4) }).map((_, i) =>
                      renderImgSlot(i, "min-h-0")
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ══ Draggable title overlay for image-only ══ */}
            {isImageOnly && (
              <div
                className={`${mode === "move" ? "cursor-move ring-2 ring-blue-400/50 ring-dashed rounded-lg" : ""} px-4 py-2 transition-all`}
                style={overlayCSS}
                onPointerDown={handleOverlayPointerDown}
                onPointerMove={handleOverlayPointerMove}
                onPointerUp={handleOverlayPointerUp}
              >
                {mode === "move" && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-[8px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap">
                    {lang === "en" ? "Drag to move" : "Arrastra para mover"}
                  </div>
                )}
                <div className="bg-gradient-to-t from-black/60 to-transparent rounded-lg px-3 py-2">
                  <EditableText
                    value={slide.section || ""}
                    onChange={handleSectionChange}
                    placeholder={lang === "en" ? "Section" : "Sección"}
                    disabled={mode === "move"}
                    className="text-[10px] uppercase tracking-widest font-bold block mb-1"
                    style={{ color: `#${overlaySectionColor || "D1D5DB"}`, fontFamily: headingFontFamily }}
                  />
                  <EditableText
                    value={slide.title}
                    onChange={handleTitleChange}
                    placeholder={lang === "en" ? "Title" : "Título"}
                    disabled={mode === "move"}
                    className="text-lg font-bold leading-tight"
                    style={{ color: `#${overlayTitleColor || "FFFFFF"}`, fontFamily: headingFontFamily }}
                  />
                </div>
              </div>
            )}

            {/* Accent bar */}
            <div className="absolute bottom-0 left-0 right-0 h-1 z-20" style={{ backgroundColor: accent }} />
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="w-80 shrink-0 bg-zinc-900 border-l border-white/10 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-white/10 shrink-0">
            {([
              { id: "style" as PanelTab, icon: <Paintbrush size={13} />, label: lang === "en" ? "Style" : "Estilo" },
              { id: "images" as PanelTab, icon: <IconCrop size={13} />, label: lang === "en" ? "Images" : "Imágenes" },
              { id: "notes" as PanelTab, icon: <StickyNote size={13} />, label: lang === "en" ? "Notes" : "Notas" },
              { id: "slide" as PanelTab, icon: <Layers size={13} />, label: lang === "en" ? "Slide" : "Diap." },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 px-1 py-2 text-[10px] font-medium transition-colors flex flex-col items-center gap-0.5 ${
                  activeTab === tab.id ? "text-blue-400 bg-white/5" : "text-white/40 hover:text-white/70"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">
            {/* ── STYLE TAB ── */}
            {activeTab === "style" && (
              <div className="space-y-5">
                <MiniColorPicker
                  value={accentRaw}
                  presets={COLOR_PRESETS}
                  onChange={handleAccentChange}
                  label={lang === "en" ? "Accent color" : "Color de acento"}
                />
                <button
                  onClick={() => updateAllSlidesAccent(accentRaw)}
                  className="w-full py-1.5 rounded-lg text-[10px] font-medium bg-white/5 border border-white/10 text-white/60 hover:text-white hover:border-white/30 transition-colors"
                >
                  {lang === "en" ? "Apply accent to all slides" : "Aplicar acento a todas"}
                </button>
                <MiniColorPicker
                  value={bgPickerColor}
                  presets={BG_PRESETS}
                  onChange={setBgPickerColor}
                  label={lang === "en" ? "Background" : "Fondo"}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (slide) updateSlide(slide.index, { bgColor: bgPickerColor });
                    }}
                    className="flex-1 py-1.5 rounded-lg text-[10px] font-medium bg-white/5 border border-white/10 text-white/60 hover:text-white hover:border-white/30 transition-colors"
                  >
                    {lang === "en" ? "Apply to this slide" : "Aplicar a esta"}
                  </button>
                  <button
                    onClick={() => {
                      setSlideBgColor(bgPickerColor);
                      if (presentation) {
                        presentation.slides.forEach((s) => {
                          updateSlide(s.index, { bgColor: undefined });
                        });
                      }
                    }}
                    className="flex-1 py-1.5 rounded-lg text-[10px] font-medium bg-white/5 border border-white/10 text-white/60 hover:text-white hover:border-white/30 transition-colors"
                  >
                    {lang === "en" ? "Apply to all" : "Aplicar a todas"}
                  </button>
                </div>
                {isImageOnly && (
                  <>
                    <MiniColorPicker
                      value={overlayTitleColor || "FFFFFF"}
                      presets={COLOR_PRESETS}
                      onChange={setOverlayTitleColor}
                      label={lang === "en" ? "Title overlay color" : "Color título overlay"}
                    />
                    <MiniColorPicker
                      value={overlaySectionColor || "D1D5DB"}
                      presets={COLOR_PRESETS}
                      onChange={setOverlaySectionColor}
                      label={lang === "en" ? "Section overlay color" : "Color sección overlay"}
                    />
                    {slide.overlayPosition && (
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-white/40">
                          {lang === "en" ? "Text position" : "Posición texto"}: {overlayPos.x}%, {overlayPos.y}%
                        </span>
                        <button onClick={resetOverlayPosition} className="text-[10px] text-blue-400/60 hover:text-blue-400 transition-colors flex items-center gap-1">
                          <IconReset size={10} /> {lang === "en" ? "Reset" : "Reiniciar"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── IMAGES TAB ── */}
            {activeTab === "images" && (
              <div className="space-y-4">
                <h4 className="text-[10px] text-white/40 font-medium uppercase tracking-wider">
                  {lang === "en"
                    ? `${expectedImages} image slot${expectedImages > 1 ? "s" : ""}`
                    : `${expectedImages} ${expectedImages > 1 ? "ranuras" : "ranura"} de imagen`}
                </h4>
                {expectedImages > 1 && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {Array.from({ length: expectedImages }).map((_, i) => {
                      const url = resolvedUrls[slide.imageUrls[i]] || slide.imageUrls[i];
                      return (
                        <button
                          key={i}
                          onClick={() => setSelectedImageSlot(i)}
                          className={`aspect-video rounded-lg overflow-hidden border-2 transition-all ${
                            selectedImageSlot === i ? "border-blue-400 ring-1 ring-blue-400/30" : "border-white/10 hover:border-white/30"
                          }`}
                        >
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt="" className="w-full h-full" style={imageStyle(i)} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-white/5">
                              <span className="text-[9px] text-white/30">{i + 1}</span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {expectedImages <= 1 && (
                  <div className="text-[10px] text-white/30 italic">
                    {lang === "en" ? "Single image layout" : "Diseño de imagen única"}
                  </div>
                )}
                {slide.imageUrls[selectedImageSlot] ? (
                  <>
                    <ImageAdjuster
                      url={resolvedUrls[slide.imageUrls[selectedImageSlot]] || slide.imageUrls[selectedImageSlot]}
                      adj={getAdj(slide, selectedImageSlot)}
                      onChange={(a) => updateImageAdj(selectedImageSlot, a)}
                      onReset={() => resetImageAdj(selectedImageSlot)}
                      lang={lang}
                    />
                    {/* Clear image slot */}
                    <button
                      onClick={() => {
                        const newUrls = [...slide.imageUrls];
                        newUrls[selectedImageSlot] = "";
                        const newSources = [...(slide.imageSources || [])];
                        newSources[selectedImageSlot] = "";
                        updateSlide(slide.index, {
                          imageUrls: newUrls,
                          imageSources: newSources,
                          imageAdjustments: setSlideImageAdjustment(slide, selectedImageSlot, DEFAULT_IMAGE_ADJUSTMENT),
                        });
                      }}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-500/10 text-red-400/80 hover:bg-red-500/20 hover:text-red-400 transition-colors text-xs"
                    >
                      <IconTrash size={12} />
                      {lang === "en" ? "Clear image from slot" : "Vaciar imagen de la ranura"}
                    </button>
                  </>
                ) : (
                  <div className="text-center py-8 text-white/30 text-xs">
                    <IconImage size={28} className="mx-auto mb-2" />
                    {lang === "en" ? "No image in slot " : "Sin imagen en ranura "}{selectedImageSlot + 1}
                  </div>
                )}
                <div className="text-[10px] text-white/30 space-y-0.5 pt-2 border-t border-white/5">
                  <div>{lang === "en" ? "Images loaded" : "Imágenes cargadas"}: {slide.imageUrls.filter(Boolean).length} / {expectedImages}</div>
                  {getAdj(slide, selectedImageSlot).scale > 1 && (
                    <div>Zoom: {Math.round(getAdj(slide, selectedImageSlot).scale * 100)}%</div>
                  )}
                </div>
              </div>
            )}

            {/* ── NOTES TAB ── */}
            {activeTab === "notes" && (
              <div className="space-y-3">
                <h4 className="text-[10px] text-white/40 font-medium uppercase tracking-wider">
                  {lang === "en" ? "Presenter Notes" : "Notas del presentador"}
                </h4>
                <textarea
                  value={slide.notes || ""}
                  onChange={(e) => handleNotesChange(e.target.value)}
                  placeholder={lang === "en" ? "Add presenter notes..." : "Añadir notas del presentador..."}
                  className="w-full h-64 bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white/80 placeholder-white/30 resize-none outline-none focus:border-blue-400/50"
                  style={{ textAlign: "justify" }}
                />
                <div className="text-[10px] text-white/30">
                  {(slide.notes || "").length > 0
                    ? `${(slide.notes || "").split(/\s+/).filter(Boolean).length} ${lang === "en" ? "words" : "palabras"}`
                    : lang === "en" ? "No notes yet" : "Sin notas aún"}
                </div>
              </div>
            )}

            {/* ── SLIDE TAB ── */}
            {activeTab === "slide" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h4 className="text-[10px] text-white/40 font-medium uppercase tracking-wider">
                    {lang === "en" ? "Slide Info" : "Info de diapositiva"}
                  </h4>
                  <div className="bg-white/5 rounded-lg p-3 space-y-1.5 text-xs text-white/60">
                    <div className="flex justify-between">
                      <span>{lang === "en" ? "Index" : "Índice"}</span>
                      <span className="text-white/80 font-mono">{slideIndex + 1}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{lang === "en" ? "Layout" : "Diseño"}</span>
                      <span className="text-white/80">{layoutId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{lang === "en" ? "Images" : "Imágenes"}</span>
                      <span className="text-white/80">{slide.imageUrls.filter(Boolean).length} / {expectedImages}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{lang === "en" ? "Bullets" : "Puntos"}</span>
                      <span className="text-white/80">{slide.bullets.length}</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="text-[10px] text-white/40 font-medium uppercase tracking-wider">
                    {lang === "en" ? "Actions" : "Acciones"}
                  </h4>
                  <button onClick={duplicateSlide} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-xs text-white/70 hover:text-white">
                    <IconCopy size={14} />
                    {lang === "en" ? "Duplicate slide" : "Duplicar diapositiva"}
                  </button>
                  <button
                    onClick={deleteSlide}
                    disabled={!presentation || presentation.slides.length <= 1}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-red-500/20 transition-colors text-xs text-white/70 hover:text-red-400 disabled:opacity-30"
                  >
                    <IconTrash size={14} />
                    {lang === "en" ? "Delete slide" : "Eliminar diapositiva"}
                  </button>
                </div>
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <h4 className="text-[10px] text-white/40 font-medium uppercase tracking-wider">
                    {lang === "en" ? "Shortcuts" : "Atajos"}
                  </h4>
                  <div className="space-y-1 text-[10px] text-white/40">
                    <div className="flex justify-between"><span>←/→</span><span>{lang === "en" ? "Navigate slides" : "Navegar"}</span></div>
                    <div className="flex justify-between"><span>Esc</span><span>{lang === "en" ? "Close editor" : "Cerrar"}</span></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
