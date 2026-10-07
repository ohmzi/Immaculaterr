import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

function buildCsp(req: Request): string {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
  ];

  if (req.secure) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

const CORE_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['X-DNS-Prefetch-Control', 'off'],
  ['X-Permitted-Cross-Domain-Policies', 'none'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  [
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  ],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
  ['Origin-Agent-Cluster', '?1'],
];

function getRequestPath(req: Request): string {
  if (req.originalUrl) return req.originalUrl.split('?')[0] || '';
  if (req.url) return req.url.split('?')[0] || '';
  return '';
}

function isSwaggerRequest(req: Request): boolean {
  return getRequestPath(req).startsWith('/api/docs');
}

function setCoreSecurityHeaders(res: Response): void {
  for (const [headerName, headerValue] of CORE_SECURITY_HEADERS) {
    res.setHeader(headerName, headerValue);
  }
}

function shouldSetHsts(req: Request): boolean {
  return process.env.NODE_ENV === 'production' && req.secure;
}

const HSTS_PIN = 'max-age=31536000; includeSubDomains';
// Tells the browser to forget an HSTS pin it stored for this host earlier.
const HSTS_CLEAR = 'max-age=0';
const LOCAL_NETWORK_SUFFIXES = [
  '.localhost',
  '.local',
  '.lan',
  '.home',
  '.home.arpa',
  '.internal',
  '.localdomain',
  '.intranet',
  '.corp',
  '.priv',
  '.fritz.box',
];

// HSTS pins a host name on every port. localhost, IP addresses and LAN names are
// shared with the owner's other self-hosted apps, so a pin would force HTTPS on all of them.
const isSharedLocalHost = (hostname: string | undefined): boolean => {
  const host = (hostname ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!host || isIP(host) !== 0 || !host.includes('.')) {
    return true;
  }
  return LOCAL_NETWORK_SUFFIXES.some((suffix) => host.endsWith(suffix));
};

export function securityHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const swaggerRequest = isSwaggerRequest(req);
  setCoreSecurityHeaders(res);

  // Swagger UI depends on inline assets; keep CSP off docs to avoid breaking local API docs.
  if (!swaggerRequest) {
    res.setHeader('Content-Security-Policy', buildCsp(req));
  }

  // HSTS only makes sense when requests are actually HTTPS.
  if (shouldSetHsts(req)) {
    res.setHeader(
      'Strict-Transport-Security',
      isSharedLocalHost(req.hostname) ? HSTS_CLEAR : HSTS_PIN,
    );
  }

  next();
}
