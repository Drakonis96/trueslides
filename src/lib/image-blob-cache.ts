/**
 * IndexedDB-backed cache for image binary data (blobs).
 * Stores actual Blob objects (not base64 strings) so they live outside the JS
 * heap. For rendering, lightweight Object URLs are created on demand. For PPTX
 * export, blobs are converted to base64 only when needed.
 *
 * Separate from image-cache-idb.ts which caches *search results*, not blobs.
 */

const DB_NAME = "trueslides-image-blobs";
const DB_VERSION = 2;
const STORE_NAME = "blobs";
/** Blobs survive for 2 hours — long enough for a typical editing session. */
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
/** Max entries before we prune the oldest quarter. */
const MAX_ENTRIES = 300;

interface BlobEntry {
  /** Original remote URL (cache key) */
  url: string;
  /** Binary image data stored as a Blob (lives outside JS heap in IDB) */
  blob: Blob;
  /** Epoch ms when this entry was written */
  createdAt: number;
  /** Epoch ms after which this entry is stale */
  expiresAt: number;
}

// ── Singleton DB handle ──

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;
      if (oldVersion < 1) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "url" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (oldVersion === 1) {
        // Migrating from v1 (base64 strings) to v2 (Blob objects).
        // Wipe old entries — they'll be re-fetched as Blobs on demand.
        const tx = (event.target as IDBOpenDBRequest).transaction!;
        tx.objectStore(STORE_NAME).clear();
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

// ── Object URL management ──

/** Central map: original URL → Object URL. Prevents duplicate Object URLs. */
const objectUrlMap = new Map<string, string>();

/** Revoke a single Object URL and remove from map. */
function revokeObjectUrl(originalUrl: string): void {
  const objUrl = objectUrlMap.get(originalUrl);
  if (objUrl) {
    URL.revokeObjectURL(objUrl);
    objectUrlMap.delete(originalUrl);
  }
}

/** Revoke all tracked Object URLs. */
export function revokeAllObjectUrls(): void {
  for (const objUrl of objectUrlMap.values()) {
    URL.revokeObjectURL(objUrl);
  }
  objectUrlMap.clear();
}

// ── Internal helpers ──

async function getRawBlob(url: string): Promise<Blob | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await openDB();
    return new Promise<Blob | undefined>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(url);
      req.onsuccess = () => {
        const entry = req.result as BlobEntry | undefined;
        if (!entry) { resolve(undefined); return; }
        if (Date.now() > entry.expiresAt) {
          void removeCachedBlob(url);
          resolve(undefined);
          return;
        }
        resolve(entry.blob);
      };
      req.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ── Public API ──

/**
 * Retrieve a lightweight Object URL for the given remote URL, or undefined.
 * Object URLs are tiny strings (~60 bytes) that reference browser-managed blobs
 * outside the JS heap. Safe for use as `<img src>`.
 */
export async function getCachedBlob(url: string): Promise<string | undefined> {
  // Return existing Object URL if we already created one
  const existing = objectUrlMap.get(url);
  if (existing) return existing;

  const blob = await getRawBlob(url);
  if (!blob) return undefined;

  const objUrl = URL.createObjectURL(blob);
  objectUrlMap.set(url, objUrl);
  return objUrl;
}

/**
 * Retrieve a base64 data URI for the given remote URL (for PPTX/PDF export).
 * Converts the cached Blob on demand — only call this when you actually need
 * a data URI. For rendering, prefer getCachedBlob() which returns Object URLs.
 */
export async function getCachedBlobAsBase64(url: string): Promise<string | undefined> {
  const blob = await getRawBlob(url);
  if (!blob) return undefined;
  return blobToBase64(blob);
}

/** Store a Blob keyed by its original remote URL. */
export async function setCachedBlob(url: string, blob: Blob, ttlMs = DEFAULT_TTL_MS): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    // Invalidate any stale Object URL for this key
    revokeObjectUrl(url);

    const db = await openDB();
    const now = Date.now();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const entry: BlobEntry = { url, blob, createdAt: now, expiresAt: now + ttlMs };
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    // Prune if we exceeded cap (fire-and-forget)
    void pruneIfNeeded();
  } catch {
    // Best-effort
  }
}

/** Remove a single entry. */
export async function removeCachedBlob(url: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  revokeObjectUrl(url);
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* best-effort */ }
}

/** Wipe entire blob cache. */
export async function clearBlobCache(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  revokeAllObjectUrls();
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* best-effort */ }
}

// ── Background prefetch ──

/** Set of URLs currently being fetched to avoid duplicate work. */
const inFlightUrls = new Set<string>();

/**
 * Download an image in the background via /api/image-proxy and store it in IndexedDB.
 * Returns immediately (fire-and-forget). Safe to call many times with the same URL.
 */
export function prefetchImageBlob(url: string): void {
  if (!url || url.startsWith("data:") || typeof window === "undefined") return;
  if (inFlightUrls.has(url)) return;

  // Quick synchronous guard — check in-flight only; IDB check is async
  inFlightUrls.add(url);

  void (async () => {
    try {
      // Already cached?
      const existing = await getRawBlob(url);
      if (existing) return;

      const proxyUrl = new URL("/api/image-proxy", window.location.origin);
      proxyUrl.searchParams.set("url", url);

      const res = await fetch(proxyUrl.toString());
      if (res.ok) {
        const blob = await res.blob();
        await setCachedBlob(url, blob);
        return;
      }

      // Proxy failed (403/502) — try direct browser fetch as fallback.
      // Some servers (Cloudflare-protected) block server proxies but allow
      // direct browser requests.
      try {
        const directRes = await fetch(url);
        if (directRes.ok) {
          const blob = await directRes.blob();
          if (blob.type.startsWith("image/")) {
            await setCachedBlob(url, blob);
          }
        }
      } catch { /* CORS or network — silent */ }
    } catch {
      // Silent — prefetch is best-effort
    } finally {
      inFlightUrls.delete(url);
    }
  })();
}

/**
 * Prefetch an array of image URLs in the background with concurrency control.
 * Returns a promise that resolves when all are done (or failed).
 */
export async function prefetchImageBlobs(urls: string[], concurrency = 4): Promise<void> {
  const queue = urls.filter((u) => u && !u.startsWith("data:"));
  if (queue.length === 0) return;

  // Proactively purge expired entries before fetching new ones
  void purgeExpired();

  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < queue.length) {
      const currentIdx = idx++;
      const url = queue[currentIdx];
      if (inFlightUrls.has(url)) continue;
      inFlightUrls.add(url);
      try {
        const existing = await getRawBlob(url);
        if (existing) continue;

        const proxyUrl = new URL("/api/image-proxy", window.location.origin);
        proxyUrl.searchParams.set("url", url);
        const res = await fetch(proxyUrl.toString());
        if (!res.ok) continue;

        const blob = await res.blob();
        await setCachedBlob(url, blob);
      } catch {
        // Silent
      } finally {
        inFlightUrls.delete(url);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
}

// ── Pruning ──

async function pruneIfNeeded(): Promise<void> {
  try {
    const db = await openDB();
    const count = await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
    if (count <= MAX_ENTRIES) return;

    // Delete oldest quarter and revoke their Object URLs
    const deleteCount = Math.ceil(count / 4);
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("createdAt");
    let deleted = 0;
    const cursorReq = index.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor && deleted < deleteCount) {
        const entry = cursor.value as BlobEntry;
        revokeObjectUrl(entry.url);
        cursor.delete();
        deleted++;
        cursor.continue();
      }
    };
  } catch { /* best-effort */ }
}

/** Proactively remove expired entries instead of waiting for access. */
async function purgeExpired(): Promise<void> {
  try {
    const db = await openDB();
    const now = Date.now();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const entry = cursor.value as BlobEntry;
        if (now > entry.expiresAt) {
          revokeObjectUrl(entry.url);
          cursor.delete();
        }
        cursor.continue();
      }
    };
  } catch { /* best-effort */ }
}
