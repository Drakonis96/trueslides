import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  updateSession,
  broadcastEvent,
} from "@/lib/presenter-session";
import type { SessionCommand } from "@/lib/presenter-session";

/**
 * POST: Send a command from remote to presenter (or vice versa).
 * Body: { sessionId, command: SessionCommand, from: "presenter" | "remote" }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sessionId, command, from } = body as {
    sessionId: string;
    command: SessionCommand;
    from: "presenter" | "remote";
  };

  if (!sessionId || !command || !from) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Apply command to session state
  if (command.type === "slide-change") {
    const idx = Math.max(0, Math.min(command.index, session.totalSlides - 1));
    updateSession(sessionId, { currentIndex: idx });
  } else if (command.type === "slide-next") {
    const idx = Math.min(session.currentIndex + 1, session.totalSlides - 1);
    updateSession(sessionId, { currentIndex: idx });
  } else if (command.type === "slide-prev") {
    const idx = Math.max(session.currentIndex - 1, 0);
    updateSession(sessionId, { currentIndex: idx });
  } else if (command.type === "tool-toggle") {
    const tools = [...session.remoteTools];
    if (command.enabled && !tools.includes(command.tool)) {
      tools.push(command.tool);
    } else if (!command.enabled) {
      const i = tools.indexOf(command.tool);
      if (i !== -1) tools.splice(i, 1);
    }
    updateSession(sessionId, { remoteTools: tools });
  } else if (command.type === "tools-reorder") {
    updateSession(sessionId, { remoteTools: command.tools });
  } else if (command.type === "overlay-update") {
    // Transient – just forward, don't persist in session
  } else if (command.type === "video-control") {
    // Transient – just forward to presenter
  }

  // Get updated session
  const updated = getSession(sessionId)!;

  // Broadcast: if from remote → send to presenter, if from presenter → send to remote
  const target = from === "remote" ? "presenter" : "remote";
  broadcastEvent(sessionId, { type: "command", command }, target);

  // Send state update for non-transient commands only (overlay-update and video-control are high-frequency and don't change session state)
  const isTransient = command.type === "overlay-update" || command.type === "video-control";
  if (!isTransient) {
    broadcastEvent(sessionId, { type: "state-update", session: updated });
  }

  return NextResponse.json({ ok: true, session: updated });
}
