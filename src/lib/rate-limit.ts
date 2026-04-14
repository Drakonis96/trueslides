/**
 * In-memory sliding-window rate limiter.
 * Each limiter tracks hits per key (e.g. session ID or IP) within a time window.
 */

interface RateLimitEntry {
  timestamps: number[];
}

export interface RateLimiterConfig {
  /** Maximum number of requests allowed in the window. */
  maxRequests: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(config: RateLimiterConfig) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
  }

  /**
   * Check if a request is allowed for the given key.
   * Returns { allowed, retryAfterMs } — retryAfterMs is 0 when allowed.
   */
  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let entry = this.store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(key, entry);
    }

    // Prune expired timestamps
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    if (entry.timestamps.length >= this.maxRequests) {
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = oldestInWindow + this.windowMs - now;
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1) };
    }

    entry.timestamps.push(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Periodically prune stale entries to prevent memory growth. */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    for (const [key, entry] of this.store) {
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
      if (entry.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }
}

// ── Pre-configured limiters for different endpoint tiers ──

/** Expensive AI operations: 10 requests per minute per session */
const aiLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });

/** Image search: 30 requests per minute per session */
const imageLimiter = new RateLimiter({ maxRequests: 30, windowMs: 60_000 });

/** General API: 60 requests per minute per session */
const generalLimiter = new RateLimiter({ maxRequests: 60, windowMs: 60_000 });

/** File uploads: 10 requests per minute per session */
const uploadLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });

export const rateLimiters = {
  ai: aiLimiter,
  image: imageLimiter,
  general: generalLimiter,
  upload: uploadLimiter,
} as const;

export type RateLimitTier = keyof typeof rateLimiters;

// Cleanup stale entries every 5 minutes
setInterval(() => {
  for (const limiter of Object.values(rateLimiters)) {
    limiter.cleanup();
  }
}, 5 * 60_000).unref();
