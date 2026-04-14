/**
 * IndexedDB-backed persistence layer for image search results.
 * Used client-side to survive page reloads without re-fetching from external APIs.
 */

const DB_NAME = "trueslides-image-cache";
const DB_VERSION = 1;
const STORE_NAME = "image-results";
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface IDBCacheEntry {
  key: string;
  value: unknown;
  expiresAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

export async function getFromIDB<T = unknown>(key: string): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await openDB();
    return new Promise<T | undefined>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        const entry = request.result as IDBCacheEntry | undefined;
        if (!entry) { resolve(undefined); return; }
        if (Date.now() > entry.expiresAt) {
          // Expired — delete in background
          deleteFromIDB(key).catch(() => {});
          resolve(undefined);
          return;
        }
        resolve(entry.value as T);
      };
      request.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

export async function setInIDB(key: string, value: unknown, ttlMs = DEFAULT_TTL_MS): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDB();
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const entry: IDBCacheEntry = { key, value, expiresAt: Date.now() + ttlMs };
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Silently fail — cache is best-effort
  }
}

export async function deleteFromIDB(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDB();
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Silently fail
  }
}

export async function clearIDBCache(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDB();
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Silently fail
  }
}

/**
 * Build a stable cache key from the image search request body.
 * Uses deterministic component ordering to ensure consistent keys
 * regardless of property order. This prevents duplicate cache entries for equivalent queries.
 */
export function buildImageCacheKey(body: Record<string, unknown>): string {
  const { searchTerms, presentationTopic, enabledSources } = body;
  // Build from sorted tuple to avoid {a,b} !== {b,a} JSON.stringify issue
  const parts: string[] = [];
  if (Array.isArray(enabledSources)) {
    parts.push(`sources:${JSON.stringify(enabledSources.sort())}`);
  }
  if (typeof presentationTopic === "string") {
    parts.push(`topic:${presentationTopic}`);
  }
  if (typeof searchTerms === "string") {
    parts.push(`terms:${searchTerms}`);
  } else if (Array.isArray(searchTerms)) {
    parts.push(`terms:${JSON.stringify(searchTerms)}`);
  }
  return `img::${parts.join("|")}`;
}

/**
 * Wrapper around fetch("/api/images") that checks IndexedDB first.
 * On cache miss, fetches from the server and stores the response in IDB.
 * Requests with non-empty `exclude` arrays skip the cache (need fresh results).
 */
export async function fetchImagesWithCache(
  body: Record<string, unknown>
): Promise<{ ok: boolean; images?: unknown[][]; error?: string }> {
  const excludeArr = body.exclude as unknown[] | undefined;
  const skipCache = excludeArr && excludeArr.length > 0;

  const cacheKey = skipCache ? "" : buildImageCacheKey(body);

  if (!skipCache) {
    const cached = await getFromIDB<{ images: unknown[][] }>(cacheKey);
    if (cached) {
      return { ok: true, images: cached.images };
    }
  }

  // Fetch from server
  const res = await fetch("/api/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (res.ok && data.images && !skipCache) {
    // Persist to IDB (fire-and-forget)
    setInIDB(cacheKey, { images: data.images }).catch(() => {});
  }

  return { ok: res.ok, images: data.images, error: data.error };
}
