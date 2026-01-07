import type { NextFunction, Request, Response } from 'express';

export type IpRateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  methods?: string[];
};

type RateLimitEntry = {
  count: number;
  resetAtMs: number;
};

export function createIpRateLimitMiddleware(options: IpRateLimitOptions) {
  const windowMs = Number.isFinite(options.windowMs) ? options.windowMs : 60_000;
  const max = Number.isFinite(options.max) ? options.max : 10;
  const keyPrefix = options.keyPrefix ?? 'iprl';
  const methods = new Set((options.methods ?? ['POST']).map((m) => m.toUpperCase()));

  // In-memory store. Suitable for single-instance deployments.
  const store = new Map<string, RateLimitEntry>();
  let lastCleanupMs = Date.now();

  const cleanup = (nowMs: number) => {
    // Opportunistic cleanup every ~1 minute to avoid unbounded growth.
    if (nowMs - lastCleanupMs < 60_000) return;
    lastCleanupMs = nowMs;
    for (const [key, entry] of store.entries()) {
      if (entry.resetAtMs <= nowMs) store.delete(key);
    }
  };

  return function ipRateLimit(req: Request, res: Response, next: NextFunction) {
    if (!methods.has(req.method.toUpperCase())) return next();

    const nowMs = Date.now();
    cleanup(nowMs);

    const ip = (req.ip ?? '').trim() || 'unknown';
    const key = `${keyPrefix}:${ip}`;

    const existing = store.get(key);
    if (!existing || existing.resetAtMs <= nowMs) {
      store.set(key, { count: 1, resetAtMs: nowMs + windowMs });
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - 1)));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil((nowMs + windowMs) / 1000)));
      return next();
    }

    existing.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(0, max - existing.count)),
    );
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(existing.resetAtMs / 1000)));

    if (existing.count > max) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((existing.resetAtMs - nowMs) / 1000),
      );
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        statusCode: 429,
        message: 'Too Many Requests',
        error: 'Rate limit exceeded',
      });
      return;
    }

    next();
  };
}

