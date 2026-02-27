import { ForbiddenException } from '@nestjs/common';
import { ImmaculateTasteController } from './immaculate-taste.controller';

describe('ImmaculateTasteController', () => {
  const asAuthenticatedRequest = (
    userId: string,
  ): Parameters<ImmaculateTasteController['listCollections']>[0] =>
    ({ user: { id: userId } }) as unknown as Parameters<
      ImmaculateTasteController['listCollections']
    >[0];

  const asResetUserBody = (
    mediaType: string,
    plexUserId: string,
  ): Parameters<ImmaculateTasteController['resetUserCollections']>[1] => ({
    mediaType,
    plexUserId,
  });

  function makeController() {
    const prisma = {
      user: {
        findFirst: jest.fn(),
      },
      immaculateTasteMovieLibrary: {
        count: jest.fn(),
      },
      immaculateTasteShowLibrary: {
        count: jest.fn(),
      },
      plexUser: {
        findMany: jest.fn(),
      },
    };

    const settingsService = {
      getInternalSettings: jest.fn(),
    };

    const plexServer = {
      getSections: jest.fn(),
      findCollectionRatingKey: jest.fn(),
      getCollectionItems: jest.fn(),
      deleteCollection: jest.fn(),
    };

    const plexUsers = {
      ensureAdminPlexUser: jest.fn(),
      getPlexUserById: jest.fn(),
    };

    const controller = new ImmaculateTasteController(
      prisma as unknown as ConstructorParameters<typeof ImmaculateTasteController>[0],
      settingsService as unknown as ConstructorParameters<
        typeof ImmaculateTasteController
      >[1],
      plexServer as unknown as ConstructorParameters<
        typeof ImmaculateTasteController
      >[2],
      plexUsers as unknown as ConstructorParameters<
        typeof ImmaculateTasteController
      >[3],
    );

    return { controller, prisma, settingsService, plexServer, plexUsers };
  }

  it('blocks reset-user requests from non-admin sessions', async () => {
    const { controller, prisma, plexUsers } = makeController();
    prisma.user.findFirst.mockResolvedValue({ id: 'admin-user' });

    await expect(
      controller.resetUserCollections(
        asAuthenticatedRequest('viewer-user'),
        asResetUserBody('movie', 'plex-user-1'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(plexUsers.ensureAdminPlexUser).not.toHaveBeenCalled();
    expect(plexUsers.getPlexUserById).not.toHaveBeenCalled();
  });

  it('blocks user-list requests from non-admin sessions', async () => {
    const { controller, prisma, plexUsers } = makeController();
    prisma.user.findFirst.mockResolvedValue({ id: 'admin-user' });

    await expect(
      controller.listCollectionUsers(asAuthenticatedRequest('viewer-user')),
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
        asAuthenticatedRequest('admin-user'),
        asResetUserBody('invalid', 'plex-user-1'),
      ),
    ).rejects.toThrow('mediaType must be "movie" or "tv"');

    expect(plexUsers.ensureAdminPlexUser).toHaveBeenCalledWith({
      userId: 'admin-user',
    });
  });

  it('listCollections excludes deselected Plex libraries', async () => {
    const { controller, prisma, settingsService, plexServer, plexUsers } =
      makeController();
    prisma.user.findFirst.mockResolvedValue({ id: 'admin-user' });
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'plex-admin',
      plexAccountTitle: 'Admin',
    });
    settingsService.getInternalSettings.mockResolvedValue({
      settings: {
        plex: {
          baseUrl: 'http://plex:32400',
          librarySelection: { excludedSectionKeys: ['2'] },
        },
      },
      secrets: {
        plex: { token: 'token' },
      },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies A', type: 'movie' },
      { key: '2', title: 'Movies B', type: 'movie' },
      { key: '3', title: 'Shows A', type: 'show' },
    ]);
    prisma.immaculateTasteMovieLibrary.count.mockResolvedValue(0);
    prisma.immaculateTasteShowLibrary.count.mockResolvedValue(0);
    plexServer.findCollectionRatingKey.mockResolvedValue(null);

    const res = await controller.listCollections(asAuthenticatedRequest('admin-user'));
    const keys = (res.collections as Array<{ librarySectionKey: string }>).map(
      (entry) => entry.librarySectionKey,
    );

    expect(keys).toEqual(['1', '3']);
    expect(keys.includes('2')).toBe(false);
  });
});
