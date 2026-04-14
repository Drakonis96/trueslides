"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useManualStore, ManualSlide, ManualSlideElement, ManualPresentation, ManualLayoutId, PREDEFINED_TEMPLATES, PredefinedTemplateId } from "@/lib/manual-store";
import { useAppStore } from "@/lib/store";
import { DEFAULT_IMAGE_ADJUSTMENT, getImageAdjustmentStyle, getMaxImageOffset, OBJECT_FIT_OPTIONS } from "@/lib/image-adjustments";
import { prefetchImageBlob, getCachedBlobAsBase64, setCachedBlob } from "@/lib/image-blob-cache";
import { UI_TEXT } from "@/lib/presets";
import { LAYOUT_LABELS, LayoutThumbnail } from "./LayoutSelector";
import {
  IconPlus, IconCopy, IconTrash, IconImage, IconSearch,
  IconFullscreen, IconMinimize, IconSparkles, IconLoader,
  IconChevronLeft, IconChevronRight, IconType,
  IconPencil, IconDownload, IconSettings, IconMove, IconUpload,
  IconZoomIn, IconZoomOut, IconCheck, IconWarning, IconSave, IconImageOff,
} from "./Icons";
import ImageSearchModal from "./ImageSearchModal";
import AINotesModal from "./AINotesModal";
import ConfirmModal from "./ConfirmModal";
import PptxImportModal from "./PptxImportModal";
import { Undo2, Redo2, ChevronUp, ChevronDown, Layers, Presentation } from "lucide-react";
import { SLIDE_LAYOUTS, PresentationData, SlideData, ShapeKind, ConnectorStyle, ArrowHead } from "@/lib/types";
import ReactMarkdown from "react-markdown";

type AlignmentTarget = "left" | "center" | "right" | "top" | "middle" | "bottom";
type GuideState = { vertical: number[]; horizontal: number[] };
type GridPreset = "none" | "basic" | "thirds" | "quarters" | "sixths";

const DEFAULT_GUIDES: GuideState = { vertical: [], horizontal: [] };
const GUIDE_SNAP_THRESHOLD = 1.2;

const GRID_PRESETS: { id: GridPreset; label: { en: string; es: string } }[] = [
  { id: "none", label: { en: "None", es: "Ninguna" } },
  { id: "basic", label: { en: "Basic", es: "Básica" } },
  { id: "thirds", label: { en: "Thirds", es: "Tercios" } },
  { id: "quarters", label: { en: "Quarters", es: "Cuartos" } },
  { id: "sixths", label: { en: "Sixths", es: "Sextos" } },
];

function getGridLines(preset: GridPreset): { vertical: number[]; horizontal: number[] } {
  switch (preset) {
    case "none": return { vertical: [], horizontal: [] };
    case "basic": return { vertical: [8, 50, 92], horizontal: [10, 50, 90] };
    case "thirds": return { vertical: [33.33, 66.67], horizontal: [33.33, 66.67] };
    case "quarters": return { vertical: [25, 50, 75], horizontal: [25, 50, 75] };
    case "sixths": return { vertical: [16.67, 33.33, 50, 66.67, 83.33], horizontal: [16.67, 33.33, 50, 66.67, 83.33] };
  }
}

const CONNECTOR_STYLES: { id: ConnectorStyle; label: { en: string; es: string }; icon: string }[] = [
  { id: "straight", label: { en: "Straight", es: "Recta" }, icon: "╱" },
  { id: "elbow", label: { en: "Elbow", es: "Codo" }, icon: "└" },
  { id: "curved", label: { en: "Curved", es: "Curva" }, icon: "⌒" },
];

const MANUAL_LAYOUTS = SLIDE_LAYOUTS;

function layoutLabel(id: ManualLayoutId, lang: "en" | "es"): string {
  return LAYOUT_LABELS[id]?.[lang] ?? id;
}

function MarkdownText({ content, className }: { content: string; className?: string }) {
  return (
    <ReactMarkdown
      className={className}
      components={{
        p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
        ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5">{children}</ol>,
        ul: ({ children }) => <ul className="list-disc pl-4 space-y-0.5">{children}</ul>,
        li: ({ children }) => <li>{children}</li>,
        strong: ({ children }) => <strong className="font-bold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildDefaultElement(
  slide: ManualSlide,
  type: ManualSlideElement["type"],
): ManualSlideElement {
  const title = slide.elements.find((element) => element.type === "title");
  const subtitle = slide.elements.find((element) => element.type === "subtitle");
  const hasImage = slide.elements.some((element) => element.type === "image");
  const baseZ = Math.max(1, ...slide.elements.map((element) => element.zIndex || 1)) + 1;
  const defaultY = title ? clamp(title.y + title.h + 4, 14, 78) : 12;

  switch (type) {
    case "title":
      return {
        id: crypto.randomUUID(),
        type,
        x: 4,
        y: subtitle ? clamp(subtitle.y - 16, 4, 68) : 72,
        w: 75,
        h: 14,
        content: "New Title",
        fontSize: 32,
        fontWeight: "bold",
        color: "FFFFFF",
        zIndex: baseZ,
      };
    case "subtitle":
      return {
        id: crypto.randomUUID(),
        type,
        x: 4,
        y: title ? clamp(title.y + title.h + 1, 18, 88) : 86,
        w: 75,
        h: 8,
        content: "Subtitle",
        fontSize: 18,
        color: "D1D5DB",
        zIndex: baseZ,
      };
    case "bullets":
      return {
        id: crypto.randomUUID(),
        type,
        x: 8,
        y: subtitle ? clamp(subtitle.y + subtitle.h + 4, 20, 78) : defaultY + 8,
        w: hasImage ? 40 : 84,
        h: hasImage ? 48 : 58,
        content: "Point 1\nPoint 2",
        fontSize: 18,
        zIndex: baseZ,
      };
    case "image":
      return {
        id: crypto.randomUUID(),
        type,
        x: hasImage ? 12 : 54,
        y: title ? 18 : 12,
        w: hasImage ? 42 : 38,
        h: 54,
        content: "",
        fontSize: 14,
        zIndex: baseZ,
      };
    case "text":
    default:
      return {
        id: crypto.randomUUID(),
        type: "text",
        x: 8,
        y: defaultY,
        w: hasImage ? 40 : 46,
        h: 16,
        content: "Text block",
        fontSize: 16,
        zIndex: baseZ,
      };
    case "youtube":
      return {
        id: crypto.randomUUID(),
        type: "youtube",
        x: 15,
        y: 15,
        w: 50,
        h: 50,
        content: "",
        youtubeUrl: "",
        zIndex: baseZ,
      };
  }
}

const SHAPE_KINDS: { id: ShapeKind; label: { en: string; es: string }; icon: string }[] = [
  { id: "rectangle", label: { en: "Rectangle", es: "Rectángulo" }, icon: "▬" },
  { id: "rounded-rect", label: { en: "Rounded Rect", es: "Rect. Redondeado" }, icon: "▢" },
  { id: "ellipse", label: { en: "Ellipse", es: "Elipse" }, icon: "●" },
  { id: "line", label: { en: "Line", es: "Línea" }, icon: "─" },
];

function buildShapeElement(slide: ManualSlide, kind: ShapeKind): ManualSlideElement {
  const baseZ = Math.max(1, ...slide.elements.map((el) => el.zIndex || 1)) + 1;
  const isLine = kind === "line";
  return {
    id: crypto.randomUUID(),
    type: "shape",
    x: 20,
    y: isLine ? 48 : 25,
    w: isLine ? 60 : 30,
    h: isLine ? 4 : 30,
    content: "",
    zIndex: baseZ,
    shapeKind: kind,
    shapeFill: "6366F1",
    shapeOpacity: 100,
    shapeBorderColor: "",
    shapeBorderWidth: 0,
  };
}

function buildConnectorElement(slide: ManualSlide, style: ConnectorStyle): ManualSlideElement {
  const baseZ = Math.max(1, ...slide.elements.map((el) => el.zIndex || 1)) + 1;
  return {
    id: crypto.randomUUID(),
    type: "connector",
    x: 20,
    y: 45,
    w: 40,
    h: 10,
    content: "",
    zIndex: baseZ,
    connectorStyle: style,
    arrowStart: "none",
    arrowEnd: "arrow",
    connectorColor: "6366F1",
    connectorWidth: 2,
  };
}

/** Extract YouTube video ID from various URL formats */
function extractYoutubeVideoId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/** Convert a YouTube URL to an embed URL */
function toYoutubeEmbedUrl(url: string): string | null {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) return null;
  return `https://www.youtube.com/embed/${videoId}`;
}

/** Get a YouTube thumbnail URL from a video ID */
function getYoutubeThumbnail(url: string): string | null {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) return null;
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

function alignElement(element: ManualSlideElement, target: AlignmentTarget): Partial<ManualSlideElement> {
  switch (target) {
    case "left":
      return { x: 0 };
    case "center":
      return { x: roundTenths((100 - element.w) / 2) };
    case "right":
      return { x: roundTenths(100 - element.w) };
    case "top":
      return { y: 0 };
    case "middle":
      return { y: roundTenths((100 - element.h) / 2) };
    case "bottom":
      return { y: roundTenths(100 - element.h) };
  }
}

function shiftLayer(element: ManualSlideElement, delta: number): Partial<ManualSlideElement> {
  return { zIndex: clamp((element.zIndex || 1) + delta, 0, 100) };
}

function snapDragPosition(element: ManualSlideElement, nextX: number, nextY: number): { x: number; y: number; guides: GuideState } {
  const guides: GuideState = { vertical: [], horizontal: [] };
  let x = roundTenths(clamp(nextX, 0, 100 - element.w));
  let y = roundTenths(clamp(nextY, 0, 100 - element.h));
  const xTargets = [
    { guide: 0, value: x },
    { guide: 50, value: x + element.w / 2 },
    { guide: 100, value: x + element.w },
  ];
  const yTargets = [
    { guide: 0, value: y },
    { guide: 50, value: y + element.h / 2 },
    { guide: 100, value: y + element.h },
  ];

  for (const target of xTargets) {
    if (Math.abs(target.value - target.guide) <= GUIDE_SNAP_THRESHOLD) {
      if (target.guide === 0) x = 0;
      if (target.guide === 50) x = roundTenths(50 - element.w / 2);
      if (target.guide === 100) x = roundTenths(100 - element.w);
      guides.vertical.push(target.guide);
      break;
    }
  }

  for (const target of yTargets) {
    if (Math.abs(target.value - target.guide) <= GUIDE_SNAP_THRESHOLD) {
      if (target.guide === 0) y = 0;
      if (target.guide === 50) y = roundTenths(50 - element.h / 2);
      if (target.guide === 100) y = roundTenths(100 - element.h);
      guides.horizontal.push(target.guide);
      break;
    }
  }

  return { x, y, guides };
}

// ── Slide thumbnail preview ──
function SlideThumbnail({ slide, index, isSelected, isMultiSelected, onClick }: {
  slide: ManualSlide;
  index: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full aspect-[16/9] rounded-lg border-2 transition-all relative overflow-hidden group ${
        isMultiSelected
          ? "border-blue-500 ring-2 ring-blue-500/30"
          : isSelected
          ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30"
          : "border-[var(--border)] hover:border-[var(--accent)]/50"
      }`}
      style={{ backgroundColor: `#${slide.bgColor}` }}
    >
      {/* Multi-select checkmark */}
      {isMultiSelected && (
        <div className="absolute top-1 left-1 z-10 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}
      {/* Mini element preview */}
      {slide.elements.map((el) => (
        <div
          key={el.id}
          className="absolute overflow-hidden"
          style={{
            left: `${el.x}%`, top: `${el.y}%`,
            width: `${el.w}%`, height: `${el.h}%`,
          }}
        >
          {el.type === "image" && el.content ? (
            <img src={el.thumbnailUrl || el.content} alt="" className="w-full h-full" style={getImageAdjustmentStyle(el.imageAdjustment)} />
          ) : el.type === "image" ? (
            <div className="w-full h-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
              <IconImage size={8} className="text-gray-400" />
            </div>
          ) : el.type === "connector" ? (
            <svg width="100%" height="100%" className="absolute inset-0">
              <line x1="0" y1="50%" x2="100%" y2="50%" stroke={`#${el.connectorColor || "6366F1"}`} strokeWidth={Math.max(1, (el.connectorWidth || 2) * 0.3)} />
            </svg>
          ) : el.type === "youtube" ? (
            el.youtubeUrl ? (
              <div className="w-full h-full relative bg-black">
                <img src={`https://img.youtube.com/vi/${extractYoutubeVideoId(el.youtubeUrl) || ""}/default.jpg`} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-4 h-3 bg-red-600 rounded flex items-center justify-center">
                    <svg width="5" height="5" viewBox="0 0 24 24" fill="white"><polygon points="9.5 7.5 16.5 12 9.5 16.5" /></svg>
                  </div>
                </div>
              </div>
            ) : (
              <div className="w-full h-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="4" /></svg>
              </div>
            )
          ) : (
            <div
              className="text-[3px] leading-tight overflow-hidden"
              style={{
                fontWeight: el.fontWeight || "normal",
                color: el.color ? `#${el.color}` : undefined,
              }}
            >
              <MarkdownText content={el.content.split("\n").slice(0, 2).join("\n")} />
            </div>
          )}
        </div>
      ))}
      {/* Slide number badge */}
      <span className="absolute bottom-0.5 right-1 text-[9px] font-medium text-[var(--muted)] bg-white/80 dark:bg-black/50 rounded px-1">
        {index + 1}
      </span>
    </button>
  );
}

// ── Draggable/resizable element on canvas ──
function CanvasElement({ element, isSelected, scale, onSelect, onUpdate, onDoubleClick, onGuideChange, onSettingsClick, onChangeClick, onImageDrop, isEditing, onEditStart, onEditEnd }: {
  element: ManualSlideElement;
  isSelected: boolean;
  scale: number;
  onSelect: (event?: React.MouseEvent) => void;
  onUpdate: (updates: Partial<ManualSlideElement>) => void;
  onDoubleClick: () => void;
  onGuideChange?: (guides: GuideState) => void;
  onSettingsClick?: () => void;
  onChangeClick?: () => void;
  onImageDrop?: (dataUrl: string) => void;
  isEditing?: boolean;
  onEditStart?: () => void;
  onEditEnd?: (content: string) => void;
}) {
  const dragRef = useRef<{ startX: number; startY: number; elX: number; elY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; elW: number; elH: number; corner: string } | null>(null);
  const rotateRef = useRef<{ centerX: number; centerY: number; startAngle: number; elRotation: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inlineTextRef = useRef<HTMLTextAreaElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [editDraft, setEditDraft] = useState(element.content);
  const isTextType = element.type === "title" || element.type === "subtitle" || element.type === "text" || element.type === "bullets";

  // Sync draft when element content changes externally
  useEffect(() => {
    if (!isEditing) setEditDraft(element.content);
  }, [element.content, isEditing]);

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && inlineTextRef.current) {
      inlineTextRef.current.focus();
      const len = inlineTextRef.current.value.length;
      inlineTextRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const readFileAsDataUrl = useCallback((file: File) => {
    if (!file.type.startsWith("image/") && file.type !== "") return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onImageDrop?.(reader.result);
    };
    reader.readAsDataURL(file);
  }, [onImageDrop]);

  const fetchExternalImageAsDataUrl = useCallback(async (url: string) => {
    // data: URLs can be used directly
    if (url.startsWith("data:image/")) {
      onImageDrop?.(url);
      return;
    }
    try {
      const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
      if (!res.ok) return;
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") onImageDrop?.(reader.result);
      };
      reader.readAsDataURL(blob);
    } catch { /* ignore fetch errors */ }
  }, [onImageDrop]);

  const extractImageUrl = useCallback((e: React.DragEvent): string | null => {
    // Decode HTML entities (&amp; &lt; &gt; &quot; &#39; &#xNN;)
    const decodeHtmlEntities = (s: string) =>
      s.replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
       .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
       .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
       .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));

    // 1. Try text/html first — <img src> is most reliable for cross-browser image drags
    const html = e.dataTransfer.getData("text/html");
    if (html) {
      const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m?.[1]) {
        const src = decodeHtmlEntities(m[1]);
        if (src.startsWith("data:image/")) return src;
        if (/^https?:\/\//i.test(src)) return src;
      }
    }
    // 2. Try text/uri-list
    const uriList = e.dataTransfer.getData("text/uri-list");
    if (uriList) {
      const firstUrl = uriList.split(/\r?\n/).find(l => l && !l.startsWith("#"));
      if (firstUrl && /^https?:\/\//i.test(firstUrl)) return firstUrl;
    }
    // 3. Try text/plain if it looks like an image URL
    const plain = e.dataTransfer.getData("text/plain");
    if (plain && /^https?:\/\/\S+/i.test(plain.trim())) {
      return plain.trim();
    }
    return null;
  }, []);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (element.type !== "image") return;
    // Prefer local image files
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) { readFileAsDataUrl(file); return; }
    // Try extracting a URL from the drag data
    const url = extractImageUrl(e);
    if (url) { fetchExternalImageAsDataUrl(url); return; }
    // Last resort: try file even without MIME type (some browsers omit it)
    if (file) readFileAsDataUrl(file);
  }, [element.type, readFileAsDataUrl, extractImageUrl, fetchExternalImageAsDataUrl]);

  const handleFileDragOver = useCallback((e: React.DragEvent) => {
    if (element.type !== "image") return;
    const types = e.dataTransfer.types;
    if (types.includes("Files") || types.includes("text/uri-list") || types.includes("text/html")) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    }
  }, [element.type]);

  const handleFileDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFileAsDataUrl(file);
    e.target.value = "";
  }, [readFileAsDataUrl]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const moveHandle = target.closest("[data-move-handle='true']");
    const noDragEl = target.closest("[data-no-drag]");
    if (noDragEl && noDragEl.getAttribute("data-no-drag") === "true") {
      e.stopPropagation();
      return;
    }
    // If editing inline, only allow drag from the explicit move handle.
    if (isEditing && !moveHandle) return;
    if (isEditing && moveHandle) {
      onEditEnd?.(editDraft);
    }
    if (isTextType && !moveHandle) {
      e.stopPropagation();
      onSelect(e);
      if (!(e.metaKey || e.ctrlKey || e.shiftKey)) {
        onEditStart?.();
      }
      return;
    }
    e.stopPropagation();
    onSelect(e);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      elX: element.x,
      elY: element.y,
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ((ev.clientX - dragRef.current.startX) / scale) * (100 / 960);
      const dy = ((ev.clientY - dragRef.current.startY) / scale) * (100 / 540);
      const snapped = snapDragPosition(element, dragRef.current.elX + dx, dragRef.current.elY + dy);
      onGuideChange?.(snapped.guides);
      onUpdate({ x: snapped.x, y: snapped.y });
    };

    const onUp = () => {
      dragRef.current = null;
      onGuideChange?.(DEFAULT_GUIDES);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [editDraft, element, isEditing, isTextType, onEditEnd, onEditStart, scale, onSelect, onUpdate, onGuideChange]);

  const handleResizeDown = useCallback((e: React.MouseEvent, corner: string) => {
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      elW: element.w,
      elH: element.h,
      corner,
    };

    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = ((ev.clientX - resizeRef.current.startX) / scale) * (100 / 960);
      const dy = ((ev.clientY - resizeRef.current.startY) / scale) * (100 / 540);
      let newW = resizeRef.current.elW;
      let newH = resizeRef.current.elH;

      if (corner.includes("r")) newW = Math.max(5, resizeRef.current.elW + dx);
      if (corner.includes("b")) newH = Math.max(5, resizeRef.current.elH + dy);
      if (corner.includes("l")) newW = Math.max(5, resizeRef.current.elW - dx);
      if (corner.includes("t")) newH = Math.max(5, resizeRef.current.elH - dy);

      const updates: Partial<ManualSlideElement> = {
        w: Math.round(Math.min(100, newW) * 10) / 10,
        h: Math.round(Math.min(100, newH) * 10) / 10,
      };

      if (corner.includes("l")) {
        updates.x = Math.max(0, element.x + (element.w - updates.w!));
      }
      if (corner.includes("t")) {
        updates.y = Math.max(0, element.y + (element.h - updates.h!));
      }

      onUpdate(updates);
    };

    const onUp = () => {
      resizeRef.current = null;
      onGuideChange?.(DEFAULT_GUIDES);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [element.x, element.y, element.w, element.h, scale, onUpdate, onGuideChange]);

  const handleRotateDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Calculate center of element in viewport coords
    const parent = (e.target as HTMLElement).closest("[data-canvas-element]");
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);

    rotateRef.current = {
      centerX,
      centerY,
      startAngle,
      elRotation: element.rotation || 0,
    };

    const onMove = (ev: MouseEvent) => {
      if (!rotateRef.current) return;
      const angle = Math.atan2(ev.clientY - rotateRef.current.centerY, ev.clientX - rotateRef.current.centerX) * (180 / Math.PI);
      let newRotation = rotateRef.current.elRotation + (angle - rotateRef.current.startAngle);
      // Snap to 0/45/90/135/180/225/270/315 when within 3 degrees
      if (ev.shiftKey) {
        newRotation = Math.round(newRotation / 45) * 45;
      }
      // Normalize to 0-360
      newRotation = ((newRotation % 360) + 360) % 360;
      onUpdate({ rotation: Math.round(newRotation * 10) / 10 });
    };

    const onUp = () => {
      rotateRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [element.rotation, onUpdate]);

  const renderContent = () => {
    if (element.type === "image") {
      const dropOverlay = isDragOver && (
        <div className="absolute inset-0 z-30 bg-[var(--accent)]/20 border-2 border-dashed border-[var(--accent)] rounded flex items-center justify-center pointer-events-none">
          <div className="bg-[var(--accent)] text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5">
            <IconUpload size={14} /> Drop image
          </div>
        </div>
      );
      if (element.content) {
        return (
          <>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInputChange} />
            <img src={element.content} alt="" className="w-full h-full" style={getImageAdjustmentStyle(element.imageAdjustment)} />
            {dropOverlay}
            {isSelected && (
              <div className="absolute top-1 right-1 flex gap-1 z-40" data-no-drag="true">
                <div
                  className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white transition-colors cursor-move"
                  title="Drag to move"
                  data-no-drag="false"
                  data-move-handle="true"
                >
                  <IconMove size={13} />
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onSettingsClick?.(); }}
                  className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white transition-colors"
                  title="Settings"
                >
                  <IconSettings size={13} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onChangeClick?.(); }}
                  className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white transition-colors"
                  title="Search image"
                >
                  <IconSearch size={13} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white transition-colors"
                  title="Upload image"
                >
                  <IconUpload size={13} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onUpdate({ content: "", imageSource: undefined, imageAdjustment: undefined }); }}
                  className="p-1.5 rounded-md bg-black/60 hover:bg-red-600/80 text-white transition-colors"
                  title="Clear image"
                >
                  <IconImageOff size={13} />
                </button>
              </div>
            )}
          </>
        );
      }
      return (
        <div
          className={`w-full h-full bg-gray-100 dark:bg-gray-800 border-2 border-dashed ${
            isDragOver
              ? "border-[var(--accent)] bg-[var(--accent)]/10"
              : "border-gray-300 dark:border-gray-600"
          } flex flex-col items-center justify-center gap-2 text-[var(--muted)] transition-colors`}
        >
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInputChange} />
          {isDragOver ? (
            <div className="flex flex-col items-center gap-2 pointer-events-none">
              <IconUpload size={28} className="text-[var(--accent)]" />
              <span className="text-xs text-[var(--accent)] font-medium">Drop image here</span>
            </div>
          ) : isSelected ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-1">
                <button
                  className="p-2 rounded-lg bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 text-[var(--accent)] transition-colors cursor-pointer"
                  data-no-drag="true"
                  onClick={(e) => { e.stopPropagation(); onChangeClick?.(); }}
                >
                  <IconSearch size={20} />
                </button>
                <span className="text-[10px]">Search</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <button
                  className="p-2 rounded-lg bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 text-[var(--accent)] transition-colors cursor-pointer"
                  data-no-drag="true"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                >
                  <IconUpload size={20} />
                </button>
                <span className="text-[10px]">Upload</span>
              </div>
            </div>
          ) : (
            <>
              <IconImage size={28} className="opacity-30" />
              <span className="text-xs opacity-50">Click to select</span>
            </>
          )}
        </div>
      );
    }

    if (element.type === "shape") {
      const fill = element.shapeFill || "6366F1";
      const opacity = (element.shapeOpacity ?? 100) / 100;
      const borderColor = element.shapeBorderColor ? `#${element.shapeBorderColor}` : "transparent";
      const borderWidth = element.shapeBorderWidth || 0;
      const kind = element.shapeKind || "rectangle";
      const base: React.CSSProperties = {
        width: "100%",
        height: "100%",
        backgroundColor: kind === "line" ? "transparent" : `#${fill}`,
        opacity,
        border: borderWidth > 0 ? `${borderWidth}px solid ${borderColor}` : "none",
        borderRadius: kind === "ellipse" ? "50%" : kind === "rounded-rect" ? "12px" : 0,
      };
      if (kind === "line") {
        return (
          <div className="w-full h-full flex items-center" style={{ opacity }}>
            <div className="w-full" style={{
              height: Math.max(2, borderWidth || 3),
              backgroundColor: `#${fill}`,
              borderRadius: 2,
            }} />
          </div>
        );
      }
      return <div style={base} />;
    }

    if (element.type === "connector") {
      const color = `#${element.connectorColor || "6366F1"}`;
      const width = element.connectorWidth || 2;
      const style = element.connectorStyle || "straight";
      const startHead = element.arrowStart || "none";
      const endHead = element.arrowEnd || "arrow";
      const markerId = `marker-${element.id}`;

      const renderArrowHead = (head: ArrowHead, id: string, isStart: boolean) => {
        if (head === "none") return null;
        if (head === "arrow") {
          return (
            <marker id={id} markerWidth="10" markerHeight="7" refX={isStart ? "0" : "10"} refY="3.5" orient="auto" markerUnits="strokeWidth">
              <polygon points={isStart ? "10 0, 0 3.5, 10 7" : "0 0, 10 3.5, 0 7"} fill={color} />
            </marker>
          );
        }
        if (head === "dot") {
          return (
            <marker id={id} markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto" markerUnits="strokeWidth">
              <circle cx="4" cy="4" r="3" fill={color} />
            </marker>
          );
        }
        if (head === "diamond") {
          return (
            <marker id={id} markerWidth="10" markerHeight="7" refX="5" refY="3.5" orient="auto" markerUnits="strokeWidth">
              <polygon points="0 3.5, 5 0, 10 3.5, 5 7" fill={color} />
            </marker>
          );
        }
        return null;
      };

      let pathD: string;
      if (style === "straight") {
        pathD = `M 0,${50} L 100,${50}`;
      } else if (style === "elbow") {
        pathD = `M 0,50 L 50,50 L 50,50 L 100,50`;
        // Modified for visual: go from start to middleX at startY, then to endY, then to end
        pathD = `M 0,100 L 50,100 L 50,0 L 100,0`;
      } else {
        // curved
        pathD = `M 0,100 C 33,100 67,0 100,0`;
      }

      return (
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="overflow-visible"
        >
          <defs>
            {renderArrowHead(startHead, `${markerId}-start`, true)}
            {renderArrowHead(endHead, `${markerId}-end`, false)}
          </defs>
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={width * 2}
            vectorEffect="non-scaling-stroke"
            markerStart={startHead !== "none" ? `url(#${markerId}-start)` : undefined}
            markerEnd={endHead !== "none" ? `url(#${markerId}-end)` : undefined}
          />
        </svg>
      );
    }

    if (element.type === "youtube") {
      const embedUrl = element.youtubeUrl ? toYoutubeEmbedUrl(element.youtubeUrl) : null;
      const thumbUrl = element.youtubeUrl ? getYoutubeThumbnail(element.youtubeUrl) : null;
      if (embedUrl && thumbUrl) {
        return (
          <div className="w-full h-full relative bg-black">
            {/* Show thumbnail with play button overlay — iframe blocks pointer events for drag/resize */}
            <img src={thumbUrl} alt="YouTube video" className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-14 h-10 bg-red-600 rounded-xl flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="9.5 7.5 16.5 12 9.5 16.5" /></svg>
              </div>
            </div>
            {isSelected && (
              <div className="absolute top-1 right-1 flex gap-1 z-40" data-no-drag="true">
                <div
                  className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white transition-colors cursor-move"
                  title="Drag to move"
                  data-no-drag="false"
                  data-move-handle="true"
                >
                  <IconMove size={13} />
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onChangeClick?.(); }}
                  className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white transition-colors"
                  title="Edit video link"
                >
                  <IconPencil size={13} />
                </button>
              </div>
            )}
            {isSelected && (
              <div className="absolute bottom-1 left-1 right-1 bg-black/70 text-white text-[10px] px-2 py-1 rounded truncate">
                {element.youtubeUrl}
              </div>
            )}
          </div>
        );
      }
      return (
        <div className="w-full h-full bg-gray-100 dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center gap-2 text-[var(--muted)]">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
            <rect x="2" y="4" width="20" height="16" rx="4" />
            <polygon points="10 8.5 16 12 10 15.5" fill="currentColor" stroke="none" />
          </svg>
          <span className="text-xs opacity-50">YouTube Video</span>
        </div>
      );
    }

    if (element.type === "bullets") {
      if (isEditing) {
        return (
          <div className="w-full h-full p-1" data-no-drag="true">
            <textarea
              ref={inlineTextRef}
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onBlur={() => onEditEnd?.(editDraft)}
              onKeyDown={(e) => { if (e.key === "Escape") { onEditEnd?.(editDraft); } }}
              className="w-full h-full bg-transparent resize-none focus:outline-none"
              style={{ fontSize: element.fontSize || 16, color: element.color ? `#${element.color}` : undefined, fontFamily: element.fontFamily || undefined, textAlign: element.textAlign || "left", lineHeight: element.lineHeight || 1.4 }}
            />
          </div>
        );
      }
      return (
        <div className="w-full h-full p-2 overflow-hidden">
          <div style={{ fontSize: element.fontSize || 16, fontFamily: element.fontFamily || undefined, textAlign: element.textAlign || "left", lineHeight: element.lineHeight || 1.4 }}>
            <MarkdownText content={element.content || "- Bullet point"} className="leading-tight" />
          </div>
        </div>
      );
    }

    // title, subtitle, text
    if (isEditing && isTextType) {
      return (
        <div className="w-full h-full p-1" data-no-drag="true">
          <textarea
            ref={inlineTextRef}
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onBlur={() => onEditEnd?.(editDraft)}
            onKeyDown={(e) => { if (e.key === "Escape") { onEditEnd?.(editDraft); } }}
            className="w-full h-full bg-transparent resize-none focus:outline-none"
            style={{
              fontSize: element.fontSize || 16,
              fontWeight: element.fontWeight || "normal",
              fontFamily: element.fontFamily || undefined,
              textAlign: element.textAlign || "left",
              lineHeight: element.lineHeight || 1.4,
              color: element.color ? `#${element.color}` : undefined,
            }}
          />
        </div>
      );
    }

    return (
      <div
        className="w-full h-full flex items-start p-2 overflow-hidden"
        style={{
          fontSize: element.fontSize || 16,
          fontWeight: element.fontWeight || "normal",
          fontFamily: element.fontFamily || undefined,
          textAlign: element.textAlign || "left",
          lineHeight: element.lineHeight || 1.4,
          color: element.color ? `#${element.color}` : undefined,
        }}
      >
        <MarkdownText
          content={element.content || (element.type === "title" ? "Title" : element.type === "subtitle" ? "Subtitle" : "Text")}
          className="w-full"
        />
      </div>
    );
  };

  return (
    <div
      data-canvas-element="true"
      className={`absolute group ${element.locked ? "cursor-not-allowed opacity-90" : isEditing ? "cursor-text" : "cursor-move"} ${isSelected ? "ring-2 ring-[var(--accent)] ring-offset-1" : "hover:ring-1 hover:ring-[var(--accent)]/50"}`}
      style={{
        left: `${element.x}%`, top: `${element.y}%`,
        width: `${element.w}%`, height: `${element.h}%`,
        zIndex: element.zIndex || 1,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
        transformOrigin: "center center",
      }}
      onMouseDown={(e) => { if (element.locked) { e.stopPropagation(); onSelect(e); return; } handleMouseDown(e); }}
      onDoubleClick={(e) => { e.stopPropagation(); if (!element.locked) onDoubleClick(); }}
      onDrop={handleFileDrop}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
    >
      {renderContent()}
      {element.locked && isSelected && (
        <div className="absolute top-1 left-1 text-[10px] bg-black/50 text-white rounded px-1 py-0.5 z-40">🔒</div>
      )}
      {isSelected && isTextType && !isEditing && !element.locked && (
        <div
          className="absolute top-1 right-1 p-1.5 rounded-md bg-black/55 hover:bg-black/75 text-white transition-colors cursor-move z-40"
          title="Drag to move"
          data-move-handle="true"
        >
          <IconMove size={13} />
        </div>
      )}
      {/* Resize handles */}
      {isSelected && !element.locked && (
        <>
          {["tl", "tr", "bl", "br"].map((corner) => (
            <div
              key={corner}
              className="absolute w-2.5 h-2.5 bg-[var(--accent)] border border-white rounded-sm cursor-nwse-resize z-50"
              style={{
                ...(corner.includes("t") ? { top: -4 } : { bottom: -4 }),
                ...(corner.includes("l") ? { left: -4 } : { right: -4 }),
                cursor: corner === "tl" || corner === "br" ? "nwse-resize" : "nesw-resize",
              }}
              onMouseDown={(e) => handleResizeDown(e, corner)}
            />
          ))}
          {/* Edge resize handles */}
          <div className="absolute top-1/2 -left-1 w-2 h-6 -translate-y-1/2 bg-[var(--accent)] rounded-sm cursor-ew-resize z-50" onMouseDown={(e) => handleResizeDown(e, "l")} />
          <div className="absolute top-1/2 -right-1 w-2 h-6 -translate-y-1/2 bg-[var(--accent)] rounded-sm cursor-ew-resize z-50" onMouseDown={(e) => handleResizeDown(e, "r")} />
          <div className="absolute -top-1 left-1/2 w-6 h-2 -translate-x-1/2 bg-[var(--accent)] rounded-sm cursor-ns-resize z-50" onMouseDown={(e) => handleResizeDown(e, "t")} />
          <div className="absolute -bottom-1 left-1/2 w-6 h-2 -translate-x-1/2 bg-[var(--accent)] rounded-sm cursor-ns-resize z-50" onMouseDown={(e) => handleResizeDown(e, "b")} />
          {/* Rotation handle */}
          <div
            className="absolute left-1/2 -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none"
            style={{ top: -28 }}
          >
            <div className="w-px h-3 bg-[var(--accent)]" />
            <div
              className="w-4 h-4 rounded-full bg-[var(--accent)] border-2 border-white cursor-grab active:cursor-grabbing pointer-events-auto flex items-center justify-center"
              onMouseDown={handleRotateDown}
              title={element.rotation ? `${Math.round(element.rotation)}°` : "Rotate"}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              </svg>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Inline text editor ──
function InlineTextEditor({ element, onSave, onCancel }: {
  element: ManualSlideElement;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(element.content);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="bg-[var(--surface)] rounded-xl p-4 w-[500px] max-w-[90vw] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <label className="block text-sm font-medium mb-2">
          {element.type === "bullets" ? "Bullet Points (one per line)" : "Text Content"}
        </label>
        <p className="text-xs text-[var(--muted)] mb-2">
          Markdown supported: **bold**, *italic*, ordered and unordered lists.
        </p>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={element.type === "bullets" ? 8 : 3}
          className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--accent)]"
        />
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg hover:bg-[var(--surface-2)]">Cancel</button>
          <button onClick={() => onSave(text)} className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]">Save</button>
        </div>
      </div>
    </div>
  );
}

function ImageCropControls({
  element,
  onUpdate,
  lang,
}: {
  element: ManualSlideElement;
  onUpdate: (updates: Partial<ManualSlideElement>) => void;
  lang: "en" | "es";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const adjustment = element.imageAdjustment || DEFAULT_IMAGE_ADJUSTMENT;

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!element.content) return;
    dragging.current = true;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;

    const movementX = (event.movementX / containerRef.current.offsetWidth) * 100;
    const movementY = (event.movementY / containerRef.current.offsetHeight) * 100;
    const maxOffset = getMaxImageOffset(adjustment.scale);

    onUpdate({
      imageAdjustment: {
        ...adjustment,
        offsetX: roundTenths(clamp(adjustment.offsetX + movementX, -maxOffset, maxOffset)),
        offsetY: roundTenths(clamp(adjustment.offsetY + movementY, -maxOffset, maxOffset)),
      },
    });
  };

  const handlePointerUp = () => {
    dragging.current = false;
  };

  if (!element.content) return null;

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[var(--muted)]">{lang === "en" ? "Crop" : "Recorte"}</span>
        <button
          type="button"
          onClick={() => onUpdate({ imageAdjustment: { ...DEFAULT_IMAGE_ADJUSTMENT } })}
          className="text-[10px] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
        >
          {lang === "en" ? "Reset crop" : "Reiniciar recorte"}
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative w-full aspect-video overflow-hidden rounded-lg border border-[var(--border)] bg-black cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <img src={element.content} alt="" className="absolute inset-0 w-full h-full pointer-events-none select-none" draggable={false} style={getImageAdjustmentStyle(adjustment)} />
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="h-px w-6 bg-white/40" />
          <div className="absolute h-6 w-px bg-white/40" />
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[var(--muted)]">{lang === "en" ? "Zoom" : "Zoom"}</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={adjustment.scale}
          onChange={(event) => {
            const scale = Number(event.target.value);
            const maxOffset = getMaxImageOffset(scale);
            onUpdate({
              imageAdjustment: {
                scale,
                offsetX: clamp(adjustment.offsetX, -maxOffset, maxOffset),
                offsetY: clamp(adjustment.offsetY, -maxOffset, maxOffset),
                opacity: adjustment.opacity ?? 100,
              },
            });
          }}
          className="accent-[var(--accent)]"
        />
      </label>

      <div className="flex items-center justify-between text-[10px] text-[var(--muted)]">
        <span>{Math.round(adjustment.scale * 100)}%</span>
        <span>{lang === "en" ? "Drag to reframe" : "Arrastra para reencuadrar"}</span>
      </div>

      {/* Fitting mode selector */}
      <div className="space-y-1.5">
        <span className="text-[var(--muted)]">{lang === "en" ? "Fitting" : "Ajuste"}</span>
        <div className="grid grid-cols-4 gap-1">
          {(["cover", "contain", "fill", "none"] as const).map((mode) => {
            const labels: Record<string, { en: string; es: string; icon: string }> = {
              cover:   { en: "Fill",     es: "Rellenar",  icon: "⊞" },
              contain: { en: "Fit",      es: "Contener",  icon: "⊡" },
              fill:    { en: "Stretch",  es: "Estirar",   icon: "⤢" },
              none:    { en: "Original", es: "Original",  icon: "1:1" },
            };
            const info = labels[mode];
            const isActive = (adjustment.objectFit || "cover") === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onUpdate({ imageAdjustment: { ...adjustment, objectFit: mode } })}
                className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[10px] transition-colors ${
                  isActive
                    ? "bg-[var(--accent)]/20 text-[var(--accent)] ring-1 ring-[var(--accent)]/30"
                    : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--fg)]"
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

      <label className="flex flex-col gap-1">
        <span className="text-[var(--muted)]">
          {lang === "en" ? "Transparency" : "Transparencia"} ({Math.round(100 - (adjustment.opacity ?? 100))}%)
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={100 - (adjustment.opacity ?? 100)}
          onChange={(event) => {
            const transparency = Number(event.target.value);
            onUpdate({
              imageAdjustment: {
                ...adjustment,
                opacity: 100 - transparency,
              },
            });
          }}
          className="accent-[var(--accent)]"
        />
      </label>
    </div>
  );
}

// ── Properties panel ──
const FONT_OPTIONS = [
  "",            // inherit/default
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Raleway",
  "Playfair Display",
  "Merriweather",
  "Source Sans 3",
  "Nunito",
  "PT Sans",
  "Oswald",
  "Bebas Neue",
  "Aptos",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Courier New",
];

function PropertiesPanel({ element, slideIndex, onUpdate, lang }: {
  element: ManualSlideElement;
  slideIndex: number;
  onUpdate: (updates: Partial<ManualSlideElement>) => void;
  lang: "en" | "es";
}) {
  return (
    <div className="space-y-3 text-xs">
      <h4 className="font-semibold text-sm capitalize">{element.type} Properties</h4>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--muted)]">X (%)</span>
          <input type="number" value={Math.round(element.x)} onChange={(e) => onUpdate({ x: +e.target.value })}
            className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--muted)]">Y (%)</span>
          <input type="number" value={Math.round(element.y)} onChange={(e) => onUpdate({ y: +e.target.value })}
            className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--muted)]">W (%)</span>
          <input type="number" value={Math.round(element.w)} onChange={(e) => onUpdate({ w: +e.target.value })}
            className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--muted)]">H (%)</span>
          <input type="number" value={Math.round(element.h)} onChange={(e) => onUpdate({ h: +e.target.value })}
            className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full" />
        </label>
      </div>
      {element.type !== "image" && element.type !== "shape" && element.type !== "youtube" && element.type !== "connector" && (
        <>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">Font Size</span>
            <input type="number" value={element.fontSize || 16} onChange={(e) => onUpdate({ fontSize: +e.target.value })}
              className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={element.fontWeight === "bold"} onChange={(e) => onUpdate({ fontWeight: e.target.checked ? "bold" : "normal" })} />
            <span className="text-[var(--muted)]">Bold</span>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">Color</span>
            <div className="flex items-center gap-1.5">
              <input type="color" value={element.color ? `#${element.color}` : "#000000"} onChange={(e) => onUpdate({ color: e.target.value.replace("#", "") })}
                className="w-8 h-6 cursor-pointer" />
              <input
                type="text"
                value={element.color || "000000"}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                  onUpdate({ color: v });
                }}
                maxLength={6}
                className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-20 font-mono"
                placeholder="FFFFFF"
              />
            </div>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">{lang === "en" ? "Font Family" : "Fuente"}</span>
            <select
              value={element.fontFamily || ""}
              onChange={(e) => onUpdate({ fontFamily: e.target.value || undefined })}
              className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full"
            >
              <option value="">{lang === "en" ? "Default" : "Por defecto"}</option>
              {FONT_OPTIONS.filter(Boolean).map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">{lang === "en" ? "Alignment" : "Alineación"}</span>
            <div className="flex gap-1">
              {(["left", "center", "right", "justify"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => onUpdate({ textAlign: a })}
                  className={`flex-1 px-1 py-1 rounded text-[10px] border ${
                    (element.textAlign || "left") === a
                      ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                      : "bg-[var(--surface-2)] border-[var(--border)] hover:bg-[var(--surface-2)]/80"
                  }`}
                  title={a}
                >
                  {a === "left" ? "\u2190" : a === "center" ? "\u2194" : a === "right" ? "\u2192" : "\u2195"}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">{lang === "en" ? "Line Height" : "Interlineado"}</span>
            <select
              value={element.lineHeight || 1.4}
              onChange={(e) => onUpdate({ lineHeight: +e.target.value })}
              className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full"
            >
              <option value={1}>1.0 — {lang === "en" ? "Tight" : "Compacto"}</option>
              <option value={1.2}>1.2</option>
              <option value={1.4}>1.4 — {lang === "en" ? "Default" : "Normal"}</option>
              <option value={1.6}>1.6</option>
              <option value={1.8}>1.8</option>
              <option value={2}>2.0 — {lang === "en" ? "Double" : "Doble"}</option>
            </select>
          </label>
        </>
      )}
      {element.type === "shape" && (
        <>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">{lang === "en" ? "Shape" : "Forma"}</span>
            <select
              value={element.shapeKind || "rectangle"}
              onChange={(e) => onUpdate({ shapeKind: e.target.value as ShapeKind })}
              className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full"
            >
              {SHAPE_KINDS.map((sk) => (
                <option key={sk.id} value={sk.id}>{sk.label[lang]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">{lang === "en" ? "Fill Color" : "Color de relleno"}</span>
            <div className="flex items-center gap-1.5">
              <input type="color" value={`#${element.shapeFill || "6366F1"}`} onChange={(e) => onUpdate({ shapeFill: e.target.value.replace("#", "") })}
                className="w-8 h-6 cursor-pointer" />
              <input
                type="text"
                value={element.shapeFill || "6366F1"}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                  onUpdate({ shapeFill: v });
                }}
                maxLength={6}
                className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-20 font-mono"
              />
            </div>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">{lang === "en" ? "Opacity" : "Opacidad"} ({element.shapeOpacity ?? 100}%)</span>
            <input
              type="range" min={0} max={100} value={element.shapeOpacity ?? 100}
              onChange={(e) => onUpdate({ shapeOpacity: +e.target.value })}
              className="w-full accent-[var(--accent)]"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">{lang === "en" ? "Border Color" : "Color de borde"}</span>
            <div className="flex items-center gap-1.5">
              <input type="color" value={`#${element.shapeBorderColor || "000000"}`} onChange={(e) => onUpdate({ shapeBorderColor: e.target.value.replace("#", "") })}
                className="w-8 h-6 cursor-pointer" />
              <input
                type="text"
                value={element.shapeBorderColor || ""}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                  onUpdate({ shapeBorderColor: v });
                }}
                maxLength={6}
                className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-20 font-mono"
                placeholder="000000"
              />
            </div>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">{lang === "en" ? "Border Width" : "Grosor de borde"}</span>
            <input type="number" min={0} max={20} value={element.shapeBorderWidth || 0} onChange={(e) => onUpdate({ shapeBorderWidth: +e.target.value })}
              className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full" />
          </label>
        </>
      )}
      {element.type === "youtube" && (
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--muted)]">YouTube URL</span>
          <input
            type="url"
            value={element.youtubeUrl || ""}
            onChange={(e) => {
              const url = e.target.value;
              const videoId = extractYoutubeVideoId(url);
              onUpdate({
                youtubeUrl: url,
                content: videoId ? `https://www.youtube.com/embed/${videoId}` : "",
              });
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full"
          />
        </label>
      )}
      {element.type === "connector" && (
        <>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">{lang === "en" ? "Style" : "Estilo"}</span>
            <select
              value={element.connectorStyle || "straight"}
              onChange={(e) => onUpdate({ connectorStyle: e.target.value as ConnectorStyle })}
              className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full"
            >
              {CONNECTOR_STYLES.map((cs) => (
                <option key={cs.id} value={cs.id}>{cs.icon} {cs.label[lang]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">{lang === "en" ? "Color" : "Color"}</span>
            <div className="flex items-center gap-1.5">
              <input type="color" value={`#${element.connectorColor || "6366F1"}`} onChange={(e) => onUpdate({ connectorColor: e.target.value.replace("#", "") })}
                className="w-8 h-6 cursor-pointer" />
              <input
                type="text"
                value={element.connectorColor || "6366F1"}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                  onUpdate({ connectorColor: v });
                }}
                maxLength={6}
                className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-20 font-mono"
              />
            </div>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">{lang === "en" ? "Width" : "Grosor"}</span>
            <input type="number" min={1} max={10} value={element.connectorWidth || 2} onChange={(e) => onUpdate({ connectorWidth: +e.target.value })}
              className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full" />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">{lang === "en" ? "Start Head" : "Punta inicio"}</span>
            <select
              value={element.arrowStart || "none"}
              onChange={(e) => onUpdate({ arrowStart: e.target.value as ArrowHead })}
              className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full"
            >
              <option value="none">{lang === "en" ? "None" : "Ninguna"}</option>
              <option value="arrow">{lang === "en" ? "Arrow" : "Flecha"}</option>
              <option value="dot">{lang === "en" ? "Dot" : "Punto"}</option>
              <option value="diamond">{lang === "en" ? "Diamond" : "Diamante"}</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--muted)]">{lang === "en" ? "End Head" : "Punta final"}</span>
            <select
              value={element.arrowEnd || "arrow"}
              onChange={(e) => onUpdate({ arrowEnd: e.target.value as ArrowHead })}
              className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full"
            >
              <option value="none">{lang === "en" ? "None" : "Ninguna"}</option>
              <option value="arrow">{lang === "en" ? "Arrow" : "Flecha"}</option>
              <option value="dot">{lang === "en" ? "Dot" : "Punto"}</option>
              <option value="diamond">{lang === "en" ? "Diamond" : "Diamante"}</option>
            </select>
          </label>
        </>
      )}
      <label className="flex flex-col gap-0.5">
        <span className="text-[var(--muted)]">Layer (z-index)</span>
        <input type="number" value={element.zIndex || 1} min={0} max={100} onChange={(e) => onUpdate({ zIndex: +e.target.value })}
          className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-full" />
      </label>
      {element.type === "image" && <ImageCropControls element={element} onUpdate={onUpdate} lang={lang} />}
      <label className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
        <input type="checkbox" checked={!!element.locked} onChange={(e) => onUpdate({ locked: e.target.checked || undefined })} />
        <span className="text-[var(--muted)]">{lang === "en" ? "Lock element" : "Bloquear elemento"}</span>
        <span className="text-[10px]">🔒</span>
      </label>
    </div>
  );
}

// ── Convert ManualPresentation → PresentationData for PPTX export ──
function manualToPresentationData(title: string, slides: ManualSlide[]): PresentationData {
  return {
    title,
    slides: slides.map((slide, index): SlideData => {
      const titleEl = slide.elements.find((el) => el.type === "title");
      const bulletEl = slide.elements.find((el) => el.type === "bullets");
      const imageEls = slide.elements.filter((el) => el.type === "image" && el.content);

      return {
        id: slide.id,
        index,
        title: titleEl?.content || "",
        bullets: bulletEl ? bulletEl.content.split("\n").filter(Boolean) : [],
        notes: slide.notes,
        imageUrls: imageEls.map((el) => el.content),
        accentColor: slide.accentColor,
        bgColor: slide.bgColor,
        slideLayout: slide.layout,
        imageSources: imageEls.map((el) => el.imageSource || ""),
        imageAdjustments: imageEls.map((el) => el.imageAdjustment || { scale: 1, offsetX: 0, offsetY: 0, opacity: 100 }),
        manualElements: slide.elements.map((el) => ({
          type: el.type,
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          content: el.content,
          fontSize: el.fontSize,
          fontWeight: el.fontWeight,
          fontFamily: el.fontFamily,
          textAlign: el.textAlign,
          lineHeight: el.lineHeight,
          color: el.color,
          zIndex: el.zIndex,
          imageAdjustment: el.imageAdjustment,
          groupId: el.groupId,
          shapeKind: el.shapeKind,
          shapeFill: el.shapeFill,
          shapeOpacity: el.shapeOpacity,
          shapeBorderColor: el.shapeBorderColor,
          shapeBorderWidth: el.shapeBorderWidth,
          youtubeUrl: el.youtubeUrl,
          locked: el.locked,
          connectorStyle: el.connectorStyle,
          arrowStart: el.arrowStart,
          arrowEnd: el.arrowEnd,
          connectorColor: el.connectorColor,
          connectorWidth: el.connectorWidth,
          rotation: el.rotation,
        })),
      };
    }),
  };
}

async function downloadImageAsBase64(url: string): Promise<string | null> {
  if (url.startsWith("data:")) return url;
  // Check blob cache first — converts Blob to base64 on demand
  const cached = await getCachedBlobAsBase64(url);
  if (cached) return cached;

  const blobToDataUri = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

  // Retry with exponential backoff (handles 429 rate-limiting)
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const proxyUrl = new URL("/api/image-proxy", window.location.origin);
      proxyUrl.searchParams.set("url", url);
      const res = await fetch(proxyUrl.toString());
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") || 0);
        const waitMs = retryAfter ? retryAfter * 1000 : 1000 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, Math.min(waitMs, 10_000)));
        continue;
      }
      if (!res.ok) {
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
          continue;
        }
        // All proxy attempts failed — try direct browser fetch as last resort.
        // The browser can pass Cloudflare JS challenges that the server proxy cannot.
        break;
      }
      const blob = await res.blob();
      void setCachedBlob(url, blob);
      return blobToDataUri(blob);
    } catch {
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
        continue;
      }
      break;
    }
  }

  // Fallback: direct browser fetch (bypasses Cloudflare challenges, CORS permitting)
  try {
    const directRes = await fetch(url);
    if (directRes.ok) {
      const blob = await directRes.blob();
      if (blob.type.startsWith("image/")) {
        void setCachedBlob(url, blob);
        return blobToDataUri(blob);
      }
    }
  } catch { /* CORS or network error */ }

  // Last resort: capture the image from the DOM if it's already rendered in a slide preview.
  // <img> tags can display cross-origin images that fetch() cannot access due to CORS.
  // We draw the already-loaded <img> element to a canvas to extract its pixel data.
  try {
    const imgs = document.querySelectorAll<HTMLImageElement>("img");
    for (const img of imgs) {
      if (img.src === url && img.naturalWidth > 0 && img.complete) {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          try {
            const dataUri = canvas.toDataURL("image/jpeg", 0.92);
            if (dataUri && dataUri.length > 100) {
              void setCachedBlob(url, await (await fetch(dataUri)).blob());
              canvas.width = 0; canvas.height = 0;
              return dataUri;
            }
          } catch { /* tainted canvas — CORS blocked pixel access */ }
          canvas.width = 0; canvas.height = 0;
        }
        break;
      }
    }
  } catch { /* DOM access error */ }
  return null;
}

async function preDownloadManualImages(
  presentation: PresentationData,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<PresentationData> {
  const urlsToDl = new Set<string>();
  for (const s of presentation.slides) {
    for (const u of s.imageUrls) {
      if (u && !u.startsWith("data:")) urlsToDl.add(u);
    }
    if (s.manualElements) {
      for (const el of s.manualElements) {
        if (el.type === "image" && el.content && !el.content.startsWith("data:")) urlsToDl.add(el.content);
      }
    }
  }
  if (urlsToDl.size === 0) return presentation;

  const map = new Map<string, string>();
  const urls = [...urlsToDl];
  const batchSize = 3;
  let downloaded = 0;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(downloadImageAsBase64));
    batch.forEach((u, j) => { if (results[j]) map.set(u, results[j]!); });
    downloaded += batch.length;
    onProgress?.(downloaded, urls.length);
  }

  return {
    ...presentation,
    slides: presentation.slides.map((s) => ({
      ...s,
      imageUrls: s.imageUrls.map((u) => map.get(u) || u).filter((url) => url.startsWith("data:") || !urlsToDl.has(url)),
      manualElements: s.manualElements?.map((el) =>
        el.type === "image" && el.content && map.has(el.content)
          ? { ...el, content: map.get(el.content)! }
          : el
      ),
    })),
  };
}

type ManualTab = "list" | "editor";

// ── Main Manual Creator ──
export default function ManualCreator({ onPresent }: { onPresent?: () => void }) {
  const store = useManualStore();
  const appStore = useAppStore();
  const lang = appStore.settings.language;
  const t = UI_TEXT[lang];
  const manualTab = appStore.manualSubTab;
  const setManualTab = appStore.setManualSubTab;

  const [showLayoutPicker, setShowLayoutPicker] = useState(false);
  const [addSlideCount, setAddSlideCount] = useState(1);
  const [hoverInsertIndex, setHoverInsertIndex] = useState<number | null>(null);
  const [showChangeLayoutPopup, setShowChangeLayoutPopup] = useState(false);
  const [showShapePicker, setShowShapePicker] = useState(false);
  const [showConnectorPicker, setShowConnectorPicker] = useState(false);
  const [showYoutubePrompt, setShowYoutubePrompt] = useState(false);
  const [youtubeUrlInput, setYoutubeUrlInput] = useState("");
  const [youtubeUrlError, setYoutubeUrlError] = useState(false);
  const [youtubeEditElementId, setYoutubeEditElementId] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [editingElement, setEditingElement] = useState<string | null>(null);
  const [generatingNotes, setGeneratingNotes] = useState(false);
  const [showAINotesModal, setShowAINotesModal] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState(store.presentation.title);
  const [gridPreset, setGridPreset] = useState<GridPreset>("basic");
  const [activeGuides, setActiveGuides] = useState<GuideState>(DEFAULT_GUIDES);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ step: string; percent: number } | null>(null);
  const [selectedSlideIndices, setSelectedSlideIndices] = useState<Set<number>>(new Set());
  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; danger?: boolean; onConfirm: () => void } | null>(null);
  const [importing, setImporting] = useState(false);
  const [pptxImportOpen, setPptxImportOpen] = useState(false);
  const [importingNotes, setImportingNotes] = useState(false);
  const lastClickedSlideIndex = useRef<number | null>(null);
  const clipboardRef = useRef<ManualSlideElement[]>([]);
  const pptxInputRef = useRef<HTMLInputElement>(null);
  const notesImportRef = useRef<HTMLInputElement>(null);

  const slides = store.presentation.slides;
  const activeCreation = store.creations.find((creation) => creation.id === store.activeCreationId) || null;
  const currentSlide = slides[store.selectedSlideIndex];
  const selectedElement = currentSlide?.elements.find((el) => el.id === store.selectedElementId);
  const selectedElements = currentSlide?.elements.filter((el) => selectedElementIds.has(el.id)) || [];
  const hasGroupedSelection = selectedElements.some((el) => Boolean(el.groupId));

  useEffect(() => {
    if (!store.isLoaded) store.loadCreations();
  }, [store.isLoaded, store]);

  useEffect(() => {
    setNoteDraft(currentSlide?.notes || "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlide?.id]);

  useEffect(() => {
    setTitleDraft(store.presentation.title || "");
  }, [store.presentation.title, store.activeCreationId]);

  // Measure canvas scale for coordinate conversion
  useEffect(() => {
    const measure = () => {
      if (canvasRef.current) {
        setCanvasScale(canvasRef.current.offsetWidth / 960);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [currentSlide]);

  // Keyboard shortcuts for undo/redo/delete/copy/paste
  const loadedFontsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const systemFonts = new Set(["Arial", "Georgia", "Times New Roman", "Courier New", "Aptos"]);
    const families = new Set<string>();
    for (const slide of slides) {
      for (const el of slide.elements) {
        if (el.fontFamily && !systemFonts.has(el.fontFamily) && !loadedFontsRef.current.has(el.fontFamily)) {
          families.add(el.fontFamily);
        }
      }
    }
    if (families.size === 0) return;
    const params = [...families].map((f) => `family=${encodeURIComponent(f)}`).join("&");
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${params}&display=swap`;
    document.head.appendChild(link);
    families.forEach((f) => loadedFontsRef.current.add(f));
  }, [slides]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        if (selectedSlideIndices.size > 0) {
          setSelectedSlideIndices(new Set());
          return;
        }
        if (selectedElementIds.size > 0) {
          setSelectedElementIds(new Set());
          store.selectElement(null);
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        store.redo();
      }
      // Copy elements (Cmd+C)
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        const elsToCopy: ManualSlideElement[] = [];
        if (selectedElementIds.size > 0 && currentSlide) {
          currentSlide.elements.filter((el) => selectedElementIds.has(el.id)).forEach((el) => elsToCopy.push(el));
        } else if (store.selectedElementId && currentSlide) {
          const el = currentSlide.elements.find((el) => el.id === store.selectedElementId);
          if (el) elsToCopy.push(el);
        }
        if (elsToCopy.length > 0) {
          e.preventDefault();
          clipboardRef.current = JSON.parse(JSON.stringify(elsToCopy));
        }
      }
      // Paste elements (Cmd+V)
      if ((e.metaKey || e.ctrlKey) && e.key === "v" && clipboardRef.current.length > 0 && currentSlide) {
        e.preventDefault();
        const newIds: string[] = [];
        for (const original of clipboardRef.current) {
          const pasted: ManualSlideElement = {
            ...JSON.parse(JSON.stringify(original)),
            id: crypto.randomUUID(),
            x: Math.min(90, original.x + 2),
            y: Math.min(90, original.y + 2),
          };
          store.addElement(store.selectedSlideIndex, pasted);
          newIds.push(pasted.id);
        }
        if (newIds.length === 1) {
          store.selectElement(newIds[0]);
          setSelectedElementIds(new Set());
        } else {
          store.selectElement(null);
          setSelectedElementIds(new Set(newIds));
        }
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // Multi-select slide delete
        if (selectedSlideIndices.size > 0) {
          e.preventDefault();
          setShowDeleteConfirm(true);
          return;
        }
        // Multi-select element delete
        if (selectedElementIds.size > 0 && currentSlide) {
          e.preventDefault();
          const ids = Array.from(selectedElementIds);
          ids.forEach((id) => store.removeElement(store.selectedSlideIndex, id));
          setSelectedElementIds(new Set());
          store.selectElement(null);
          return;
        }
        if (store.selectedElementId && currentSlide) {
          e.preventDefault();
          store.removeElement(store.selectedSlideIndex, store.selectedElementId);
          setSelectedElementIds(new Set());
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [store, currentSlide, selectedSlideIndices, selectedElementIds]);

  // Clear multi-selection when slides change (delete, add, reorder)
  useEffect(() => {
    setSelectedSlideIndices(new Set());
    lastClickedSlideIndex.current = null;
  }, [slides.length]);

  useEffect(() => {
    setSelectedElementIds(new Set());
  }, [store.selectedSlideIndex]);

  const handleSlideClick = useCallback((index: number, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      // Toggle individual slide in selection
      setSelectedSlideIndices((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next;
      });
      lastClickedSlideIndex.current = index;
    } else if (e.shiftKey && lastClickedSlideIndex.current !== null) {
      // Range selection
      const from = Math.min(lastClickedSlideIndex.current, index);
      const to = Math.max(lastClickedSlideIndex.current, index);
      setSelectedSlideIndices((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(i);
        return next;
      });
    } else {
      // Normal click — clear multi-selection, select single slide
      setSelectedSlideIndices(new Set());
      setSelectedElementIds(new Set());
      store.selectSlide(index);
      lastClickedSlideIndex.current = index;
    }
  }, [store]);

  const handleConfirmDeleteSelected = useCallback(() => {
    if (selectedSlideIndices.size > 0) {
      store.deleteSlides(Array.from(selectedSlideIndices));
      setSelectedSlideIndices(new Set());
    }
    setShowDeleteConfirm(false);
  }, [store, selectedSlideIndices]);

  const handleAddSlide = useCallback((layout: ManualLayoutId) => {
    store.addSlide(layout, addSlideCount);
    setShowLayoutPicker(false);
  }, [store, addSlideCount]);

  const handleOpenAINotesModal = useCallback(() => {
    setShowAINotesModal(true);
  }, []);

  const handleAINotesSave = useCallback((notes: string) => {
    setNoteDraft(notes);
    store.updateSlideNotes(store.selectedSlideIndex, notes);
  }, [store]);

  const handleImageSelected = useCallback((image: { url: string; source: string }, slotIndex: number) => {
    if (!store.imageSearchTargetElementId) return;
    store.updateElement(store.selectedSlideIndex, store.imageSearchTargetElementId, {
      content: image.url,
      imageSource: image.source,
      imageAdjustment: { ...DEFAULT_IMAGE_ADJUSTMENT },
    });
    store.setShowImageSearch(false);
    // Pre-download image blob in background for faster rendering & PPTX export
    prefetchImageBlob(image.url);
  }, [store]);

  const handleSlideDragStart = (e: React.DragEvent, index: number) => {
    setDragSourceIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleSlideDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    // Determine if cursor is in the top or bottom half of the element
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const insertIndex = e.clientY < midY ? index : index + 1;
    setDragOverIndex(insertIndex);
  };

  const handleSlideDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragSourceIndex !== null && dragOverIndex !== null) {
      // Convert insertion index to move target
      let toIndex = dragOverIndex;
      // If inserting after the source, account for removal shift
      if (toIndex > dragSourceIndex) toIndex -= 1;
      if (toIndex !== dragSourceIndex) {
        store.moveSlide(dragSourceIndex, toIndex);
      }
    }
    setDragSourceIndex(null);
    setDragOverIndex(null);
  };

  const handleSlideDragEnd = () => {
    setDragSourceIndex(null);
    setDragOverIndex(null);
  };

  // ── Add element menu ──
  const handleAddElement = useCallback((type: ManualSlideElement["type"]) => {
    if (!currentSlide) return;
    const element = buildDefaultElement(currentSlide, type);
    store.addElement(store.selectedSlideIndex, element);
    store.selectElement(element.id);
    setSelectedElementIds(new Set([element.id]));
  }, [currentSlide, store]);

  const handleAddYoutube = useCallback((url: string) => {
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) {
      setYoutubeUrlError(true);
      return;
    }
    if (youtubeEditElementId) {
      store.updateElement(store.selectedSlideIndex, youtubeEditElementId, {
        youtubeUrl: url,
        content: `https://www.youtube.com/embed/${videoId}`,
      });
      store.selectElement(youtubeEditElementId);
      setSelectedElementIds(new Set([youtubeEditElementId]));
    } else {
      if (!currentSlide) return;
      const element = buildDefaultElement(currentSlide, "youtube");
      element.youtubeUrl = url;
      element.content = `https://www.youtube.com/embed/${videoId}`;
      store.addElement(store.selectedSlideIndex, element);
      store.selectElement(element.id);
      setSelectedElementIds(new Set([element.id]));
    }
    setShowYoutubePrompt(false);
    setYoutubeUrlInput("");
    setYoutubeUrlError(false);
    setYoutubeEditElementId(null);
  }, [currentSlide, store, youtubeEditElementId]);

  const handleAddTitleSubtitle = useCallback(() => {
    if (!currentSlide) return;
    const hasTitle = currentSlide.elements.some((el) => el.type === "title");
    const hasSubtitle = currentSlide.elements.some((el) => el.type === "subtitle");
    if (!hasTitle) {
      const titleEl = buildDefaultElement(currentSlide, "title");
      store.addElement(store.selectedSlideIndex, titleEl);
      store.selectElement(titleEl.id);
      setSelectedElementIds(new Set([titleEl.id]));
      // rebuild slide reference so subtitle position accounts for the new title
      const updatedSlide = { ...currentSlide, elements: [...currentSlide.elements, titleEl] };
      if (!hasSubtitle) {
        const subtitleEl = buildDefaultElement(updatedSlide, "subtitle");
        store.addElement(store.selectedSlideIndex, subtitleEl);
      }
    } else if (!hasSubtitle) {
      const subtitleEl = buildDefaultElement(currentSlide, "subtitle");
      store.addElement(store.selectedSlideIndex, subtitleEl);
      store.selectElement(subtitleEl.id);
      setSelectedElementIds(new Set([subtitleEl.id]));
    }
  }, [currentSlide, store]);

  const handleElementSelect = useCallback((id: string, event?: React.MouseEvent) => {
    const multi = !!event && (event.metaKey || event.ctrlKey || event.shiftKey);
    if (multi) {
      setSelectedElementIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
          const first = next.values().next().value || null;
          store.selectElement(first);
        } else {
          next.add(id);
          store.selectElement(id);
        }
        return next;
      });
      return;
    }
    setSelectedElementIds(new Set([id]));
    store.selectElement(id);
  }, [store]);

  const handleElementUpdate = useCallback((element: ManualSlideElement, updates: Partial<ManualSlideElement>) => {
    if (!currentSlide) return;

    const shouldMoveTogether =
      (updates.x !== undefined || updates.y !== undefined) &&
      (selectedElementIds.size > 1
        ? selectedElementIds.has(element.id)
        : !!element.groupId);

    if (!shouldMoveTogether) {
      store.updateElement(store.selectedSlideIndex, element.id, updates);
      return;
    }

    const moveIds = selectedElementIds.size > 1
      ? Array.from(selectedElementIds)
      : currentSlide.elements.filter((el) => el.groupId && el.groupId === element.groupId).map((el) => el.id);

    const deltaX = updates.x !== undefined ? updates.x - element.x : 0;
    const deltaY = updates.y !== undefined ? updates.y - element.y : 0;

    const batch = currentSlide.elements
      .filter((el) => moveIds.includes(el.id))
      .map((el) => {
        const next: Partial<ManualSlideElement> = {};
        if (updates.x !== undefined) next.x = roundTenths(clamp(el.x + deltaX, 0, 100 - el.w));
        if (updates.y !== undefined) next.y = roundTenths(clamp(el.y + deltaY, 0, 100 - el.h));
        return { elementId: el.id, updates: next };
      });

    if (batch.length > 0) {
      store.updateElements(store.selectedSlideIndex, batch);
    }
  }, [currentSlide, selectedElementIds, store]);

  const commitNotes = useCallback(() => {
    if (!currentSlide) return;
    store.updateSlideNotes(store.selectedSlideIndex, noteDraft);
  }, [currentSlide, noteDraft, store]);

  const handleAlign = useCallback((target: AlignmentTarget) => {
    if (!currentSlide || selectedElementIds.size === 0) return;
    const batch = currentSlide.elements
      .filter((el) => selectedElementIds.has(el.id))
      .map((el) => ({ elementId: el.id, updates: alignElement(el, target) }));
    if (batch.length > 0) {
      store.updateElements(store.selectedSlideIndex, batch);
    }
  }, [currentSlide, selectedElementIds, store]);

  const handleLayerShift = useCallback((delta: number) => {
    if (!currentSlide || selectedElementIds.size === 0) return;
    const batch = currentSlide.elements
      .filter((el) => selectedElementIds.has(el.id))
      .map((el) => ({ elementId: el.id, updates: shiftLayer(el, delta) }));
    if (batch.length > 0) {
      store.updateElements(store.selectedSlideIndex, batch);
    }
  }, [currentSlide, selectedElementIds, store]);

  const handleGroupSelection = useCallback(() => {
    if (!currentSlide || selectedElementIds.size < 2) return;
    const groupId = crypto.randomUUID();
    const batch = currentSlide.elements
      .filter((el) => selectedElementIds.has(el.id))
      .map((el) => ({ elementId: el.id, updates: { groupId } }));
    store.updateElements(store.selectedSlideIndex, batch);
  }, [currentSlide, selectedElementIds, store]);

  const handleUngroupSelection = useCallback(() => {
    if (!currentSlide || selectedElementIds.size === 0) return;
    const batch = currentSlide.elements
      .filter((el) => selectedElementIds.has(el.id))
      .map((el) => ({ elementId: el.id, updates: { groupId: undefined } }));
    store.updateElements(store.selectedSlideIndex, batch);
  }, [currentSlide, selectedElementIds, store]);

  const handleSelectCreation = useCallback((creationId: string) => {
    store.selectCreation(creationId);
    setManualTab("editor");
  }, [store]);

  const handleCreateCreation = useCallback(() => {
    store.createCreation();
    setManualTab("editor");
  }, [store]);

  /** Called by PptxImportModal with already-converted ManualPresentation */
  const handlePptxModalImport = useCallback(
    (presentation: ManualPresentation) => {
      store.importCreation(presentation);
      setManualTab("editor");
    },
    [store, setManualTab]
  );

  const handleImportPptx = useCallback(async (file: File) => {
    if (importing) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/parse-pptx", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        alert(err.error || (lang === "en" ? "Failed to parse PPTX" : "Error al procesar el PPTX"));
        return;
      }
      const data = await res.json();

      interface ParsedShapeData {
        type: "text" | "image" | "table";
        x: number; y: number; w: number; h: number;
        paragraphs?: { runs: { text: string; bold?: boolean; fontSize?: number; color?: string; fontFamily?: string }[]; alignment?: string; isBullet?: boolean }[];
        imageBase64?: string;
        fontSize?: number;
        fontWeight?: "normal" | "bold";
        fontFamily?: string;
        color?: string;
        textAlign?: "left" | "center" | "right" | "justify";
      }

      interface ParsedSlideData {
        texts: string[];
        imageBase64s: string[];
        presenterNotes: string;
        shapes?: ParsedShapeData[];
        bgColor?: string;
      }

      const importedSlides: ManualSlide[] = (data.slides || []).map((ps: ParsedSlideData) => {
        const elements: ManualSlideElement[] = [];
        let zIndex = 1;

        // Use rich shape data if available
        if (ps.shapes && ps.shapes.length > 0) {
          for (const shape of ps.shapes) {
            if (shape.type === "image" && shape.imageBase64) {
              elements.push({
                id: crypto.randomUUID(),
                type: "image",
                x: shape.x,
                y: shape.y,
                w: shape.w,
                h: shape.h,
                content: shape.imageBase64,
                fontSize: 14,
                zIndex: zIndex++,
              });
            } else if (shape.type === "text" && shape.paragraphs) {
              // Build text content from paragraphs
              const lines = shape.paragraphs.map(p =>
                p.runs.map(r => r.text).join("")
              );
              const content = lines.join("\n");
              if (!content.trim()) continue;

              // Determine element type based on formatting heuristics
              const isBigBold = (shape.fontSize && shape.fontSize >= 28) || shape.fontWeight === "bold";
              const hasBullets = shape.paragraphs.some(p => p.isBullet);
              const isFirstShape = elements.filter(e => e.type !== "image").length === 0;
              let elType: ManualSlideElement["type"] = "text";
              if (isBigBold && isFirstShape && !hasBullets) {
                elType = "title";
              } else if (hasBullets || lines.length > 2) {
                elType = "bullets";
              }

              elements.push({
                id: crypto.randomUUID(),
                type: elType,
                x: shape.x,
                y: shape.y,
                w: shape.w,
                h: shape.h,
                content,
                fontSize: shape.fontSize || (elType === "title" ? 32 : 18),
                fontWeight: shape.fontWeight || (elType === "title" ? "bold" : "normal"),
                fontFamily: shape.fontFamily,
                color: shape.color || "FFFFFF",
                textAlign: shape.textAlign,
                zIndex: zIndex++,
              });
            }
          }
        } else {
          // Fallback: old flat import (for backward compatibility)
          if (ps.texts.length > 0) {
            elements.push({
              id: crypto.randomUUID(),
              type: "title",
              x: 4, y: 4, w: 92, h: 12,
              content: ps.texts[0],
              fontSize: 32, fontWeight: "bold", color: "FFFFFF",
              zIndex: zIndex++,
            });
          }
          if (ps.texts.length > 1) {
            elements.push({
              id: crypto.randomUUID(),
              type: "bullets",
              x: 4, y: 18, w: ps.imageBase64s.length > 0 ? 50 : 92, h: 60,
              content: ps.texts.slice(1).join("\n"),
              fontSize: 18,
              zIndex: zIndex++,
            });
          }
          ps.imageBase64s.forEach((imgData: string, imgIdx: number) => {
            elements.push({
              id: crypto.randomUUID(),
              type: "image",
              x: ps.texts.length > 1 ? 56 : 10 + imgIdx * 25,
              y: 18,
              w: ps.texts.length > 1 ? 40 : 42,
              h: 60,
              content: imgData,
              fontSize: 14,
              zIndex: zIndex++,
            });
          });
        }

        // Fallback: at least one empty element so the slide isn't blank
        if (elements.length === 0) {
          elements.push({
            id: crypto.randomUUID(),
            type: "text",
            x: 10, y: 40, w: 80, h: 20,
            content: lang === "en" ? "(empty slide)" : "(diapositiva vacía)",
            fontSize: 18,
            zIndex: 1,
          });
        }
        return {
          id: crypto.randomUUID(),
          layout: "single" as ManualLayoutId,
          elements,
          notes: ps.presenterNotes || "",
          bgColor: ps.bgColor || "1E293B",
          accentColor: "6366F1",
        };
      });
      const presentation: ManualPresentation = {
        title: (data.fileName || "Imported Deck").replace(/\.pptx$/i, ""),
        slides: importedSlides,
      };
      store.importCreation(presentation);
      setManualTab("editor");
    } catch (err) {
      console.error("PPTX import error:", err);
      alert(lang === "en" ? "Failed to import PPTX file" : "Error al importar el archivo PPTX");
    } finally {
      setImporting(false);
      if (pptxInputRef.current) pptxInputRef.current.value = "";
    }
  }, [importing, lang, store, setManualTab]);

  const handleImportNotes = useCallback(async (file: File) => {
    if (importingNotes || slides.length === 0) return;
    setImportingNotes(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/parse-pptx", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        alert(err.error || (lang === "en" ? "Failed to parse PPTX" : "Error al procesar el PPTX"));
        return;
      }
      const data = await res.json();
      const importedSlides: { presenterNotes: string }[] = data.slides || [];
      if (importedSlides.length !== slides.length) {
        alert(
          lang === "en"
            ? `Slide count mismatch: the imported file has ${importedSlides.length} slide(s) but the current presentation has ${slides.length}.`
            : `El número de diapositivas no coincide: el archivo importado tiene ${importedSlides.length} diapositiva(s) pero la presentación actual tiene ${slides.length}.`
        );
        return;
      }
      for (let i = 0; i < importedSlides.length; i++) {
        const notes = (importedSlides[i].presenterNotes || "").trim();
        store.updateSlideNotes(i, notes);
      }
      setNoteDraft(slides[store.selectedSlideIndex] ? (importedSlides[store.selectedSlideIndex]?.presenterNotes || "").trim() : "");
    } catch (err) {
      console.error("Notes import error:", err);
      alert(lang === "en" ? "Failed to import notes" : "Error al importar las notas");
    } finally {
      setImportingNotes(false);
      if (notesImportRef.current) notesImportRef.current.value = "";
    }
  }, [importingNotes, slides, lang, store]);

  const handleDownloadPptx = useCallback(async () => {
    if (downloading || slides.length === 0) return;
    setDownloading(true);
    setExportProgress({ step: lang === "en" ? "Preparing slides..." : "Preparando diapositivas...", percent: 5 });
    try {
      const presentation = manualToPresentationData(store.presentation.title, slides);

      setExportProgress({ step: lang === "en" ? "Downloading images..." : "Descargando imágenes...", percent: 10 });
      const withImages = await preDownloadManualImages(presentation, (downloaded, total) => {
        const pct = 10 + Math.round((downloaded / total) * 50);
        setExportProgress({
          step: lang === "en" ? `Downloading images (${downloaded}/${total})...` : `Descargando imágenes (${downloaded}/${total})...`,
          percent: pct,
        });
      });

      setExportProgress({ step: lang === "en" ? "Building PowerPoint..." : "Generando PowerPoint...", percent: 65 });

      const res = await fetch("/api/build-pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presentation: withImages,
          imageLayout: "full",
          stretchImages: false,
          textDensity: 30,
          slideBgColor: slides[0]?.bgColor || "FFFFFF",
          slideAccentColor: slides[0]?.accentColor || "6366F1",
        }),
      });

      if (!res.ok) {
        console.error("PPTX build failed:", res.status);
        setExportProgress({ step: lang === "en" ? "Export failed" : "Error al exportar", percent: 100 });
        await new Promise((r) => setTimeout(r, 1500));
        return;
      }

      setExportProgress({ step: lang === "en" ? "Downloading file..." : "Descargando archivo...", percent: 90 });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${store.presentation.title || "manual-deck"}.pptx`;
      a.click();
      URL.revokeObjectURL(url);

      setExportProgress({ step: lang === "en" ? "Done!" : "¡Listo!", percent: 100 });
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.error("Download error:", err);
      setExportProgress({ step: lang === "en" ? "Export failed" : "Error al exportar", percent: 100 });
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      setDownloading(false);
      setExportProgress(null);
    }
  }, [downloading, slides, store.presentation.title, lang]);

  if (!store.isLoaded) {
    return (
      <div className="text-sm text-[var(--muted)] py-10 text-center">
        Loading manual creations...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── LIST TAB ── */}
      {manualTab === "list" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">
              {lang === "en" ? "Manual Creations" : "Creaciones Manuales"}
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCreateCreation}
                className="flex items-center gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              >
                <IconPlus size={12} /> {lang === "en" ? "New Creation" : "Nueva Creación"}
              </button>
              <button
                onClick={() => setPptxImportOpen(true)}
                disabled={importing}
                className="flex items-center gap-1.5 border border-[var(--accent)]/60 text-[var(--accent)] hover:bg-[var(--accent)]/10 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
              >
                {importing
                  ? <><IconLoader size={12} className="animate-spin" /> {lang === "en" ? "Importing..." : "Importando..."}</>
                  : <><IconUpload size={12} /> {lang === "en" ? "Import PPTX" : "Importar PPTX"}</>}
              </button>
            </div>
          </div>

          {store.creations.length === 0 ? (
            <div className="text-center py-16 text-[var(--muted)]">
              <Layers size={48} className="mx-auto mb-4 opacity-30" />
              <p className="text-sm">
                {lang === "en"
                  ? "No manual creations yet. Start by creating your first one."
                  : "Aún no hay creaciones manuales. Empieza creando la primera."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {store.creations.map((creation) => {
                const selected = creation.id === store.activeCreationId;
                const slideCount = creation.presentation.slides.length;
                const firstSlide = creation.presentation.slides[0];
                return (
                  <div
                    key={creation.id}
                    className={`group rounded-xl border transition-all cursor-pointer ${
                      selected
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/30"
                        : "border-[var(--border)] hover:border-[var(--accent)]/50 hover:shadow-md"
                    }`}
                  >
                    {/* Thumbnail preview */}
                    <div
                      className="aspect-video rounded-t-xl overflow-hidden relative"
                      style={{ backgroundColor: firstSlide ? `#${firstSlide.bgColor}` : "#f1f5f9" }}
                      onClick={() => handleSelectCreation(creation.id)}
                    >
                      {firstSlide ? (
                        firstSlide.elements.map((el) => (
                          <div
                            key={el.id}
                            className="absolute overflow-hidden"
                            style={{
                              left: `${el.x}%`, top: `${el.y}%`,
                              width: `${el.w}%`, height: `${el.h}%`,
                            }}
                          >
                            {el.type === "image" && el.content ? (
                              <img src={el.content} alt="" className="w-full h-full" style={getImageAdjustmentStyle(el.imageAdjustment)} />
                            ) : el.type === "image" ? (
                              <div className="w-full h-full bg-gray-200 dark:bg-gray-700" />
                            ) : (
                              <div
                                className="text-[4px] leading-tight overflow-hidden"
                                style={{
                                  fontWeight: el.fontWeight || "normal",
                                  color: el.color ? `#${el.color}` : undefined,
                                }}
                              >
                                {el.content.split("\n").slice(0, 2).join("\n")}
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Layers size={24} className="text-[var(--muted)] opacity-30" />
                        </div>
                      )}
                    </div>
                    {/* Info row */}
                    <div className="p-3 flex items-center justify-between gap-2" onClick={() => handleSelectCreation(creation.id)}>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{creation.title}</div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {slideCount} {lang === "en" ? "slides" : "diapositivas"}
                          {" · "}
                          {new Date(creation.updatedAt).toLocaleDateString(lang === "es" ? "es-ES" : "en-US", { month: "short", day: "numeric" })}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmModal({
                              title: lang === "en" ? "Delete" : "Eliminar",
                              message: lang === "en" ? "Delete this manual creation?" : "¿Eliminar esta creación manual?",
                              danger: true,
                              onConfirm: () => {
                                store.deleteCreation(creation.id);
                                setConfirmModal(null);
                              },
                            });
                          }}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--muted)] hover:text-red-400 transition-colors"
                          title={lang === "en" ? "Delete" : "Eliminar"}
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── EDITOR TAB ── */}
      {manualTab === "editor" && activeCreation && (
      <>
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setManualTab("list")}
          className="flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--fg)] transition-colors mr-1"
        >
          <IconChevronLeft size={14} />
          {lang === "en" ? "Back" : "Volver"}
        </button>

        <input
          value={titleDraft}
          onChange={(e) => {
            const nextTitle = e.target.value;
            setTitleDraft(nextTitle);
            if (store.activeCreationId) {
              store.renameCreation(store.activeCreationId, nextTitle);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              store.saveActiveCreation();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={lang === "en" ? "Creation title" : "Título de la creación"}
          className="min-w-[220px] flex-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
        />

        <button
          onClick={() => {
            store.saveActiveCreation();
            setSavedFlash(true);
            setTimeout(() => setSavedFlash(false), 1000);
          }}
          className="p-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--border)] transition-colors"
          title={lang === "en" ? "Save" : "Guardar"}
        >
          {savedFlash ? <IconCheck size={16} className="text-green-400" /> : <IconSave size={16} />}
        </button>

        <button
          onClick={handleDownloadPptx}
          disabled={downloading || slides.length === 0}
          className="p-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-colors disabled:opacity-50"
          title={lang === "en" ? "Download PPTX" : "Descargar PPTX"}
        >
          {downloading ? <IconLoader size={16} className="animate-spin" /> : <IconDownload size={16} />}
        </button>

        <button
          onClick={() => notesImportRef.current?.click()}
          disabled={importingNotes || slides.length === 0}
          className="p-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--border)] transition-colors disabled:opacity-50"
          title={lang === "en" ? "Import notes from PPTX" : "Importar notas desde PPTX"}
        >
          {importingNotes ? <IconLoader size={16} className="animate-spin" /> : <IconUpload size={16} />}
        </button>
        <input
          ref={notesImportRef}
          type="file"
          accept=".pptx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportNotes(file);
          }}
        />

        {/* Add slide dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowLayoutPicker(!showLayoutPicker)}
            className="p-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-colors"
            title={t.manualAddSlide}
          >
            <IconPlus size={16} />
          </button>
          {showLayoutPicker && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl p-3 w-72">
              {/* Slide count stepper */}
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--border)]">
                <span className="text-xs font-semibold text-[var(--muted)]">
                  {lang === "en" ? "How many?" : "¿Cuántas?"}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setAddSlideCount((c) => Math.max(1, c - 1))}
                    className="w-6 h-6 rounded-md bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] text-xs font-bold text-[var(--fg)] transition-colors flex items-center justify-center"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={addSlideCount}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                      setAddSlideCount(v);
                    }}
                    className="w-10 h-6 text-center text-xs font-semibold bg-[var(--surface-2)] border border-[var(--border)] rounded-md outline-none focus:border-[var(--accent)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    onClick={() => setAddSlideCount((c) => Math.min(50, c + 1))}
                    className="w-6 h-6 rounded-md bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] text-xs font-bold text-[var(--fg)] transition-colors flex items-center justify-center"
                  >
                    +
                  </button>
                </div>
              </div>
              {/* Predefined templates */}
              <p className="text-xs font-semibold text-[var(--muted)] mb-2">{lang === "en" ? "Templates" : "Plantillas"}</p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {PREDEFINED_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => { store.addSlideFromTemplate(tmpl.id, addSlideCount); setShowLayoutPicker(false); }}
                    className="flex items-center gap-2 p-2 rounded-lg border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors text-left"
                  >
                    <span className="text-lg">{tmpl.icon}</span>
                    <span className="text-xs font-medium">{tmpl.label[lang]}</span>
                  </button>
                ))}
              </div>
              <div className="border-t border-[var(--border)] pt-2">
                <p className="text-xs font-semibold text-[var(--muted)] mb-2">{t.manualSelectLayout}</p>
                <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
                  {MANUAL_LAYOUTS.map((layout) => (
                    <button
                      key={layout.id}
                      onClick={() => handleAddSlide(layout.id)}
                      className="flex flex-col items-center gap-1 p-2 rounded-lg border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors"
                    >
                      <LayoutThumbnail layout={layout} active={false} />
                      <span className="text-[10px] text-[var(--muted)] text-center">{layoutLabel(layout.id, lang)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Present */}
        {onPresent && (
          <button
            onClick={onPresent}
            className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            title={lang === "en" ? "Present" : "Presentar"}
          >
            <Presentation size={16} />
          </button>
        )}

        {/* Undo / Redo */}
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => store.undo()}
            disabled={!store.canUndo()}
            className="p-2 rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={t.manualUndo}
          >
            <Undo2 size={16} />
          </button>
          <button
            onClick={() => store.redo()}
            disabled={!store.canRedo()}
            className="p-2 rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={t.manualRedo}
          >
            <Redo2 size={16} />
          </button>
        </div>

        <div className="w-px h-6 bg-[var(--border)] mx-1" />

        {/* Quick add title + subtitle */}
        {currentSlide && (
          <button
            onClick={handleAddTitleSubtitle}
            disabled={currentSlide.elements.some((el) => el.type === "title") && currentSlide.elements.some((el) => el.type === "subtitle")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--surface-2)] hover:bg-[var(--border)] transition-colors text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-30 disabled:cursor-not-allowed"
            title={lang === "en" ? "Add title & subtitle" : "Añadir título y subtítulo"}
          >
            <IconType size={12} />
            {lang === "en" ? "Title + Subtitle" : "Título + Subtítulo"}
          </button>
        )}

        <div className="w-px h-6 bg-[var(--border)] mx-1" />

        {/* Add elements */}
        {currentSlide && (
          <div className="flex items-center gap-1">
            <button onClick={() => handleAddElement("title")} className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors text-[var(--muted)] hover:text-[var(--fg)]" title={t.manualAddTitle}>
              <IconType size={14} />
            </button>
            <button onClick={() => handleAddElement("subtitle")} className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors text-[var(--muted)] hover:text-[var(--fg)] text-xs font-semibold" title={t.manualAddSubtitle}>
              Tt
            </button>
            <button onClick={() => handleAddElement("text")} className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors text-[var(--muted)] hover:text-[var(--fg)]" title={t.manualAddText}>
              <IconPencil size={14} />
            </button>
            <button onClick={() => handleAddElement("bullets")} className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors text-[var(--muted)] hover:text-[var(--fg)]" title={t.manualAddBullets}>
              ≡
            </button>
            <button onClick={() => handleAddElement("image")} className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors text-[var(--muted)] hover:text-[var(--fg)]" title={t.manualAddImage}>
              <IconImage size={14} />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowShapePicker((v) => !v)}
                className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors text-[var(--muted)] hover:text-[var(--fg)]"
                title={lang === "en" ? "Add shape" : "Añadir forma"}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              </button>
              {showShapePicker && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl p-2 w-44">
                  {SHAPE_KINDS.map((sk) => (
                    <button
                      key={sk.id}
                      onClick={() => {
                        if (!currentSlide) return;
                        const el = buildShapeElement(currentSlide, sk.id);
                        store.addElement(store.selectedSlideIndex, el);
                        store.selectElement(el.id);
                        setSelectedElementIds(new Set([el.id]));
                        setShowShapePicker(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[var(--surface-2)] text-xs text-left transition-colors"
                    >
                      <span className="text-base leading-none w-5 text-center">{sk.icon}</span>
                      {sk.label[lang]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => {
                setYoutubeEditElementId(null);
                setYoutubeUrlInput("");
                setYoutubeUrlError(false);
                setShowYoutubePrompt(true);
              }}
              className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors text-[var(--muted)] hover:text-[var(--fg)]"
              title={t.manualAddYoutube}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="4" /><polygon points="10 8.5 16 12 10 15.5" fill="currentColor" stroke="none" /></svg>
            </button>
            {/* Connector / arrow picker */}
            <div className="relative">
              <button
                onClick={() => setShowConnectorPicker((v) => !v)}
                className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors text-[var(--muted)] hover:text-[var(--fg)]"
                title={lang === "en" ? "Add connector/arrow" : "Añadir conector/flecha"}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </button>
              {showConnectorPicker && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl p-2 w-44">
                  {CONNECTOR_STYLES.map((cs) => (
                    <button
                      key={cs.id}
                      onClick={() => {
                        if (!currentSlide) return;
                        const el = buildConnectorElement(currentSlide, cs.id);
                        store.addElement(store.selectedSlideIndex, el);
                        store.selectElement(el.id);
                        setSelectedElementIds(new Set([el.id]));
                        setShowConnectorPicker(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[var(--surface-2)] text-xs text-left transition-colors"
                    >
                      <span className="text-base leading-none w-5 text-center">{cs.icon}</span>
                      {cs.label[lang]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Grid selector */}
        {currentSlide && (
          <>
            <div className="w-px h-6 bg-[var(--border)] mx-1" />
            <select
              value={gridPreset}
              onChange={(e) => setGridPreset(e.target.value as GridPreset)}
              className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--muted)]"
              title={lang === "en" ? "Grid" : "Rejilla"}
            >
              {GRID_PRESETS.map((gp) => (
                <option key={gp.id} value={gp.id}>{lang === "en" ? "Grid" : "Rejilla"}: {gp.label[lang]}</option>
              ))}
            </select>
          </>
        )}

        <div className="flex-1" />

        {store.lastSavedAt && (
          <span className="text-[11px] text-[var(--muted)]">
            {lang === "en" ? "Autosaved" : "Guardado automático"}
          </span>
        )}

        {/* Fullscreen toggle */}
        {currentSlide && (
          <button
            onClick={() => store.setFullscreen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg hover:bg-[var(--surface-2)] transition-colors text-[var(--muted)] hover:text-[var(--fg)]"
          >
            <IconFullscreen size={14} /> {t.manualFullscreen}
          </button>
        )}
      </div>

      {/* Main area: sidebar + canvas + properties */}
      {slides.length === 0 ? (
        <div className="text-center py-20 text-[var(--muted)]">
          <Layers size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-sm">{t.manualNoSlides}</p>
        </div>
      ) : (
        <div className="flex gap-3" style={{ minHeight: 500 }}>
          {/* Slide list sidebar */}
          <div className="w-32 shrink-0 space-y-0 overflow-y-auto max-h-[calc(100vh-250px)] pr-1" onMouseLeave={() => setHoverInsertIndex(null)}>
            {slides.map((slide, i) => (
              <div key={slide.id} className="relative">
                {/* Hover insert zone before this slide */}
                <div
                  className="relative h-2 -my-1 z-10 flex items-center justify-center cursor-pointer group/insert"
                  onMouseEnter={() => setHoverInsertIndex(i)}
                  onMouseLeave={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const isInside = e.clientY >= rect.top && e.clientY <= rect.bottom;
                    if (!isInside) setHoverInsertIndex(null);
                  }}
                  onClick={(e) => { e.stopPropagation(); store.insertSlideAt(i, "single"); setHoverInsertIndex(null); }}
                >
                  <div className={`absolute inset-x-1 h-0.5 rounded-full transition-all ${hoverInsertIndex === i ? "bg-[var(--accent)] shadow-[0_0_4px_var(--accent)]" : "bg-transparent"}`} />
                  <div className={`relative z-10 w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold transition-all ${hoverInsertIndex === i ? "bg-[var(--accent)] scale-100 opacity-100" : "scale-0 opacity-0"}`}>
                    +
                  </div>
                </div>
                {/* Insertion line before this slide (drag) */}
                {dragOverIndex === i && dragSourceIndex !== null && dragSourceIndex !== i && dragSourceIndex !== i - 1 && (
                  <div className="h-0.5 bg-[var(--accent)] rounded-full mx-1 -mt-px mb-0.5 shadow-[0_0_4px_var(--accent)]" />
                )}
                <div
                  draggable
                  onDragStart={(e) => handleSlideDragStart(e, i)}
                  onDragOver={(e) => handleSlideDragOver(e, i)}
                  onDrop={(e) => handleSlideDrop(e)}
                  onDragEnd={handleSlideDragEnd}
                  className={`relative group my-1 ${dragSourceIndex === i ? "opacity-40" : ""}`}
                >
                  <SlideThumbnail
                  slide={slide}
                  index={i}
                  isSelected={i === store.selectedSlideIndex}
                  isMultiSelected={selectedSlideIndices.has(i)}
                  onClick={(e) => handleSlideClick(i, e)}
                />
                {/* Slide actions on hover */}
                <div className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); store.duplicateSlide(i); }}
                    className="p-0.5 rounded bg-white/90 dark:bg-black/70 text-[var(--muted)] hover:text-[var(--fg)]"
                    title={t.manualDuplicateSlide}
                  >
                    <IconCopy size={10} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const slideIdx = i;
                      setConfirmModal({
                        title: lang === "en" ? "Delete slide" : "Eliminar diapositiva",
                        message: t.manualDeleteSlideConfirm,
                        danger: true,
                        onConfirm: () => {
                          store.deleteSlide(slideIdx);
                          setConfirmModal(null);
                        },
                      });
                    }}
                    className="p-0.5 rounded bg-white/90 dark:bg-black/70 text-[var(--muted)] hover:text-red-400"
                    title={t.manualDeleteSlide}
                  >
                    <IconTrash size={10} />
                  </button>
                </div>
                {/* Reorder arrows */}
                <div className="absolute left-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-0.5">
                  {i > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); store.moveSlide(i, i - 1); }}
                      className="p-0.5 rounded bg-white/90 dark:bg-black/70 text-[var(--muted)] hover:text-[var(--fg)]"
                    >
                      <ChevronUp size={10} />
                    </button>
                  )}
                  {i < slides.length - 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); store.moveSlide(i, i + 1); }}
                      className="p-0.5 rounded bg-white/90 dark:bg-black/70 text-[var(--muted)] hover:text-[var(--fg)]"
                    >
                      <ChevronDown size={10} />
                    </button>
                  )}
                </div>
                {/* Insertion line after last slide */}
                {i === slides.length - 1 && dragOverIndex === slides.length && dragSourceIndex !== null && dragSourceIndex !== slides.length - 1 && (
                  <div className="h-0.5 bg-[var(--accent)] rounded-full mx-1 mt-0.5 shadow-[0_0_4px_var(--accent)]" />
                )}
              </div>
              </div>
            ))}
            {/* Hover insert zone after all slides */}
            <div
              className="relative h-2 -my-1 z-10 flex items-center justify-center cursor-pointer group/insert"
              onMouseEnter={() => setHoverInsertIndex(slides.length)}
              onMouseLeave={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const isInside = e.clientY >= rect.top && e.clientY <= rect.bottom;
                if (!isInside) setHoverInsertIndex(null);
              }}
              onClick={(e) => { e.stopPropagation(); store.insertSlideAt(slides.length, "single"); setHoverInsertIndex(null); }}
            >
              <div className={`absolute inset-x-1 h-0.5 rounded-full transition-all ${hoverInsertIndex === slides.length ? "bg-[var(--accent)] shadow-[0_0_4px_var(--accent)]" : "bg-transparent"}`} />
              <div className={`relative z-10 w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold transition-all ${hoverInsertIndex === slides.length ? "bg-[var(--accent)] scale-100 opacity-100" : "scale-0 opacity-0"}`}>
                +
              </div>
            </div>
            {/* Add slide button at bottom of sidebar */}
            <button
              onClick={() => setShowLayoutPicker(!showLayoutPicker)}
              className="w-full aspect-[16/9] rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-all flex items-center justify-center text-[var(--muted)] hover:text-[var(--accent)]"
              title={t.manualAddSlide}
            >
              <IconPlus size={20} />
            </button>
          </div>

          {/* Canvas + Notes area */}
          <div className="flex-1 min-w-0 space-y-3">
            {currentSlide && (
              <>
                {/* Slide canvas */}
                <div
                  ref={canvasRef}
                  className="relative w-full aspect-[16/9] rounded-xl overflow-hidden border border-[var(--border)] shadow-sm"
                  style={{ backgroundColor: `#${currentSlide.bgColor}` }}
                  onMouseDown={() => {
                    setSelectedElementIds(new Set());
                    setEditingElement(null);
                    store.selectElement(null);
                  }}
                >
                  {/* Alignment grid guides (configurable) */}
                  <div className="absolute inset-0 pointer-events-none">
                    {(() => {
                      const grid = getGridLines(gridPreset);
                      return (
                        <>
                          {grid.vertical.map((v) => (
                            <div key={`grid-v-${v}`} className="absolute top-0 bottom-0 w-px" style={{ left: `${v}%`, backgroundColor: v === 50 ? "var(--accent)" : "var(--border)", opacity: v === 50 ? 0.2 : 0.4 }} />
                          ))}
                          {grid.horizontal.map((h) => (
                            <div key={`grid-h-${h}`} className="absolute left-0 right-0 h-px" style={{ top: `${h}%`, backgroundColor: h === 50 ? "var(--accent)" : "var(--border)", opacity: h === 50 ? 0.2 : 0.4 }} />
                          ))}
                        </>
                      );
                    })()}
                    {activeGuides.vertical.map((guide) => (
                      <div
                        key={`manual-v-${guide}`}
                        className="absolute top-0 bottom-0 w-px -translate-x-1/2 bg-[var(--accent)]"
                        style={{ left: `${guide}%` }}
                      />
                    ))}
                    {activeGuides.horizontal.map((guide) => (
                      <div
                        key={`manual-h-${guide}`}
                        className="absolute left-0 right-0 h-px -translate-y-1/2 bg-[var(--accent)]"
                        style={{ top: `${guide}%` }}
                      />
                    ))}
                  </div>

                  {currentSlide.elements.map((el) => (
                    <CanvasElement
                      key={el.id}
                      element={el}
                      isSelected={selectedElementIds.has(el.id)}
                      scale={canvasScale}
                      onSelect={(event) => handleElementSelect(el.id, event)}
                      onUpdate={(updates) => handleElementUpdate(el, updates)}
                      onGuideChange={setActiveGuides}
                      onDoubleClick={() => {
                        if (el.type === "image") {
                          store.setShowImageSearch(true, el.id);
                        } else if (el.type !== "shape") {
                          setEditingElement(el.id);
                        }
                      }}
                      onSettingsClick={() => {
                        setSelectedElementIds(new Set([el.id]));
                        store.selectElement(el.id);
                      }}
                      onChangeClick={() => {
                        setSelectedElementIds(new Set([el.id]));
                        store.selectElement(el.id);
                        if (el.type === "youtube") {
                          setYoutubeEditElementId(el.id);
                          setYoutubeUrlInput(el.youtubeUrl || "");
                          setYoutubeUrlError(false);
                          setShowYoutubePrompt(true);
                          return;
                        }
                        store.setShowImageSearch(true, el.id);
                      }}
                      onImageDrop={(dataUrl) => {
                        store.updateElement(store.selectedSlideIndex, el.id, {
                          content: dataUrl,
                          imageSource: "upload",
                          imageAdjustment: { ...DEFAULT_IMAGE_ADJUSTMENT },
                        });
                      }}
                      isEditing={editingElement === el.id}
                      onEditStart={() => setEditingElement(el.id)}
                      onEditEnd={(content) => {
                        if (content !== el.content) {
                          store.updateElement(store.selectedSlideIndex, el.id, { content });
                        }
                        setEditingElement(null);
                      }}
                    />
                  ))}

                  {/* Accent bar at bottom */}
                  <div
                    className="absolute bottom-0 left-0 right-0 h-[3px] z-20 pointer-events-none"
                    style={{ backgroundColor: `#${currentSlide.accentColor}` }}
                  />
                </div>

                {/* Background & accent bar colors */}
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    {lang === "en" ? "Background" : "Fondo"}
                    <input
                      type="color"
                      value={`#${currentSlide.bgColor}`}
                      onChange={(e) => store.updateSlideBgColor(store.selectedSlideIndex, e.target.value.replace("#", ""))}
                      className="w-7 h-7 rounded-md border border-[var(--border)] cursor-pointer bg-transparent p-0"
                    />
                    <input
                      type="text"
                      value={currentSlide.bgColor}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                        store.updateSlideBgColor(store.selectedSlideIndex, v);
                      }}
                      maxLength={6}
                      className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-20 font-mono"
                      placeholder="FFFFFF"
                    />
                    {slides.length > 1 && (
                      <button
                        onClick={() => store.applyBgColorToAll(currentSlide.bgColor)}
                        className="px-2 py-1 text-[10px] rounded bg-[var(--surface-2)] hover:bg-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors whitespace-nowrap"
                        title={lang === "en" ? "Apply background color to all slides" : "Aplicar color de fondo a todas las diapositivas"}
                      >
                        {lang === "en" ? "Apply to all" : "Aplicar a todas"}
                      </button>
                    )}
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    {lang === "en" ? "Accent bar" : "Barra de acento"}
                    <input
                      type="color"
                      value={`#${currentSlide.accentColor}`}
                      onChange={(e) => store.updateSlideAccentColor(store.selectedSlideIndex, e.target.value.replace("#", ""))}
                      className="w-7 h-7 rounded-md border border-[var(--border)] cursor-pointer bg-transparent p-0"
                    />
                    <input
                      type="text"
                      value={currentSlide.accentColor}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                        store.updateSlideAccentColor(store.selectedSlideIndex, v);
                      }}
                      maxLength={6}
                      className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-xs w-20 font-mono"
                      placeholder="6366F1"
                    />
                  </label>
                  {/* Layout button */}
                  <div className="relative">
                    <button
                      onClick={() => setShowChangeLayoutPopup(!showChangeLayoutPopup)}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                        showChangeLayoutPopup
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]"
                      }`}
                      title={t.manualSelectLayout}
                    >
                      <Layers size={12} />
                      <span>{layoutLabel(currentSlide.layout, lang)}</span>
                    </button>
                    {showChangeLayoutPopup && (
                      <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl p-3 w-[340px]">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-[var(--muted)] font-medium">{t.manualSelectLayout}</span>
                          <button onClick={() => setShowChangeLayoutPopup(false)} className="text-xs text-[var(--muted)] hover:text-[var(--fg)]">✕</button>
                        </div>
                        <div className="grid grid-cols-5 gap-2">
                          {MANUAL_LAYOUTS.map((layout) => {
                            const active = currentSlide.layout === layout.id;
                            return (
                              <button
                                key={layout.id}
                                onClick={() => { store.updateSlideLayout(store.selectedSlideIndex, layout.id); setShowChangeLayoutPopup(false); }}
                                className={`rounded-lg p-1 transition-all flex flex-col items-center ${
                                  active
                                    ? "ring-2 ring-[var(--accent)] bg-[var(--accent)]/10"
                                    : "hover:bg-[var(--surface-2)] bg-transparent"
                                }`}
                              >
                                <LayoutThumbnail layout={layout} active={active} />
                                <span className="block text-[9px] mt-0.5 truncate text-center" style={{ color: active ? "var(--accent)" : "var(--muted)" }}>
                                  {layoutLabel(layout.id, lang)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Notes section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">{t.manualSlideNotes}</h3>
                      <p className="text-[11px] text-[var(--muted)]">{t.manualNotesHint}</p>
                    </div>
                    <button
                      onClick={handleOpenAINotesModal}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--border)] transition-colors"
                    >
                      <IconSparkles size={12} />
                      {t.manualGenerateNotes}
                    </button>
                  </div>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onBlur={commitNotes}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        commitNotes();
                      }
                    }}
                    rows={4}
                    placeholder={t.manualWriteNotes}
                    className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--accent)]"
                    style={{ textAlign: "justify" }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Properties panel – always visible */}
          <div className="w-48 shrink-0 bg-[var(--surface-2)] rounded-xl p-3 border border-[var(--border)] self-start min-h-[120px]">
            {selectedElement && currentSlide ? (
              <>
                <PropertiesPanel
                  element={selectedElement}
                  slideIndex={store.selectedSlideIndex}
                  lang={lang}
                  onUpdate={(updates) => handleElementUpdate(selectedElement, updates)}
                />
                <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-2">
                  <div className="grid grid-cols-3 gap-1">
                    <button onClick={() => handleAlign("left")} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface)] hover:bg-[var(--border)]" title={t.manualAlignLeft}>L</button>
                    <button onClick={() => handleAlign("center")} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface)] hover:bg-[var(--border)]" title={t.manualAlignCenter}>C</button>
                    <button onClick={() => handleAlign("right")} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface)] hover:bg-[var(--border)]" title={t.manualAlignRight}>R</button>
                    <button onClick={() => handleAlign("top")} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface)] hover:bg-[var(--border)]" title={t.manualAlignTop}>T</button>
                    <button onClick={() => handleAlign("middle")} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface)] hover:bg-[var(--border)]" title={t.manualAlignMiddle}>M</button>
                    <button onClick={() => handleAlign("bottom")} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface)] hover:bg-[var(--border)]" title={t.manualAlignBottom}>B</button>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => handleLayerShift(1)} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface)] hover:bg-[var(--border)]" title={t.manualBringForward}>{t.manualBringForward}</button>
                    <button onClick={() => handleLayerShift(-1)} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface)] hover:bg-[var(--border)]" title={t.manualSendBackward}>{t.manualSendBackward}</button>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      onClick={handleGroupSelection}
                      disabled={selectedElementIds.size < 2}
                      className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface)] hover:bg-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed"
                      title={lang === "en" ? "Group selected" : "Agrupar selección"}
                    >
                      {lang === "en" ? "Group" : "Agrupar"}
                    </button>
                    <button
                      onClick={handleUngroupSelection}
                      disabled={!hasGroupedSelection}
                      className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface)] hover:bg-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed"
                      title={lang === "en" ? "Ungroup selected" : "Desagrupar selección"}
                    >
                      {lang === "en" ? "Ungroup" : "Desagrupar"}
                    </button>
                  </div>
                  {selectedElement.type === "image" && (
                    <button
                      onClick={() => store.setShowImageSearch(true, selectedElement.id)}
                      className="w-full flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[var(--surface)] hover:bg-[var(--border)] transition-colors"
                    >
                      <IconSearch size={12} /> {t.manualSearchImages}
                    </button>
                  )}
                  {selectedElement.type !== "image" && selectedElement.type !== "youtube" && selectedElement.type !== "connector" && (
                    <button
                      onClick={() => setEditingElement(selectedElement.id)}
                      className="w-full flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[var(--surface)] hover:bg-[var(--border)] transition-colors"
                    >
                      <IconPencil size={12} /> {t.manualEditText}
                    </button>
                  )}
                  {/* Duplicate element */}
                  <button
                    onClick={() => {
                      if (!currentSlide) return;
                      const dup: ManualSlideElement = {
                        ...JSON.parse(JSON.stringify(selectedElement)),
                        id: crypto.randomUUID(),
                        x: Math.min(90, selectedElement.x + 2),
                        y: Math.min(90, selectedElement.y + 2),
                      };
                      store.addElement(store.selectedSlideIndex, dup);
                      store.selectElement(dup.id);
                      setSelectedElementIds(new Set([dup.id]));
                    }}
                    className="w-full flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[var(--surface)] hover:bg-[var(--border)] transition-colors"
                  >
                    <IconCopy size={12} /> {lang === "en" ? "Duplicate" : "Duplicar"}
                  </button>
                  {/* Download image */}
                  {selectedElement.type === "image" && selectedElement.content && (
                    <button
                      onClick={() => {
                        const link = document.createElement("a");
                        link.href = selectedElement.content;
                        link.download = `image-${selectedElement.id.slice(0, 8)}.png`;
                        link.target = "_blank";
                        link.click();
                      }}
                      className="w-full flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[var(--surface)] hover:bg-[var(--border)] transition-colors"
                    >
                      <IconDownload size={12} /> {lang === "en" ? "Download Image" : "Descargar Imagen"}
                    </button>
                  )}
                  <button
                    onClick={() => store.removeElement(store.selectedSlideIndex, selectedElement.id)}
                    className="w-full flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <IconTrash size={12} /> {t.manualRemoveElement}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-[var(--muted)] py-6">
                <Layers size={20} className="opacity-30 mb-2" />
                <p className="text-[11px] text-center">
                  {lang === "en" ? "Select an element to see its properties" : "Selecciona un elemento para ver sus propiedades"}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* YouTube URL prompt modal */}
      {showYoutubePrompt && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => {
            setShowYoutubePrompt(false);
            setYoutubeEditElementId(null);
          }}
        >
          <div
            className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl p-5 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="4" /><polygon points="10 8.5 16 12 10 15.5" fill="currentColor" stroke="none" /></svg>
              {youtubeEditElementId ? (lang === "en" ? "Edit YouTube Link" : "Editar enlace de YouTube") : t.manualAddYoutube}
            </h3>
            <label className="block text-xs text-[var(--muted)] mb-1.5">{t.manualYoutubeUrlPrompt}</label>
            <input
              type="url"
              autoFocus
              value={youtubeUrlInput}
              onChange={(e) => { setYoutubeUrlInput(e.target.value); setYoutubeUrlError(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddYoutube(youtubeUrlInput); }}
              placeholder={t.manualYoutubeUrlPlaceholder}
              className={`w-full bg-[var(--surface)] border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)] ${
                youtubeUrlError ? "border-red-500" : "border-[var(--border)]"
              }`}
            />
            {youtubeUrlError && (
              <p className="text-xs text-red-500 mt-1">{t.manualYoutubeInvalidUrl}</p>
            )}
            {youtubeUrlInput && extractYoutubeVideoId(youtubeUrlInput) && (
              <div className="mt-3 rounded-lg overflow-hidden aspect-video bg-black">
                <img
                  src={`https://img.youtube.com/vi/${extractYoutubeVideoId(youtubeUrlInput)}/hqdefault.jpg`}
                  alt="Preview"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => {
                  setShowYoutubePrompt(false);
                  setYoutubeEditElementId(null);
                }}
                className="px-4 py-2 text-xs text-[var(--muted)] hover:text-[var(--fg)] rounded-lg hover:bg-[var(--surface-2)] transition-colors"
              >
                {lang === "en" ? "Cancel" : "Cancelar"}
              </button>
              <button
                onClick={() => handleAddYoutube(youtubeUrlInput)}
                disabled={!youtubeUrlInput.trim()}
                className="px-4 py-2 text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition-colors disabled:opacity-40"
              >
                {youtubeEditElementId ? (lang === "en" ? "Update Video" : "Actualizar vídeo") : (lang === "en" ? "Insert Video" : "Insertar Vídeo")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image search modal */}
      {store.showImageSearch && (
        <ImageSearchModal
          slotIndex={0}
          slideTitle={currentSlide?.elements.find((el) => el.type === "title")?.content}
          onSelect={(image) => {
            if (store.imageSearchTargetElementId) {
              store.updateElement(store.selectedSlideIndex, store.imageSearchTargetElementId, {
                content: image.url,
                imageSource: image.source,
                imageAdjustment: { ...DEFAULT_IMAGE_ADJUSTMENT },
              });
            }
            store.setShowImageSearch(false);
            prefetchImageBlob(image.url);
          }}
          onClose={() => store.setShowImageSearch(false)}
        />
      )}

      {/* AI Notes modal */}
      {showAINotesModal && currentSlide && (
        <AINotesModal
          slideContent={currentSlide.elements
            .map((el) => el.type !== "image" ? el.content : "")
            .filter(Boolean)
            .join("\n")}
          slideTitle={currentSlide.elements.find((el) => el.type === "title")?.content || ""}
          existingNotes={currentSlide.notes || ""}
          lang={lang}
          onSave={handleAINotesSave}
          onClose={() => setShowAINotesModal(false)}
        />
      )}

      {/* Export progress modal */}
      {exportProgress && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
          <div className="bg-[var(--surface)] rounded-xl p-6 w-[380px] max-w-[90vw] shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              {exportProgress.percent < 100 || exportProgress.step.includes("!") || exportProgress.step.includes("¡") ? (
                <div className="w-8 h-8 rounded-full bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
                  {exportProgress.percent >= 100 ? (
                    <IconCheck size={16} className="text-green-400" />
                  ) : (
                    <IconLoader size={16} className="text-[var(--accent)] animate-spin" />
                  )}
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                  <IconWarning size={16} className="text-red-400" />
                </div>
              )}
              <div className="min-w-0">
                <h3 className="text-sm font-semibold truncate">
                  {lang === "en" ? "Exporting to PowerPoint" : "Exportando a PowerPoint"}
                </h3>
                <p className="text-xs text-[var(--muted)] truncate">{exportProgress.step}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="h-2.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${exportProgress.percent}%` }}
                />
              </div>
              <p className="text-[11px] text-[var(--muted)] text-right">{exportProgress.percent}%</p>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen editor */}
      {store.isFullscreen && currentSlide && (
        <ManualFullscreenEditor
          slide={currentSlide}
          slideIndex={store.selectedSlideIndex}
          onClose={() => store.setFullscreen(false)}
        />
      )}
      </>
      )}

      <ConfirmModal
        open={!!confirmModal}
        title={confirmModal?.title ?? ""}
        message={confirmModal?.message ?? ""}
        danger={confirmModal?.danger}
        confirmLabel={lang === "es" ? "Confirmar" : "Confirm"}
        cancelLabel={lang === "es" ? "Cancelar" : "Cancel"}
        onConfirm={() => confirmModal?.onConfirm()}
        onCancel={() => setConfirmModal(null)}
      />

      <PptxImportModal
        open={pptxImportOpen}
        onClose={() => setPptxImportOpen(false)}
        onImport={handlePptxModalImport}
      />

    </div>
  );
}

// ── Fullscreen editor for manual creator ──
function ManualFullscreenEditor({ slide, slideIndex, onClose }: {
  slide: ManualSlide;
  slideIndex: number;
  onClose: () => void;
}) {
  const store = useManualStore();
  const appStore = useAppStore();
  const lang = appStore.settings.language;
  const t = UI_TEXT[lang];
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [editingElement, setEditingElement] = useState<string | null>(null);
  const [showAINotesModalFS, setShowAINotesModalFS] = useState(false);
  const [noteDraft, setNoteDraft] = useState(slide.notes);
  const [activeGuides, setActiveGuides] = useState<GuideState>(DEFAULT_GUIDES);
  const [zoomLevel, setZoomLevel] = useState(1000);
  const [showShapePickerFS, setShowShapePickerFS] = useState(false);
  const [showConnectorPickerFS, setShowConnectorPickerFS] = useState(false);
  const [showSlideListFS, setShowSlideListFS] = useState(false);
  const [showYoutubePromptFS, setShowYoutubePromptFS] = useState(false);
  const [youtubeUrlInputFS, setYoutubeUrlInputFS] = useState("");
  const [youtubeUrlErrorFS, setYoutubeUrlErrorFS] = useState(false);
  const [youtubeEditElementIdFS, setYoutubeEditElementIdFS] = useState<string | null>(null);
  const ZOOM_STEP = 100;
  const ZOOM_MIN = 500;
  const ZOOM_MAX = 1400;

  useEffect(() => {
    const measure = () => {
      if (canvasRef.current) {
        setCanvasScale(canvasRef.current.offsetWidth / 960);
      }
    };
    // Delay measurement slightly so layout settles after zoom change
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [zoomLevel]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleOpenAINotesModalFS = useCallback(() => {
    setShowAINotesModalFS(true);
  }, []);

  const handleAINotesSaveFS = useCallback((notes: string) => {
    setNoteDraft(notes);
    store.updateSlideNotes(slideIndex, notes);
  }, [store, slideIndex]);

  const currentSlide = store.presentation.slides[slideIndex];
  const selectedElement = currentSlide?.elements.find((element) => element.id === store.selectedElementId);

  useEffect(() => {
    setNoteDraft(currentSlide?.notes || "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlide?.id]);

  const commitNotes = useCallback(() => {
    store.updateSlideNotes(slideIndex, noteDraft);
  }, [noteDraft, slideIndex, store]);

  const handleAddTitleSubtitle = useCallback(() => {
    const s = currentSlide || slide;
    const hasTitle = s.elements.some((el) => el.type === "title");
    const hasSubtitle = s.elements.some((el) => el.type === "subtitle");
    if (!hasTitle) {
      const titleEl = buildDefaultElement(s, "title");
      store.addElement(slideIndex, titleEl);
      const updatedSlide = { ...s, elements: [...s.elements, titleEl] };
      if (!hasSubtitle) {
        const subtitleEl = buildDefaultElement(updatedSlide, "subtitle");
        store.addElement(slideIndex, subtitleEl);
      }
    } else if (!hasSubtitle) {
      const subtitleEl = buildDefaultElement(s, "subtitle");
      store.addElement(slideIndex, subtitleEl);
    }
  }, [currentSlide, slide, slideIndex, store]);

  const handleAlign = useCallback((target: AlignmentTarget) => {
    if (!selectedElement) return;
    store.updateElement(slideIndex, selectedElement.id, alignElement(selectedElement, target));
  }, [selectedElement, slideIndex, store]);

  const handleLayerShift = useCallback((delta: number) => {
    if (!selectedElement) return;
    store.updateElement(slideIndex, selectedElement.id, shiftLayer(selectedElement, delta));
  }, [selectedElement, slideIndex, store]);

  const handleUpsertYoutubeFS = useCallback(() => {
    const videoId = extractYoutubeVideoId(youtubeUrlInputFS);
    if (!videoId) {
      setYoutubeUrlErrorFS(true);
      return;
    }

    const embedUrl = `https://www.youtube.com/embed/${videoId}`;
    if (youtubeEditElementIdFS) {
      store.updateElement(slideIndex, youtubeEditElementIdFS, {
        youtubeUrl: youtubeUrlInputFS,
        content: embedUrl,
      });
      store.selectElement(youtubeEditElementIdFS);
    } else {
      const s = currentSlide || slide;
      const el = buildDefaultElement(s, "youtube");
      el.youtubeUrl = youtubeUrlInputFS;
      el.content = embedUrl;
      store.addElement(slideIndex, el);
      store.selectElement(el.id);
    }

    setShowYoutubePromptFS(false);
    setYoutubeUrlErrorFS(false);
    setYoutubeUrlInputFS("");
    setYoutubeEditElementIdFS(null);
  }, [currentSlide, slide, slideIndex, store, youtubeEditElementIdFS, youtubeUrlInputFS]);

  return (
    <div className="fixed inset-0 z-[60] bg-[var(--bg)] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
        {/* Left: close + slide indicator */}
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors">
          <IconMinimize size={16} />
        </button>
        <button
          onClick={() => setShowSlideListFS((v) => !v)}
          className={`p-2 rounded-lg transition-colors ${showSlideListFS ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "hover:bg-[var(--surface-2)]"}`}
          title={lang === "en" ? "Toggle slide list" : "Mostrar/ocultar diapositivas"}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <line x1="14" y1="4" x2="21" y2="4" />
            <line x1="14" y1="9" x2="21" y2="9" />
            <line x1="14" y1="15" x2="21" y2="15" />
            <line x1="14" y1="20" x2="21" y2="20" />
          </svg>
        </button>
        <span className="text-sm font-medium">
          Slide {slideIndex + 1} / {store.presentation.slides.length}
        </span>

        {/* Center: all action buttons */}
        <div className="flex-1 flex items-center justify-center gap-1">
          {/* Undo/redo */}
          <button onClick={() => store.undo()} disabled={!store.canUndo()} className="p-2 rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors">
            <Undo2 size={16} />
          </button>
          <button onClick={() => store.redo()} disabled={!store.canRedo()} className="p-2 rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors">
            <Redo2 size={16} />
          </button>
          <div className="w-px h-6 bg-[var(--border)] mx-1" />
          {/* Title + Subtitle */}
          <button
            onClick={handleAddTitleSubtitle}
            disabled={!!(currentSlide?.elements.some((el) => el.type === "title") && currentSlide?.elements.some((el) => el.type === "subtitle"))}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--surface-2)] hover:bg-[var(--border)] transition-colors text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-30 disabled:cursor-not-allowed"
            title={lang === "en" ? "Add title & subtitle" : "Añadir título y subtítulo"}
          >
            <IconType size={12} />
            {lang === "en" ? "Title + Subtitle" : "Título + Subtítulo"}
          </button>
          <div className="w-px h-6 bg-[var(--border)] mx-1" />
          {/* Add elements */}
          <button onClick={() => { const element = buildDefaultElement(currentSlide || slide, "title"); store.addElement(slideIndex, element); store.selectElement(element.id); }} className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors" title={t.manualAddTitle}>
            <IconType size={14} />
          </button>
          <button onClick={() => { const element = buildDefaultElement(currentSlide || slide, "subtitle"); store.addElement(slideIndex, element); store.selectElement(element.id); }} className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors text-xs font-semibold" title={t.manualAddSubtitle}>
            Tt
          </button>
          <button onClick={() => { const element = buildDefaultElement(currentSlide || slide, "text"); store.addElement(slideIndex, element); store.selectElement(element.id); }} className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors" title={t.manualAddText}>
            <IconPencil size={14} />
          </button>
          <button onClick={() => { const element = buildDefaultElement(currentSlide || slide, "bullets"); store.addElement(slideIndex, element); store.selectElement(element.id); }} className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors" title={t.manualAddBullets}>
            ≡
          </button>
          <button onClick={() => { const element = buildDefaultElement(currentSlide || slide, "image"); store.addElement(slideIndex, element); store.selectElement(element.id); }} className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors" title={t.manualAddImage}>
            <IconImage size={14} />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowShapePickerFS((v) => !v)}
              className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
              title={lang === "en" ? "Add shape" : "Añadir forma"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            </button>
            {showShapePickerFS && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl p-2 w-44">
                {SHAPE_KINDS.map((sk) => (
                  <button
                    key={sk.id}
                    onClick={() => {
                      const el = buildShapeElement(currentSlide || slide, sk.id);
                      store.addElement(slideIndex, el);
                      store.selectElement(el.id);
                      setShowShapePickerFS(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[var(--surface-2)] text-xs text-left transition-colors"
                  >
                    <span className="text-base leading-none w-5 text-center">{sk.icon}</span>
                    {sk.label[lang]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => {
              setYoutubeEditElementIdFS(null);
              setYoutubeUrlInputFS("");
              setYoutubeUrlErrorFS(false);
              setShowYoutubePromptFS(true);
            }}
            className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
            title={t.manualAddYoutube}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="4" /><polygon points="10 8.5 16 12 10 15.5" fill="currentColor" stroke="none" /></svg>
          </button>
          {/* Connector / arrow picker (fullscreen) */}
          <div className="relative">
            <button
              onClick={() => setShowConnectorPickerFS((v) => !v)}
              className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
              title={lang === "en" ? "Add connector/arrow" : "Añadir conector/flecha"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
            {showConnectorPickerFS && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl p-2 w-44">
                {CONNECTOR_STYLES.map((cs) => (
                  <button
                    key={cs.id}
                    onClick={() => {
                      const el = buildConnectorElement(currentSlide || slide, cs.id);
                      store.addElement(slideIndex, el);
                      store.selectElement(el.id);
                      setShowConnectorPickerFS(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[var(--surface-2)] text-xs text-left transition-colors"
                  >
                    <span className="text-base leading-none w-5 text-center">{cs.icon}</span>
                    {cs.label[lang]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="w-px h-6 bg-[var(--border)] mx-1" />
          {/* Zoom */}
          <button
            onClick={() => setZoomLevel((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
            disabled={zoomLevel <= ZOOM_MIN}
            className="p-2 rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors"
            title={lang === "en" ? "Zoom out" : "Alejar"}
          >
            <IconZoomOut size={16} />
          </button>
          <span className="text-xs text-[var(--muted)] min-w-[3rem] text-center">{Math.round(zoomLevel / 9)}%</span>
          <button
            onClick={() => setZoomLevel((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
            disabled={zoomLevel >= ZOOM_MAX}
            className="p-2 rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors"
            title={lang === "en" ? "Zoom in" : "Acercar"}
          >
            <IconZoomIn size={16} />
          </button>
        </div>

        {/* Right: slide nav */}
        <button
          onClick={() => { if (slideIndex > 0) store.selectSlide(slideIndex - 1); }}
          disabled={slideIndex === 0}
          className="p-2 rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors"
        >
          <IconChevronLeft size={16} />
        </button>
        <button
          onClick={() => { if (slideIndex < store.presentation.slides.length - 1) store.selectSlide(slideIndex + 1); }}
          disabled={slideIndex >= store.presentation.slides.length - 1}
          className="p-2 rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors"
        >
          <IconChevronRight size={16} />
        </button>
      </div>

      {/* Canvas + sidebars */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar: slide list (toggleable) */}
        {showSlideListFS && (
          <div className="w-44 border-r border-[var(--border)] bg-[var(--surface)] overflow-y-auto p-2 space-y-0" onMouseLeave={() => setHoverInsertIndex(null)}>
            {store.presentation.slides.map((s, i) => (
              <div key={s.id}>
                {/* Hover insert zone before this slide */}
                <div
                  className="relative h-2 -my-0.5 z-10 flex items-center justify-center cursor-pointer"
                  onMouseEnter={() => setHoverInsertIndex(i)}
                  onMouseLeave={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const isInside = e.clientY >= rect.top && e.clientY <= rect.bottom;
                    if (!isInside) setHoverInsertIndex(null);
                  }}
                  onClick={(e) => { e.stopPropagation(); store.insertSlideAt(i, "single"); setHoverInsertIndex(null); }}
                >
                  <div className={`absolute inset-x-1 h-0.5 rounded-full transition-all ${hoverInsertIndex === i ? "bg-[var(--accent)] shadow-[0_0_4px_var(--accent)]" : "bg-transparent"}`} />
                  <div className={`relative z-10 w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold transition-all ${hoverInsertIndex === i ? "bg-[var(--accent)] scale-100 opacity-100" : "scale-0 opacity-0"}`}>
                    +
                  </div>
                </div>
                <button
                  onClick={() => store.selectSlide(i)}
                  className={`w-full rounded-lg border-2 transition-all overflow-hidden ${
                    i === slideIndex
                      ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30"
                      : "border-[var(--border)] hover:border-[var(--accent)]/50"
                  }`}
                >
                <div className="aspect-[16/9] relative" style={{ backgroundColor: `#${s.bgColor}` }}>
                  {s.elements.map((el) => (
                    <div
                      key={el.id}
                      className="absolute overflow-hidden"
                      style={{
                        left: `${el.x}%`, top: `${el.y}%`,
                        width: `${el.w}%`, height: `${el.h}%`,
                      }}
                    >
                      {el.type === "image" && el.content ? (
                        <img src={el.content} alt="" className="w-full h-full object-cover" />
                      ) : el.type === "image" ? (
                        <div className="w-full h-full bg-gray-700/30" />
                      ) : el.type === "connector" ? (
                        <svg width="100%" height="100%" className="absolute inset-0">
                          <line x1="0" y1="50%" x2="100%" y2="50%" stroke={`#${el.connectorColor || "6366F1"}`} strokeWidth={1} />
                        </svg>
                      ) : el.type === "shape" ? (
                        <div className="w-full h-full" style={{ backgroundColor: `#${el.shapeFill || "6366F1"}`, borderRadius: el.shapeKind === "ellipse" ? "50%" : el.shapeKind === "rounded-rect" ? "4px" : 0, opacity: (el.shapeOpacity ?? 100) / 100 }} />
                      ) : (
                        <div className="text-[3px] leading-tight overflow-hidden" style={{ fontWeight: el.fontWeight || "normal", color: el.color ? `#${el.color}` : undefined }}>
                          {el.content?.slice(0, 30)}
                        </div>
                      )}
                    </div>
                  ))}
                  <span className="absolute bottom-0.5 right-1 text-[8px] font-medium text-white/80 bg-black/40 rounded px-0.5">{i + 1}</span>
                </div>
              </button>
              </div>
            ))}
            {/* Hover insert zone after all slides */}
            <div
              className="relative h-2 -my-0.5 z-10 flex items-center justify-center cursor-pointer"
              onMouseEnter={() => setHoverInsertIndex(store.presentation.slides.length)}
              onMouseLeave={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const isInside = e.clientY >= rect.top && e.clientY <= rect.bottom;
                if (!isInside) setHoverInsertIndex(null);
              }}
              onClick={(e) => { e.stopPropagation(); store.insertSlideAt(store.presentation.slides.length, "single"); setHoverInsertIndex(null); }}
            >
              <div className={`absolute inset-x-1 h-0.5 rounded-full transition-all ${hoverInsertIndex === store.presentation.slides.length ? "bg-[var(--accent)] shadow-[0_0_4px_var(--accent)]" : "bg-transparent"}`} />
              <div className={`relative z-10 w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold transition-all ${hoverInsertIndex === store.presentation.slides.length ? "bg-[var(--accent)] scale-100 opacity-100" : "scale-0 opacity-0"}`}>
                +
              </div>
            </div>
          </div>
        )}

        {/* Center: canvas + notes below */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Canvas */}
          <div className="flex-1 flex items-center justify-center p-3 bg-[var(--surface-2)]/30 overflow-auto">
          <div
            ref={canvasRef}
            className="relative w-full aspect-[16/9] rounded-xl overflow-hidden border border-[var(--border)] shadow-lg"
            style={{ maxWidth: `${zoomLevel}px`, backgroundColor: `#${currentSlide?.bgColor || "FFFFFF"}` }}
            onMouseDown={() => {
              setEditingElement(null);
              store.selectElement(null);
            }}
          >
            <div className="absolute inset-0 pointer-events-none">
              {/* Basic grid for fullscreen - same as "basic" preset */}
              {(() => {
                const grid = getGridLines("basic");
                return (
                  <>
                    {grid.vertical.map((v) => (
                      <div key={`fsgrid-v-${v}`} className="absolute top-0 bottom-0 w-px" style={{ left: `${v}%`, backgroundColor: v === 50 ? "var(--accent)" : "var(--border)", opacity: v === 50 ? 0.2 : 0.4 }} />
                    ))}
                    {grid.horizontal.map((h) => (
                      <div key={`fsgrid-h-${h}`} className="absolute left-0 right-0 h-px" style={{ top: `${h}%`, backgroundColor: h === 50 ? "var(--accent)" : "var(--border)", opacity: h === 50 ? 0.2 : 0.4 }} />
                    ))}
                  </>
                );
              })()}
              {activeGuides.vertical.map((guide) => (
                <div key={`fullscreen-v-${guide}`} className="absolute top-0 bottom-0 w-px -translate-x-1/2 bg-[var(--accent)]" style={{ left: `${guide}%` }} />
              ))}
              {activeGuides.horizontal.map((guide) => (
                <div key={`fullscreen-h-${guide}`} className="absolute left-0 right-0 h-px -translate-y-1/2 bg-[var(--accent)]" style={{ top: `${guide}%` }} />
              ))}
            </div>
            {currentSlide?.elements.map((el) => (
              <CanvasElement
                key={el.id}
                element={el}
                isSelected={el.id === store.selectedElementId}
                scale={canvasScale}
                onSelect={() => store.selectElement(el.id)}
                onUpdate={(updates) => store.updateElement(slideIndex, el.id, updates)}
                onGuideChange={setActiveGuides}
                onDoubleClick={() => {
                  if (el.type === "image") {
                    store.setShowImageSearch(true, el.id);
                  } else if (el.type !== "shape") {
                    setEditingElement(el.id);
                  }
                }}
                onChangeClick={() => {
                  store.selectElement(el.id);
                  if (el.type === "youtube") {
                    setYoutubeEditElementIdFS(el.id);
                    setYoutubeUrlInputFS(el.youtubeUrl || "");
                    setYoutubeUrlErrorFS(false);
                    setShowYoutubePromptFS(true);
                  }
                }}
                isEditing={editingElement === el.id}
                onEditStart={() => setEditingElement(el.id)}
                onEditEnd={(content) => {
                  if (content !== el.content) {
                    store.updateElement(slideIndex, el.id, { content });
                  }
                  setEditingElement(null);
                }}
              />
            ))}
          </div>
        </div>

          {/* Notes below canvas */}
          <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold">{t.manualSlideNotes}</h3>
                <p className="text-[10px] text-[var(--muted)]">{t.manualNotesHint}</p>
              </div>
              <button
                onClick={handleOpenAINotesModalFS}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-[var(--surface-2)] hover:bg-[var(--border)] transition-colors"
              >
                <IconSparkles size={10} />
                AI
              </button>
            </div>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={commitNotes}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  commitNotes();
                }
              }}
              rows={3}
              placeholder={t.manualWriteNotes}
              className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--accent)]"
              style={{ textAlign: "justify" }}
            />
          </div>
        </div>

        {/* Right sidebar: properties only */}
        <div className="w-56 border-l border-[var(--border)] bg-[var(--surface)] p-3 overflow-y-auto space-y-3">
          {store.selectedElementId && currentSlide && (() => {
            const el = currentSlide.elements.find((e) => e.id === store.selectedElementId);
            if (!el) return null;
            return (
              <div className="space-y-3">
                <PropertiesPanel
                  element={el}
                  slideIndex={slideIndex}
                  lang={lang}
                  onUpdate={(updates) => store.updateElement(slideIndex, el.id, updates)}
                />
                <div className="grid grid-cols-3 gap-1">
                  <button onClick={() => handleAlign("left")} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface-2)] hover:bg-[var(--border)]" title={t.manualAlignLeft}>L</button>
                  <button onClick={() => handleAlign("center")} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface-2)] hover:bg-[var(--border)]" title={t.manualAlignCenter}>C</button>
                  <button onClick={() => handleAlign("right")} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface-2)] hover:bg-[var(--border)]" title={t.manualAlignRight}>R</button>
                  <button onClick={() => handleAlign("top")} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface-2)] hover:bg-[var(--border)]" title={t.manualAlignTop}>T</button>
                  <button onClick={() => handleAlign("middle")} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface-2)] hover:bg-[var(--border)]" title={t.manualAlignMiddle}>M</button>
                  <button onClick={() => handleAlign("bottom")} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface-2)] hover:bg-[var(--border)]" title={t.manualAlignBottom}>B</button>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button onClick={() => handleLayerShift(1)} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface-2)] hover:bg-[var(--border)]" title={t.manualBringForward}>{t.manualBringForward}</button>
                  <button onClick={() => handleLayerShift(-1)} className="px-2 py-1 text-[10px] rounded-md bg-[var(--surface-2)] hover:bg-[var(--border)]" title={t.manualSendBackward}>{t.manualSendBackward}</button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* YouTube URL prompt modal (fullscreen) */}
      {showYoutubePromptFS && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => {
            setShowYoutubePromptFS(false);
            setYoutubeEditElementIdFS(null);
          }}
        >
          <div
            className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl p-5 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="4" /><polygon points="10 8.5 16 12 10 15.5" fill="currentColor" stroke="none" /></svg>
              {youtubeEditElementIdFS ? (lang === "en" ? "Edit YouTube Link" : "Editar enlace de YouTube") : t.manualAddYoutube}
            </h3>
            <label className="block text-xs text-[var(--muted)] mb-1.5">{t.manualYoutubeUrlPrompt}</label>
            <input
              type="url"
              autoFocus
              value={youtubeUrlInputFS}
              onChange={(e) => { setYoutubeUrlInputFS(e.target.value); setYoutubeUrlErrorFS(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleUpsertYoutubeFS();
                }
              }}
              placeholder={t.manualYoutubeUrlPlaceholder}
              className={`w-full bg-[var(--surface)] border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)] ${
                youtubeUrlErrorFS ? "border-red-500" : "border-[var(--border)]"
              }`}
            />
            {youtubeUrlErrorFS && (
              <p className="text-xs text-red-500 mt-1">{t.manualYoutubeInvalidUrl}</p>
            )}
            {youtubeUrlInputFS && extractYoutubeVideoId(youtubeUrlInputFS) && (
              <div className="mt-3 rounded-lg overflow-hidden aspect-video bg-black">
                <img
                  src={`https://img.youtube.com/vi/${extractYoutubeVideoId(youtubeUrlInputFS)}/hqdefault.jpg`}
                  alt="Preview"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => {
                  setShowYoutubePromptFS(false);
                  setYoutubeEditElementIdFS(null);
                }}
                className="px-4 py-2 text-xs text-[var(--muted)] hover:text-[var(--fg)] rounded-lg hover:bg-[var(--surface-2)] transition-colors"
              >
                {lang === "en" ? "Cancel" : "Cancelar"}
              </button>
              <button
                onClick={handleUpsertYoutubeFS}
                disabled={!youtubeUrlInputFS.trim()}
                className="px-4 py-2 text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition-colors disabled:opacity-40"
              >
                {youtubeEditElementIdFS ? (lang === "en" ? "Update Video" : "Actualizar vídeo") : (lang === "en" ? "Insert Video" : "Insertar Vídeo")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image search modal */}
      {store.showImageSearch && (
        <ImageSearchModal
          slotIndex={0}
          slideTitle={currentSlide?.elements.find((el) => el.type === "title")?.content}
          onSelect={(image) => {
            if (store.imageSearchTargetElementId) {
              store.updateElement(slideIndex, store.imageSearchTargetElementId, {
                content: image.url,
                imageSource: image.source,
                imageAdjustment: { ...DEFAULT_IMAGE_ADJUSTMENT },
              });
            }
            store.setShowImageSearch(false);
            prefetchImageBlob(image.url);
          }}
          onClose={() => store.setShowImageSearch(false)}
        />
      )}

      {/* AI Notes modal (fullscreen editor) */}
      {showAINotesModalFS && (
        <AINotesModal
          slideContent={slide.elements
            .map((el) => el.type !== "image" ? el.content : "")
            .filter(Boolean)
            .join("\n")}
          slideTitle={slide.elements.find((el) => el.type === "title")?.content || ""}
          existingNotes={slide.notes || ""}
          lang={lang}
          onSave={handleAINotesSaveFS}
          onClose={() => setShowAINotesModalFS(false)}
        />
      )}

    </div>
  );
}
