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
        groupBy: jest.fn(),
        deleteMany: jest.fn(),
      },
      immaculateTasteShowLibrary: {
        count: jest.fn(),
        groupBy: jest.fn(),
        deleteMany: jest.fn(),
      },
      plexUser: {
        findMany: jest.fn(),
      },
      immaculateTasteProfile: {
        findMany: jest.fn(),
      },
      setting: {
        upsert: jest.fn(),
      },
    };

    const settingsService = {
      getInternalSettings: jest.fn(),
    };

    const plexServer = {
      getSections: jest.fn(),
      listCollectionsForSectionKey: jest.fn(),
      findCollectionRatingKey: jest.fn(),
      getCollectionItems: jest.fn(),
      deleteCollection: jest.fn(),
    };

    const plexUsers = {
      ensureAdminPlexUser: jest.fn(),
      getPlexUserById: jest.fn(),
    };

    const controller = new ImmaculateTasteController(
      prisma as unknown as ConstructorParameters<
        typeof ImmaculateTasteController
      >[0],
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

    const res = await controller.listCollections(
      asAuthenticatedRequest('admin-user'),
    );
    const keys = (res.collections as Array<{ librarySectionKey: string }>).map(
      (entry) => entry.librarySectionKey,
    );

    expect(keys).toEqual(['1', '3']);
    expect(keys.includes('2')).toBe(false);
  });

  it('reset-user removes all Immaculaterr collections for the selected media type', async () => {
    const { controller, prisma, settingsService, plexServer, plexUsers } =
      makeController();
    prisma.user.findFirst.mockResolvedValue({ id: 'admin-user' });
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'plex-admin',
      plexAccountTitle: 'Admin',
    });
    plexUsers.getPlexUserById.mockResolvedValue({
      id: 'plex-user-1',
      plexAccountTitle: 'plex laking',
    });
    settingsService.getInternalSettings.mockResolvedValue({
      settings: {
        plex: {
          baseUrl: 'http://plex:32400',
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
    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      {
        id: 'default-profile-row',
        isDefault: true,
        mediaType: 'both',
        movieCollectionBaseName: null,
        showCollectionBaseName: null,
        userOverrides: [],
      },
      {
        id: 'kids-profile',
        isDefault: false,
        mediaType: 'movie',
        movieCollectionBaseName: 'Kids Picks',
        showCollectionBaseName: null,
        userOverrides: [],
      },
    ]);
    prisma.immaculateTasteMovieLibrary.groupBy.mockResolvedValue([
      { profileId: 'default' },
      { profileId: 'kids-profile' },
    ]);
    plexServer.listCollectionsForSectionKey
      .mockResolvedValueOnce([
        {
          ratingKey: '100',
          title: 'Inspired by your Immaculate Taste in Movies (plex laking)',
        },
        { ratingKey: '101', title: 'Kids Picks' },
        { ratingKey: '102', title: 'Unrelated Collection' },
      ])
      .mockResolvedValueOnce([{ ratingKey: '200', title: 'Kids Picks' }]);
    plexServer.deleteCollection.mockResolvedValue(undefined);
    prisma.immaculateTasteMovieLibrary.deleteMany.mockResolvedValue({
      count: 12,
    });
    prisma.setting.upsert.mockResolvedValue({
      key: 'reset-marker',
      value: '2026-03-08T00:00:00.000Z',
      encrypted: false,
    });

    const res = await controller.resetUserCollections(
      asAuthenticatedRequest('admin-user'),
      asResetUserBody('movie', 'plex-user-1'),
    );

    expect(plexServer.listCollectionsForSectionKey).toHaveBeenCalledTimes(2);
    expect(plexServer.deleteCollection).toHaveBeenCalledTimes(3);
    expect(prisma.immaculateTasteMovieLibrary.deleteMany).toHaveBeenCalledWith({
      where: { plexUserId: 'plex-user-1' },
    });
    expect(prisma.immaculateTasteShowLibrary.deleteMany).not.toHaveBeenCalled();
    expect(res.plex.deleted).toBe(3);
    expect(res.dataset.deleted).toBe(12);
  });
});
