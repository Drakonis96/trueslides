import { useCallback, useEffect, useRef, useState } from "react";
import type { SlideData } from "@/lib/types";
import type { PresenterSession, SessionCommand, SessionEvent, SessionStyleProps } from "@/lib/presenter-session";

/**
 * Hook for the presenter side to manage a remote control session.
 * Handles session creation, SSE connection, and command processing.
 */
export function usePresenterRemoteHost(
  slides: SlideData[],
  presentationTitle: string,
  currentIndex: number,
  onRemoteCommand: (command: SessionCommand) => void,
  styleProps?: SessionStyleProps,
) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const clientIdRef = useRef<string>(generateId());
  const sessionIdRef = useRef<string | null>(null);
  const onRemoteCommandRef = useRef(onRemoteCommand);
  const slidesRef = useRef(slides);
  const presentationTitleRef = useRef(presentationTitle);
  const currentIndexRef = useRef(currentIndex);
  const stylePropsRef = useRef(styleProps);

  // Keep refs in sync without triggering effects
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    onRemoteCommandRef.current = onRemoteCommand;
  }, [onRemoteCommand]);

  useEffect(() => {
    slidesRef.current = slides;
  }, [slides]);

  useEffect(() => {
    presentationTitleRef.current = presentationTitle;
  }, [presentationTitle]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    stylePropsRef.current = styleProps;
  }, [styleProps]);

  /** Create a new session */
  const startSession = useCallback(async () => {
    const id = generateId();
    try {
      const resp = await fetch("/api/presenter-remote/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          sessionId: id,
          slides: slidesRef.current,
          presentationTitle: presentationTitleRef.current,
          currentIndex: currentIndexRef.current,
          style: stylePropsRef.current,
        }),
      });
      if (!resp.ok) throw new Error("Failed to create session");
      setSessionId(id);
      return id;
    } catch (err) {
      console.error("Failed to create remote session:", err);
      return null;
    }
  // Stable: no external deps, uses refs
  }, []);

  /** Connect SSE for receiving remote commands */
  useEffect(() => {
    if (!sessionId) return;

    const clientId = clientIdRef.current;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const url = `/api/presenter-remote/events?sessionId=${sessionId}&role=presenter&clientId=${clientId}`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        retryCount = 0;
        setRemoteConnected(true);
      };

      es.onmessage = (evt) => {
        try {
          const event: SessionEvent = JSON.parse(evt.data);
          if (event.type === "command") {
            onRemoteCommandRef.current(event.command);
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        es.close();
        setRemoteConnected(false);
        // Exponential backoff reconnect
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        retryCount++;
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (retryTimer) clearTimeout(retryTimer);
      setRemoteConnected(false);
    };
  // Only re-run when sessionId changes, not on callback changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /** Sync slide changes to the server */
  const syncSlideChange = useCallback((index: number) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    fetch("/api/presenter-remote/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", sessionId: sid, currentIndex: index }),
    }).catch(() => { /* non-critical */ });
  }, []);

  /** End the session */
  const endSession = useCallback(() => {
    const sid = sessionIdRef.current;
    if (sid) {
      fetch("/api/presenter-remote/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", sessionId: sid }),
      }).catch(() => {});
    }
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setSessionId(null);
    setRemoteConnected(false);
  }, []);

  return {
    sessionId,
    remoteConnected,
    startSession,
    endSession,
    syncSlideChange,
  };
}

/**
 * Hook for the mobile remote side.
 * Connects to an existing session and provides controls.
 * Uses preflight fetch + SSE with polling fallback for robustness.
 */
export function usePresenterRemoteClient(sessionId: string | null) {
  const [session, setSession] = useState<PresenterSession | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const clientIdRef = useRef<string>(generateId());
  const sessionIdRef = useRef(sessionId);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sseWorkingRef = useRef(false);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  /** Connect to session: preflight fetch → SSE with polling fallback */
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    const clientId = clientIdRef.current;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // Step 1: Preflight — verify session exists via regular fetch
    async function preflight(): Promise<boolean> {
      try {
        const resp = await fetch(`/api/presenter-remote/session?sessionId=${sessionId}`);
        if (!resp.ok) {
          if (resp.status === 404) {
            setError("Session not found");
          } else {
            setError(`Server error (${resp.status})`);
          }
          return false;
        }
        const data = await resp.json();
        if (data.session) {
          setSession(data.session);
          setConnected(true);
          setError(null);
        }
        return true;
      } catch (e) {
        setError("Cannot reach server");
        return false;
      }
    }

    // Step 2: SSE connection (real-time updates)
    function connectSSE() {
      if (cancelled) return;
      const url = `/api/presenter-remote/events?sessionId=${sessionId}&role=remote&clientId=${clientId}`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        retryCount = 0;
        sseWorkingRef.current = true;
        setConnected(true);
        setError(null);
      };

      es.onmessage = (evt) => {
        try {
          const event: SessionEvent = JSON.parse(evt.data);
          if (event.type === "state-update") {
            setSession(event.session);
            setConnected(true);
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        es.close();
        sseWorkingRef.current = false;
        // Don't set disconnected if we have polling fallback
        if (retryCount < 5) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
          retryCount++;
          retryTimer = setTimeout(connectSSE, delay);
        }
        // Polling fallback will keep things alive
      };
    }

    // Step 3: Polling fallback — keeps session updated even if SSE is blocked
    function startPolling() {
      if (cancelled) return;
      pollRef.current = setInterval(async () => {
        if (cancelled) return;
        // Skip polling if SSE is working fine
        if (sseWorkingRef.current) return;
        try {
          const resp = await fetch(`/api/presenter-remote/session?sessionId=${sessionId}`);
          if (resp.ok) {
            const data = await resp.json();
            if (data.session) {
              setSession(data.session);
              setConnected(true);
              setError(null);
            }
          } else if (resp.status === 404) {
            setError("Session expired");
            setConnected(false);
          }
        } catch {
          // Network still down — just wait for next poll
        }
      }, 1500);
    }

    // Execute the connection pipeline
    // Always start SSE + polling even if preflight fails (e.g. route not yet
    // compiled in dev mode or session created a moment later). Preflight
    // retries a few times; SSE/polling will recover on their own.
    (async () => {
      let ok = false;
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        ok = await preflight();
        if (ok || cancelled) break;
        // short pause before retry (500ms, 1000ms)
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
      if (cancelled) return;
      connectSSE();
      startPolling();
    })();

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (retryTimer) clearTimeout(retryTimer);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sessionId]);

  /** Send a command to the presenter — overlay updates use an in-flight guard
   *  so concurrent POSTs don't pile up and cause network congestion. */
  const overlayInFlightRef = useRef(false);
  const pendingOverlayCmdRef = useRef<SessionCommand | null>(null);

  const sendCommand = useCallback(async (command: SessionCommand) => {
    const sid = sessionIdRef.current;
    if (!sid) return;

    // For overlay-update commands, queue only the latest and skip if one is already in-flight
    if (command.type === "overlay-update") {
      if (overlayInFlightRef.current) {
        pendingOverlayCmdRef.current = command;
        return;
      }
      overlayInFlightRef.current = true;
    }

    try {
      const resp = await fetch("/api/presenter-remote/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, command, from: "remote" }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        if (data.error === "Session not found") {
          setError("Session expired");
          setConnected(false);
        }
      }
    } catch {
      // Network error - SSE will handle reconnection
    } finally {
      if (command.type === "overlay-update") {
        overlayInFlightRef.current = false;
        // Flush the latest pending overlay if one queued while we were in-flight
        const pending = pendingOverlayCmdRef.current;
        if (pending) {
          pendingOverlayCmdRef.current = null;
          sendCommand(pending);
        }
      }
    }
  }, []);

  const nextSlide = useCallback(() => sendCommand({ type: "slide-next" }), [sendCommand]);
  const prevSlide = useCallback(() => sendCommand({ type: "slide-prev" }), [sendCommand]);
  const goToSlide = useCallback((index: number) => sendCommand({ type: "slide-change", index }), [sendCommand]);
  const toggleTool = useCallback(
    (tool: "flashlight" | "draw" | "pointer" | "magnifier", enabled: boolean) =>
      sendCommand({ type: "tool-toggle", tool, enabled }),
    [sendCommand],
  );
  const reorderTools = useCallback(
    (tools: Array<"flashlight" | "draw" | "pointer" | "magnifier">) =>
      sendCommand({ type: "tools-reorder", tools }),
    [sendCommand],
  );

  return {
    session,
    connected,
    error,
    nextSlide,
    prevSlide,
    goToSlide,
    toggleTool,
    reorderTools,
    sendCommand,
  };
}

function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  const arr = new Uint8Array(12);
  if (typeof crypto !== "undefined") {
    crypto.getRandomValues(arr);
    for (let i = 0; i < 12; i++) id += chars[arr[i] % chars.length];
  } else {
    for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
