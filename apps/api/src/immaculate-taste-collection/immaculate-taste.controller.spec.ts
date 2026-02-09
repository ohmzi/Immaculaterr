import { ForbiddenException } from '@nestjs/common';
import { ImmaculateTasteController } from './immaculate-taste.controller';

describe('ImmaculateTasteController', () => {
  function makeController() {
    const prisma = {
      user: {
        findFirst: jest.fn(),
      },
    } as any;

    const settingsService = {
      getInternalSettings: jest.fn(),
    } as any;

    const plexServer = {} as any;

    const plexUsers = {
      ensureAdminPlexUser: jest.fn(),
      getPlexUserById: jest.fn(),
    } as any;

    const controller = new ImmaculateTasteController(
      prisma,
      settingsService,
      plexServer,
      plexUsers,
    );

    return { controller, prisma, plexUsers };
  }

  it('blocks reset-user requests from non-admin sessions', async () => {
    const { controller, prisma, plexUsers } = makeController();
    prisma.user.findFirst.mockResolvedValue({ id: 'admin-user' });

    await expect(
      controller.resetUserCollections(
        { user: { id: 'viewer-user' } } as any,
        { mediaType: 'movie', plexUserId: 'plex-user-1' } as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(plexUsers.ensureAdminPlexUser).not.toHaveBeenCalled();
    expect(plexUsers.getPlexUserById).not.toHaveBeenCalled();
  });

  it('blocks user-list requests from non-admin sessions', async () => {
    const { controller, prisma, plexUsers } = makeController();
    prisma.user.findFirst.mockResolvedValue({ id: 'admin-user' });

    await expect(
      controller.listCollectionUsers({ user: { id: 'viewer-user' } } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(plexUsers.ensureAdminPlexUser).not.toHaveBeenCalled();
  });

  it('allows admin session to proceed into reset-user validation flow', async () => {
    const { controller, prisma, plexUsers } = makeController();
    prisma.user.findFirst.mockResolvedValue({ id: 'admin-user' });
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'plex-admin',
      plexAccountTitle: 'Admin',
    });

    await expect(
      controller.resetUserCollections(
        { user: { id: 'admin-user' } } as any,
        { mediaType: 'invalid', plexUserId: 'plex-user-1' } as any,
      ),
    ).rejects.toThrow('mediaType must be "movie" or "tv"');

    expect(plexUsers.ensureAdminPlexUser).toHaveBeenCalledWith({
      userId: 'admin-user',
    });
  });
});
