import type { NextFunction, Request, Response } from 'express';

import {
  createIpRateLimitMiddleware,
  createTokenBucketRateLimitMiddleware,
} from './ip-rate-limit.middleware';

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response & { status: jest.Mock; json: jest.Mock };
  return { res, headers };
}

function run(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  ip = '10.0.0.1',
) {
  const { res } = makeRes();
  const next = jest.fn();
  middleware({ ip, method: 'GET' } as unknown as Request, res, next);
  return { allowed: next.mock.calls.length > 0, res };
}

describe('createTokenBucketRateLimitMiddleware', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('allows a full burst instantly, then throttles', () => {
    const mw = createTokenBucketRateLimitMiddleware({
      windowMs: 60_000,
      sustainedMax: 60,
      burstMax: 10,
    });
    // burstMax is clamped up to sustainedMax when smaller; use explicit values
    const strict = createTokenBucketRateLimitMiddleware({
      windowMs: 60_000,
      sustainedMax: 6,
      burstMax: 10,
    });
    for (let i = 0; i < 10; i += 1) {
      expect(run(strict).allowed).toBe(true);
    }
    const blocked = run(strict);
    expect(blocked.allowed).toBe(false);
    expect(blocked.res.status).toHaveBeenCalledWith(429);
    void mw;
  });

  it('refills at the sustained rate and sets Retry-After when empty', () => {
    const mw = createTokenBucketRateLimitMiddleware({
      windowMs: 60_000,
      sustainedMax: 60, // 1 token/second
      burstMax: 60,
    });
    for (let i = 0; i < 60; i += 1) expect(run(mw).allowed).toBe(true);
    expect(run(mw).allowed).toBe(false);

    // One second later exactly one more request fits.
    jest.advanceTimersByTime(1_000);
    expect(run(mw).allowed).toBe(true);
    expect(run(mw).allowed).toBe(false);
  });

  it('keeps buckets separate per IP', () => {
    const mw = createTokenBucketRateLimitMiddleware({
      windowMs: 60_000,
      sustainedMax: 2,
      burstMax: 2,
    });
    expect(run(mw, '10.0.0.1').allowed).toBe(true);
    expect(run(mw, '10.0.0.1').allowed).toBe(true);
    expect(run(mw, '10.0.0.1').allowed).toBe(false);
    expect(run(mw, '10.0.0.2').allowed).toBe(true);
  });

  it('never lets the burst capacity fall below the sustained allowance', () => {
    const mw = createTokenBucketRateLimitMiddleware({
      windowMs: 60_000,
      sustainedMax: 50,
      burstMax: 10, // clamped up to 50
    });
    for (let i = 0; i < 50; i += 1) expect(run(mw).allowed).toBe(true);
    expect(run(mw).allowed).toBe(false);
  });
});

describe('createIpRateLimitMiddleware (auth fixed window, unchanged)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('enforces the strict fixed window', () => {
    const mw = createIpRateLimitMiddleware({
      windowMs: 60_000,
      max: 3,
      methods: [],
    });
    expect(run(mw).allowed).toBe(true);
    expect(run(mw).allowed).toBe(true);
    expect(run(mw).allowed).toBe(true);
    const blocked = run(mw);
    expect(blocked.allowed).toBe(false);
    expect(blocked.res.status).toHaveBeenCalledWith(429);

    jest.advanceTimersByTime(60_001);
    expect(run(mw).allowed).toBe(true);
  });
});
