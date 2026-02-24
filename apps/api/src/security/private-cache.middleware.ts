import type { NextFunction, Request, Response } from 'express';

const NO_STORE_VALUE =
  'no-store, no-cache, must-revalidate, private, max-age=0';

function isHtmlDocumentRequest(req: Request): boolean {
  if (req.method.toUpperCase() !== 'GET') return false;
  const accept = (req.headers.accept ?? '').toLowerCase();
  if (!accept) return false;
  return accept.includes('text/html');
}

function setNoStoreHeaders(res: Response): void {
  res.setHeader('Cache-Control', NO_STORE_VALUE);
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

export function privateCacheMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const path = (req.originalUrl || req.url || '').split('?')[0] || '';
  const shouldDisableCache = path.startsWith('/api') || isHtmlDocumentRequest(req);
  if (shouldDisableCache) {
    setNoStoreHeaders(res);
  }
  return next();
}
