import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");
const MANUAL_CREATIONS_FILE = join(DATA_DIR, "manual-creations.json");

export interface ManualCreationsState {
  creations: Record<string, unknown>[];
  activeCreationId: string | null;
  updatedAt: number;
}

const EMPTY_STATE: ManualCreationsState = {
  creations: [],
  activeCreationId: null,
  updatedAt: 0,
};

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizeState(value: unknown): ManualCreationsState {
  if (!value || typeof value !== "object") return { ...EMPTY_STATE };
  const raw = value as {
    creations?: unknown;
    activeCreationId?: unknown;
    updatedAt?: unknown;
  };
  return {
    creations: Array.isArray(raw.creations) ? (raw.creations as Record<string, unknown>[]) : [],
    activeCreationId: typeof raw.activeCreationId === "string" ? raw.activeCreationId : null,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

export function getManualCreationsState(): ManualCreationsState {
  ensureDataDir();
  if (!existsSync(MANUAL_CREATIONS_FILE)) return { ...EMPTY_STATE };
  try {
    const raw = readFileSync(MANUAL_CREATIONS_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function setManualCreationsState(state: { creations: Record<string, unknown>[]; activeCreationId: string | null }): void {
  ensureDataDir();
  const next: ManualCreationsState = {
    creations: Array.isArray(state.creations) ? state.creations : [],
    activeCreationId: state.activeCreationId,
    updatedAt: Date.now(),
  };
  writeFileSync(MANUAL_CREATIONS_FILE, JSON.stringify(next), "utf8");
}

export function clearManualCreationsState(): void {
  setManualCreationsState({ creations: [], activeCreationId: null });
}
