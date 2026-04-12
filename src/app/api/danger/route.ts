import { NextRequest, NextResponse } from "next/server";
import { getSessionId } from "@/lib/session";
import { deleteAllAiKeys, deleteAllImageSourceKeys, deleteAllKeys } from "@/lib/key-store";
import { getUserState, setUserState, deleteUserState } from "@/lib/state-store";
import { clearManualCreationsState } from "@/lib/manual-creations-store";

type DangerAction =
  | "remove-ai-keys"
  | "remove-image-keys"
  | "remove-manual"
  | "remove-ai-creations"
  | "remove-notes"
  | "remove-all-creations"
  | "remove-everything";

const VALID_ACTIONS: DangerAction[] = [
  "remove-ai-keys",
  "remove-image-keys",
  "remove-manual",
  "remove-ai-creations",
  "remove-notes",
  "remove-all-creations",
  "remove-everything",
];

export async function POST(req: NextRequest) {
  try {
    const sessionId = await getSessionId();
    const body = await req.json();
    const action = body.action as string;

    if (!action || !VALID_ACTIONS.includes(action as DangerAction)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    switch (action as DangerAction) {
      case "remove-ai-keys":
        deleteAllAiKeys(sessionId);
        return NextResponse.json({ ok: true, cleared: "ai-keys" });

      case "remove-image-keys":
        deleteAllImageSourceKeys(sessionId);
        return NextResponse.json({ ok: true, cleared: "image-keys" });

      case "remove-manual":
        clearManualCreationsState();
        return NextResponse.json({ ok: true, cleared: "manual" });

      case "remove-ai-creations": {
        const state = getUserState(sessionId);
        if (state && Array.isArray(state.history)) {
          state.history = (state.history as Record<string, unknown>[]).filter(
            (e) => e.type !== "presentation"
          );
          setUserState(sessionId, state);
        }
        return NextResponse.json({ ok: true, cleared: "ai-creations" });
      }

      case "remove-notes": {
        const state = getUserState(sessionId);
        if (state && Array.isArray(state.history)) {
          state.history = (state.history as Record<string, unknown>[]).filter(
            (e) => e.type !== "notes"
          );
          setUserState(sessionId, state);
        }
        return NextResponse.json({ ok: true, cleared: "notes" });
      }

      case "remove-all-creations": {
        clearManualCreationsState();
        const state = getUserState(sessionId);
        if (state) {
          state.history = [];
          setUserState(sessionId, state);
        }
        return NextResponse.json({ ok: true, cleared: "all-creations" });
      }

      case "remove-everything":
        deleteAllKeys(sessionId);
        deleteUserState(sessionId);
        clearManualCreationsState();
        return NextResponse.json({ ok: true, cleared: "everything" });
    }
  } catch (err) {
    console.error("Danger zone error:", err);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
}
