"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlideData } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { useBroadcastSender } from "./useBroadcastSync";
import SlideRenderer from "./SlideRenderer";
import PresenterAIChat from "./PresenterAIChat";
import { InteractiveOverlay, PresenterToolbar, MagnifierRenderer, DEFAULT_OVERLAY, clearOverlayDrawings } from "./PresenterToolsOverlay";
import type { OverlayState } from "./PresenterToolsOverlay";
import { usePresenterRemoteHost } from "./usePresenterRemote";
import QRRemoteModal from "./QRRemoteModal";
import type { SessionCommand } from "@/lib/presenter-session";
import { Bot, Smartphone, Maximize, Minimize, Pencil, Check, Play, Pause } from "lucide-react";
import ReactMarkdown from "react-markdown";

/* ── Memoized toolbar — only re-renders when tool config changes, not cursor position ── */
const MemoToolbar = React.memo(PresenterToolbar, (prev, next) =>
  prev.lang === next.lang &&
  prev.onOverlayChange === next.onOverlayChange &&
  prev.overlayState.tool === next.overlayState.tool &&
  prev.overlayState.flashlightShape === next.overlayState.flashlightShape &&
  prev.overlayState.flashlightSize === next.overlayState.flashlightSize &&
  prev.overlayState.drawSize === next.overlayState.drawSize &&
  prev.overlayState.drawStrokes.length === next.overlayState.drawStrokes.length &&
  prev.overlayState.pointerSize === next.overlayState.pointerSize &&
  prev.overlayState.magnifierSize === next.overlayState.magnifierSize &&
  prev.overlayState.magnifierZoom === next.overlayState.magnifierZoom
);

/* ── YouTube detection helper ── */
function slideHasYouTube(slide: SlideData): boolean {
  const ytRe = /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/;
  if ((slide.bullets || []).some((b) => ytRe.test(b))) return true;
  if ((slide.imageUrls || []).some((u) => ytRe.test(u))) return true;
  if ((slide.manualElements || []).some((el) => el.type === "youtube" && el.youtubeUrl)) return true;
  return false;
}

interface PresenterViewProps {
  slides: SlideData[];
  initialIndex: number;
  presentationTitle: string;
  bgColor: string;
  headingFont?: string;
  bodyFont?: string;
  textDensity: number;
  layoutMode: "fixed" | "smart";
  globalLayout: string;
  overlayTitleColor: string;
  overlaySectionColor: string;
  onUpdateNotes?: (slideIndex: number, notes: string) => void;
  onExit: () => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ── Isolated Timer component — ticks don't re-render parent ── */
function PresenterTimer({ startLabel, pauseLabel }: { startLabel: string; pauseLabel: string }) {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      ref.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else if (ref.current) {
      clearInterval(ref.current);
      ref.current = null;
    }
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [running]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-mono font-bold" style={{ minWidth: 60, textAlign: "center" }}>
        {formatTime(seconds)}
      </span>
      <button
        onClick={() => setRunning(!running)}
        className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${
          running ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"
        }`}
      >
        {running ? "⏸ " + pauseLabel : "▶ " + startLabel}
      </button>
      <button
        onClick={() => { setRunning(false); setSeconds(0); }}
        className="text-[10px] text-[var(--muted)] hover:text-[var(--fg)] px-1.5 py-1 rounded hover:bg-[var(--surface-2)] transition-colors"
      >
        ↺
      </button>
    </div>
  );
}

export default function PresenterView({
  slides,
  initialIndex,
  presentationTitle,
  bgColor,
  headingFont,
  bodyFont,
  textDensity,
  layoutMode,
  globalLayout,
  overlayTitleColor,
  overlaySectionColor,
  onUpdateNotes,
  onExit,
}: PresenterViewProps) {
  const lang = useAppStore((s) => s.settings.language);
  const { sendSlideChange, sendOverlay, sendVideoControl } = useBroadcastSender();

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [notesPanelWidth, setNotesPanelWidth] = useState(50); // %
  const [notesFontSize, setNotesFontSize] = useState(16); // px
  const [previewScale, setPreviewScale] = useState(100); // %

  // Notes editing
  const [editingNotes, setEditingNotes] = useState(false);
  const [editDraft, setEditDraft] = useState("");

  // Auto-scroll refs for dots and filmstrip
  const dotsContainerRef = useRef<HTMLDivElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);

  // Overlay tools state
  const [overlayState, setOverlayState] = useState<OverlayState>(DEFAULT_OVERLAY);

  // Video play/pause state
  const [videoPlaying, setVideoPlaying] = useState(false);

  // rAF-throttle: batch rapid cursor-move updates into one React state update per frame
  const rafRef = useRef<number>(0);
  const pendingOverlayRef = useRef<OverlayState | null>(null);

  const handleOverlayChange = useCallback((next: OverlayState) => {
    overlayStateRef.current = next; // keep ref always fresh
    sendOverlay(next);
    // Batch into one setState per animation frame
    pendingOverlayRef.current = next;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        if (pendingOverlayRef.current) {
          setOverlayState(pendingOverlayRef.current);
          pendingOverlayRef.current = null;
        }
      });
    }
  }, [sendOverlay]);

  // Clean up pending rAF on unmount
  useEffect(() => {
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  // AI Chat
  const [chatOpen, setChatOpen] = useState(false);

  // Notes panel resize
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // QR Remote Control
  const [qrModalOpen, setQrModalOpen] = useState(false);

  // Fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Use refs so the handler never changes identity — avoids SSE reconnect loops
  const overlayStateRef = useRef(overlayState);
  // Note: overlayStateRef is updated immediately in handleOverlayChange, not here,
  // so it stays fresh even between rAF-batched renders.

  // Stable refs for goTo — avoids cascading identity changes on every overlay/cursor update
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const editingNotesRef = useRef(editingNotes);
  editingNotesRef.current = editingNotes;
  const editDraftRef = useRef(editDraft);
  editDraftRef.current = editDraft;
  const sendOverlayRef = useRef(sendOverlay);
  sendOverlayRef.current = sendOverlay;
  const sendSlideChangeRef = useRef(sendSlideChange);
  sendSlideChangeRef.current = sendSlideChange;
  const sendVideoControlRef = useRef(sendVideoControl);
  sendVideoControlRef.current = sendVideoControl;

  const handleRemoteCommand = useCallback((command: SessionCommand) => {
    if (command.type === "slide-next") {
      setCurrentIndex((prev) => {
        const next = Math.min(prev + 1, slides.length - 1);
        if (next !== prev) {
          const clearedOverlay = clearOverlayDrawings(overlayStateRef.current);
          setOverlayState(clearedOverlay);
          sendOverlayRef.current(clearedOverlay);
          sendSlideChangeRef.current(next);
        }
        return next;
      });
    } else if (command.type === "slide-prev") {
      setCurrentIndex((prev) => {
        const next = Math.max(prev - 1, 0);
        if (next !== prev) {
          const clearedOverlay = clearOverlayDrawings(overlayStateRef.current);
          setOverlayState(clearedOverlay);
          sendOverlayRef.current(clearedOverlay);
          sendSlideChangeRef.current(next);
        }
        return next;
      });
    } else if (command.type === "slide-change") {
      const idx = Math.max(0, Math.min(command.index, slides.length - 1));
      setCurrentIndex((prev) => {
        if (idx !== prev) {
          const clearedOverlay = clearOverlayDrawings(overlayStateRef.current);
          setOverlayState(clearedOverlay);
          sendOverlayRef.current(clearedOverlay);
          sendSlideChangeRef.current(idx);
        }
        return idx;
      });
    } else if (command.type === "overlay-update") {
      overlayStateRef.current = command.overlay;
      sendOverlayRef.current(command.overlay);
      // rAF-batch state update to avoid per-message re-renders
      pendingOverlayRef.current = command.overlay;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          if (pendingOverlayRef.current) {
            setOverlayState(pendingOverlayRef.current);
            pendingOverlayRef.current = null;
          }
        });
      }
    } else if (command.type === "video-control") {
      // Forward to audience window via BroadcastChannel (only audience plays video)
      sendVideoControlRef.current(command.action);
      // Sync local state (UI indicator only, no local playback)
      setVideoPlaying(command.action === "play");
    }
  // Stable: only depends on slides.length which rarely changes
  }, [slides.length]);

  const remoteStyleProps = React.useMemo(() => ({
    bgColor,
    headingFont,
    bodyFont,
    textDensity,
    layoutMode,
    globalLayout,
    overlayTitleColor,
    overlaySectionColor,
  }), [bgColor, headingFont, bodyFont, textDensity, layoutMode, globalLayout, overlayTitleColor, overlaySectionColor]);

  const {
    sessionId: remoteSessionId,
    remoteConnected,
    startSession,
    endSession,
    syncSlideChange,
  } = usePresenterRemoteHost(slides, presentationTitle, currentIndex, handleRemoteCommand, remoteStyleProps);

  // Navigate slides — uses refs for values that change frequently (currentIndex,
  // overlayState, editingNotes, editDraft) so goTo/goNext/goPrev have stable
  // identities and don't cascade re-renders to 127+ filmstrip/dot closures.
  const goTo = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, slides.length - 1));
    if (clamped === currentIndexRef.current) return;

    // Auto-save notes if editing when navigating away
    if (editingNotesRef.current && onUpdateNotes) {
      onUpdateNotes(slides[currentIndexRef.current].index, editDraftRef.current);
      setEditingNotes(false);
    }

    const clearedOverlay = clearOverlayDrawings(overlayStateRef.current);
    overlayStateRef.current = clearedOverlay;
    setOverlayState(clearedOverlay);
    sendOverlay(clearedOverlay);
    setCurrentIndex(clamped);
    sendSlideChange(clamped);
    syncSlideChange(clamped);
    setVideoPlaying(false);
  }, [slides, sendOverlay, sendSlideChange, syncSlideChange, onUpdateNotes]);

  const goNext = useCallback(() => goTo(currentIndexRef.current + 1), [goTo]);
  const goPrev = useCallback(() => goTo(currentIndexRef.current - 1), [goTo]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (chatOpen || editingNotes) return; // Don't navigate while chat or notes editing is open
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "Escape") {
        if (document.fullscreenElement) return; // let browser handle exiting fullscreen
        onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, onExit, chatOpen, editingNotes, toggleFullscreen]);

  // Notes panel resize via mouse drag
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const leftPct = ((e.clientX - rect.left) / rect.width) * 100;
      // notesPanelWidth controls the right (notes) panel; left panel is the remainder
      setNotesPanelWidth(Math.max(25, Math.min(75, 100 - leftPct)));
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizing]);

  // Send initial slide to audience
  useEffect(() => {
    sendSlideChange(currentIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup remote session on unmount
  useEffect(() => {
    return () => { endSession(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slide = slides[currentIndex];
  const nextSlide = slides[currentIndex + 1];

  // Auto-scroll dots and filmstrip to keep current slide visible
  useEffect(() => {
    // Scroll dot into view
    const dotsContainer = dotsContainerRef.current;
    if (dotsContainer) {
      const dot = dotsContainer.children[currentIndex] as HTMLElement | undefined;
      dot?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
    // Scroll filmstrip thumbnail into view
    const filmstrip = filmstripRef.current;
    if (filmstrip) {
      const thumb = filmstrip.children[currentIndex] as HTMLElement | undefined;
      thumb?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [currentIndex]);
  const allNotes = useMemo(() => {
    // Only build the full notes string when the AI chat is actually open
    if (!chatOpen) return "";
    return slides.map((s, i) => `[Slide ${i + 1}: ${s.title}]\n${s.notes || "(no notes)"}`).join("\n\n");
  }, [slides, chatOpen]);

  const t = lang === "es" ? {
    presenterNotes: "Notas del Presentador",
    noNotes: "Sin notas para esta diapositiva.",
    slidePreview: "Vista Previa",
    nextSlide: "Siguiente",
    noNext: "Última diapositiva",
    timer: "Temporizador",
    start: "Iniciar",
    pause: "Pausar",
    reset: "Reiniciar",
    exit: "Salir",
    aiAssistant: "Asistente IA",
    fontSize: "Tamaño",
    previewSize: "Tamaño vista previa",
    of: "de",
    editNotes: "Editar",
    saveNotes: "Guardar",
  } : {
    presenterNotes: "Presenter Notes",
    noNotes: "No notes for this slide.",
    slidePreview: "Slide Preview",
    nextSlide: "Next Slide",
    noNext: "Last slide",
    timer: "Timer",
    start: "Start",
    pause: "Pause",
    reset: "Reset",
    exit: "Exit",
    aiAssistant: "AI Assistant",
    fontSize: "Font Size",
    previewSize: "Preview Size",
    of: "of",
    editNotes: "Edit",
    saveNotes: "Save",
  };

  const previewW = Math.round((previewScale / 100) * 500);
  const previewH = Math.round(previewW * 9 / 16);

  // Memoize slide dots — only recompute when slides or currentIndex change, not on overlay cursor updates
  const slideDots = useMemo(() => slides.map((_, i) => {
    if (Math.abs(i - currentIndex) > 25) return null;
    return (
      <button
        key={i}
        onClick={() => goTo(i)}
        className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all ${
          i === currentIndex ? "bg-[var(--accent)] scale-125" : "bg-[var(--border)] hover:bg-[var(--muted)]"
        }`}
        title={`Slide ${i + 1}`}
      />
    );
  }), [slides, currentIndex, goTo]);

  // Memoize filmstrip items — only recompute when slides, currentIndex, or style props change
  const filmstripItems = useMemo(() => slides.map((s, i) => {
    const thumbSrc = s.thumbnailUrl
      || (s.manualElements?.length === 1 && s.manualElements[0].type === "image" && s.manualElements[0].w === 100 && s.manualElements[0].h === 100
          ? s.manualElements[0].content : null);
    const hasThumbnail = !!thumbSrc;
    const inRange = hasThumbnail || Math.abs(i - currentIndex) <= 15;
    if (!inRange) {
      return <div key={i} style={{ width: 96, height: 54, flexShrink: 0 }} />;
    }
    const inWindow = Math.abs(i - currentIndex) <= 6;
    return (
      <button
        key={i}
        onClick={() => goTo(i)}
        className={`shrink-0 rounded-md overflow-hidden border-2 transition-all ${
          i === currentIndex
            ? "border-[var(--accent)] shadow-md scale-105"
            : "border-transparent opacity-60 hover:opacity-100 hover:border-[var(--border)]"
        }`}
      >
        {hasThumbnail ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={thumbSrc!} alt="" width={96} height={54} decoding="async" loading="lazy"
               style={{ width: 96, height: 54, objectFit: "cover", display: "block" }} />
        ) : inWindow ? (
          <SlideRenderer
            slide={s}
            width={96}
            height={54}
            bgColor={bgColor}
            headingFont={headingFont}
            bodyFont={bodyFont}
            textDensity={textDensity}
            layoutMode={layoutMode}
            globalLayout={globalLayout}
            overlayTitleColor={overlayTitleColor}
            overlaySectionColor={overlaySectionColor}
          />
        ) : (
          <div style={{ width: 96, height: 54, backgroundColor: `#${bgColor}` }} className="flex items-center justify-center">
            <span className="text-[8px] text-[var(--muted)]">{i + 1}</span>
          </div>
        )}
      </button>
    );
  }), [slides, currentIndex, goTo, bgColor, headingFont, bodyFont, textDensity, layoutMode, globalLayout, overlayTitleColor, overlaySectionColor]);

  return (
    <div className="fixed inset-0 z-[9000] bg-[var(--bg)] flex flex-col" style={{ userSelect: "none" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onExit} className="text-xs text-[var(--muted)] hover:text-[var(--fg)] px-2 py-1 rounded hover:bg-[var(--surface-2)] transition-colors">
            ← {t.exit}
          </button>
          <span className="text-xs font-semibold truncate max-w-[300px]">{presentationTitle}</span>
        </div>

        <div className="flex items-center gap-4">
          {/* Slide counter */}
          <span className="text-xs font-mono text-[var(--muted)]">
            {currentIndex + 1} / {slides.length}
          </span>

          {/* Timer */}
          <PresenterTimer startLabel={t.start} pauseLabel={t.pause} />

          {/* AI Assistant button */}
          <button
            onClick={() => setChatOpen(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors flex items-center gap-1.5"
          >
            <Bot size={14} /> {t.aiAssistant}
          </button>

          {/* Remote Control button */}
          <button
            onClick={() => setQrModalOpen(true)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              remoteConnected
                ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)]"
            }`}
          >
            <Smartphone size={14} /> {lang === "es" ? "Remoto" : "Remote"}
            {remoteConnected && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
          </button>

          {/* Fullscreen toggle */}
          <button
            onClick={toggleFullscreen}
            className="text-xs px-3 py-1.5 rounded-lg bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)] transition-colors flex items-center gap-1.5"
            title={isFullscreen ? (lang === "es" ? "Salir de pantalla completa (F)" : "Exit fullscreen (F)") : (lang === "es" ? "Pantalla completa (F)" : "Fullscreen (F)")}
          >
            {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
        </div>
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-center gap-4 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <button
          onClick={goPrev}
          disabled={currentIndex === 0}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--surface-2)] hover:bg-[var(--border)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          ← {lang === "es" ? "Anterior" : "Previous"}
        </button>
        {/* Slide dots — memoized to avoid re-render on overlay cursor changes */}
        <div ref={dotsContainerRef} className="flex gap-1 overflow-x-auto max-w-[50vw] py-1">
          {slideDots}
        </div>
        <button
          onClick={goNext}
          disabled={currentIndex === slides.length - 1}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--surface-2)] hover:bg-[var(--border)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {lang === "es" ? "Siguiente" : "Next"} →
        </button>
      </div>

      {/* Presenter tools toolbar */}
      <div className="flex items-center px-4 py-1.5 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <MemoToolbar overlayState={overlayState} onOverlayChange={handleOverlayChange} lang={lang} />
      </div>

      {/* Main content area */}
      <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Slide preview + next slide */}
        <div
          className="flex flex-col border-r border-[var(--border)] bg-[var(--bg)] overflow-y-auto p-4 gap-4"
          style={{ width: `${100 - notesPanelWidth}%` }}
        >
          {/* Current slide preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold">{t.slidePreview}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--muted)]">{t.previewSize}</span>
                <input
                  type="range"
                  min={30}
                  max={100}
                  value={previewScale}
                  onChange={(e) => setPreviewScale(Number(e.target.value))}
                  className="w-24 h-1 accent-[var(--accent)]"
                />
                <span className="text-[10px] font-mono w-8">{previewScale}%</span>
              </div>
            </div>
            <div className="flex justify-center">
              <div style={{ position: "relative", width: previewW, height: previewH }}>
                <div key={currentIndex} style={{ position: "absolute", inset: 0, animation: "slideTransitionIn 0.35s ease-out" }}>
                  <SlideRenderer
                    slide={slide}
                    width={previewW}
                    height={previewH}
                    bgColor={bgColor}
                    headingFont={headingFont}
                    bodyFont={bodyFont}
                    textDensity={textDensity}
                    layoutMode={layoutMode}
                    globalLayout={globalLayout}
                    overlayTitleColor={overlayTitleColor}
                    overlaySectionColor={overlaySectionColor}
                  />
                </div>
                <InteractiveOverlay
                  width={previewW}
                  height={previewH}
                  overlayState={overlayState}
                  onOverlayChange={handleOverlayChange}
                />
                {overlayState.tool === "magnifier" && overlayState.cursorActive && (
                  <MagnifierRenderer state={overlayState} width={previewW} height={previewH}>
                    <SlideRenderer
                      slide={slide}
                      width={previewW}
                      height={previewH}
                      bgColor={bgColor}
                      headingFont={headingFont}
                      bodyFont={bodyFont}
                      textDensity={textDensity}
                      layoutMode={layoutMode}
                      globalLayout={globalLayout}
                      overlayTitleColor={overlayTitleColor}
                      overlaySectionColor={overlaySectionColor}
                    />
                  </MagnifierRenderer>
                )}
                {/* YouTube play/pause overlay button */}
                {slideHasYouTube(slide) && (
                  <button
                    onClick={() => {
                      const action = videoPlaying ? "pause" : "play";
                      setVideoPlaying(!videoPlaying);
                      sendVideoControl(action);

                    }}
                    className={`absolute bottom-2 right-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-lg backdrop-blur-sm ${
                      videoPlaying
                        ? "bg-red-600/90 text-white hover:bg-red-500"
                        : "bg-emerald-600/90 text-white hover:bg-emerald-500"
                    }`}
                    style={{ zIndex: 100 }}
                    title={videoPlaying ? (lang === "es" ? "Pausar vídeo" : "Pause video") : (lang === "es" ? "Reproducir vídeo" : "Play video")}
                  >
                    {videoPlaying ? <Pause size={14} /> : <Play size={14} />}
                    <span>{videoPlaying ? (lang === "es" ? "Pausar" : "Pause") : (lang === "es" ? "Reproducir" : "Play")}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Next slide preview */}
          <div>
            <span className="text-xs font-semibold text-[var(--muted)] block mb-2">{t.nextSlide}</span>
            {nextSlide ? (
              <div className="flex justify-center opacity-70">
                <SlideRenderer
                  slide={nextSlide}
                  width={Math.round(previewW * 0.6)}
                  height={Math.round(previewW * 0.6 * 9 / 16)}
                  bgColor={bgColor}
                  headingFont={headingFont}
                  bodyFont={bodyFont}
                  textDensity={textDensity}
                  layoutMode={layoutMode}
                  globalLayout={globalLayout}
                  overlayTitleColor={overlayTitleColor}
                  overlaySectionColor={overlaySectionColor}
                />
              </div>
            ) : (
              <p className="text-xs text-[var(--muted)] italic text-center py-4">{t.noNext}</p>
            )}
          </div>
        </div>

        {/* Resize handle */}
        <div
          className="w-1.5 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)] transition-colors shrink-0 flex items-center justify-center"
          onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); }}
        >
          <div className="w-0.5 h-8 bg-[var(--muted)] rounded-full opacity-50" />
        </div>

        {/* Right: Notes panel */}
        <div
          className="flex flex-col overflow-hidden flex-1"
          style={{ width: `${notesPanelWidth}%` }}
        >
          {/* Notes header with font size control */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
            <span className="text-xs font-semibold">{t.presenterNotes}</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[var(--muted)]">{t.fontSize}</span>
              <button
                onClick={() => setNotesFontSize((s) => Math.max(10, s - 2))}
                className="text-xs px-1.5 py-0.5 rounded bg-[var(--surface-2)] hover:bg-[var(--border)] transition-colors"
              >
                A−
              </button>
              <span className="text-[10px] font-mono w-6 text-center">{notesFontSize}</span>
              <button
                onClick={() => setNotesFontSize((s) => Math.min(32, s + 2))}
                className="text-xs px-1.5 py-0.5 rounded bg-[var(--surface-2)] hover:bg-[var(--border)] transition-colors"
              >
                A+
              </button>
              {onUpdateNotes && (
                editingNotes ? (
                  <button
                    onClick={() => {
                      onUpdateNotes(slide.index, editDraft);
                      setEditingNotes(false);
                    }}
                    className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors flex items-center gap-1"
                  >
                    <Check size={10} /> {t.saveNotes}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setEditDraft(slide.notes || "");
                      setEditingNotes(true);
                    }}
                    className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)] transition-colors flex items-center gap-1"
                  >
                    <Pencil size={10} /> {t.editNotes}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Notes content */}
          <div className="flex-1 overflow-y-auto p-5">
            {editingNotes ? (
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                className="w-full h-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-3 resize-none focus:outline-none focus:border-[var(--accent)] leading-relaxed"
                style={{ fontSize: notesFontSize, minHeight: "100%" }}
                autoFocus
              />
            ) : slide.notes ? (
              <div
                className="leading-relaxed prose prose-invert prose-sm max-w-none presenter-notes-indent"
                style={{ fontSize: notesFontSize, textAlign: "justify" }}
              >
                <ReactMarkdown>{slide.notes.replace(/\n(?!\n)/g, "  \n")}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)] italic">{t.noNotes}</p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom filmstrip — memoized to avoid re-render on overlay cursor changes */}
      <div ref={filmstripRef} className="border-t border-[var(--border)] bg-[var(--surface)] shrink-0 px-2 py-1.5 overflow-x-auto flex gap-2 items-center" style={{ maxHeight: 90 }}>
        {filmstripItems}
      </div>

      {/* AI Chat Modal */}
      <PresenterAIChat
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        allNotes={allNotes}
        presentationTitle={presentationTitle}
        currentSlideIndex={currentIndex}
        currentSlideTitle={slide.title}
      />

      {/* QR Remote Control Modal */}
      <QRRemoteModal
        open={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        sessionId={remoteSessionId}
        connected={remoteConnected}
        lang={lang}
        onStartSession={startSession}
      />
    </div>
  );
}
