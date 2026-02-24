import { Injectable, Logger } from '@nestjs/common';

type AttemptKey = string;

type AttemptState = {
  failures: number;
  firstFailureAtMs: number;
  lastFailureAtMs: number;
  lockUntilMs: number;
};

type FailureComputation = {
  failures: number;
  firstFailureAtMs: number;
  lockUntilMs: number;
};

export type ThrottleAssessment = {
  allowed: boolean;
  retryAfterSeconds: number | null;
  retryAt: string | null;
  captchaRequired: boolean;
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isoFromMs(ms: number | null): string | null {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

@Injectable()
export class AuthThrottleService {
  private readonly logger = new Logger(AuthThrottleService.name);

  private readonly store = new Map<AttemptKey, AttemptState>();
  private readonly windowMs = parsePositiveInt(
    process.env.AUTH_LOCKOUT_WINDOW_MS,
    15 * 60_000,
  );
  private readonly threshold = parsePositiveInt(
    process.env.AUTH_LOCKOUT_THRESHOLD,
    5,
  );
  private readonly lockMs = parsePositiveInt(
    process.env.AUTH_LOCKOUT_MS,
    15 * 60_000,
  );
  private readonly lockMaxMs = parsePositiveInt(
    process.env.AUTH_LOCKOUT_MAX_MS,
    12 * 60 * 60_000,
  );
  private readonly captchaEnabled =
    process.env.AUTH_CAPTCHA_ENABLED === 'true' ||
    Boolean(process.env.AUTH_CAPTCHA_VERIFY_URL?.trim());
  private readonly captchaThreshold = parsePositiveInt(
    process.env.AUTH_CAPTCHA_AFTER_FAILURES,
    3,
  );

  assess(params: { username: string; ip: string | null }): ThrottleAssessment {
    const now = Date.now();
    this.cleanup(now);
    const key = this.buildKey(params.username, params.ip);
    const state = this.store.get(key);
    if (!state) {
      return {
        allowed: true,
        retryAfterSeconds: null,
        retryAt: null,
        captchaRequired: false,
      };
    }

    const retryAfterMs = Math.max(0, state.lockUntilMs - now);
    const locked = retryAfterMs > 0;
    const retryAfterSeconds = locked
      ? Math.max(1, Math.ceil(retryAfterMs / 1000))
      : null;
    const retryAt = locked ? isoFromMs(state.lockUntilMs) : null;
    const captchaRequired =
      this.captchaEnabled && state.failures >= this.captchaThreshold;

    return {
      allowed: !locked,
      retryAfterSeconds,
      retryAt,
      captchaRequired,
    };
  }

  recordFailure(params: {
    username: string;
    ip: string | null;
    reason: string;
    userAgent: string | null;
  }): ThrottleAssessment {
    const now = Date.now();
    this.cleanup(now);
    const key = this.buildKey(params.username, params.ip);
    const prev = this.store.get(key);
    const { failures, firstFailureAtMs, lockUntilMs } =
      this.computeFailureState(prev, now);
    const lastFailureAtMs = now;

    this.store.set(key, {
      failures,
      firstFailureAtMs,
      lastFailureAtMs,
      lockUntilMs,
    });
    const assessment = this.toAssessment({ lockUntilMs, now, failures });

    this.logger.warn(
      `auth throttle failure username=${JSON.stringify(params.username)} ip=${JSON.stringify(params.ip)} ua=${JSON.stringify(params.userAgent)} reason=${JSON.stringify(params.reason)} failures=${failures} lockUntil=${JSON.stringify(assessment.retryAt)}`,
    );

    return assessment;
  }

  recordSuccess(params: { username: string; ip: string | null }): void {
    const key = this.buildKey(params.username, params.ip);
    this.store.delete(key);
  }

  private buildKey(username: string, ip: string | null): AttemptKey {
    return `${username.trim().toLowerCase()}|${(ip ?? '').trim().toLowerCase() || 'unknown'}`;
  }

  private cleanup(now: number): void {
    for (const [key, state] of this.store.entries()) {
      const lockExpired = state.lockUntilMs <= now;
      const windowExpired = now - state.lastFailureAtMs > this.windowMs;
      if (lockExpired && windowExpired) this.store.delete(key);
    }
  }

  private computeFailureState(
    prev: AttemptState | undefined,
    now: number,
  ): FailureComputation {
    const withinWindow = this.isWithinWindow(prev, now);
    const failures = withinWindow && prev ? prev.failures + 1 : 1;
    const firstFailureAtMs = withinWindow && prev ? prev.firstFailureAtMs : now;
    const lockUntilMs = this.computeNextLockUntilMs({ prev, now, failures });
    return { failures, firstFailureAtMs, lockUntilMs };
  }

  private isWithinWindow(prev: AttemptState | undefined, now: number): boolean {
    if (!prev) return false;
    return now - prev.firstFailureAtMs <= this.windowMs;
  }

  private computeNextLockUntilMs(params: {
    prev: AttemptState | undefined;
    now: number;
    failures: number;
  }): number {
    if (params.failures < this.threshold) return 0;
    const prevLockDuration = Math.max(
      0,
      (params.prev?.lockUntilMs ?? 0) - params.now,
    );
    const nextLock =
      prevLockDuration > 0
        ? Math.min(prevLockDuration * 2, this.lockMaxMs)
        : this.lockMs;
    return params.now + nextLock;
  }

  private toAssessment(params: {
    lockUntilMs: number;
    now: number;
    failures: number;
  }): ThrottleAssessment {
    const locked = params.lockUntilMs > params.now;
    return {
      allowed: !locked,
      retryAfterSeconds: locked
        ? Math.max(1, Math.ceil((params.lockUntilMs - params.now) / 1000))
        : null,
      retryAt: locked ? isoFromMs(params.lockUntilMs) : null,
      captchaRequired:
        this.captchaEnabled && params.failures >= this.captchaThreshold,
    };
  }
}
