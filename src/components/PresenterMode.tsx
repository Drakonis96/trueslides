"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { SlideData } from "@/lib/types";
import PresenterView from "./presenter/PresenterView";
import AudienceView from "./presenter/AudienceView";
import { useBroadcastInitProvider } from "./presenter/useBroadcastSync";

interface PresenterModeProps {
  /** Slides from AI-generated or manual presentation */
  slides: SlideData[];
  presentationTitle: string;
  /** If true, this instance is the audience-only window */
  isAudienceWindow?: boolean;
  initialIndex?: number;
  onUpdateNotes?: (slideIndex: number, notes: string) => void;
  onExit: () => void;
}

// ── Electron bridge types (available when running inside Electron) ──
interface ElectronBridge {
  isElectron: boolean;
  getDisplays: () => Promise<{ id: number; label: string; width: number; height: number; isPrimary: boolean }[]>;
  openAudienceWindow: () => Promise<{ displayId: number; isExternal: boolean }>;
  closeAudienceWindow: () => Promise<boolean>;
  onAudienceWindowClosed: (cb: () => void) => () => void;
}

declare global {
  interface Window {
    electron?: ElectronBridge;
  }
}

function getElectron(): ElectronBridge | null {
  return typeof window !== "undefined" && window.electron?.isElectron
    ? window.electron
    : null;
}

export default function PresenterMode({
  slides,
  presentationTitle,
  isAudienceWindow = false,
  initialIndex = 0,
  onUpdateNotes,
  onExit,
}: PresenterModeProps) {
  const bgColor = useAppStore((s) => s.slideBgColor) || "FFFFFF";
  const headingFont = useAppStore((s) => s.headingFontFamily);
  const bodyFont = useAppStore((s) => s.bodyFontFamily);
  const textDensity = useAppStore((s) => s.textDensity);
  const layoutMode = useAppStore((s) => s.layoutMode);
  const globalLayout = useAppStore((s) => s.slideLayout);
  const overlayTitleColor = useAppStore((s) => s.overlayTitleColor) || "FFFFFF";
  const overlaySectionColor = useAppStore((s) => s.overlaySectionColor) || "D1D5DB";

  const audienceWindowRef = useRef<Window | null>(null);

  // Broadcast init data to audience window via BroadcastChannel (no size limit)
  const initPayload = useMemo(() => ({
    slides,
    presentationTitle,
    initialIndex,
    bgColor,
    headingFont,
    bodyFont,
    textDensity,
    layoutMode,
    globalLayout,
    overlayTitleColor,
    overlaySectionColor,
  }), [slides, presentationTitle, initialIndex, bgColor, headingFont, bodyFont, textDensity, layoutMode, globalLayout, overlayTitleColor, overlaySectionColor]);

  useBroadcastInitProvider(isAudienceWindow ? null : initPayload);

  // Open audience window on presenter enter
  useEffect(() => {
    if (isAudienceWindow) return;

    const electron = getElectron();

    if (electron) {
      // Electron: open audience window on external display via IPC
      electron.openAudienceWindow().catch(console.error);

      // Listen for audience window being closed externally
      const unsubscribe = electron.onAudienceWindowClosed(() => {
        // Audience window was closed by the user — no action needed,
        // presenter can keep running
      });

      return () => {
        unsubscribe();
      };
    } else {
      // Browser: open a popup window
      const w = window.open(
        `${window.location.origin}?audience=1`,
        "trueslides-audience",
        "popup,width=1280,height=720"
      );
      audienceWindowRef.current = w;

      return () => {};
    }
  }, [isAudienceWindow]);

  const handleExit = useCallback(() => {
    const electron = getElectron();

    if (electron) {
      // Electron: close the managed audience window
      electron.closeAudienceWindow().catch(console.error);
    } else {
      // Browser: close the popup
      if (audienceWindowRef.current && !audienceWindowRef.current.closed) {
        audienceWindowRef.current.close();
      }
      audienceWindowRef.current = null;
    }

    onExit();
  }, [onExit]);

  if (isAudienceWindow) {
    return (
      <AudienceView
        slides={slides}
        initialIndex={initialIndex}
        bgColor={bgColor}
        headingFont={headingFont}
        bodyFont={bodyFont}
        textDensity={textDensity}
        layoutMode={layoutMode}
        globalLayout={globalLayout}
        overlayTitleColor={overlayTitleColor}
        overlaySectionColor={overlaySectionColor}
      />
    );
  }

  return (
    <PresenterView
      slides={slides}
      initialIndex={initialIndex}
      presentationTitle={presentationTitle}
      bgColor={bgColor}
      headingFont={headingFont}
      bodyFont={bodyFont}
      textDensity={textDensity}
      layoutMode={layoutMode}
      globalLayout={globalLayout}
      overlayTitleColor={overlayTitleColor}
      overlaySectionColor={overlaySectionColor}      onUpdateNotes={onUpdateNotes}      onExit={handleExit}
    />
  );
}
