import { AuthService } from '../../auth/auth.service';

describe('security/session control', () => {
  function makeService(sessionRecord: unknown) {
    const prisma = {
      session: {
        findUnique: jest.fn().mockResolvedValue(sessionRecord),
        delete: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as never;

    const service = new AuthService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return {
      service,
      prisma: prisma as unknown as { session: Record<string, jest.Mock> },
    };
  }

  it('invalidates expired sessions server-side', async () => {
    const { service, prisma } = makeService({
      id: 'hashed',
      tokenVersion: 0,
      expiresAt: new Date(Date.now() - 1000),
      user: { id: 'u1', username: 'admin', tokenVersion: 0 },
    });

    const user = await service.getUserForSession('sid');
    expect(user).toBeNull();
    expect(prisma.session.delete).toHaveBeenCalled();
  });

  it('invalidates sessions after token version bump', async () => {
    const { service, prisma } = makeService({
      id: 'hashed',
      tokenVersion: 1,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'u1', username: 'admin', tokenVersion: 2 },
    });

    const user = await service.getUserForSession('sid');
    expect(user).toBeNull();
    expect(prisma.session.delete).toHaveBeenCalled();
  });

  it('returns authenticated user for valid non-expired session', async () => {
    const { service, prisma } = makeService({
      id: 'hashed',
      tokenVersion: 2,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'u1', username: 'admin', tokenVersion: 2 },
    });

    const user = await service.getUserForSession('sid');
    expect(user).toEqual({ id: 'u1', username: 'admin' });
    expect(prisma.session.update).toHaveBeenCalled();
  });
});
