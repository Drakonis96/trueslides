import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import type { AIProvider, ImageSourceId } from "./types";

// Used as storage key prefix to avoid collisions between AI providers and image sources
const IMG_PREFIX = "img_";

// ── Encryption helpers ──

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getDerivedKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is required. Generate one with: openssl rand -hex 32"
    );
  }
  // Derive a 256-bit key from the env var using SHA-256
  return createHash("sha256").update(secret).digest();
}

function encrypt(plaintext: string): string {
  const key = getDerivedKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const tag = cipher.getAuthTag();

  // Format: base64(iv + tag + ciphertext)
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString("base64");
}

function decrypt(encoded: string): string {
  const key = getDerivedKey();
  const combined = Buffer.from(encoded, "base64");

  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

// ── Storage ──

interface KeyStore {
  [sessionId: string]: {
    [provider: string]: string; // encrypted API key
  };
}

const DATA_DIR = join(process.cwd(), "data");
const STORE_PATH = join(DATA_DIR, "keys.json");

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

function readStore(): KeyStore {
  ensureDataDir();
  if (!existsSync(STORE_PATH)) return {};
  try {
    const raw = readFileSync(STORE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStore(store: KeyStore): void {
  ensureDataDir();
  writeFileSync(STORE_PATH, JSON.stringify(store), { encoding: "utf8", mode: 0o600 });
  // Ensure permissions even if file already existed
  try { chmodSync(STORE_PATH, 0o600); } catch { /* ignore on platforms that don't support chmod */ }
}

// ── Public API ──

/**
 * Store an encrypted API key for a provider in a given session.
 */
export function setApiKey(sessionId: string, provider: AIProvider, apiKey: string): void {
  const store = readStore();
  if (!store[sessionId]) store[sessionId] = {};
  store[sessionId][provider] = encrypt(apiKey);
  writeStore(store);
}

/**
 * Retrieve the decrypted API key for a provider in a given session.
 * Returns null if not found.
 */
export function getApiKey(sessionId: string, provider: AIProvider): string | null {
  const store = readStore();
  const encrypted = store[sessionId]?.[provider];
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}

/**
 * Delete an API key for a provider in a given session.
 */
export function deleteApiKey(sessionId: string, provider: AIProvider): void {
  const store = readStore();
  if (store[sessionId]) {
    delete store[sessionId][provider];
    if (Object.keys(store[sessionId]).length === 0) {
      delete store[sessionId];
    }
  }
  writeStore(store);
}

/**
 * Get a summary of which providers have keys set for a session.
 * NEVER returns the actual key values.
 */
export function getKeyStatus(sessionId: string): Record<AIProvider, boolean> {
  const store = readStore();
  const session = store[sessionId] || {};
  return {
    openrouter: !!session.openrouter,
    gemini: !!session.gemini,
    claude: !!session.claude,
    openai: !!session.openai,
  };
}

// ── Image Source Keys ──

export function setImageSourceKey(sessionId: string, sourceId: ImageSourceId, apiKey: string): void {
  const store = readStore();
  if (!store[sessionId]) store[sessionId] = {};
  store[sessionId][IMG_PREFIX + sourceId] = encrypt(apiKey);
  writeStore(store);
}

export function getImageSourceKey(sessionId: string, sourceId: ImageSourceId): string | null {
  const store = readStore();
  const encrypted = store[sessionId]?.[IMG_PREFIX + sourceId];
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}

export function deleteImageSourceKey(sessionId: string, sourceId: ImageSourceId): void {
  const store = readStore();
  if (store[sessionId]) {
    delete store[sessionId][IMG_PREFIX + sourceId];
    if (Object.keys(store[sessionId]).length === 0) {
      delete store[sessionId];
    }
  }
  writeStore(store);
}

export function getImageSourceKeyStatus(sessionId: string): Record<ImageSourceId, boolean> {
  const store = readStore();
  const session = store[sessionId] || {};
  return {
    wikimedia: true, // always available
    openverse: true, // always available (no key needed)
    loc: true,       // always available (no key needed)
    unsplash: !!session[IMG_PREFIX + "unsplash"],
    pexels: !!session[IMG_PREFIX + "pexels"],
    pixabay: !!session[IMG_PREFIX + "pixabay"],
    flickr: !!session[IMG_PREFIX + "flickr"],
    europeana: !!session[IMG_PREFIX + "europeana"],
    hispana: !!session[IMG_PREFIX + "hispana"],
  };
}

// ── Bulk delete helpers ──

const AI_PROVIDERS: AIProvider[] = ["openrouter", "gemini", "claude", "openai"];
const KEYED_IMAGE_SOURCES: ImageSourceId[] = ["unsplash", "pexels", "pixabay", "flickr", "europeana", "hispana"];

export function deleteAllAiKeys(sessionId: string): void {
  const store = readStore();
  if (!store[sessionId]) return;
  for (const p of AI_PROVIDERS) {
    delete store[sessionId][p];
  }
  if (Object.keys(store[sessionId]).length === 0) delete store[sessionId];
  writeStore(store);
}

export function deleteAllImageSourceKeys(sessionId: string): void {
  const store = readStore();
  if (!store[sessionId]) return;
  for (const s of KEYED_IMAGE_SOURCES) {
    delete store[sessionId][IMG_PREFIX + s];
  }
  if (Object.keys(store[sessionId]).length === 0) delete store[sessionId];
  writeStore(store);
}

export function deleteAllKeys(sessionId: string): void {
  const store = readStore();
  delete store[sessionId];
  writeStore(store);
}
