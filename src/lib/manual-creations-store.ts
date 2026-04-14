import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = join(process.cwd(), "data");
const MANUAL_CREATIONS_FILE = join(DATA_DIR, "manual-creations.json");
const SLIDE_IMAGES_DIR = resolve(process.cwd(), "data", "slide-images");

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

function readState(): ManualCreationsState {
  ensureDataDir();
  if (!existsSync(MANUAL_CREATIONS_FILE)) return { ...EMPTY_STATE };
  try {
    const raw = readFileSync(MANUAL_CREATIONS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    // Migrate from old session-keyed format: if the top-level is a map of session
    // objects (no "creations" array at top level), merge all sessions into one.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed.creations)) {
      const sessions = Object.values(parsed) as ManualCreationsState[];
      if (sessions.length === 0) return { ...EMPTY_STATE };
      const allCreations: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      let latestActiveId: string | null = null;
      let latestTime = 0;
      for (const s of sessions) {
        const ns = normalizeState(s);
        for (const c of ns.creations) {
          const id = (c as { id?: string }).id;
          if (id && !seen.has(id)) {
            seen.add(id);
            allCreations.push(c);
          }
        }
        if (ns.updatedAt > latestTime) {
          latestTime = ns.updatedAt;
          latestActiveId = ns.activeCreationId;
        }
      }
      const merged: ManualCreationsState = {
        creations: allCreations,
        activeCreationId: latestActiveId,
        updatedAt: latestTime || Date.now(),
      };
      writeState(merged);
      return merged;
    }
    return normalizeState(parsed);
  } catch {
    return { ...EMPTY_STATE };
  }
}

function writeState(state: ManualCreationsState): void {
  ensureDataDir();
  writeFileSync(MANUAL_CREATIONS_FILE, JSON.stringify(state), "utf8");
}

/**
 * Migrate inline data: URIs in manual-creation elements to on-disk PNG files.
 * This dramatically reduces JS heap usage for large imported-PPTX presentations
 * (e.g. 127 slides × ~500KB base64 ≈ 63 MB → near zero).
 * The migration is idempotent and only runs when data: URIs are detected.
 */
function migrateDataUrisToFiles(state: ManualCreationsState): ManualCreationsState {
  let migrated = false;

  for (const creation of state.creations) {
    const slides = (creation as { slides?: unknown[] }).slides;
    if (!Array.isArray(slides)) continue;

    for (const slide of slides) {
      const elements = (slide as { elements?: unknown[] }).elements;
      if (!Array.isArray(elements)) continue;

      for (const el of elements) {
        const element = el as { type?: string; content?: string };
        if (
          element.type === "image" &&
          typeof element.content === "string" &&
          element.content.startsWith("data:image/")
        ) {
          try {
            // Extract the binary data from the data: URI
            const match = element.content.match(/^data:image\/(\w+);base64,(.+)$/);
            if (!match) continue;

            const ext = match[1] === "jpeg" ? "jpg" : match[1];
            const buffer = Buffer.from(match[2], "base64");

            // Save to disk
            if (!existsSync(SLIDE_IMAGES_DIR)) {
              mkdirSync(SLIDE_IMAGES_DIR, { recursive: true });
            }
            const imageId = randomUUID();
            const filename = `${imageId}.${ext}`;
            writeFileSync(join(SLIDE_IMAGES_DIR, filename), buffer);

            // Replace content with a URL
            element.content = `/api/slide-images/${filename}`;
            migrated = true;
          } catch (err) {
            console.warn("[manual-creations] Failed to migrate data: URI to file:", err);
          }
        }
      }
    }
  }

  if (migrated) {
    // Persist the migrated state back to disk so migration only runs once
    writeState(state);
    console.log("[manual-creations] Migrated inline data: URIs to on-disk files");
  }

  return state;
}

export function getManualCreationsState(): ManualCreationsState {
  const state = readState();
  return migrateDataUrisToFiles(state);
}

export function setManualCreationsState(state: { creations: Record<string, unknown>[]; activeCreationId: string | null }): void {
  writeState({
    creations: Array.isArray(state.creations) ? state.creations : [],
    activeCreationId: state.activeCreationId,
    updatedAt: Date.now(),
  });
}

export function clearManualCreationsState(): void {
  writeState({ ...EMPTY_STATE });
}
