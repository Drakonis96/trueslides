/**
 * In-memory presenter session manager for cross-device remote control.
 * Sessions are ephemeral and exist only while the presenter is active.
 *
 * Uses globalThis to persist across Next.js HMR in dev mode.
 */

import type { SlideData } from "./types";
import type { OverlayState } from "@/components/presenter/PresenterToolsOverlay";

/** Presentation styling props needed to render slides on the remote */
export interface SessionStyleProps {
  bgColor: string;
  headingFont?: string;
  bodyFont?: string;
  textDensity: number;
  layoutMode: "fixed" | "smart";
  globalLayout: string;
  overlayTitleColor: string;
  overlaySectionColor: string;
}

export interface PresenterSession {
  id: string;
  createdAt: number;
  lastActivity: number;
  currentIndex: number;
  totalSlides: number;
  /** Minimal slide data sent to remote (title, section, notes, hasVideo) */
  slideMeta: Array<{ title: string; section: string; notes: string; hasVideo: boolean }>;
  presentationTitle: string;
  overlayState?: OverlayState;
  /** Tools enabled on remote */
  remoteTools: Array<"flashlight" | "draw" | "pointer" | "magnifier">;
}

export type SessionCommand =
  | { type: "slide-change"; index: number }
  | { type: "slide-next" }
  | { type: "slide-prev" }
  | { type: "overlay-update"; overlay: OverlayState }
  | { type: "tool-toggle"; tool: "flashlight" | "draw" | "pointer" | "magnifier"; enabled: boolean }
  | { type: "tools-reorder"; tools: Array<"flashlight" | "draw" | "pointer" | "magnifier"> }
  | { type: "video-control"; action: "play" | "pause" };

export type SessionEvent =
  | { type: "state-update"; session: PresenterSession }
  | { type: "command"; command: SessionCommand };

/* ── Persist across HMR via globalThis ── */

const globalStore = globalThis as typeof globalThis & {
  __presenterSessions?: Map<string, PresenterSession>;
  __presenterSlidesData?: Map<string, { slides: SlideData[]; style: SessionStyleProps }>;
  __presenterSSEClients?: Map<string, Map<string, { controller: ReadableStreamDefaultController; role: "presenter" | "remote" }>>;
  __presenterCleanupTimer?: ReturnType<typeof setInterval>;
};

if (!globalStore.__presenterSessions) {
  globalStore.__presenterSessions = new Map();
}
if (!globalStore.__presenterSlidesData) {
  globalStore.__presenterSlidesData = new Map();
}
if (!globalStore.__presenterSSEClients) {
  globalStore.__presenterSSEClients = new Map();
}

const sessions = globalStore.__presenterSessions;
const slidesData = globalStore.__presenterSlidesData;
const sseClients = globalStore.__presenterSSEClients;

/** Cleanup stale sessions older than 4h */
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

function cleanStale() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      sessions.delete(id);
      slidesData.delete(id);
      sseClients.delete(id);
    }
  }
}

// Run cleanup every 10 minutes (only one timer across HMR)
if (typeof setInterval !== "undefined" && !globalStore.__presenterCleanupTimer) {
  globalStore.__presenterCleanupTimer = setInterval(cleanStale, 10 * 60 * 1000);
}

export function createSession(
  id: string,
  slides: SlideData[],
  presentationTitle: string,
  currentIndex: number,
  style?: SessionStyleProps,
): PresenterSession {
  const session: PresenterSession = {
    id,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    currentIndex,
    totalSlides: slides.length,
    slideMeta: slides.map((s) => ({
      title: s.title || "",
      section: s.section || "",
      notes: s.notes || "",
      hasVideo: (s.bullets || []).some((b) => /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)/.test(b))
        || (s.imageUrls || []).some((u) => /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)/.test(u))
        || (s.manualElements || []).some((el) => el.type === "youtube" && el.youtubeUrl),
    })),
    presentationTitle,
    remoteTools: ["flashlight", "draw", "pointer", "magnifier"],
  };
  sessions.set(id, session);
  // Store full slides + style separately (not broadcast via SSE)
  slidesData.set(id, {
    slides,
    style: style || {
      bgColor: "FFFFFF",
      textDensity: 50,
      layoutMode: "fixed",
      globalLayout: "single",
      overlayTitleColor: "FFFFFF",
      overlaySectionColor: "D1D5DB",
    },
  });
  return session;
}

export function getSession(id: string): PresenterSession | undefined {
  return sessions.get(id);
}

/** Get full slide data + style for a session (heavy, only called once by remote) */
export function getSessionSlides(id: string): { slides: SlideData[]; style: SessionStyleProps } | undefined {
  return slidesData.get(id);
}

export function updateSession(id: string, updates: Partial<PresenterSession>): PresenterSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  Object.assign(session, updates, { lastActivity: Date.now() });
  return session;
}

export function deleteSession(id: string): void {
  sessions.delete(id);
  slidesData.delete(id);
  // Close all SSE connections
  const clients = sseClients.get(id);
  if (clients) {
    for (const [, client] of clients) {
      try { client.controller.close(); } catch { /* already closed */ }
    }
    sseClients.delete(id);
  }
}

/** Register an SSE client for a session */
export function registerSSEClient(
  sessionId: string,
  clientId: string,
  controller: ReadableStreamDefaultController,
  role: "presenter" | "remote",
): void {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Map());
  }
  sseClients.get(sessionId)!.set(clientId, { controller, role });
}

/** Unregister an SSE client */
export function unregisterSSEClient(sessionId: string, clientId: string): void {
  const clients = sseClients.get(sessionId);
  if (clients) {
    clients.delete(clientId);
    if (clients.size === 0) sseClients.delete(sessionId);
  }
}

/** Send an SSE event to specific roles in a session */
export function broadcastEvent(
  sessionId: string,
  event: SessionEvent,
  targetRole?: "presenter" | "remote",
  excludeClientId?: string,
): void {
  const clients = sseClients.get(sessionId);
  if (!clients) return;

  const data = `data: ${JSON.stringify(event)}\n\n`;

  for (const [clientId, client] of clients) {
    if (excludeClientId && clientId === excludeClientId) continue;
    if (targetRole && client.role !== targetRole) continue;
    try {
      client.controller.enqueue(new TextEncoder().encode(data));
    } catch {
      // Client disconnected, remove it
      clients.delete(clientId);
    }
  }
}
