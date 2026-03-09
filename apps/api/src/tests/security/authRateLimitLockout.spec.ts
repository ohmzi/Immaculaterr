import { HttpException } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';

describe('security/auth rate limit lockout', () => {
  it('returns 429 semantics when lockout is active', async () => {
    const authThrottle = {
      assess: jest.fn().mockReturnValue({
        allowed: false,
        retryAfterSeconds: 60,
        retryAt: new Date(Date.now() + 60_000).toISOString(),
        captchaRequired: true,
      }),
    };

    const service = new AuthService(
      {} as never,
      {} as never,
      authThrottle as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect.assertions(3);
    try {
      await service.login({
        username: 'admin',
        password: 'wrong-password',
        ip: '127.0.0.1',
        userAgent: 'jest',
      });
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
    }
    expect(authThrottle.assess).toHaveBeenCalledWith({
      username: 'admin',
      ip: '127.0.0.1',
    });
  });
});
