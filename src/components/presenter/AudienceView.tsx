"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { SlideData } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { useBroadcastReceiver, useBroadcastSender } from "./useBroadcastSync";
import SlideRenderer from "./SlideRenderer";
import { OverlayRenderer, InteractiveOverlay, PresenterToolbar, DEFAULT_OVERLAY, clearOverlayDrawings } from "./PresenterToolsOverlay";
import type { OverlayState } from "./PresenterToolsOverlay";
import { Maximize, Minimize } from "lucide-react";

interface AudienceViewProps {
  slides: SlideData[];
  initialIndex: number;
  bgColor: string;
  headingFont?: string;
  bodyFont?: string;
  textDensity: number;
  layoutMode: "fixed" | "smart";
  globalLayout: string;
  overlayTitleColor: string;
  overlaySectionColor: string;
}

export default function AudienceView({
  slides,
  initialIndex,
  bgColor,
  headingFont,
  bodyFont,
  textDensity,
  layoutMode,
  globalLayout,
  overlayTitleColor,
  overlaySectionColor,
}: AudienceViewProps) {
  const lang = useAppStore((s) => s.settings.language);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [overlayState, setOverlayState] = useState<OverlayState>(DEFAULT_OVERLAY);
  const [localTool, setLocalTool] = useState(false); // true = local tools active (not receiving from presenter)
  const localToolRef = useRef(false);
  localToolRef.current = localTool;
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sendOverlay } = useBroadcastSender();

  // Reactive window dimensions — re-render on resize / fullscreen
  const [dims, setDims] = useState({ w: typeof window !== "undefined" ? window.innerWidth : 1280, h: typeof window !== "undefined" ? window.innerHeight : 720 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const update = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      // Small delay for the browser to settle the new viewport
      requestAnimationFrame(update);
    };
    window.addEventListener("resize", update);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Listen for slide changes, overlay updates, and video control from presenter
  useBroadcastReceiver(
    useCallback((index: number) => {
      if (index >= 0 && index < slides.length) {
        setCurrentIndex(index);
        setOverlayState((prev) => clearOverlayDrawings(prev));
      }
    }, [slides.length]),
    useCallback((overlay: OverlayState) => {
      // Only apply remote overlay when local tools are not active
      if (localToolRef.current) return;
      setOverlayState(overlay);
    }, []),
    useCallback((action: "play" | "pause") => {
      const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe[src*="youtube"]');
      iframes.forEach((iframe) => {
        try {
          const msg = action === "play"
            ? '{"event":"command","func":"playVideo","args":""}'
            : '{"event":"command","func":"pauseVideo","args":""}';
          iframe.contentWindow?.postMessage(msg, "*");
        } catch { /* cross-origin guard */ }
      });
    }, []),
  );

  const handleOverlayChange = useCallback((next: OverlayState) => {
    setLocalTool(next.tool !== "none");
    setOverlayState(next);
    sendOverlay(next);
  }, [sendOverlay]);

  // Show toolbar on mouse move near bottom
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const inBottom = e.clientY > window.innerHeight - 80;
      const inToolbar = e.clientY > window.innerHeight - 160;
      if (inBottom || (toolbarVisible && inToolbar)) {
        setToolbarVisible(true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => setToolbarVisible(false), 3000);
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [toolbarVisible]);

  // Keep toolbar visible while a LOCAL tool is active
  useEffect(() => {
    if (localTool) {
      setToolbarVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  }, [localTool]);

  // Keyboard navigation (fallback if presenter doesn't send)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        setCurrentIndex((prev) => {
          const next = Math.min(prev + 1, slides.length - 1);
          if (next !== prev) setOverlayState((overlay) => clearOverlayDrawings(overlay));
          return next;
        });
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setCurrentIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          if (next !== prev) setOverlayState((overlay) => clearOverlayDrawings(overlay));
          return next;
        });
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      } else if (e.key === "Escape") {
        if (document.fullscreenElement) return; // let browser handle exiting fullscreen
        window.close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length]);

  const slide = slides[currentIndex];
  if (!slide) return null;

  const showCursor = toolbarVisible || overlayState.tool !== "none";

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        backgroundColor: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        cursor: showCursor ? "default" : "none",
      }}
    >
      <div style={{ position: "relative", width: dims.w, height: dims.h }}>
        {/* Key forces full remount on slide change, animation provides smooth fade-in */}
        <div key={currentIndex} style={{ position: "absolute", inset: 0, animation: "slideTransitionIn 0.35s ease-out" }}>
          <SlideRenderer
            slide={slide}
            width={dims.w}
            height={dims.h}
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
        <div style={{ position: "absolute", inset: 0, zIndex: 2 }}>
          {localTool ? (
            <InteractiveOverlay
              width={dims.w}
              height={dims.h}
              overlayState={overlayState}
              onOverlayChange={handleOverlayChange}
            />
          ) : (
            <OverlayRenderer
              state={overlayState}
              width={dims.w}
              height={dims.h}
            />
          )}
        </div>
      </div>

      {/* Floating toolbar — appears on mouse-near-bottom */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          padding: "8px 16px 12px",
          background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
          transition: "opacity 0.3s, transform 0.3s",
          opacity: toolbarVisible ? 1 : 0,
          transform: toolbarVisible ? "translateY(0)" : "translateY(20px)",
          pointerEvents: toolbarVisible ? "auto" : "none",
          zIndex: 50,
        }}
      >
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-2 shadow-2xl flex items-center gap-3">
          <PresenterToolbar overlayState={overlayState} onOverlayChange={handleOverlayChange} lang={lang} />
          <div className="w-px h-6 bg-[var(--border)]" />
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
            title={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
