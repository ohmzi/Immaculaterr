import { AuthThrottleService } from '../../auth/auth-throttle.service';

describe('security/auth throttle response metadata', () => {
  const originalEnv = {
    AUTH_LOCKOUT_THRESHOLD: process.env.AUTH_LOCKOUT_THRESHOLD,
    AUTH_LOCKOUT_WINDOW_MS: process.env.AUTH_LOCKOUT_WINDOW_MS,
    AUTH_LOCKOUT_MS: process.env.AUTH_LOCKOUT_MS,
    AUTH_CAPTCHA_ENABLED: process.env.AUTH_CAPTCHA_ENABLED,
    AUTH_CAPTCHA_AFTER_FAILURES: process.env.AUTH_CAPTCHA_AFTER_FAILURES,
  };

  afterEach(() => {
    process.env.AUTH_LOCKOUT_THRESHOLD = originalEnv.AUTH_LOCKOUT_THRESHOLD;
    process.env.AUTH_LOCKOUT_WINDOW_MS = originalEnv.AUTH_LOCKOUT_WINDOW_MS;
    process.env.AUTH_LOCKOUT_MS = originalEnv.AUTH_LOCKOUT_MS;
    process.env.AUTH_CAPTCHA_ENABLED = originalEnv.AUTH_CAPTCHA_ENABLED;
    process.env.AUTH_CAPTCHA_AFTER_FAILURES =
      originalEnv.AUTH_CAPTCHA_AFTER_FAILURES;
  });

  it('emits retry metadata and captcha requirements after repeated failures', () => {
    process.env.AUTH_LOCKOUT_THRESHOLD = '3';
    process.env.AUTH_LOCKOUT_WINDOW_MS = '60000';
    process.env.AUTH_LOCKOUT_MS = '120000';
    process.env.AUTH_CAPTCHA_ENABLED = 'true';
    process.env.AUTH_CAPTCHA_AFTER_FAILURES = '2';

    const throttle = new AuthThrottleService();
    const identity = { username: 'admin', ip: '127.0.0.1' };

    const f1 = throttle.recordFailure({
      ...identity,
      reason: 'invalid_credentials',
      userAgent: 'jest',
    });
    expect(f1.retryAfterSeconds).toBeNull();
    expect(f1.captchaRequired).toBe(false);

    const f2 = throttle.recordFailure({
      ...identity,
      reason: 'invalid_credentials',
      userAgent: 'jest',
    });
    expect(f2.captchaRequired).toBe(true);

    const f3 = throttle.recordFailure({
      ...identity,
      reason: 'invalid_credentials',
      userAgent: 'jest',
    });
    expect(f3.retryAfterSeconds).not.toBeNull();
    expect(f3.retryAt).toMatch(/T/);

    const blocked = throttle.assess(identity);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).not.toBeNull();
  });
});
