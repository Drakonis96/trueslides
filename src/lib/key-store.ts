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
  [provider: string]: string; // encrypted API key
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
    const parsed = JSON.parse(raw);
    // Migrate from old session-keyed format: if top-level values are objects
    // (not strings), merge all sessions into a flat store.
    if (parsed && typeof parsed === "object") {
      const keys = Object.keys(parsed);
      if (keys.length > 0 && typeof parsed[keys[0]] === "object" && parsed[keys[0]] !== null) {
        const merged: KeyStore = {};
        for (const sessionData of Object.values(parsed) as Record<string, string>[]) {
          for (const [provider, encryptedKey] of Object.entries(sessionData)) {
            if (typeof encryptedKey === "string" && !merged[provider]) {
              merged[provider] = encryptedKey;
            }
          }
        }
        writeStore(merged);
        return merged;
      }
    }
    return parsed as KeyStore;
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
 * Store an encrypted API key for a provider.
 */
export function setApiKey(provider: AIProvider, apiKey: string): void {
  const store = readStore();
  store[provider] = encrypt(apiKey);
  writeStore(store);
}

/**
 * Retrieve the decrypted API key for a provider.
 * Returns null if not found.
 */
export function getApiKey(provider: AIProvider): string | null {
  const store = readStore();
  const encrypted = store[provider];
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}

/**
 * Delete an API key for a provider.
 */
export function deleteApiKey(provider: AIProvider): void {
  const store = readStore();
  delete store[provider];
  writeStore(store);
}

/**
 * Get a summary of which providers have keys set.
 * NEVER returns the actual key values.
 */
export function getKeyStatus(): Record<AIProvider, boolean> {
  const store = readStore();
  return {
    openrouter: !!store.openrouter,
    gemini: !!store.gemini,
    claude: !!store.claude,
    openai: !!store.openai,
  };
}

// ── Image Source Keys ──

export function setImageSourceKey(sourceId: ImageSourceId, apiKey: string): void {
  const store = readStore();
  store[IMG_PREFIX + sourceId] = encrypt(apiKey);
  writeStore(store);
}

export function getImageSourceKey(sourceId: ImageSourceId): string | null {
  const store = readStore();
  const encrypted = store[IMG_PREFIX + sourceId];
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}

export function deleteImageSourceKey(sourceId: ImageSourceId): void {
  const store = readStore();
  delete store[IMG_PREFIX + sourceId];
  writeStore(store);
}

export function getImageSourceKeyStatus(): Record<ImageSourceId, boolean> {
  const store = readStore();
  return {
    wikimedia: true, // always available
    openverse: true, // always available (no key needed)
    loc: true,       // always available (no key needed)
    unsplash: !!store[IMG_PREFIX + "unsplash"],
    pexels: !!store[IMG_PREFIX + "pexels"],
    pixabay: !!store[IMG_PREFIX + "pixabay"],
    flickr: !!store[IMG_PREFIX + "flickr"],
    europeana: !!store[IMG_PREFIX + "europeana"],
    hispana: !!store[IMG_PREFIX + "hispana"],
  };
}

// ── Bulk delete helpers ──

const AI_PROVIDERS: AIProvider[] = ["openrouter", "gemini", "claude", "openai"];
const KEYED_IMAGE_SOURCES: ImageSourceId[] = ["unsplash", "pexels", "pixabay", "flickr", "europeana", "hispana"];

export function deleteAllAiKeys(): void {
  const store = readStore();
  for (const p of AI_PROVIDERS) {
    delete store[p];
  }
  writeStore(store);
}

export function deleteAllImageSourceKeys(): void {
  const store = readStore();
  for (const s of KEYED_IMAGE_SOURCES) {
    delete store[IMG_PREFIX + s];
  }
  writeStore(store);
}

export function deleteAllKeys(): void {
  writeStore({});
}
