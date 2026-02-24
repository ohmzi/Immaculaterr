import { AuthService } from '../../auth/auth.service';

describe('security/session cookie protection', () => {
  function makeService() {
    const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
    const decode = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

    const crypto = {
      encryptString: jest.fn((value: string) => `enc:v1:${encode(value)}`),
      decryptString: jest.fn((value: string) => {
        if (!value.startsWith('enc:v1:')) {
          throw new Error('not encrypted');
        }
        return decode(value.slice('enc:v1:'.length));
      }),
      isEncrypted: jest.fn((value: string) => value.startsWith('enc:v1:')),
    };

    const service = new AuthService(
      {} as never,
      crypto as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, crypto };
  }

  it('encodes session cookies before storage', () => {
    const { service, crypto } = makeService();
    const cookieValue = service.encodeSessionIdForCookie('sid-123');
    expect(cookieValue).toMatch(/^enc:v1:/);
    expect(crypto.encryptString).toHaveBeenCalledWith('sid:v1:sid-123');
  });

  it('decodes encrypted session cookies from requests', () => {
    const { service } = makeService();
    const encoded = service.encodeSessionIdForCookie('sid-abc');

    const sessionId = service.readSessionIdFromRequest({
      cookies: { tcp_session: encoded },
    } as never);

    expect(sessionId).toBe('sid-abc');
  });

  it('keeps legacy plaintext cookie compatibility', () => {
    const { service } = makeService();

    const sessionId = service.readSessionIdFromRequest({
      cookies: { tcp_session: 'legacy-session-id' },
    } as never);

    expect(sessionId).toBe('legacy-session-id');
  });

  it('rejects invalid encrypted cookie payloads', () => {
    const { service } = makeService();

    const invalidEncoded = `enc:v1:${Buffer.from('bad-prefix', 'utf8').toString('base64url')}`;
    const sessionId = service.readSessionIdFromRequest({
      cookies: { tcp_session: invalidEncoded },
    } as never);

    expect(sessionId).toBeNull();
  });
});
