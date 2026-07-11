import {
  fetchWithTransientRetry,
  isTransientHttpStatus,
  isTransientNetworkError,
} from './http.utils';

function response(status: number, headers?: Record<string, string>) {
  return new Response('x', { status, headers });
}

describe('http.utils', () => {
  it('classifies transient statuses and codes', () => {
    expect(isTransientHttpStatus(503)).toBe(true);
    expect(isTransientHttpStatus(429)).toBe(true);
    expect(isTransientHttpStatus(404)).toBe(false);
    expect(isTransientNetworkError({ code: 'ECONNRESET' })).toBe(true);
    expect(
      isTransientNetworkError(
        new Error('fetch failed', { cause: { code: 'ETIMEDOUT' } }),
      ),
    ).toBe(true);
    expect(isTransientNetworkError(new Error('boom'))).toBe(false);
  });

  it('retries once on a transient status and returns the second response', async () => {
    let calls = 0;
    const res = await fetchWithTransientRetry(async () => {
      calls += 1;
      return calls === 1
        ? response(503, { 'retry-after': '0' })
        : response(200);
    });
    expect(calls).toBe(2);
    expect(res.status).toBe(200);
  });

  it('does not retry non-transient statuses', async () => {
    let calls = 0;
    const res = await fetchWithTransientRetry(async () => {
      calls += 1;
      return response(401);
    });
    expect(calls).toBe(1);
    expect(res.status).toBe(401);
  });

  it('retries once on a transient network error', async () => {
    let calls = 0;
    const res = await fetchWithTransientRetry(async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('fetch failed') as Error & { cause: unknown };
        err.cause = { code: 'ECONNRESET' };
        throw err;
      }
      return response(200);
    });
    expect(calls).toBe(2);
    expect(res.status).toBe(200);
  });

  it('propagates non-transient errors immediately', async () => {
    let calls = 0;
    await expect(
      fetchWithTransientRetry(async () => {
        calls += 1;
        throw new Error('hard failure');
      }),
    ).rejects.toThrow('hard failure');
    expect(calls).toBe(1);
  });
});
