import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");
const STATE_FILE = join(DATA_DIR, "state.json");

type StateStore = Record<string, Record<string, unknown>>;

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): StateStore {
  ensureDataDir();
  if (!existsSync(STATE_FILE)) return {};
  try {
    const raw = readFileSync(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStore(store: StateStore): void {
  ensureDataDir();
  writeFileSync(STATE_FILE, JSON.stringify(store), "utf8");
}

export function getUserState(sessionId: string): Record<string, unknown> | null {
  const store = readStore();
  return store[sessionId] ?? null;
}

export function setUserState(sessionId: string, state: Record<string, unknown>): void {
  const store = readStore();
  store[sessionId] = state;
  writeStore(store);
}

export function deleteUserState(sessionId: string): void {
  const store = readStore();
  delete store[sessionId];
  writeStore(store);
}
