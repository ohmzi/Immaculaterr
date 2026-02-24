import type { NextFunction, Request, Response } from 'express';

function buildCsp(req: Request): string {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' http: https: ws: wss:",
    "worker-src 'self' blob:",
  ];

  if (req.secure) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function securityHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const path = (req.originalUrl || req.url || '').split('?')[0] || '';
  const isSwagger = path.startsWith('/api/docs');

  // Core hardening.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');

  // Swagger UI depends on inline assets; keep CSP off docs to avoid breaking local API docs.
  if (!isSwagger) {
    res.setHeader('Content-Security-Policy', buildCsp(req));
  }

  // HSTS only makes sense when requests are actually HTTPS.
  if (process.env.NODE_ENV === 'production' && req.secure) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }

  next();
}
