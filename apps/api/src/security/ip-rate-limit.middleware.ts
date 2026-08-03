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
  const windowMs = Number.isFinite(options.windowMs)
    ? options.windowMs
    : 60_000;
  const max = Number.isFinite(options.max) ? options.max : 10;
  const keyPrefix = options.keyPrefix ?? 'iprl';
  const methodsList = options.methods ?? ['POST'];
  const methods =
    methodsList.length > 0
      ? new Set(methodsList.map((m) => m.toUpperCase()))
      : null;

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
    if (methods && !methods.has(req.method.toUpperCase())) return next();

    const nowMs = Date.now();
    cleanup(nowMs);

    const ip = (req.ip ?? '').trim() || 'unknown';
    const key = `${keyPrefix}:${ip}`;

    const existing = store.get(key);
    if (!existing || existing.resetAtMs <= nowMs) {
      store.set(key, { count: 1, resetAtMs: nowMs + windowMs });
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - 1)));
      res.setHeader(
        'X-RateLimit-Reset',
        String(Math.ceil((nowMs + windowMs) / 1000)),
      );
      return next();
    }

    existing.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(0, max - existing.count)),
    );
    res.setHeader(
      'X-RateLimit-Reset',
      String(Math.ceil(existing.resetAtMs / 1000)),
    );

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

export type TokenBucketRateLimitOptions = {
  /** Sustained allowance: tokens refilled per window. */
  windowMs: number;
  sustainedMax: number;
  /** Instantaneous allowance: bucket capacity for bursts. */
  burstMax: number;
  keyPrefix?: string;
};

type TokenBucketEntry = {
  tokens: number;
  updatedAtMs: number;
};

/**
 * Token-bucket limiter for the general API: legitimate users get a burst
 * allowance for fast navigation (many parallel queries per page), while the
 * refill rate caps sustained request floods. Auth endpoints keep their
 * separate strict fixed-window limits.
 */
export function createTokenBucketRateLimitMiddleware(
  options: TokenBucketRateLimitOptions,
) {
  const windowMs =
    Number.isFinite(options.windowMs) && options.windowMs > 0
      ? options.windowMs
      : 60_000;
  const sustainedMax =
    Number.isFinite(options.sustainedMax) && options.sustainedMax > 0
      ? options.sustainedMax
      : 240;
  const burstMax = Math.max(
    sustainedMax,
    Number.isFinite(options.burstMax) && options.burstMax > 0
      ? options.burstMax
      : sustainedMax,
  );
  const keyPrefix = options.keyPrefix ?? 'tbrl';
  const refillPerMs = sustainedMax / windowMs;

  const store = new Map<string, TokenBucketEntry>();
  let lastCleanupMs = Date.now();

  const cleanup = (nowMs: number) => {
    if (nowMs - lastCleanupMs < 60_000) return;
    lastCleanupMs = nowMs;
    for (const [key, entry] of store.entries()) {
      // A bucket refilled to capacity carries no state worth keeping.
      const refilled = entry.tokens + (nowMs - entry.updatedAtMs) * refillPerMs;
      if (refilled >= burstMax) store.delete(key);
    }
  };

  return function tokenBucketRateLimit(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const nowMs = Date.now();
    cleanup(nowMs);

    const ip = (req.ip ?? '').trim() || 'unknown';
    const key = `${keyPrefix}:${ip}`;

    const entry = store.get(key) ?? {
      tokens: burstMax,
      updatedAtMs: nowMs,
    };
    entry.tokens = Math.min(
      burstMax,
      entry.tokens + (nowMs - entry.updatedAtMs) * refillPerMs,
    );
    entry.updatedAtMs = nowMs;

    res.setHeader('X-RateLimit-Limit', String(burstMax));

    if (entry.tokens < 1) {
      store.set(key, entry);
      const retryAfterSec = Math.max(
        1,
        Math.ceil((1 - entry.tokens) / refillPerMs / 1000),
      );
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        statusCode: 429,
        message: 'Too Many Requests',
        error: 'Rate limit exceeded',
      });
      return;
    }

    entry.tokens -= 1;
    store.set(key, entry);
    res.setHeader('X-RateLimit-Remaining', String(Math.floor(entry.tokens)));
    next();
  };
}
