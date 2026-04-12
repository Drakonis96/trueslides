import { NextRequest, NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { getUserState, setUserState } from "@/lib/state-store";

export async function GET() {
  try {
    const sessionId = await getSessionId();
    const state = getUserState(sessionId);
    return NextResponse.json({ state });
  } catch (err) {
    console.error("State GET error:", err);
    return NextResponse.json({ error: "Failed to load state" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const sessionId = await getSessionId();
    const body = await req.json();
    if (!body.state || typeof body.state !== "object") {
      return NextResponse.json({ error: "Invalid state" }, { status: 400 });
    }
    setUserState(sessionId, body.state);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("State POST error:", err);
    return NextResponse.json({ error: "Failed to save state" }, { status: 500 });
  }
}
