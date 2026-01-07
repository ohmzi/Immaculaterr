import type { NextFunction, Request, Response } from 'express';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type OriginCheckOptions = {
  allowedOrigins?: string[];
};

function normalizeAllowedOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    // Fall back to exact string match (useful for unusual environments).
    return trimmed;
  }
}

export function createOriginCheckMiddleware(options: OriginCheckOptions = {}) {
  const allowed = new Set<string>();
  for (const origin of options.allowedOrigins ?? []) {
    const normalized = normalizeAllowedOrigin(origin);
    if (normalized) allowed.add(normalized);
  }

  return function originCheck(req: Request, res: Response, next: NextFunction) {
    if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) return next();

    const originHeader = req.headers.origin;
    if (typeof originHeader !== 'string' || originHeader.trim() === '') return next();

    let originUrl: URL;
    try {
      originUrl = new URL(originHeader);
    } catch {
      res.status(403).json({
        statusCode: 403,
        message: 'Forbidden',
        error: 'Invalid Origin',
      });
      return;
    }

    const hostHeader =
      typeof req.headers.host === 'string'
        ? req.headers.host.trim().toLowerCase()
        : '';
    if (!hostHeader) {
      res.status(403).json({
        statusCode: 403,
        message: 'Forbidden',
        error: 'Missing Host',
      });
      return;
    }

    // Same-origin is allowed by default.
    const originHost = originUrl.host.toLowerCase();
    if (originHost === hostHeader) return next();

    // Allow extra configured origins (e.g., separate UI host).
    const normalizedOrigin = originUrl.origin;
    if (allowed.has(normalizedOrigin) || allowed.has(originHeader.trim())) return next();

    res.status(403).json({
      statusCode: 403,
      message: 'Forbidden',
      error: 'Origin mismatch',
    });
  };
}

