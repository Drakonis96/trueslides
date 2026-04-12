import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  getSession,
  getSessionSlides,
  updateSession,
  deleteSession,
  broadcastEvent,
} from "@/lib/presenter-session";
import type { SlideData } from "@/lib/types";
import type { SessionStyleProps } from "@/lib/presenter-session";

/**
 * POST: Create or update a presenter session.
 * Body: { action: "create" | "update" | "delete", sessionId, slides?, presentationTitle?, currentIndex?, overlayState? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, sessionId } = body;

  if (!sessionId || typeof sessionId !== "string" || sessionId.length > 64) {
    return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
  }

  if (action === "create") {
    const { slides, presentationTitle, currentIndex, style } = body as {
      slides: SlideData[];
      presentationTitle: string;
      currentIndex: number;
      style?: SessionStyleProps;
    };

    if (!Array.isArray(slides) || !presentationTitle) {
      return NextResponse.json({ error: "Missing slides or presentationTitle" }, { status: 400 });
    }

    const session = createSession(sessionId, slides, presentationTitle, currentIndex || 0, style);
    return NextResponse.json({ ok: true, session });
  }

  if (action === "update") {
    const session = updateSession(sessionId, {
      ...(typeof body.currentIndex === "number" ? { currentIndex: body.currentIndex } : {}),
      ...(body.overlayState ? { overlayState: body.overlayState } : {}),
      ...(body.remoteTools ? { remoteTools: body.remoteTools } : {}),
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Broadcast state update to all remote clients
    broadcastEvent(sessionId, { type: "state-update", session }, "remote");

    return NextResponse.json({ ok: true, session });
  }

  if (action === "delete") {
    deleteSession(sessionId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

/**
 * GET: Retrieve current session state.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Optionally include full slides + style (heavy, for initial remote load only)
  const includeSlides = request.nextUrl.searchParams.get("includeSlides") === "true";
  if (includeSlides) {
    const data = getSessionSlides(sessionId);
    return NextResponse.json({ session, slides: data?.slides, style: data?.style });
  }

  return NextResponse.json({ session });
}
