import type { NextFunction, Request, Response } from 'express';

export function securityHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Basic hardening headers (keep CSP out for now to avoid breaking assets).
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );

  // HSTS only makes sense when requests are actually HTTPS.
  if (process.env.NODE_ENV === 'production' && req.secure) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }

  next();
}

