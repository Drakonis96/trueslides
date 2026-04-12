"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { SlideData } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { useBroadcastSender } from "./useBroadcastSync";
import SlideRenderer from "./SlideRenderer";
import PresenterAIChat from "./PresenterAIChat";
import { InteractiveOverlay, PresenterToolbar, DEFAULT_OVERLAY, clearOverlayDrawings } from "./PresenterToolsOverlay";
import type { OverlayState } from "./PresenterToolsOverlay";
import { usePresenterRemoteHost } from "./usePresenterRemote";
import QRRemoteModal from "./QRRemoteModal";
import type { SessionCommand } from "@/lib/presenter-session";
import { Bot, Smartphone, Maximize, Minimize } from "lucide-react";

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
  onExit: () => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
  onExit,
}: PresenterViewProps) {
  const lang = useAppStore((s) => s.settings.language);
  const { sendSlideChange, sendOverlay, sendVideoControl } = useBroadcastSender();

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [notesPanelWidth, setNotesPanelWidth] = useState(50); // %
  const [notesFontSize, setNotesFontSize] = useState(16); // px
  const [previewScale, setPreviewScale] = useState(60); // %

  // Overlay tools state
  const [overlayState, setOverlayState] = useState<OverlayState>(DEFAULT_OVERLAY);

  const handleOverlayChange = useCallback((next: OverlayState) => {
    setOverlayState(next);
    sendOverlay(next);
  }, [sendOverlay]);

  // Timer
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  overlayStateRef.current = overlayState;
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
      setOverlayState(command.overlay);
      sendOverlayRef.current(command.overlay);
    } else if (command.type === "video-control") {
      // Forward to audience window via BroadcastChannel
      sendVideoControlRef.current(command.action);
      // Also control iframes in the presenter view itself
      const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe[src*="youtube"]');
      iframes.forEach((iframe) => {
        try {
          const msg = command.action === "play"
            ? '{"event":"command","func":"playVideo","args":""}'
            : '{"event":"command","func":"pauseVideo","args":""}';
          iframe.contentWindow?.postMessage(msg, "*");
        } catch { /* cross-origin guard */ }
      });
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

  // Navigate slides
  const goTo = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, slides.length - 1));
    if (clamped === currentIndex) return;

    const clearedOverlay = clearOverlayDrawings(overlayState);
    setOverlayState(clearedOverlay);
    sendOverlay(clearedOverlay);
    setCurrentIndex(clamped);
    sendSlideChange(clamped);
    syncSlideChange(clamped);
  }, [currentIndex, overlayState, slides.length, sendOverlay, sendSlideChange, syncSlideChange]);

  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);
  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (chatOpen) return; // Don't navigate while chat is open
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
  }, [goNext, goPrev, onExit, chatOpen, toggleFullscreen]);

  // Timer logic
  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

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
  const allNotes = slides.map((s, i) => `[Slide ${i + 1}: ${s.title}]\n${s.notes || "(no notes)"}`).join("\n\n");

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
  };

  const previewW = Math.round((previewScale / 100) * 500);
  const previewH = Math.round(previewW * 9 / 16);

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
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono font-bold" style={{ minWidth: 60, textAlign: "center" }}>
              {formatTime(timerSeconds)}
            </span>
            <button
              onClick={() => setTimerRunning(!timerRunning)}
              className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${
                timerRunning ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"
              }`}
            >
              {timerRunning ? "⏸ " + t.pause : "▶ " + t.start}
            </button>
            <button
              onClick={() => { setTimerRunning(false); setTimerSeconds(0); }}
              className="text-[10px] text-[var(--muted)] hover:text-[var(--fg)] px-1.5 py-1 rounded hover:bg-[var(--surface-2)] transition-colors"
            >
              ↺
            </button>
          </div>

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
        {/* Slide dots */}
        <div className="flex gap-1 overflow-x-auto max-w-[50vw] py-1">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all ${
                i === currentIndex ? "bg-[var(--accent)] scale-125" : "bg-[var(--border)] hover:bg-[var(--muted)]"
              }`}
              title={`Slide ${i + 1}`}
            />
          ))}
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
        <PresenterToolbar overlayState={overlayState} onOverlayChange={handleOverlayChange} lang={lang} />
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
            </div>
          </div>

          {/* Notes content */}
          <div className="flex-1 overflow-y-auto p-5">
            {slide.notes ? (
              <div
                className="leading-relaxed whitespace-pre-wrap"
                style={{ fontSize: notesFontSize, textAlign: "justify" }}
              >
                {slide.notes}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)] italic">{t.noNotes}</p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom filmstrip — all slide thumbnails */}
      <div className="border-t border-[var(--border)] bg-[var(--surface)] shrink-0 px-2 py-1.5 overflow-x-auto flex gap-2 items-center" style={{ maxHeight: 90 }}>
        {slides.map((s, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className={`shrink-0 rounded-md overflow-hidden border-2 transition-all ${
              i === currentIndex
                ? "border-[var(--accent)] shadow-md scale-105"
                : "border-transparent opacity-60 hover:opacity-100 hover:border-[var(--border)]"
            }`}
          >
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
          </button>
        ))}
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
