import type { Request, Response } from 'express';
import { privateCacheMiddleware } from '../../security/private-cache.middleware';

type HeaderStore = Record<string, string>;

function execute(reqPartial: Partial<Request>): HeaderStore {
  const headers: HeaderStore = {};
  const req = {
    method: 'GET',
    url: '/',
    originalUrl: '/',
    headers: {},
    ...reqPartial,
  } as Request;

  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  } as unknown as Response;

  privateCacheMiddleware(req, res, () => undefined);
  return headers;
}

describe('security/private cache middleware', () => {
  it('sets no-store headers for API responses', () => {
    const headers = execute({ originalUrl: '/api/auth/me' });
    expect(headers['Cache-Control']).toContain('no-store');
    expect(headers['Pragma']).toBe('no-cache');
    expect(headers['Expires']).toBe('0');
  });

  it('sets no-store headers for app shell html document requests', () => {
    const headers = execute({
      originalUrl: '/',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    expect(headers['Cache-Control']).toContain('no-store');
  });

  it('does not force no-store for static asset requests', () => {
    const headers = execute({
      originalUrl: '/assets/index-abc.js',
      headers: { accept: 'application/javascript' },
    });
    expect(headers['Cache-Control']).toBeUndefined();
  });
});
