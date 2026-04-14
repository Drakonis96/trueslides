"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Flashlight, Pencil, Circle, Trash2, Search } from "lucide-react";

/* ── Types ── */

export type ToolMode = "none" | "flashlight" | "draw" | "pointer" | "magnifier";
export type FlashlightShape = "circle" | "rect-h" | "rect-v";

export interface OverlayState {
  tool: ToolMode;
  /** Normalized cursor position 0..1 */
  cursorX: number;
  cursorY: number;
  cursorActive: boolean;
  flashlightShape: FlashlightShape;
  /** Size as fraction of slide width (e.g. 0.15 = 15%) */
  flashlightSize: number;
  pointerSize: number; // fraction of slide width
  drawSize: number;    // fraction of slide width mapped to px later
  drawStrokes: { x: number; y: number }[][];
  magnifierSize: number; // fraction of slide width for lens radius
  magnifierZoom: number; // zoom factor (e.g. 2 = 2x)
}

export const DEFAULT_OVERLAY: OverlayState = {
  tool: "none",
  cursorX: 0.5,
  cursorY: 0.5,
  cursorActive: false,
  flashlightShape: "circle",
  flashlightSize: 0.15,
  pointerSize: 0.015,
  drawSize: 0.004,
  drawStrokes: [],
  magnifierSize: 0.15,
  magnifierZoom: 2,
};

/** Max total draw points across all strokes before auto-simplifying. */
const MAX_DRAW_POINTS = 3000;

/**
 * Downsample strokes when they exceed MAX_DRAW_POINTS to cap memory.
 * Keeps every Nth point (Ramer-Douglas-Peucker is overkill for a live tool).
 */
function simplifyStrokes(strokes: { x: number; y: number }[][]): { x: number; y: number }[][] {
  let total = 0;
  for (const s of strokes) total += s.length;
  if (total <= MAX_DRAW_POINTS) return strokes;
  // Keep every 2nd point in each stroke (preserves first/last)
  return strokes.map((stroke) => {
    if (stroke.length <= 4) return stroke;
    const simplified = [stroke[0]];
    for (let i = 2; i < stroke.length - 1; i += 2) {
      simplified.push(stroke[i]);
    }
    simplified.push(stroke[stroke.length - 1]);
    return simplified;
  });
}

export function clearOverlayDrawings(state: OverlayState): OverlayState {
  return {
    ...state,
    cursorActive: state.tool === "draw" ? false : state.cursorActive,
    drawStrokes: [],
  };
}

/* ── Passive overlay: renders received overlay state (used by audience) ── */

export function OverlayRenderer({
  state,
  width,
  height,
}: {
  state: OverlayState;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    const cx = state.cursorX * width;
    const cy = state.cursorY * height;

    // Draw strokes (always visible regardless of tool)
    if (state.drawStrokes.length > 0) {
      ctx.strokeStyle = "rgba(220, 38, 38, 0.85)";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const stroke of state.drawStrokes) {
        if (stroke.length < 2) continue;
        ctx.lineWidth = state.drawSize * width;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x * width, stroke[0].y * height);
        for (let i = 1; i < stroke.length; i++) {
          ctx.lineTo(stroke[i].x * width, stroke[i].y * height);
        }
        ctx.stroke();
      }
    }

    if (!state.cursorActive) return;

    // Flashlight
    if (state.tool === "flashlight") {
      const sz = state.flashlightSize * width;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "white";
      if (state.flashlightShape === "circle") {
        ctx.beginPath();
        ctx.arc(cx, cy, sz, 0, Math.PI * 2);
        ctx.fill();
      } else if (state.flashlightShape === "rect-h") {
        const rw = sz * 2.5;
        const rh = sz * 0.7;
        ctx.fillRect(cx - rw / 2, cy - rh / 2, rw, rh);
      } else {
        const rw = sz * 0.7;
        const rh = sz * 2.5;
        ctx.fillRect(cx - rw / 2, cy - rh / 2, rw, rh);
      }
      ctx.restore();
    }

    // Pointer
    if (state.tool === "pointer") {
      const r = state.pointerSize * width;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(220, 38, 38, 0.85)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = Math.max(1, r * 0.25);
      ctx.stroke();
      ctx.restore();
    }

    // Magnifier lens ring (the actual zoom is rendered as a DOM element)
    if (state.tool === "magnifier") {
      const r = state.magnifierSize * width;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = Math.max(2, r * 0.04);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r + Math.max(2, r * 0.04) / 2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }, [state, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: "absolute",
        inset: 0,
        width,
        height,
        pointerEvents: "none",
        zIndex: 10,
      }}
    />
  );
}

/* ── Interactive overlay: captures mouse input (used by presenter) ── */

export function InteractiveOverlay({
  width,
  height,
  overlayState,
  onOverlayChange,
}: {
  width: number;
  height: number;
  overlayState: OverlayState;
  onOverlayChange: (next: OverlayState) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  const getNormalized = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0.5, y: 0.5 };
      return {
        x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
      };
    },
    []
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (overlayState.tool === "none") return;
      const { x, y } = getNormalized(e);
      const next = { ...overlayState, cursorX: x, cursorY: y, cursorActive: true };

      if (overlayState.tool === "draw" && drawingRef.current) {
        const strokes = [...next.drawStrokes];
        const last = [...strokes[strokes.length - 1], { x, y }];
        strokes[strokes.length - 1] = last;
        next.drawStrokes = simplifyStrokes(strokes);
      }

      onOverlayChange(next);
    },
    [overlayState, getNormalized, onOverlayChange]
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (overlayState.tool === "none") return;
      const { x, y } = getNormalized(e);

      if (overlayState.tool === "draw") {
        drawingRef.current = true;
        const strokes = [...overlayState.drawStrokes, [{ x, y }]];
        onOverlayChange({ ...overlayState, cursorX: x, cursorY: y, cursorActive: true, drawStrokes: strokes });
      } else {
        onOverlayChange({ ...overlayState, cursorX: x, cursorY: y, cursorActive: true });
      }
    },
    [overlayState, getNormalized, onOverlayChange]
  );

  const onMouseUp = useCallback(() => {
    drawingRef.current = false;
  }, []);

  const onMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (overlayState.tool === "none") return;
      const { x, y } = getNormalized(e);
      onOverlayChange({ ...overlayState, cursorX: x, cursorY: y, cursorActive: true });
    },
    [overlayState, getNormalized, onOverlayChange]
  );

  const onMouseLeave = useCallback(() => {
    if (overlayState.tool === "none") return;
    drawingRef.current = false;
    onOverlayChange({ ...overlayState, cursorActive: false });
  }, [overlayState, onOverlayChange]);

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    const cx = overlayState.cursorX * width;
    const cy = overlayState.cursorY * height;

    // Draw strokes
    if (overlayState.drawStrokes.length > 0) {
      ctx.strokeStyle = "rgba(220, 38, 38, 0.85)";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const stroke of overlayState.drawStrokes) {
        if (stroke.length < 2) continue;
        ctx.lineWidth = overlayState.drawSize * width;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x * width, stroke[0].y * height);
        for (let i = 1; i < stroke.length; i++) {
          ctx.lineTo(stroke[i].x * width, stroke[i].y * height);
        }
        ctx.stroke();
      }
    }

    if (!overlayState.cursorActive) return;

    // Flashlight
    if (overlayState.tool === "flashlight") {
      const sz = overlayState.flashlightSize * width;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "white";
      if (overlayState.flashlightShape === "circle") {
        ctx.beginPath();
        ctx.arc(cx, cy, sz, 0, Math.PI * 2);
        ctx.fill();
      } else if (overlayState.flashlightShape === "rect-h") {
        const rw = sz * 2.5;
        const rh = sz * 0.7;
        ctx.fillRect(cx - rw / 2, cy - rh / 2, rw, rh);
      } else {
        const rw = sz * 0.7;
        const rh = sz * 2.5;
        ctx.fillRect(cx - rw / 2, cy - rh / 2, rw, rh);
      }
      ctx.restore();
    }

    // Pointer
    if (overlayState.tool === "pointer") {
      const r = overlayState.pointerSize * width;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(220, 38, 38, 0.85)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = Math.max(1, r * 0.25);
      ctx.stroke();
      ctx.restore();
    }

    // Magnifier lens ring
    if (overlayState.tool === "magnifier") {
      const r = overlayState.magnifierSize * width;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = Math.max(2, r * 0.04);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r + Math.max(2, r * 0.04) / 2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }, [overlayState, width, height]);

  const cursorStyle =
    overlayState.tool === "none"
      ? "default"
      : overlayState.tool === "draw"
      ? "crosshair"
      : "none";

  // Handle wheel to adjust size
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (overlayState.tool === "none") return;
      let next = { ...overlayState };
      let delta = e.deltaY < 0 ? 1 : -1;
      if (overlayState.tool === "flashlight") {
        let sz = Math.max(0.05, Math.min(0.4, overlayState.flashlightSize + delta * 0.02));
        next.flashlightSize = sz;
      } else if (overlayState.tool === "draw") {
        let sz = Math.max(0.001, Math.min(0.02, overlayState.drawSize + delta * 0.001));
        next.drawSize = sz;
      } else if (overlayState.tool === "pointer") {
        let sz = Math.max(0.005, Math.min(0.04, overlayState.pointerSize + delta * 0.002));
        next.pointerSize = sz;
      } else if (overlayState.tool === "magnifier") {
        let sz = Math.max(0.05, Math.min(0.3, overlayState.magnifierSize + delta * 0.02));
        next.magnifierSize = sz;
      }
      onOverlayChange(next);
      e.preventDefault();
    },
    [overlayState, onOverlayChange]
  );

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: "absolute",
        inset: 0,
        width,
        height,
        cursor: cursorStyle,
        zIndex: 10,
      }}
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onWheel={handleWheel}
    />
  );
}

/* ── Magnifier lens: renders a zoomed circular clip of the slide ── */

export function MagnifierRenderer({
  state,
  width,
  height,
  children,
}: {
  state: OverlayState;
  width: number;
  height: number;
  /** The slide content to magnify (e.g. <SlideRenderer />) */
  children: React.ReactNode;
}) {
  if (state.tool !== "magnifier" || !state.cursorActive) return null;

  const zoom = state.magnifierZoom;
  const r = state.magnifierSize * width;
  const diameter = r * 2;
  const cx = state.cursorX * width;
  const cy = state.cursorY * height;

  return (
    <div
      style={{
        position: "absolute",
        left: cx - r,
        top: cy - r,
        width: diameter,
        height: diameter,
        borderRadius: "50%",
        overflow: "hidden",
        border: "2px solid rgba(255,255,255,0.7)",
        boxShadow: "0 0 12px rgba(0,0,0,0.5)",
        pointerEvents: "none",
        zIndex: 15,
      }}
    >
      <div
        style={{
          width: width,
          height: height,
          transform: `scale(${zoom})`,
          transformOrigin: `${state.cursorX * 100}% ${state.cursorY * 100}%`,
          position: "absolute",
          left: -(cx - r),
          top: -(cy - r),
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ── Toolbar for selecting tool & adjusting sizes ── */

export function PresenterToolbar({
  overlayState,
  onOverlayChange,
  lang,
}: {
  overlayState: OverlayState;
  onOverlayChange: (next: OverlayState) => void;
  lang: string;
}) {
  const es = lang === "es";
  const tool = overlayState.tool;
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const modKey = isMac ? "⌘" : "Ctrl";

  const setTool = useCallback((t: ToolMode) => {
    onOverlayChange({ ...overlayState, tool: t === overlayState.tool ? "none" : t, cursorActive: false });
  }, [overlayState, onOverlayChange]);

  const clearDrawing = () => {
    onOverlayChange({ ...overlayState, drawStrokes: [] });
  };

  // Keyboard shortcuts: Cmd/Ctrl + Alt + S/D/P/M
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") { e.preventDefault(); setTool("flashlight"); }
      else if (k === "d") { e.preventDefault(); setTool("draw"); }
      else if (k === "p") { e.preventDefault(); setTool("pointer"); }
      else if (k === "m") { e.preventDefault(); setTool("magnifier"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTool]);

  const btnClass = (active: boolean) =>
    `px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
      active
        ? "bg-[var(--accent)] text-white shadow-md"
        : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)]"
    }`;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Flashlight */}
      <button onClick={() => setTool("flashlight")} className={btnClass(tool === "flashlight")} title={`${es ? "Linterna" : "Spotlight"} (${modKey}+Alt+S)`}>
        <Flashlight size={14} className="inline -mt-0.5" /> {es ? "Linterna" : "Spotlight"}
        <kbd className="ml-1 text-[9px] opacity-50">{modKey.charAt(0)}⌥S</kbd>
      </button>

      {tool === "flashlight" && (
        <div className="flex items-center gap-1.5 pl-1 border-l border-[var(--border)]">
          {/* Shape selector */}
          <button
            onClick={() => onOverlayChange({ ...overlayState, flashlightShape: "circle" })}
            className={`px-1.5 py-1 rounded text-[10px] ${overlayState.flashlightShape === "circle" ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)] text-[var(--muted)]"}`}
            title={es ? "Círculo" : "Circle"}
          >
            ●
          </button>
          <button
            onClick={() => onOverlayChange({ ...overlayState, flashlightShape: "rect-h" })}
            className={`px-1.5 py-1 rounded text-[10px] ${overlayState.flashlightShape === "rect-h" ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)] text-[var(--muted)]"}`}
            title={es ? "Rect. Horizontal" : "Horiz. Rect."}
          >
            ▬
          </button>
          <button
            onClick={() => onOverlayChange({ ...overlayState, flashlightShape: "rect-v" })}
            className={`px-1.5 py-1 rounded text-[10px] ${overlayState.flashlightShape === "rect-v" ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)] text-[var(--muted)]"}`}
            title={es ? "Rect. Vertical" : "Vert. Rect."}
          >
            ▮
          </button>
          {/* Size slider */}
          <span className="text-[10px] text-[var(--muted)] ml-1">{es ? "Tamaño" : "Size"}</span>
          <input
            type="range"
            min={5}
            max={40}
            value={Math.round(overlayState.flashlightSize * 100)}
            onChange={(e) => onOverlayChange({ ...overlayState, flashlightSize: Number(e.target.value) / 100 })}
            className="w-16 h-1 accent-[var(--accent)]"
          />
        </div>
      )}

      {/* Drawing */}
      <button onClick={() => setTool("draw")} className={btnClass(tool === "draw")} title={`${es ? "Dibujo" : "Draw"} (${modKey}+Alt+D)`}>
        <Pencil size={14} className="inline -mt-0.5" /> {es ? "Dibujo" : "Draw"}
        <kbd className="ml-1 text-[9px] opacity-50">{modKey.charAt(0)}⌥D</kbd>
      </button>

      {tool === "draw" && (
        <div className="flex items-center gap-1.5 pl-1 border-l border-[var(--border)]">
          <span className="text-[10px] text-[var(--muted)]">{es ? "Grosor" : "Width"}</span>
          <input
            type="range"
            min={1}
            max={20}
            value={Math.round(overlayState.drawSize * 1000)}
            onChange={(e) => onOverlayChange({ ...overlayState, drawSize: Number(e.target.value) / 1000 })}
            className="w-16 h-1 accent-[var(--accent)]"
          />
          <button
            onClick={clearDrawing}
            className="text-[10px] px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors flex items-center gap-1"
          >
            <Trash2 size={10} /> {es ? "Borrar" : "Clear"}
          </button>
        </div>
      )}

      {/* Pointer */}
      <button onClick={() => setTool("pointer")} className={btnClass(tool === "pointer")} title={`${es ? "Puntero" : "Pointer"} (${modKey}+Alt+P)`}>
        <Circle size={14} className="inline -mt-0.5 fill-red-500 text-red-500" /> {es ? "Puntero" : "Pointer"}
        <kbd className="ml-1 text-[9px] opacity-50">{modKey.charAt(0)}⌥P</kbd>
      </button>

      {tool === "pointer" && (
        <div className="flex items-center gap-1.5 pl-1 border-l border-[var(--border)]">
          <span className="text-[10px] text-[var(--muted)]">{es ? "Tamaño" : "Size"}</span>
          <input
            type="range"
            min={5}
            max={40}
            value={Math.round(overlayState.pointerSize * 1000)}
            onChange={(e) => onOverlayChange({ ...overlayState, pointerSize: Number(e.target.value) / 1000 })}
            className="w-16 h-1 accent-[var(--accent)]"
          />
        </div>
      )}

      {/* Magnifier */}
      <button onClick={() => setTool("magnifier")} className={btnClass(tool === "magnifier")} title={`${es ? "Lupa" : "Magnifier"} (${modKey}+Alt+M)`}>
        <Search size={14} className="inline -mt-0.5" /> {es ? "Lupa" : "Magnifier"}
        <kbd className="ml-1 text-[9px] opacity-50">{modKey.charAt(0)}⌥M</kbd>
      </button>

      {tool === "magnifier" && (
        <div className="flex items-center gap-1.5 pl-1 border-l border-[var(--border)]">
          <span className="text-[10px] text-[var(--muted)]">{es ? "Tamaño" : "Size"}</span>
          <input
            type="range"
            min={5}
            max={30}
            value={Math.round(overlayState.magnifierSize * 100)}
            onChange={(e) => onOverlayChange({ ...overlayState, magnifierSize: Number(e.target.value) / 100 })}
            className="w-16 h-1 accent-[var(--accent)]"
          />
          <span className="text-[10px] text-[var(--muted)] ml-1">{es ? "Zoom" : "Zoom"}</span>
          <input
            type="range"
            min={15}
            max={50}
            value={Math.round(overlayState.magnifierZoom * 10)}
            onChange={(e) => onOverlayChange({ ...overlayState, magnifierZoom: Number(e.target.value) / 10 })}
            className="w-16 h-1 accent-[var(--accent)]"
          />
          <span className="text-[10px] font-mono text-[var(--muted)]">{overlayState.magnifierZoom.toFixed(1)}x</span>
        </div>
      )}
    </div>
  );
}