import type { MiddlewareHandler } from "hono";
import { HttpApiError } from "../errors/api.js";

export type RateLimitStore = { check(key: string, limit: number, windowSeconds: number): Promise<boolean> };

export function createMemoryRateLimitStore(): RateLimitStore {
  const buckets = new Map<string, { count: number; expiresAt: number }>();
  return {
    async check(key, limit, windowSeconds) {
      const now = Date.now();
      const current = buckets.get(key);
      if (!current || current.expiresAt <= now) {
        buckets.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
        return true;
      }
      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    }
  };
}

export function rateLimit(store: RateLimitStore, limit: number, windowSeconds: number): MiddlewareHandler {
  return async (c, next) => {
    const forwarded = c.req.header("CF-Connecting-IP") ?? "unknown";
    const key = `${c.req.path}:${forwarded}`;
    if (!(await store.check(key, limit, windowSeconds))) throw new HttpApiError(429, "RATE_LIMITED", "Too many requests. Try again later.", true);
    await next();
  };
}
