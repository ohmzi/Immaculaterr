import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../db/prisma.service';
import { maskUsername, maskIp, truncateForLog } from '../log.utils';

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
export class AuthThrottleService implements OnModuleInit {
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

  private static readonly DB_CLEANUP_INTERVAL_MS = 3_600_000; // hourly

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadFromDb();
  }

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

    const state: AttemptState = {
      failures,
      firstFailureAtMs,
      lastFailureAtMs,
      lockUntilMs,
    };
    this.store.set(key, state);
    void this.persistToDb(key, state);

    const assessment = this.toAssessment({ lockUntilMs, now, failures });

    this.logger.warn(
      `auth throttle failure username=${JSON.stringify(maskUsername(params.username))} ip=${JSON.stringify(maskIp(params.ip))} ua=${JSON.stringify(truncateForLog(params.userAgent ?? '', 80))} reason=${JSON.stringify(params.reason)} failures=${failures} lockUntil=${JSON.stringify(assessment.retryAt)}`,
    );

    return assessment;
  }

  recordSuccess(params: { username: string; ip: string | null }): void {
    const key = this.buildKey(params.username, params.ip);
    this.store.delete(key);
    void this.deleteFromDb(key);
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

  private async loadFromDb(): Promise<void> {
    try {
      const now = Date.now();
      const rows = await this.prisma.loginThrottle.findMany();
      let loaded = 0;
      for (const row of rows) {
        const lockUntilMs = row.lockUntil.getTime();
        const lastFailureAtMs = row.lastFailureAt.getTime();
        const lockExpired = lockUntilMs <= now;
        const windowExpired = now - lastFailureAtMs > this.windowMs;
        if (lockExpired && windowExpired) continue;
        this.store.set(row.key, {
          failures: row.failures,
          firstFailureAtMs: row.firstFailureAt.getTime(),
          lastFailureAtMs,
          lockUntilMs,
        });
        loaded += 1;
      }
      if (loaded > 0) {
        this.logger.log(`Loaded ${loaded} active lockout(s) from database`);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to load throttle state from DB: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }

  private async persistToDb(key: string, state: AttemptState): Promise<void> {
    try {
      await this.prisma.loginThrottle.upsert({
        where: { key },
        create: {
          key,
          failures: state.failures,
          firstFailureAt: new Date(state.firstFailureAtMs),
          lastFailureAt: new Date(state.lastFailureAtMs),
          lockUntil: new Date(state.lockUntilMs || 0),
        },
        update: {
          failures: state.failures,
          firstFailureAt: new Date(state.firstFailureAtMs),
          lastFailureAt: new Date(state.lastFailureAtMs),
          lockUntil: new Date(state.lockUntilMs || 0),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist throttle state: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }

  private async deleteFromDb(key: string): Promise<void> {
    try {
      await this.prisma.loginThrottle.deleteMany({ where: { key } });
    } catch (err) {
      this.logger.warn(
        `Failed to delete throttle state: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }

  @Interval(AuthThrottleService.DB_CLEANUP_INTERVAL_MS)
  async purgeStaleThrottleRows() {
    try {
      const now = new Date();
      const windowCutoff = new Date(Date.now() - this.windowMs);
      const { count } = await this.prisma.loginThrottle.deleteMany({
        where: {
          lockUntil: { lt: now },
          lastFailureAt: { lt: windowCutoff },
        },
      });
      if (count > 0) {
        this.logger.log(`Purged ${count} stale throttle row(s)`);
      }
    } catch (err) {
      this.logger.warn(
        `Throttle DB cleanup failed: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }
}
