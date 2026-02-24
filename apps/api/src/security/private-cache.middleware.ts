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

function getRequestPath(req: Request): string {
  if (req.originalUrl) return req.originalUrl.split('?')[0] || '';
  if (req.url) return req.url.split('?')[0] || '';
  return '';
}

function shouldDisablePrivateCache(req: Request): boolean {
  const path = getRequestPath(req);
  return path.startsWith('/api') || isHtmlDocumentRequest(req);
}

export function privateCacheMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (shouldDisablePrivateCache(req)) {
    setNoStoreHeaders(res);
  }
  return next();
}
