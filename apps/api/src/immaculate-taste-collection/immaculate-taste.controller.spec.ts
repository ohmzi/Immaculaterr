import { ForbiddenException } from '@nestjs/common';
import { ImmaculateTasteController } from './immaculate-taste.controller';

describe('ImmaculateTasteController', () => {
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
    } as any;

    const settingsService = {
      getInternalSettings: jest.fn(),
    } as any;

    const plexServer = {
      getSections: jest.fn(),
      findCollectionRatingKey: jest.fn(),
      getCollectionItems: jest.fn(),
      deleteCollection: jest.fn(),
    } as any;

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

    return { controller, prisma, settingsService, plexServer, plexUsers };
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

    const res = await controller.listCollections({ user: { id: 'admin-user' } } as any);
    const keys = (res.collections as Array<{ librarySectionKey: string }>).map(
      (entry) => entry.librarySectionKey,
    );

    expect(keys).toEqual(['1', '3']);
    expect(keys.includes('2')).toBe(false);
  });
});
