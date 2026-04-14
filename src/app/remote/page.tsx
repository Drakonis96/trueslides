"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePresenterRemoteClient } from "@/components/presenter/usePresenterRemote";
import SlideRenderer from "@/components/presenter/SlideRenderer";
import { OverlayRenderer, MagnifierRenderer } from "@/components/presenter/PresenterToolsOverlay";
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
  SlidersHorizontal,
  Search,
} from "lucide-react";

type ToolType = "flashlight" | "draw" | "pointer" | "magnifier";

const ALL_TOOLS: ToolType[] = ["flashlight", "draw", "pointer", "magnifier"];

const TOOL_ICONS: Record<ToolType, React.ReactNode> = {
  flashlight: <Flashlight size={18} />,
  draw: <Pencil size={18} />,
  pointer: <Circle size={18} className="fill-red-500 text-red-500" />,
  magnifier: <Search size={18} />,
};

const TOOL_LABELS: Record<string, Record<ToolType, string>> = {
  en: { flashlight: "Spotlight", draw: "Draw", pointer: "Pointer", magnifier: "Magnifier" },
  es: { flashlight: "Linterna", draw: "Dibujo", pointer: "Puntero", magnifier: "Lupa" },
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
  // Tool sizes (fractions of slide width)
  const [flashlightSize, setFlashlightSize] = useState(0.15);
  const [pointerSize, setPointerSize] = useState(0.015);
  const [drawSize, setDrawSize] = useState(0.004);
  const [magnifierSize, setMagnifierSize] = useState(0.15);
  const [magnifierZoom, setMagnifierZoom] = useState(2);
  const [showSizeModal, setShowSizeModal] = useState(false);
  // Local overlay state (for rendering on the mobile slide preview)
  const [localOverlay, setLocalOverlay] = useState<OverlayState>({
    tool: "none", cursorX: 0.5, cursorY: 0.5, cursorActive: false,
    flashlightShape: "circle", flashlightSize: 0.15,
    pointerSize: 0.015, drawSize: 0.004, drawStrokes: [],
    magnifierSize: 0.15, magnifierZoom: 2,
  });
  // Video playing state
  const [videoPlaying, setVideoPlaying] = useState(false);
  // Landscape detection
  const [isLandscape, setIsLandscape] = useState(false);

  // Full slides data (fetched once on connect)
  const [slides, setSlides] = useState<SlideData[] | null>(null);
  const [styleProps, setStyleProps] = useState<SessionStyleProps | null>(null);

  // Draw strokes collected during touch
  const drawStrokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const currentStrokeRef = useRef<Array<{ x: number; y: number }>>([]);

  // Notes scroll container ref (to reset on slide change)
  const notesScrollRef = useRef<HTMLDivElement>(null);

  // Slide container dimensions for rendering
  const slideContainerRef = useRef<HTMLDivElement>(null);
  const [slideDims, setSlideDims] = useState({ w: 320, h: 180 });

  // Draggable split between slide area and notes area (portrait only)
  // Value is the percentage of the available area (header to nav) given to the slide section
  const [splitPct, setSplitPct] = useState(55);
  const splitDragging = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);

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

  // Detect landscape orientation
  useEffect(() => {
    const mql = window.matchMedia("(orientation: landscape)");
    setIsLandscape(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Draggable split handle logic (portrait)
  const handleSplitPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    splitDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);
  const handleSplitPointerMove = useCallback((e: React.PointerEvent) => {
    if (!splitDragging.current || !splitContainerRef.current) return;
    const rect = splitContainerRef.current.getBoundingClientRect();
    const pct = ((e.clientY - rect.top) / rect.height) * 100;
    setSplitPct(Math.max(25, Math.min(75, pct)));
  }, []);
  const handleSplitPointerUp = useCallback(() => {
    splitDragging.current = false;
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
      const { width, height } = entries[0].contentRect;
      // Reserve some padding so the slide doesn't touch edges
      const availW = Math.max(0, width - 8);
      const availH = Math.max(0, height - 8);
      // Fit 16:9 within available space
      const hFromWidth = availW * 9 / 16;
      const wFromHeight = availH * 16 / 9;
      // Use whichever dimension is the constraining one
      if (hFromWidth <= availH) {
        setSlideDims({ w: availW, h: hFromWidth });
      } else {
        setSlideDims({ w: wFromHeight, h: availH });
      }
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
      // Reset notes scroll to top
      if (notesScrollRef.current) notesScrollRef.current.scrollTop = 0;
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
          flashlightShape: "circle", flashlightSize,
          pointerSize, drawSize, drawStrokes: drawStrokesRef.current,
          magnifierSize, magnifierZoom,
        };
        setLocalOverlay(cleared);
        sendCommand({ type: "overlay-update", overlay: cleared });
      }
      return next;
    });
  }, [enabledTools, sendCommand, flashlightSize, pointerSize, drawSize, magnifierSize, magnifierZoom]);

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
    flashlightSize,
    pointerSize,
    drawSize,
    drawStrokes: strokes ?? drawStrokesRef.current,
    magnifierSize,
    magnifierZoom,
  }), [activeTool, flashlightSize, pointerSize, drawSize, magnifierSize, magnifierZoom]);

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

  // Live-update overlay when a slider changes
  const handleSizeChange = useCallback((setter: (v: number) => void, value: number, field?: string) => {
    setter(value);
    // Send an immediate overlay update so the presenter sees the change in real time
    if (activeTool) {
      const preview: OverlayState = {
        tool: activeTool,
        cursorX: 0.5,
        cursorY: 0.5,
        cursorActive: true,
        flashlightShape: "circle",
        flashlightSize: activeTool === "flashlight" ? value : flashlightSize,
        pointerSize: activeTool === "pointer" ? value : pointerSize,
        drawSize: activeTool === "draw" ? value : drawSize,
        drawStrokes: drawStrokesRef.current,
        magnifierSize: field === "magnifierSize" ? value : magnifierSize,
        magnifierZoom: field === "magnifierZoom" ? value : magnifierZoom,
      };
      setLocalOverlay(preview);
      sendCommand({ type: "overlay-update", overlay: preview });
    }
  }, [activeTool, flashlightSize, pointerSize, drawSize, magnifierSize, magnifierZoom, sendCommand]);

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
        toolSizes: "Tamaños", spotlight: "Linterna", pointer: "Puntero", drawing: "Dibujo", magnifier: "Lupa", zoom: "Zoom", close: "Cerrar",
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
        toolSizes: "Sizes", spotlight: "Spotlight", pointer: "Pointer", drawing: "Drawing", magnifier: "Magnifier", zoom: "Zoom", close: "Close",
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

  // Shared sub-components to avoid duplication between layouts
  const headerEl = (
    <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0 safe-area-top">
      <div className="flex items-center gap-2 min-w-0">
        {connected ? (
          <Wifi size={14} className="text-emerald-400 shrink-0" />
        ) : (
          <WifiOff size={14} className="text-red-400 shrink-0 animate-pulse" />
        )}
        <span className="text-xs font-medium truncate max-w-[180px]">{session.presentationTitle}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-gray-400">
          {session.currentIndex + 1} / {session.totalSlides}
        </span>
        <button
          onClick={() => setShowTools(!showTools)}
          className={`p-1.5 rounded-lg transition-colors ${showTools ? "bg-blue-600" : "bg-gray-800 hover:bg-gray-700"}`}
        >
          <Settings size={14} />
        </button>
      </div>
    </header>
  );

  const slidePreviewEl = (
    <div ref={slideContainerRef} className="w-full flex-1 flex items-center justify-center min-h-0">
      <div
        className="relative rounded-lg overflow-hidden border border-gray-800"
        style={{ width: slideDims.w, height: slideDims.h }}
      >
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
        {activeTool && (
          <OverlayRenderer state={localOverlay} width={slideDims.w} height={slideDims.h} />
        )}
        {activeTool === "magnifier" && currentSlideData && styleProps && (
          <MagnifierRenderer state={localOverlay} width={slideDims.w} height={slideDims.h}>
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
          </MagnifierRenderer>
        )}
        <div
          ref={slideInteractRef}
          onTouchStart={handleSlideTouchStart}
          onTouchMove={handleSlideTouchMove}
          onTouchEnd={handleSlideTouchEnd}
          onMouseDown={handleSlideMouseDown}
          className={`absolute inset-0 z-20 ${activeTool ? "touch-none" : ""}`}
          style={{ cursor: activeTool ? "crosshair" : "default" }}
        />
        {activeTool && (
          <div className="absolute top-1.5 left-1.5 z-30 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-600/80 text-[10px] font-medium pointer-events-none">
            {TOOL_ICONS[activeTool]}
            <span>{toolLabels[activeTool]}</span>
          </div>
        )}
        {activeTool === "draw" && drawStrokesRef.current.length > 0 && (
          <button onClick={handleClearDraw}
            className="absolute top-1.5 right-1.5 z-30 p-1 rounded-md bg-red-600/80 hover:bg-red-600 text-white">
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );

  const toolStripEl = (
    <div className={`flex items-center justify-center gap-1.5 ${isLandscape ? "mt-1.5" : "mt-2"}`}>
      {ALL_TOOLS.filter((tl) => enabledTools.has(tl)).map((tool) => (
        <button
          key={tool}
          onClick={() => handleActivateTool(tool)}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${
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
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${
            videoPlaying ? "bg-red-600 text-white" : "bg-emerald-700 text-white hover:bg-emerald-600"
          }`}
        >
          {videoPlaying ? <Pause size={12} /> : <Play size={12} />}
          <span>{videoPlaying ? (lang === "es" ? "Pausa" : "Pause") : "Play"}</span>
        </button>
      )}
      <button
        onClick={() => setShowSizeModal(true)}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all bg-gray-800 text-gray-300 hover:bg-gray-700"
      >
        <SlidersHorizontal size={14} />
      </button>
    </div>
  );

  const toolsConfigEl = showTools ? (
    <div className="bg-gray-900 border-y border-gray-800 px-3 py-2 animate-slideDown">
      <h3 className="text-[10px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">{t.tools}</h3>
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
              className={`flex items-center gap-2 px-2 py-2 rounded-xl transition-all ${
                isActive ? "bg-blue-900/60 ring-1 ring-blue-500" : isEnabled ? "bg-gray-800" : "bg-gray-800/40 opacity-50"
              } ${dragIdx === idx ? "scale-105 shadow-lg ring-2 ring-blue-500" : ""}`}
            >
              <GripVertical size={14} className="text-gray-500 shrink-0 cursor-grab active:cursor-grabbing" />
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
                className={`w-10 h-6 rounded-full transition-colors relative ${isEnabled ? "bg-blue-600" : "bg-gray-600"}`}
              >
                <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform absolute top-1 ${isEnabled ? "translate-x-5" : "translate-x-1"}`} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  const sizeModalEl = showSizeModal ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowSizeModal(false)}>
      <div className="bg-gray-900 rounded-2xl p-4 w-[280px] shadow-2xl border border-gray-700 animate-slideDown"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <SlidersHorizontal size={16} />
          {t.toolSizes}
        </h3>
        <div className="space-y-4">
          {/* Flashlight / Spotlight size */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-300 flex items-center gap-1.5">
                <Flashlight size={13} /> {t.spotlight}
              </span>
              <span className="text-[10px] font-mono text-gray-500">{Math.round(flashlightSize * 100)}%</span>
            </div>
            <input type="range" min={0.05} max={0.4} step={0.01} value={flashlightSize}
              onChange={(e) => handleSizeChange(setFlashlightSize, parseFloat(e.target.value))}
              className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-500" />
          </div>
          {/* Pointer size */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-300 flex items-center gap-1.5">
                <Circle size={13} className="fill-red-500 text-red-500" /> {t.pointer}
              </span>
              <span className="text-[10px] font-mono text-gray-500">{Math.round(pointerSize * 1000) / 10}%</span>
            </div>
            <input type="range" min={0.005} max={0.06} step={0.001} value={pointerSize}
              onChange={(e) => handleSizeChange(setPointerSize, parseFloat(e.target.value))}
              className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer accent-red-500" />
          </div>
          {/* Draw size */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-300 flex items-center gap-1.5">
                <Pencil size={13} /> {t.drawing}
              </span>
              <span className="text-[10px] font-mono text-gray-500">{Math.round(drawSize * 1000) / 10}%</span>
            </div>
            <input type="range" min={0.001} max={0.02} step={0.001} value={drawSize}
              onChange={(e) => handleSizeChange(setDrawSize, parseFloat(e.target.value))}
              className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer accent-amber-500" />
          </div>
          {/* Magnifier size */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-300 flex items-center gap-1.5">
                <Search size={13} /> {t.magnifier}
              </span>
              <span className="text-[10px] font-mono text-gray-500">{Math.round(magnifierSize * 100)}%</span>
            </div>
            <input type="range" min={0.05} max={0.3} step={0.01} value={magnifierSize}
              onChange={(e) => handleSizeChange(setMagnifierSize, parseFloat(e.target.value), "magnifierSize")}
              className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer accent-indigo-500" />
          </div>
          {/* Magnifier zoom */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-300 flex items-center gap-1.5">
                <Search size={13} /> {t.zoom}
              </span>
              <span className="text-[10px] font-mono text-gray-500">{magnifierZoom.toFixed(1)}x</span>
            </div>
            <input type="range" min={1.5} max={5} step={0.1} value={magnifierZoom}
              onChange={(e) => handleSizeChange(setMagnifierZoom, parseFloat(e.target.value), "magnifierZoom")}
              className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer accent-indigo-500" />
          </div>
        </div>
        <button onClick={() => setShowSizeModal(false)}
          className="mt-4 w-full py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm font-medium transition-colors">
          {t.close}
        </button>
      </div>
    </div>
  ) : null;

  const notesEl = (
    <div className={`flex-1 flex flex-col min-h-0 ${isLandscape ? "" : ""}`}>
      {/* Sticky header: slide info + font size controls */}
      <div className={`shrink-0 bg-gray-950 z-10 ${isLandscape ? "px-3 pt-1 pb-0.5" : "px-4 pt-1.5 pb-0.5"}`}>
        <div className="flex items-center justify-between mb-0.5">
          <h2 className="text-[11px] font-semibold text-gray-300">{t.notes}</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setNotesFontSize((s) => Math.max(10, s - 2))}
              className="p-0.5 rounded-md bg-gray-800 hover:bg-gray-700 active:bg-gray-600 transition-colors">
              <Minus size={11} />
            </button>
            <span className="text-[9px] font-mono text-gray-400 w-5 text-center">{notesFontSize}</span>
            <button onClick={() => setNotesFontSize((s) => Math.min(36, s + 2))}
              className="p-0.5 rounded-md bg-gray-800 hover:bg-gray-700 active:bg-gray-600 transition-colors">
              <Plus size={11} />
            </button>
          </div>
        </div>
        {currentSlide && (
          <div className="pb-1 border-b border-gray-800">
            {currentSlide.section && <p className="text-[10px] text-blue-400 font-medium leading-tight">{currentSlide.section}</p>}
            <h3 className="text-[13px] font-bold leading-tight">{currentSlide.title}</h3>
          </div>
        )}
      </div>
      {/* Scrollable notes body */}
      <div ref={notesScrollRef} className={`flex-1 overflow-y-auto min-h-0 ${isLandscape ? "px-3 pb-2" : "px-4 pb-3"}`}>
        {notes ? (
          <div className="leading-relaxed whitespace-pre-wrap text-gray-200"
            style={{ fontSize: notesFontSize, textAlign: "justify" }}>
            {notes}
          </div>
        ) : (
          <p className="text-xs text-gray-500 italic">{t.noNotes}</p>
        )}
      </div>
    </div>
  );

  const navEl = (
    <div className={`bg-gray-900 border-t border-gray-800 shrink-0 safe-area-bottom ${isLandscape ? "px-2 py-1.5" : "px-4 py-3"}`}>
      {!isLandscape && (
        <div className="flex justify-center mb-2">
          <div className="flex gap-1 overflow-x-auto max-w-full py-1 px-2">
            {Array.from({ length: session.totalSlides }, (_, i) => {
              const dist = Math.abs(i - session.currentIndex);
              if (dist > 25) return null;
              return (
                <button key={i} onClick={() => goToSlide(i)}
                  className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
                    i === session.currentIndex ? "bg-blue-500 scale-150" : "bg-gray-600 hover:bg-gray-400"
                  }`} />
              );
            })}
          </div>
        </div>
      )}
      <div className={`flex gap-2 ${isLandscape ? "gap-1.5" : "gap-3"}`}>
        <button onClick={prevSlide} disabled={session.currentIndex === 0}
          className={`flex-1 flex items-center justify-center gap-1 rounded-2xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all font-semibold touch-manipulation ${
            isLandscape ? "py-2 text-sm rounded-xl" : "py-4 text-lg"
          }`}>
          <ChevronLeft size={isLandscape ? 18 : 24} />
          <span className="hidden sm:inline">{t.prev}</span>
        </button>
        <button onClick={nextSlide} disabled={session.currentIndex === session.totalSlides - 1}
          className={`flex-1 flex items-center justify-center gap-1 rounded-2xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all font-semibold touch-manipulation ${
            isLandscape ? "py-2 text-sm rounded-xl" : "py-4 text-lg"
          }`}>
          <span className="hidden sm:inline">{t.next}</span>
          <ChevronRight size={isLandscape ? 18 : 24} />
        </button>
      </div>
    </div>
  );

  // --- LANDSCAPE LAYOUT ---
  if (isLandscape) {
    return (
      <div className="h-[100dvh] flex flex-col bg-gray-950 text-white select-none overflow-hidden">
        {/* Slide preview — fills all space above the bottom bar */}
        <div ref={slideContainerRef} className="flex-1 flex items-center justify-center min-h-0 overflow-hidden p-1">
          <div
            className="relative rounded-lg overflow-hidden border border-gray-800"
            style={{ width: slideDims.w, height: slideDims.h }}
          >
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
                  {currentSlide?.title || (lang === "es" ? "Cargando..." : "Loading...")}
                </span>
              </div>
            )}
            {activeTool && (
              <OverlayRenderer state={localOverlay} width={slideDims.w} height={slideDims.h} />
            )}
            {activeTool === "magnifier" && currentSlideData && styleProps && (
              <MagnifierRenderer state={localOverlay} width={slideDims.w} height={slideDims.h}>
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
              </MagnifierRenderer>
            )}
            <div
              ref={slideInteractRef}
              onTouchStart={handleSlideTouchStart}
              onTouchMove={handleSlideTouchMove}
              onTouchEnd={handleSlideTouchEnd}
              onMouseDown={handleSlideMouseDown}
              className={`absolute inset-0 z-20 ${activeTool ? "touch-none" : ""}`}
              style={{ cursor: activeTool ? "crosshair" : "default" }}
            />
            {activeTool && (
              <div className="absolute top-1 left-1 z-30 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-600/80 text-[10px] font-medium pointer-events-none">
                {TOOL_ICONS[activeTool]}
              </div>
            )}
            {activeTool === "draw" && drawStrokesRef.current.length > 0 && (
              <button onClick={handleClearDraw}
                className="absolute top-1 right-1 z-30 p-1 rounded-md bg-red-600/80 hover:bg-red-600 text-white">
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>
        {/* Bottom bar: all centered — prev, tools, counter, next */}
        <div className="px-2 py-1.5 bg-gray-900 border-t border-gray-800 shrink-0 safe-area-bottom">
          <div className="flex items-center justify-center gap-2">
            <button onClick={prevSlide} disabled={session.currentIndex === 0}
              className="p-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all touch-manipulation">
              <ChevronLeft size={20} />
            </button>
            {ALL_TOOLS.filter((tl) => enabledTools.has(tl)).map((tool) => (
              <button
                key={tool}
                onClick={() => handleActivateTool(tool)}
                className={`p-2 rounded-xl transition-all touch-manipulation ${
                  activeTool === tool
                    ? "bg-blue-600 text-white ring-1 ring-blue-400"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                {TOOL_ICONS[tool]}
              </button>
            ))}
            {hasVideo && (
              <button
                onClick={handleVideoToggle}
                className={`p-2 rounded-xl transition-all touch-manipulation ${
                  videoPlaying ? "bg-red-600 text-white" : "bg-emerald-700 text-white hover:bg-emerald-600"
                }`}
              >
                {videoPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
            )}
            <button
              onClick={() => setShowSizeModal(true)}
              className="p-2 rounded-xl transition-all touch-manipulation bg-gray-800 text-gray-300 hover:bg-gray-700"
            >
              <SlidersHorizontal size={18} />
            </button>
            <span className="text-xs font-mono text-gray-400 px-1">
              {session.currentIndex + 1}/{session.totalSlides}
            </span>
            <button onClick={nextSlide} disabled={session.currentIndex === session.totalSlides - 1}
              className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all touch-manipulation">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        <style jsx>{`
          .safe-area-bottom { padding-bottom: max(4px, env(safe-area-inset-bottom)); }
        `}</style>
        {sizeModalEl}
      </div>
    );
  }

  // --- PORTRAIT LAYOUT ---
  return (
    <div className="h-[100dvh] flex flex-col bg-gray-950 text-white select-none overflow-hidden">
      {headerEl}

      {/* Resizable split area between slide+tools and notes */}
      <div ref={splitContainerRef} className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Top: slide preview + tools */}
        <div className="flex flex-col px-2 pt-2 pb-0 min-h-0" style={{ height: `${splitPct}%` }}>
          {slidePreviewEl}
          {toolStripEl}
        </div>

        {/* Draggable divider */}
        <div
          onPointerDown={handleSplitPointerDown}
          onPointerMove={handleSplitPointerMove}
          onPointerUp={handleSplitPointerUp}
          className="shrink-0 flex items-center justify-center mt-1 py-1 cursor-row-resize touch-none z-10"
        >
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>

        {/* Bottom: notes */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {toolsConfigEl}
          {notesEl}
        </div>
      </div>

      {navEl}

      <style jsx>{`
        .safe-area-top { padding-top: max(12px, env(safe-area-inset-top)); }
        .safe-area-bottom { padding-bottom: max(16px, env(safe-area-inset-bottom)); }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        .animate-slideDown { animation: slideDown 0.2s ease-out; }
      `}</style>
      {sizeModalEl}
    </div>
  );
}
