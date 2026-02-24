import type { Request, Response } from 'express';
import { securityHeadersMiddleware } from '../../security/security-headers.middleware';

type HeaderStore = Record<string, string>;

function runMiddleware(reqPartial: Partial<Request>): HeaderStore {
  const headers: HeaderStore = {};
  const req = {
    originalUrl: '/api/auth/login',
    url: '/api/auth/login',
    secure: false,
    ...reqPartial,
  } as Request;

  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  } as unknown as Response;

  securityHeadersMiddleware(req, res, () => undefined);
  return headers;
}

describe('security/security-headers middleware', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('sets core hardening headers and CSP for API routes', () => {
    process.env.NODE_ENV = 'production';
    const headers = runMiddleware({ originalUrl: '/api/auth/login' });

    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('skips CSP for swagger docs to avoid breaking embedded UI assets', () => {
    const headers = runMiddleware({ originalUrl: '/api/docs' });
    expect(headers['Content-Security-Policy']).toBeUndefined();
  });

  it('sets HSTS only for secure prod requests', () => {
    process.env.NODE_ENV = 'production';

    const insecure = runMiddleware({ secure: false });
    expect(insecure['Strict-Transport-Security']).toBeUndefined();

    const secure = runMiddleware({ secure: true });
    expect(secure['Strict-Transport-Security']).toContain('max-age=31536000');
  });
});
