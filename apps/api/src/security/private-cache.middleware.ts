import type { NextFunction, Request, Response } from 'express';

const NO_STORE_VALUE =
  'no-store, no-cache, must-revalidate, private, max-age=0';

function isHtmlDocumentRequest(req: Request): boolean {
  if (req.method.toUpperCase() !== 'GET') return false;
  const accept = (req.headers.accept ?? '').toLowerCase();
  if (!accept) return false;
  return accept.includes('text/html');
}

export function privateCacheMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const path = (req.originalUrl || req.url || '').split('?')[0] || '';

  // API responses can carry private state/session context; do not cache.
  if (path.startsWith('/api')) {
    res.setHeader('Cache-Control', NO_STORE_VALUE);
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return next();
  }

  // Protect app shell HTML as well (but let static assets use normal cache semantics).
  if (isHtmlDocumentRequest(req)) {
    res.setHeader('Cache-Control', NO_STORE_VALUE);
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  next();
}
