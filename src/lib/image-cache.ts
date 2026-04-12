/**
 * In-memory LRU cache for image search results.
 * Avoids redundant HTTP calls for overlapping queries across slides.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ImageSearchCache<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize = 200, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /** Build a normalized cache key from query + source. */
  static key(query: string, source: string): string {
    return `${source}::${query.toLowerCase().trim()}`;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

/** Singleton cache for image search results across the process. */
export const imageSearchCache = new ImageSearchCache<unknown[]>(200, 5 * 60 * 1000);
