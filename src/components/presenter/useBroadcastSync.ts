import { useCallback, useEffect, useRef, useState } from "react";

import type { OverlayState } from "./PresenterToolsOverlay";

/**
 * BroadcastChannel-based sync between presenter and audience windows.
 * Messages: { type: "slide-change", index: number }
 *         | { type: "init-data", payload: unknown }
 *         | { type: "init-request" }
 *         | { type: "overlay-update", overlay: OverlayState }
 */

const CHANNEL_NAME = "trueslides-presenter";

export type PresenterMessage =
  | { type: "slide-change"; index: number }
  | { type: "init-data"; payload: unknown }
  | { type: "init-request" }
  | { type: "overlay-update"; overlay: OverlayState }
  | { type: "video-control"; action: "play" | "pause" };

export function useBroadcastSender() {
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    return () => {
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, []);

  const sendSlideChange = useCallback((index: number) => {
    channelRef.current?.postMessage({ type: "slide-change", index } satisfies PresenterMessage);
  }, []);

  const sendOverlay = useCallback((overlay: OverlayState) => {
    channelRef.current?.postMessage({ type: "overlay-update", overlay } satisfies PresenterMessage);
  }, []);

  const sendVideoControl = useCallback((action: "play" | "pause") => {
    channelRef.current?.postMessage({ type: "video-control", action } satisfies PresenterMessage);
  }, []);

  return { sendSlideChange, sendOverlay, sendVideoControl };
}

export function useBroadcastReceiver(
  onSlideChange: (index: number) => void,
  onOverlayUpdate?: (overlay: OverlayState) => void,
  onVideoControl?: (action: "play" | "pause") => void,
) {
  const callbackRef = useRef(onSlideChange);
  callbackRef.current = onSlideChange;
  const overlayRef = useRef(onOverlayUpdate);
  overlayRef.current = onOverlayUpdate;
  const videoRef = useRef(onVideoControl);
  videoRef.current = onVideoControl;

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<PresenterMessage>) => {
      if (event.data?.type === "slide-change") {
        callbackRef.current(event.data.index);
      } else if (event.data?.type === "overlay-update") {
        overlayRef.current?.(event.data.overlay);
      } else if (event.data?.type === "video-control") {
        videoRef.current?.(event.data.action);
      }
    };
    return () => channel.close();
  }, []);
}

/**
 * Presenter side: listen for init-request from audience and respond with payload.
 * Also sends init-data immediately so the audience gets it even if it loads fast.
 */
export function useBroadcastInitProvider(payload: unknown | null) {
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (payload === null) return;

    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    // Respond to audience requests
    channel.onmessage = (event: MessageEvent<PresenterMessage>) => {
      if (event.data?.type === "init-request") {
        channel.postMessage({ type: "init-data", payload } satisfies PresenterMessage);
      }
    };

    // Send immediately in case the audience window is already listening
    channel.postMessage({ type: "init-data", payload } satisfies PresenterMessage);

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [payload]);
}

/**
 * Audience side: request init data from presenter.
 * Returns the payload once received, or null while waiting.
 */
export function useBroadcastInitReceiver(): unknown | null {
  const [data, setData] = useState<unknown | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);

    channel.onmessage = (event: MessageEvent<PresenterMessage>) => {
      if (event.data?.type === "init-data") {
        setData(event.data.payload);
      }
    };

    // Request data from presenter
    channel.postMessage({ type: "init-request" } satisfies PresenterMessage);

    return () => channel.close();
  }, []);

  return data;
}
