import { NextRequest } from "next/server";
import {
  getSession,
  registerSSEClient,
  unregisterSSEClient,
  broadcastEvent,
} from "@/lib/presenter-session";

export const dynamic = "force-dynamic";

/**
 * GET: SSE stream for real-time presenter remote events.
 * Query params: sessionId, role (presenter|remote), clientId
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const role = request.nextUrl.searchParams.get("role") as "presenter" | "remote";
  const clientId = request.nextUrl.searchParams.get("clientId");

  if (!sessionId || !role || !clientId) {
    return new Response("Missing sessionId, role, or clientId", { status: 400 });
  }

  if (role !== "presenter" && role !== "remote") {
    return new Response("Invalid role", { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return new Response("Session not found", { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      // Register this client
      registerSSEClient(sessionId, clientId, controller, role);

      // Send initial state immediately
      const initData = `data: ${JSON.stringify({ type: "state-update", session })}\n\n`;
      controller.enqueue(new TextEncoder().encode(initData));

      // Keep-alive every 15 seconds
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepAlive);
          unregisterSSEClient(sessionId, clientId);
        }
      }, 15000);

      // Cleanup on abort
      request.signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        unregisterSSEClient(sessionId, clientId);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      unregisterSSEClient(sessionId, clientId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
