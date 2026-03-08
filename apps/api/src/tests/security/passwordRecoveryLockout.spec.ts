import { AuthService } from '../../auth/auth.service';

describe('security/password recovery lockout', () => {
  it('tracks remaining attempts and locks after 5 failures', () => {
    const service = new AuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const first = (
      service as never as {
        recordPasswordResetFailure: (params: {
          username: string;
          ip: string | null;
        }) => {
          allowed: boolean;
          attemptsRemaining: number;
        };
      }
    ).recordPasswordResetFailure({
      username: 'admin',
      ip: '127.0.0.1',
    });
    expect(first.allowed).toBe(true);
    expect(first.attemptsRemaining).toBe(4);

    let last = first;
    for (let i = 0; i < 4; i += 1) {
      last = (
        service as never as {
          recordPasswordResetFailure: (params: {
            username: string;
            ip: string | null;
          }) => {
            allowed: boolean;
            attemptsRemaining: number;
            retryAfterSeconds: number | null;
          };
        }
      ).recordPasswordResetFailure({
        username: 'admin',
        ip: '127.0.0.1',
      });
    }

    expect(last.allowed).toBe(false);
    expect(last.attemptsRemaining).toBe(0);
    expect(last.retryAfterSeconds).not.toBeNull();
  });
});
