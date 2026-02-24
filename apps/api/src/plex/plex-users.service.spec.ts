import { PlexUsersService } from './plex-users.service';

describe('PlexUsersService title precedence', () => {
  function createService() {
    const prisma = {
      plexUser: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
      $executeRaw: jest.fn(),
      user: {
        findFirst: jest.fn(),
      },
    };

    const settingsService = {
      getInternalSettings: jest.fn(),
    };
    const plexService = {
      whoami: jest.fn(),
    };

    const service = new PlexUsersService(
      prisma as never,
      settingsService as never,
      plexService as never,
    );

    return {
      service,
      prisma,
    };
  }

  it('keeps existing display title when incoming shared title is username style', async () => {
    const { service, prisma } = createService();
    prisma.plexUser.findUnique.mockResolvedValue({
      id: 'plex-user-1',
      plexAccountId: 691675664,
      plexAccountTitle: 'plex laking',
      isAdmin: false,
    });
    prisma.plexUser.findFirst.mockResolvedValue(null);
    prisma.plexUser.update.mockImplementation(async (input: unknown) => {
      const obj = input as { data: { plexAccountTitle: string } };
      return {
        id: 'plex-user-1',
        plexAccountId: 691675664,
        plexAccountTitle: obj.data.plexAccountTitle,
        isAdmin: false,
      };
    });

    const user = await service.getOrCreateByPlexAccount({
      plexAccountId: 691675664,
      plexAccountTitle: 'plexlaking',
    });

    expect(user?.plexAccountTitle).toBe('plex laking');
  });

  it('upgrades Unknown title when a concrete title arrives', async () => {
    const { service, prisma } = createService();
    prisma.plexUser.findUnique.mockResolvedValue({
      id: 'plex-user-1',
      plexAccountId: 691675664,
      plexAccountTitle: 'Unknown',
      isAdmin: false,
    });
    prisma.plexUser.findFirst.mockResolvedValue(null);
    prisma.plexUser.update.mockImplementation(async (input: unknown) => {
      const obj = input as { data: { plexAccountTitle: string } };
      return {
        id: 'plex-user-1',
        plexAccountId: 691675664,
        plexAccountTitle: obj.data.plexAccountTitle,
        isAdmin: false,
      };
    });

    const user = await service.getOrCreateByPlexAccount({
      plexAccountId: 691675664,
      plexAccountTitle: 'plexlaking',
    });

    expect(user?.plexAccountTitle).toBe('plexlaking');
  });
});
