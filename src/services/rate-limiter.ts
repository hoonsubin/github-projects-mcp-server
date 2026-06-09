// =============================================================================
// src/services/rate-limiter.ts
// Sliding-window rate limiter.
//
// Tracks request timestamps per key within a configurable window.
// Single-threaded JS — no locking needed.
// =============================================================================

export interface RateLimiterConfig {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimiter {
  allow(key: string): boolean;
  dispose(): void;
}

export const createRateLimiter = (config: RateLimiterConfig): RateLimiter => {
  const counts = new Map<string, number[]>();

  const allow = (key: string): boolean => {
    const now = Date.now();
    const cutoff = now - config.windowMs;
    const timestamps = (counts.get(key) ?? []).filter((t) => t > cutoff);

    if (timestamps.length >= config.maxRequests) {
      counts.set(key, timestamps);
      return false;
    }

    timestamps.push(now);
    counts.set(key, timestamps);
    return true;
  };

  // Sweep entries whose entire window has expired to prevent unbounded growth.
  const cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - config.windowMs;
    for (const [key, timestamps] of counts) {
      const active = timestamps.filter((t) => t > cutoff);
      if (active.length === 0) counts.delete(key);
      else counts.set(key, active);
    }
  }, config.windowMs);

  return {
    allow,
    dispose: () => clearInterval(cleanupInterval),
  };
};
