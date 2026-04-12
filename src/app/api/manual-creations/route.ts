import { NextRequest, NextResponse } from "next/server";
import { clearManualCreationsState, getManualCreationsState, setManualCreationsState } from "@/lib/manual-creations-store";

export async function GET() {
  try {
    const state = getManualCreationsState();
    return NextResponse.json({ state });
  } catch (err) {
    console.error("Manual creations GET error:", err);
    return NextResponse.json({ error: "Failed to load manual creations" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const state = body?.state as { creations?: unknown; activeCreationId?: unknown } | undefined;
    if (!state || !Array.isArray(state.creations)) {
      return NextResponse.json({ error: "Invalid manual creations payload" }, { status: 400 });
    }

    setManualCreationsState({
      creations: state.creations as Record<string, unknown>[],
      activeCreationId: typeof state.activeCreationId === "string" ? state.activeCreationId : null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Manual creations POST error:", err);
    return NextResponse.json({ error: "Failed to save manual creations" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    clearManualCreationsState();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Manual creations DELETE error:", err);
    return NextResponse.json({ error: "Failed to clear manual creations" }, { status: 500 });
  }
}
