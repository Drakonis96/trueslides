import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");
const STATE_FILE = join(DATA_DIR, "state.json");

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readState(): Record<string, unknown> | null {
  ensureDataDir();
  if (!existsSync(STATE_FILE)) return null;
  try {
    const raw = readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    // Migrate from old session-keyed format: if the top-level is a map of session
    // objects (i.e. values are objects with history/settings), merge into one.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed);
      if (keys.length > 0) {
        const first = parsed[keys[0]];
        // Detect session-keyed format: values are objects and none have typical
        // state keys at the top level
        if (first && typeof first === "object" && !Array.isArray(first) && (first.history || first.settings || first.imageFeedback)) {
          // Merge all sessions — prefer the most recently updated one by picking
          // the session with the longest history array
          let best: Record<string, unknown> | null = null;
          let bestHistoryLen = -1;
          for (const sessionState of Object.values(parsed) as Record<string, unknown>[]) {
            const histLen = Array.isArray(sessionState.history) ? sessionState.history.length : 0;
            if (histLen > bestHistoryLen) {
              bestHistoryLen = histLen;
              best = sessionState;
            }
          }
          if (best) {
            writeState(best);
            return best;
          }
        }
      }
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function writeState(state: Record<string, unknown>): void {
  ensureDataDir();
  writeFileSync(STATE_FILE, JSON.stringify(state), "utf8");
}

export function getUserState(): Record<string, unknown> | null {
  return readState();
}

export function setUserState(state: Record<string, unknown>): void {
  writeState(state);
}

export function deleteUserState(): void {
  writeState({});
}
