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
  onExit: () => void;
}

export default function PresenterMode({
  slides,
  presentationTitle,
  isAudienceWindow = false,
  initialIndex = 0,
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

    // Open audience window
    const w = window.open(
      `${window.location.origin}?audience=1`,
      "trueslides-audience",
      "popup,width=1280,height=720"
    );
    audienceWindowRef.current = w;

    return () => {};
  }, [isAudienceWindow]);

  const handleExit = useCallback(() => {
    // Close audience window if we opened one
    if (audienceWindowRef.current && !audienceWindowRef.current.closed) {
      audienceWindowRef.current.close();
    }
    audienceWindowRef.current = null;
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
      overlaySectionColor={overlaySectionColor}
      onExit={handleExit}
    />
  );
}
