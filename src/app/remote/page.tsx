"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePresenterRemoteClient } from "@/components/presenter/usePresenterRemote";
import SlideRenderer from "@/components/presenter/SlideRenderer";
import { OverlayRenderer } from "@/components/presenter/PresenterToolsOverlay";
import type { OverlayState } from "@/components/presenter/PresenterToolsOverlay";
import type { SlideData } from "@/lib/types";
import type { SessionStyleProps } from "@/lib/presenter-session";
import {
  ChevronLeft,
  ChevronRight,
  Wifi,
  WifiOff,
  Flashlight,
  Pencil,
  Circle,
  GripVertical,
  Settings,
  Minus,
  Plus,
  Play,
  Pause,
  Trash2,
} from "lucide-react";

type ToolType = "flashlight" | "draw" | "pointer";

const ALL_TOOLS: ToolType[] = ["flashlight", "draw", "pointer"];

const TOOL_ICONS: Record<ToolType, React.ReactNode> = {
  flashlight: <Flashlight size={18} />,
  draw: <Pencil size={18} />,
  pointer: <Circle size={18} className="fill-red-500 text-red-500" />,
};

const TOOL_LABELS: Record<string, Record<ToolType, string>> = {
  en: { flashlight: "Spotlight", draw: "Draw", pointer: "Pointer" },
  es: { flashlight: "Linterna", draw: "Dibujo", pointer: "Puntero" },
};

export default function RemotePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lang, setLang] = useState<"en" | "es">("en");
  const [notesFontSize, setNotesFontSize] = useState(16);
  const [showTools, setShowTools] = useState(false);
  const [localToolOrder, setLocalToolOrder] = useState<ToolType[]>([...ALL_TOOLS]);
  const [enabledTools, setEnabledTools] = useState<Set<ToolType>>(new Set(ALL_TOOLS));
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Active tool — which tool the user is currently using on the slide
  const [activeTool, setActiveTool] = useState<ToolType | null>(null);
  // Local overlay state (for rendering on the mobile slide preview)
  const [localOverlay, setLocalOverlay] = useState<OverlayState>({
    tool: "none", cursorX: 0.5, cursorY: 0.5, cursorActive: false,
    flashlightShape: "circle", flashlightSize: 0.15,
    pointerSize: 0.015, drawSize: 0.004, drawStrokes: [],
  });
  // Video playing state
  const [videoPlaying, setVideoPlaying] = useState(false);

  // Full slides data (fetched once on connect)
  const [slides, setSlides] = useState<SlideData[] | null>(null);
  const [styleProps, setStyleProps] = useState<SessionStyleProps | null>(null);

  // Draw strokes collected during touch
  const drawStrokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const currentStrokeRef = useRef<Array<{ x: number; y: number }>>([]);

  // Slide container dimensions for rendering
  const slideContainerRef = useRef<HTMLDivElement>(null);
  const [slideDims, setSlideDims] = useState({ w: 320, h: 180 });

  // Extract session ID from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("session");
    if (sid && /^[a-z0-9]{8,20}$/.test(sid)) {
      setSessionId(sid);
    }
    const navLang = navigator.language.toLowerCase();
    if (navLang.startsWith("es")) setLang("es");
  }, []);

  const {
    session,
    connected,
    error,
    nextSlide,
    prevSlide,
    goToSlide,
    toggleTool,
    reorderTools,
    sendCommand,
  } = usePresenterRemoteClient(sessionId);

  // Fetch full slides data once session is available
  const slidesFetchedRef = useRef(false);
  useEffect(() => {
    if (!sessionId || !session || slidesFetchedRef.current) return;
    slidesFetchedRef.current = true;
    (async () => {
      try {
        const resp = await fetch(`/api/presenter-remote/session?sessionId=${sessionId}&includeSlides=true`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.slides) setSlides(data.slides);
          if (data.style) setStyleProps(data.style);
        }
      } catch { /* non-critical */ }
    })();
  }, [sessionId, session]);

  // Measure slide container for proper rendering
  useEffect(() => {
    const container = slideContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      // Maintain 16:9 ratio
      setSlideDims({ w: width, h: width * 9 / 16 });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [session]); // re-observe when session appears

  // Connection timeout
  const [connectTimeout, setConnectTimeout] = useState(false);
  useEffect(() => {
    if (session) { setConnectTimeout(false); return; }
    const timer = setTimeout(() => setConnectTimeout(true), 8000);
    return () => clearTimeout(timer);
  }, [session, sessionId]);

  // Sync tool order from session but always keep all tools visible
  useEffect(() => {
    if (session?.remoteTools) {
      setLocalToolOrder((prev) => {
        const ordered: ToolType[] = [];
        for (const t of session.remoteTools) {
          if (ALL_TOOLS.includes(t)) ordered.push(t);
        }
        for (const t of prev) {
          if (!ordered.includes(t)) ordered.push(t);
        }
        for (const t of ALL_TOOLS) {
          if (!ordered.includes(t)) ordered.push(t);
        }
        return ordered;
      });
      setEnabledTools(new Set(session.remoteTools));
    }
  }, [session?.remoteTools]);

  // Reset drawing on slide change
  const prevIndexRef = useRef(session?.currentIndex ?? 0);
  useEffect(() => {
    if (session && session.currentIndex !== prevIndexRef.current) {
      prevIndexRef.current = session.currentIndex;
      drawStrokesRef.current = [];
      currentStrokeRef.current = [];
      setLocalOverlay((prev) => ({ ...prev, drawStrokes: [], cursorActive: false }));
    }
  }, [session?.currentIndex]);

  const handleToggleTool = useCallback((tool: ToolType) => {
    setEnabledTools((prev) => {
      const next = new Set(prev);
      if (next.has(tool)) {
        next.delete(tool);
        toggleTool(tool, false);
        setActiveTool((at) => at === tool ? null : at);
      } else {
        next.add(tool);
        toggleTool(tool, true);
      }
      return next;
    });
  }, [toggleTool]);

  const handleActivateTool = useCallback((tool: ToolType) => {
    if (!enabledTools.has(tool)) return;
    setActiveTool((prev) => {
      const next = prev === tool ? null : tool;
      // Clear overlay when deactivating
      if (!next) {
        const cleared: OverlayState = {
          tool: "none", cursorX: 0.5, cursorY: 0.5, cursorActive: false,
          flashlightShape: "circle", flashlightSize: 0.15,
          pointerSize: 0.015, drawSize: 0.004, drawStrokes: drawStrokesRef.current,
        };
        setLocalOverlay(cleared);
        sendCommand({ type: "overlay-update", overlay: cleared });
      }
      return next;
    });
  }, [enabledTools, sendCommand]);

  // Send overlay update to presenter (throttled ~30fps with trailing send)
  const sendOverlayThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOverlayRef = useRef<OverlayState | null>(null);
  const sendOverlayUpdate = useCallback((overlay: OverlayState) => {
    setLocalOverlay(overlay);
    if (sendOverlayThrottleRef.current) {
      // Throttled: queue the latest overlay so it's sent when the timer fires
      pendingOverlayRef.current = overlay;
      return;
    }
    sendCommand({ type: "overlay-update", overlay });
    sendOverlayThrottleRef.current = setTimeout(() => {
      sendOverlayThrottleRef.current = null;
      if (pendingOverlayRef.current) {
        sendCommand({ type: "overlay-update", overlay: pendingOverlayRef.current });
        pendingOverlayRef.current = null;
      }
    }, 33);
  }, [sendCommand]);

  // Touch handlers directly on the slide
  const slideInteractRef = useRef<HTMLDivElement>(null);

  const getTouchPos = useCallback((touch: React.Touch | { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const el = slideInteractRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height));
    return { x, y };
  }, []);

  const buildOverlay = useCallback((pos: { x: number; y: number }, active: boolean, strokes?: { x: number; y: number }[][]): OverlayState => ({
    tool: activeTool || "none",
    cursorX: pos.x,
    cursorY: pos.y,
    cursorActive: active,
    flashlightShape: "circle",
    flashlightSize: 0.15,
    pointerSize: 0.015,
    drawSize: 0.004,
    drawStrokes: strokes ?? drawStrokesRef.current,
  }), [activeTool]);

  const handleSlideTouchStart = useCallback((e: React.TouchEvent) => {
    if (!activeTool) return;
    e.preventDefault();
    const pos = getTouchPos(e.touches[0]);
    if (!pos) return;
    if (activeTool === "draw") currentStrokeRef.current = [pos];
    sendOverlayUpdate(buildOverlay(pos, true));
  }, [activeTool, getTouchPos, sendOverlayUpdate, buildOverlay]);

  const handleSlideTouchMove = useCallback((e: React.TouchEvent) => {
    if (!activeTool) return;
    e.preventDefault();
    const pos = getTouchPos(e.touches[0]);
    if (!pos) return;
    if (activeTool === "draw") currentStrokeRef.current.push(pos);
    const strokes = activeTool === "draw"
      ? [...drawStrokesRef.current, [...currentStrokeRef.current]]
      : drawStrokesRef.current;
    sendOverlayUpdate(buildOverlay(pos, true, strokes));
  }, [activeTool, getTouchPos, sendOverlayUpdate, buildOverlay]);

  const handleSlideTouchEnd = useCallback(() => {
    if (!activeTool) return;
    if (activeTool === "draw" && currentStrokeRef.current.length > 0) {
      drawStrokesRef.current.push([...currentStrokeRef.current]);
      currentStrokeRef.current = [];
    }
    sendOverlayUpdate(buildOverlay({ x: 0.5, y: 0.5 }, false));
  }, [activeTool, sendOverlayUpdate, buildOverlay]);

  // Mouse handlers (for desktop testing)
  const handleSlideMouseDown = useCallback((e: React.MouseEvent) => {
    if (!activeTool) return;
    const pos = getTouchPos(e);
    if (!pos) return;
    if (activeTool === "draw") currentStrokeRef.current = [pos];
    sendOverlayUpdate(buildOverlay(pos, true));

    const el = slideInteractRef.current!;
    const rect = el.getBoundingClientRect();
    const mm = (ev: MouseEvent) => {
      const mx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const my = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
      if (activeTool === "draw") currentStrokeRef.current.push({ x: mx, y: my });
      const strokes = activeTool === "draw"
        ? [...drawStrokesRef.current, [...currentStrokeRef.current]]
        : drawStrokesRef.current;
      sendOverlayUpdate(buildOverlay({ x: mx, y: my }, true, strokes));
    };
    const mu = () => {
      if (activeTool === "draw" && currentStrokeRef.current.length > 0) {
        drawStrokesRef.current.push([...currentStrokeRef.current]);
        currentStrokeRef.current = [];
      }
      sendOverlayUpdate(buildOverlay({ x: 0.5, y: 0.5 }, false));
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
    };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
  }, [activeTool, getTouchPos, sendOverlayUpdate, buildOverlay]);

  // Clear drawing
  const handleClearDraw = useCallback(() => {
    drawStrokesRef.current = [];
    currentStrokeRef.current = [];
    const cleared = buildOverlay({ x: 0.5, y: 0.5 }, false, []);
    sendOverlayUpdate(cleared);
  }, [sendOverlayUpdate, buildOverlay]);

  // Video control
  const handleVideoToggle = useCallback(() => {
    const action = videoPlaying ? "pause" : "play";
    setVideoPlaying(!videoPlaying);
    sendCommand({ type: "video-control", action });
  }, [videoPlaying, sendCommand]);

  // Drag-to-reorder tools
  const handleDragStart = useCallback((idx: number) => setDragIdx(idx), []);
  const handleDragOver = useCallback((idx: number) => {
    if (dragIdx === null || dragIdx === idx) return;
    setLocalToolOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(idx);
  }, [dragIdx]);
  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    reorderTools(localToolOrder.filter((t) => enabledTools.has(t)));
  }, [localToolOrder, enabledTools, reorderTools]);

  const touchStartYRef = useRef(0);
  const touchIdxRef = useRef<number | null>(null);
  const handleTouchReorderStart = useCallback((idx: number, e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
    touchIdxRef.current = idx;
  }, []);
  const handleTouchReorderMove = useCallback((e: React.TouchEvent) => {
    if (touchIdxRef.current === null) return;
    const diff = e.touches[0].clientY - touchStartYRef.current;
    const steps = Math.round(diff / 56);
    if (steps !== 0) {
      const fromIdx = touchIdxRef.current;
      const toIdx = Math.max(0, Math.min(localToolOrder.length - 1, fromIdx + steps));
      if (fromIdx !== toIdx) {
        setLocalToolOrder((prev) => {
          const next = [...prev];
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          return next;
        });
        touchIdxRef.current = toIdx;
        touchStartYRef.current = e.touches[0].clientY;
      }
    }
  }, [localToolOrder.length]);
  const handleTouchReorderEnd = useCallback(() => {
    touchIdxRef.current = null;
    reorderTools(localToolOrder.filter((t) => enabledTools.has(t)));
  }, [localToolOrder, enabledTools, reorderTools]);

  const t = lang === "es"
    ? {
        title: "Control Remoto", connecting: "Conectando...", connected: "Conectado",
        disconnected: "Desconectado", reconnecting: "Reconectando...",
        invalidSession: "Sesión no válida",
        scanQR: "Escanea el código QR desde la pantalla del presentador",
        expired: "Sesión expirada", notes: "Notas",
        noNotes: "Sin notas para esta diapositiva.", tools: "Herramientas",
        slide: "Diapositiva", of: "de", fontSize: "Tamaño de fuente",
        prev: "Anterior", next: "Siguiente",
        clearDraw: "Borrar dibujo", video: "Video",
      }
    : {
        title: "Remote Control", connecting: "Connecting...", connected: "Connected",
        disconnected: "Disconnected", reconnecting: "Reconnecting...",
        invalidSession: "Invalid session",
        scanQR: "Scan the QR code from the presenter screen",
        expired: "Session expired", notes: "Notes",
        noNotes: "No notes for this slide.", tools: "Tools",
        slide: "Slide", of: "of", fontSize: "Font size",
        prev: "Previous", next: "Next",
        clearDraw: "Clear drawing", video: "Video",
      };

  // No session ID
  if (!sessionId) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-gray-950 text-white p-6">
        <WifiOff size={48} className="text-gray-500 mb-4" />
        <h1 className="text-xl font-bold mb-2">{t.invalidSession}</h1>
        <p className="text-gray-400 text-center text-sm">{t.scanQR}</p>
      </div>
    );
  }

  // Error state — only show hard error if session was never established
  // (transient initial errors are shown as the loading state below)
  if (error && (session || error === "Session expired")) {
    const errorMessages: Record<string, { title: string; desc: string }> = {
      "Cannot reach server": {
        title: lang === "es" ? "No se pudo conectar al servidor" : "Cannot reach server",
        desc: lang === "es"
          ? "Asegúrate de que tu móvil está en la misma red WiFi que el ordenador y de que el servidor está ejecutándose."
          : "Make sure your phone is on the same WiFi network as the computer and the server is running.",
      },
      "Session not found": {
        title: lang === "es" ? "Sesión no encontrada" : "Session not found",
        desc: lang === "es"
          ? "La sesión del presentador no existe o ha expirado. Genera un nuevo código QR desde la pantalla del presentador."
          : "The presenter session doesn't exist or has expired. Generate a new QR code from the presenter screen.",
      },
      "Session expired": {
        title: lang === "es" ? "Sesión expirada" : "Session expired",
        desc: lang === "es"
          ? "La sesión del presentador ha finalizado. Genera un nuevo código QR desde la pantalla del presentador."
          : "The presenter session has ended. Generate a new QR code from the presenter screen.",
      },
    };
    const msg = errorMessages[error] || {
      title: lang === "es" ? "Error de conexión" : "Connection error",
      desc: error,
    };
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-gray-950 text-white p-6">
        <WifiOff size={48} className="text-red-400 mb-4" />
        <h1 className="text-xl font-bold mb-2">{msg.title}</h1>
        <p className="text-gray-400 text-center text-sm mb-6 max-w-xs leading-relaxed">{msg.desc}</p>
        <button onClick={() => window.location.reload()}
          className="px-6 py-3 bg-blue-600 rounded-xl text-sm font-medium hover:bg-blue-500 active:bg-blue-700 transition-colors">
          {lang === "es" ? "Reintentar" : "Retry"}
        </button>
      </div>
    );
  }

  // Loading / connecting
  if (!session) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-gray-950 text-white p-6">
        <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-300 mb-2">{t.connecting}</p>
        {connectTimeout && (
          <div className="mt-4 max-w-xs text-center space-y-3">
            <p className="text-amber-400 text-sm font-medium">
              {lang === "es" ? "No se pudo conectar" : "Could not connect"}
            </p>
            <p className="text-gray-500 text-xs leading-relaxed">
              {lang === "es"
                ? "Asegúrate de que tu móvil está en la misma red WiFi que el ordenador y de que el servidor acepta conexiones externas."
                : "Make sure your phone is on the same WiFi network as the computer and the server accepts external connections."}
            </p>
            <button onClick={() => window.location.reload()}
              className="mt-2 px-4 py-2 bg-blue-600 rounded-xl text-sm font-medium hover:bg-blue-500 active:bg-blue-700 transition-colors">
              {lang === "es" ? "Reintentar" : "Retry"}
            </button>
          </div>
        )}
      </div>
    );
  }

  const currentSlide = session.slideMeta[session.currentIndex];
  const currentSlideData = slides?.[session.currentIndex];
  const notes = currentSlide?.notes || "";
  const hasVideo = currentSlide?.hasVideo || false;
  const toolLabels = TOOL_LABELS[lang] || TOOL_LABELS.en;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-gray-950 text-white select-none overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800 shrink-0 safe-area-top">
        <div className="flex items-center gap-2 min-w-0">
          {connected ? (
            <Wifi size={16} className="text-emerald-400 shrink-0" />
          ) : (
            <WifiOff size={16} className="text-red-400 shrink-0 animate-pulse" />
          )}
          <span className="text-xs font-medium truncate max-w-[180px]">{session.presentationTitle}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-400">
            {session.currentIndex + 1} / {session.totalSlides}
          </span>
          <button
            onClick={() => setShowTools(!showTools)}
            className={`p-2 rounded-lg transition-colors ${showTools ? "bg-blue-600" : "bg-gray-800 hover:bg-gray-700"}`}
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      {/* Slide preview with interactive tool overlay */}
      <div className="px-3 pt-3 pb-1 shrink-0" ref={slideContainerRef}>
        <div
          className="relative w-full rounded-lg overflow-hidden border border-gray-800"
          style={{ height: slideDims.h }}
        >
          {/* Render the actual slide */}
          {currentSlideData && styleProps ? (
            <SlideRenderer
              slide={currentSlideData}
              width={slideDims.w}
              height={slideDims.h}
              bgColor={styleProps.bgColor}
              headingFont={styleProps.headingFont}
              bodyFont={styleProps.bodyFont}
              textDensity={styleProps.textDensity}
              layoutMode={styleProps.layoutMode}
              globalLayout={styleProps.globalLayout}
              overlayTitleColor={styleProps.overlayTitleColor}
              overlaySectionColor={styleProps.overlaySectionColor}
            />
          ) : (
            <div className="w-full h-full bg-gray-800 flex items-center justify-center">
              <span className="text-gray-500 text-sm">
                {currentSlide?.title || (lang === "es" ? "Cargando diapositiva..." : "Loading slide...")}
              </span>
            </div>
          )}

          {/* Tool overlay canvas (shows flashlight/pointer/draw) */}
          {activeTool && (
            <OverlayRenderer
              state={localOverlay}
              width={slideDims.w}
              height={slideDims.h}
            />
          )}

          {/* Invisible interactive touch layer on top */}
          <div
            ref={slideInteractRef}
            onTouchStart={handleSlideTouchStart}
            onTouchMove={handleSlideTouchMove}
            onTouchEnd={handleSlideTouchEnd}
            onMouseDown={handleSlideMouseDown}
            className={`absolute inset-0 z-20 ${activeTool ? "touch-none" : ""}`}
            style={{ cursor: activeTool ? "crosshair" : "default" }}
          />

          {/* Active tool indicator badge */}
          {activeTool && (
            <div className="absolute top-2 left-2 z-30 flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-600/80 text-xs font-medium pointer-events-none">
              {TOOL_ICONS[activeTool]}
              <span>{toolLabels[activeTool]}</span>
            </div>
          )}

          {/* Clear draw button overlay */}
          {activeTool === "draw" && drawStrokesRef.current.length > 0 && (
            <button
              onClick={handleClearDraw}
              className="absolute top-2 right-2 z-30 p-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>

        {/* Tool selector strip below slide */}
        <div className="flex items-center justify-center gap-2 mt-2">
          {ALL_TOOLS.filter((t) => enabledTools.has(t)).map((tool) => (
            <button
              key={tool}
              onClick={() => handleActivateTool(tool)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTool === tool
                  ? "bg-blue-600 text-white ring-1 ring-blue-400"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {TOOL_ICONS[tool]}
              <span>{toolLabels[tool]}</span>
            </button>
          ))}
          {hasVideo && (
            <button
              onClick={handleVideoToggle}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                videoPlaying
                  ? "bg-red-600 text-white"
                  : "bg-emerald-700 text-white hover:bg-emerald-600"
              }`}
            >
              {videoPlaying ? <Pause size={14} /> : <Play size={14} />}
              <span>{videoPlaying ? (lang === "es" ? "Pausa" : "Pause") : "Play"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Expandable tools config panel */}
      {showTools && (
        <div className="bg-gray-900 border-y border-gray-800 px-4 py-3 animate-slideDown">
          <h3 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">{t.tools}</h3>
          <div className="space-y-1">
            {localToolOrder.map((tool, idx) => {
              const isEnabled = enabledTools.has(tool);
              const isActive = activeTool === tool;
              return (
                <div
                  key={tool}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => { e.preventDefault(); handleDragOver(idx); }}
                  onDragEnd={handleDragEnd}
                  onTouchStart={(e) => handleTouchReorderStart(idx, e)}
                  onTouchMove={handleTouchReorderMove}
                  onTouchEnd={handleTouchReorderEnd}
                  className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${
                    isActive ? "bg-blue-900/60 ring-1 ring-blue-500" : isEnabled ? "bg-gray-800" : "bg-gray-800/40 opacity-50"
                  } ${dragIdx === idx ? "scale-105 shadow-lg ring-2 ring-blue-500" : ""}`}
                >
                  <GripVertical size={16} className="text-gray-500 shrink-0 cursor-grab active:cursor-grabbing" />
                  <button onClick={() => handleActivateTool(tool)}
                    className={`shrink-0 p-1 rounded-lg transition-colors ${isActive ? "bg-blue-600 text-white" : isEnabled ? "text-gray-200" : "text-gray-600"}`}
                    disabled={!isEnabled}>
                    {TOOL_ICONS[tool]}
                  </button>
                  <button onClick={() => handleActivateTool(tool)}
                    className={`text-sm font-medium flex-1 text-left ${!isEnabled ? "text-gray-600" : ""}`}
                    disabled={!isEnabled}>
                    {toolLabels[tool]}
                    {isActive && <span className="ml-2 text-xs text-blue-400">({lang === "es" ? "activo" : "active"})</span>}
                  </button>
                  <button
                    onClick={() => handleToggleTool(tool)}
                    className={`w-12 h-7 rounded-full transition-colors relative ${isEnabled ? "bg-blue-600" : "bg-gray-600"}`}
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform absolute top-1 ${isEnabled ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Notes section */}
      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-300">{t.notes}</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setNotesFontSize((s) => Math.max(10, s - 2))}
              className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 active:bg-gray-600 transition-colors">
              <Minus size={14} />
            </button>
            <span className="text-xs font-mono text-gray-400 w-8 text-center">{notesFontSize}</span>
            <button onClick={() => setNotesFontSize((s) => Math.min(36, s + 2))}
              className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 active:bg-gray-600 transition-colors">
              <Plus size={14} />
            </button>
          </div>
        </div>
        {currentSlide && (
          <div className="mb-2 pb-2 border-b border-gray-800">
            {currentSlide.section && <p className="text-xs text-blue-400 font-medium mb-1">{currentSlide.section}</p>}
            <h3 className="text-base font-bold">{currentSlide.title}</h3>
          </div>
        )}
        {notes ? (
          <div className="leading-relaxed whitespace-pre-wrap text-gray-200"
            style={{ fontSize: notesFontSize, textAlign: "justify" }}>
            {notes}
          </div>
        ) : (
          <p className="text-sm text-gray-500 italic">{t.noNotes}</p>
        )}
      </div>

      {/* Navigation controls */}
      <div className="px-4 py-3 bg-gray-900 border-t border-gray-800 shrink-0 safe-area-bottom">
        <div className="flex justify-center mb-2">
          <div className="flex gap-1 overflow-x-auto max-w-full py-1 px-2">
            {Array.from({ length: session.totalSlides }, (_, i) => (
              <button key={i} onClick={() => goToSlide(i)}
                className={`w-2 h-2 rounded-full shrink-0 transition-all ${
                  i === session.currentIndex ? "bg-blue-500 scale-150" : "bg-gray-600 hover:bg-gray-400"
                }`} />
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={prevSlide} disabled={session.currentIndex === 0}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-lg font-semibold touch-manipulation">
            <ChevronLeft size={24} />
            <span className="hidden sm:inline">{t.prev}</span>
          </button>
          <button onClick={nextSlide} disabled={session.currentIndex === session.totalSlides - 1}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-lg font-semibold touch-manipulation">
            <span className="hidden sm:inline">{t.next}</span>
            <ChevronRight size={24} />
          </button>
        </div>
      </div>

      <style jsx>{`
        .safe-area-top { padding-top: max(12px, env(safe-area-inset-top)); }
        .safe-area-bottom { padding-bottom: max(16px, env(safe-area-inset-bottom)); }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        .animate-slideDown { animation: slideDown 0.2s ease-out; }
      `}</style>
    </div>
  );
}
