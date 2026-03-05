import type {
  ImmaculateTasteProfile,
  ImmaculateTasteProfileUserOverride,
} from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexUsersService } from '../plex/plex-users.service';
import { SettingsService } from '../settings/settings.service';
import { ImmaculateTasteProfileService } from './immaculate-taste-profile.service';

type PrismaMock = {
  immaculateTasteProfile: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    aggregate: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    delete: jest.Mock;
  };
  immaculateTasteProfileUserOverride: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    delete: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    create: jest.Mock;
  };
  plexUser: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
  immaculateTasteMovieLibrary: {
    updateMany: jest.Mock;
    findMany: jest.Mock;
  };
  immaculateTasteShowLibrary: {
    updateMany: jest.Mock;
    findMany: jest.Mock;
  };
  jobRun: {
    create: jest.Mock;
  };
  jobLogLine: {
    createMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

type SettingsMock = {
  getInternalSettings: jest.Mock;
};

type PlexServerMock = {
  getSections: jest.Mock;
  getMachineIdentifier: jest.Mock;
  findCollectionRatingKey: jest.Mock;
  createCollection: jest.Mock;
  addItemToCollection: jest.Mock;
  uploadCollectionPoster: jest.Mock;
  uploadCollectionArt: jest.Mock;
  renameCollection: jest.Mock;
  deleteCollection: jest.Mock;
  listCollectionsForSectionKey: jest.Mock;
  getCollectionItems: jest.Mock;
  listMoviesWithTmdbIdsForSectionKey: jest.Mock;
  listShowsWithTvdbIdsForSectionKey: jest.Mock;
};

type PlexUsersMock = {
  ensureAdminPlexUser: jest.Mock;
};

function makeProfile(
  overrides: Partial<ImmaculateTasteProfile>,
): ImmaculateTasteProfile {
  return {
    id: 'profile-1',
    userId: 'user-1',
    name: 'Default',
    isDefault: true,
    enabled: true,
    sortOrder: 0,
    mediaType: 'both',
    matchMode: 'all',
    genres: '[]',
    audioLanguages: '[]',
    excludedGenres: '[]',
    excludedAudioLanguages: '[]',
    radarrInstanceId: null,
    sonarrInstanceId: null,
    movieCollectionBaseName: null,
    showCollectionBaseName: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createService() {
  const prisma: PrismaMock = {
    immaculateTasteProfile: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    immaculateTasteProfileUserOverride: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    plexUser: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    immaculateTasteMovieLibrary: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    immaculateTasteShowLibrary: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    jobRun: {
      create: jest.fn(),
    },
    jobLogLine: {
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: PrismaMock) => Promise<unknown>)(prisma);
    }
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return arg;
  });
  const settings: SettingsMock = {
    getInternalSettings: jest.fn(),
  };
  const plexServer: PlexServerMock = {
    getSections: jest.fn(),
    getMachineIdentifier: jest.fn(),
    findCollectionRatingKey: jest.fn(),
    createCollection: jest.fn(),
    addItemToCollection: jest.fn(),
    uploadCollectionPoster: jest.fn(),
    uploadCollectionArt: jest.fn(),
    renameCollection: jest.fn(),
    deleteCollection: jest.fn(),
    listCollectionsForSectionKey: jest.fn(),
    getCollectionItems: jest.fn(),
    listMoviesWithTmdbIdsForSectionKey: jest.fn(),
    listShowsWithTvdbIdsForSectionKey: jest.fn(),
  };
  const plexUsers: PlexUsersMock = {
    ensureAdminPlexUser: jest.fn(),
  };
  const service = new ImmaculateTasteProfileService(
    prisma as unknown as PrismaService,
    settings as unknown as SettingsService,
    plexServer as unknown as PlexServerService,
    plexUsers as unknown as PlexUsersService,
  );

  prisma.jobRun.create.mockResolvedValue({ id: 'run-1' });
  prisma.jobLogLine.createMany.mockResolvedValue({ count: 0 });
  prisma.immaculateTasteProfileUserOverride.updateMany.mockResolvedValue({
    count: 0,
  });
  prisma.immaculateTasteMovieLibrary.findMany.mockResolvedValue([]);
  prisma.immaculateTasteShowLibrary.findMany.mockResolvedValue([]);
  plexServer.listCollectionsForSectionKey.mockResolvedValue([]);
  plexServer.getCollectionItems.mockResolvedValue([]);
  plexServer.listMoviesWithTmdbIdsForSectionKey.mockResolvedValue([]);
  plexServer.listShowsWithTvdbIdsForSectionKey.mockResolvedValue([]);
  plexServer.addItemToCollection.mockResolvedValue(undefined);
  plexServer.uploadCollectionPoster.mockResolvedValue(undefined);
  plexServer.uploadCollectionArt.mockResolvedValue(undefined);

  return { service, prisma, settings, plexServer, plexUsers };
}

function getLastMockCallArg(mockFn: jest.Mock): unknown {
  const calls = mockFn.mock.calls as Array<unknown[]>;
  return calls.at(-1)?.[0];
}

describe('ImmaculateTasteProfileService update rename task', () => {
  it('renames existing movie collection when movie base name changes', async () => {
    const { service, prisma, settings, plexServer, plexUsers } =
      createService();
    const current = makeProfile({
      id: 'profile-1',
      movieCollectionBaseName: null,
    });
    const updated = makeProfile({
      id: 'profile-1',
      movieCollectionBaseName: 'My Renamed Movies',
      updatedAt: new Date('2026-01-01T00:01:00.000Z'),
    });

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([current]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...updated, userOverrides: [] });
    prisma.immaculateTasteProfile.update.mockResolvedValue(updated);
    prisma.immaculateTasteProfileUserOverride.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex:32400' } },
      secrets: { plex: { token: 'plex-token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
      { key: '2', title: 'TV Shows', type: 'show' },
    ]);
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'user-1',
      plexAccountTitle: 'ohmz_i',
    });
    prisma.plexUser.findMany.mockResolvedValue([
      { id: 'user-1', plexAccountTitle: 'ohmz_i', isAdmin: true },
    ]);
    plexServer.findCollectionRatingKey.mockImplementation(
      (params: { librarySectionKey: string; collectionName: string }) => {
        if (
          params.librarySectionKey === '1' &&
          params.collectionName ===
            'Inspired by your Immaculate Taste in Movies (ohmz_i)'
        ) {
          return Promise.resolve('rk-movie');
        }
        return Promise.resolve(null);
      },
    );
    plexServer.renameCollection.mockResolvedValue(undefined);

    const result = await service.update('user-1', 'profile-1', {
      movieCollectionBaseName: 'My Renamed Movies',
    });

    expect(result.movieCollectionBaseName).toBe('My Renamed Movies');
    expect(plexServer.renameCollection).toHaveBeenCalledWith({
      baseUrl: 'http://plex:32400',
      token: 'plex-token',
      librarySectionKey: '1',
      collectionRatingKey: 'rk-movie',
      collectionName: 'My Renamed Movies',
    });
    const renameRunCreateArg = getLastMockCallArg(prisma.jobRun.create) as {
      data: {
        jobId: string;
        summary: {
          template: string;
          tasks: Array<{ id: string; status: string }>;
        };
      };
    };
    expect(renameRunCreateArg.data.jobId).toBe('immaculateTasteProfileAction');
    expect(renameRunCreateArg.data.summary.template).toBe('jobReportV1');
    expect(renameRunCreateArg.data.summary.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'rename_collections',
          status: 'success',
        }),
      ]),
    );
  });

  it('deletes matching Plex collections and logs the disable task in Rewind', async () => {
    const { service, prisma, settings, plexServer, plexUsers } =
      createService();
    const current = makeProfile({
      id: 'profile-2',
      name: 'Kids',
      isDefault: false,
      enabled: true,
      mediaType: 'movie',
      movieCollectionBaseName: 'Kids Picks',
    });
    const updated = makeProfile({
      ...current,
      enabled: false,
      updatedAt: new Date('2026-01-01T00:03:00.000Z'),
    });

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      makeProfile({
        id: 'default-profile',
        name: 'Default',
        isDefault: true,
        enabled: true,
      }),
      current,
    ]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ id: 'default-profile' })
      .mockResolvedValueOnce({ ...updated, userOverrides: [] });
    prisma.immaculateTasteProfile.update.mockResolvedValue(updated);
    prisma.immaculateTasteProfileUserOverride.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex:32400' } },
      secrets: { plex: { token: 'plex-token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'user-1',
      plexAccountTitle: 'ohmz_i',
    });
    prisma.plexUser.findMany.mockResolvedValue([
      { id: 'user-1', plexAccountTitle: 'ohmz_i', isAdmin: true },
    ]);
    plexServer.findCollectionRatingKey
      .mockResolvedValueOnce('rk-movie')
      .mockResolvedValue(null);
    plexServer.deleteCollection.mockResolvedValue(undefined);

    const result = await service.update('user-1', 'profile-2', {
      enabled: false,
    });

    expect(result.enabled).toBe(false);
    expect(plexServer.deleteCollection).toHaveBeenCalledWith({
      baseUrl: 'http://plex:32400',
      token: 'plex-token',
      collectionRatingKey: 'rk-movie',
    });
    const disableRunCreateArg = getLastMockCallArg(prisma.jobRun.create) as {
      data: {
        jobId: string;
        summary: {
          template: string;
          tasks: Array<{ id: string; status: string }>;
        };
      };
    };
    expect(disableRunCreateArg.data.jobId).toBe('immaculateTasteProfileAction');
    expect(disableRunCreateArg.data.summary.template).toBe('jobReportV1');
    expect(disableRunCreateArg.data.summary.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cleanup_collections_on_disable',
          status: 'success',
        }),
      ]),
    );
    expect(prisma.jobLogLine.createMany).toHaveBeenCalled();
  });

  it('does not run rename task when collection base names are unchanged', async () => {
    const { service, prisma, settings, plexServer } = createService();
    const current = makeProfile({
      id: 'profile-1',
      matchMode: 'all',
      movieCollectionBaseName: null,
      showCollectionBaseName: null,
    });
    const updated = makeProfile({
      id: 'profile-1',
      matchMode: 'any',
      movieCollectionBaseName: null,
      showCollectionBaseName: null,
      updatedAt: new Date('2026-01-01T00:01:00.000Z'),
    });

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([current]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...updated, userOverrides: [] });
    prisma.immaculateTasteProfile.update.mockResolvedValue(updated);
    prisma.immaculateTasteProfileUserOverride.findMany.mockResolvedValue([]);

    const result = await service.update('user-1', 'profile-1', {
      matchMode: 'any',
    });

    expect(result.matchMode).toBe('any');
    expect(settings.getInternalSettings).not.toHaveBeenCalled();
    expect(plexServer.renameCollection).not.toHaveBeenCalled();
  });

  it('recreates missing Plex collections and logs recreate task when profile is toggled on', async () => {
    const { service, prisma, settings, plexServer, plexUsers } =
      createService();
    const current = makeProfile({
      id: 'profile-2',
      name: 'Kids',
      isDefault: false,
      enabled: false,
      mediaType: 'movie',
      movieCollectionBaseName: null,
    });
    const updated = makeProfile({
      ...current,
      enabled: true,
      updatedAt: new Date('2026-01-01T00:07:00.000Z'),
    });

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      makeProfile({
        id: 'default-profile',
        name: 'Default',
        isDefault: true,
        enabled: true,
      }),
      current,
    ]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...updated, userOverrides: [] });
    prisma.immaculateTasteProfile.update.mockResolvedValue(updated);
    prisma.immaculateTasteProfileUserOverride.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex:32400' } },
      secrets: { plex: { token: 'plex-token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plexServer.getMachineIdentifier.mockResolvedValue('machine-1');
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'user-1',
      plexAccountTitle: 'ohmz_i',
    });
    prisma.plexUser.findMany.mockResolvedValue([
      { id: 'user-1', plexAccountTitle: 'ohmz_i', isAdmin: true },
    ]);
    plexServer.findCollectionRatingKey.mockResolvedValue(null);
    prisma.immaculateTasteMovieLibrary.findMany.mockResolvedValue([
      { tmdbId: 12345 },
    ]);
    plexServer.listMoviesWithTmdbIdsForSectionKey.mockResolvedValue([
      {
        ratingKey: 'rk-seed',
        title: 'Seed Movie',
        tmdbId: 12345,
        addedAt: 1700000000,
        year: 2024,
      },
    ]);
    plexServer.createCollection.mockResolvedValue('rk-created');

    const result = await service.update('user-1', 'profile-2', {
      enabled: true,
    });

    expect(result.enabled).toBe(true);
    expect(plexServer.createCollection).toHaveBeenCalledWith({
      baseUrl: 'http://plex:32400',
      token: 'plex-token',
      machineIdentifier: 'machine-1',
      librarySectionKey: '1',
      collectionName: 'Inspired by your Immaculate Taste in Movies (ohmz_i)',
      type: 1,
      initialItemRatingKey: 'rk-seed',
    });
    const enableRunCreateArg = getLastMockCallArg(prisma.jobRun.create) as {
      data: {
        jobId: string;
        summary: {
          template: string;
          tasks: Array<{ id: string; status: string }>;
        };
      };
    };
    expect(enableRunCreateArg.data.jobId).toBe('immaculateTasteProfileAction');
    expect(enableRunCreateArg.data.summary.template).toBe('jobReportV1');
    expect(enableRunCreateArg.data.summary.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'recreate_collections_on_enable',
          status: 'success',
        }),
      ]),
    );
  });

  it('does not create empty placeholder collections when no seed item is available', async () => {
    const { service, prisma, settings, plexServer, plexUsers } =
      createService();
    const current = makeProfile({
      id: 'profile-2',
      name: 'Kids',
      isDefault: false,
      enabled: false,
      mediaType: 'movie',
      movieCollectionBaseName: null,
    });
    const updated = makeProfile({
      ...current,
      enabled: true,
      updatedAt: new Date('2026-01-01T00:08:00.000Z'),
    });

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      makeProfile({
        id: 'default-profile',
        name: 'Default',
        isDefault: true,
        enabled: true,
      }),
      current,
    ]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...updated, userOverrides: [] });
    prisma.immaculateTasteProfile.update.mockResolvedValue(updated);
    prisma.immaculateTasteProfileUserOverride.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex:32400' } },
      secrets: { plex: { token: 'plex-token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plexServer.getMachineIdentifier.mockResolvedValue('machine-1');
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'user-1',
      plexAccountTitle: 'ohmz_i',
    });
    prisma.plexUser.findMany.mockResolvedValue([
      { id: 'user-1', plexAccountTitle: 'ohmz_i', isAdmin: true },
    ]);
    plexServer.findCollectionRatingKey.mockResolvedValue(null);
    prisma.immaculateTasteMovieLibrary.findMany.mockResolvedValue([]);
    plexServer.listMoviesWithTmdbIdsForSectionKey.mockResolvedValue([]);

    await service.update('user-1', 'profile-2', {
      enabled: true,
    });

    expect(plexServer.createCollection).not.toHaveBeenCalled();
    const enableRunCreateArg = getLastMockCallArg(prisma.jobRun.create) as {
      data: {
        summary: {
          tasks: Array<{ id: string; status: string }>;
        };
      };
    };
    expect(enableRunCreateArg.data.summary.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'recreate_collections_on_enable',
          status: 'success',
        }),
      ]),
    );
  });

  it('prunes empty duplicate collections before recreate', async () => {
    const { service, prisma, settings, plexServer, plexUsers } =
      createService();
    const current = makeProfile({
      id: 'profile-2',
      name: 'Kids',
      isDefault: false,
      enabled: false,
      mediaType: 'movie',
      movieCollectionBaseName: null,
    });
    const updated = makeProfile({
      ...current,
      enabled: true,
      updatedAt: new Date('2026-01-01T00:09:00.000Z'),
    });

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      makeProfile({
        id: 'default-profile',
        name: 'Default',
        isDefault: true,
        enabled: true,
      }),
      current,
    ]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...updated, userOverrides: [] });
    prisma.immaculateTasteProfile.update.mockResolvedValue(updated);
    prisma.immaculateTasteProfileUserOverride.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex:32400' } },
      secrets: { plex: { token: 'plex-token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plexServer.getMachineIdentifier.mockResolvedValue('machine-1');
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'user-1',
      plexAccountTitle: 'ohmz_i',
    });
    prisma.plexUser.findMany.mockResolvedValue([
      { id: 'user-1', plexAccountTitle: 'ohmz_i', isAdmin: true },
    ]);
    plexServer.listCollectionsForSectionKey.mockResolvedValue([
      {
        ratingKey: 'rk-empty',
        title: 'Inspired by your Immaculate Taste in Movies (ohmz_i)',
      },
      {
        ratingKey: 'rk-main',
        title: 'Inspired by your Immaculate Taste in Movies (ohmz_i)',
      },
    ]);
    plexServer.getCollectionItems.mockImplementation(
      (params: { collectionRatingKey: string }) =>
        params.collectionRatingKey === 'rk-empty'
          ? Promise.resolve([])
          : Promise.resolve([{ ratingKey: 'item-1', title: 'Movie A' }]),
    );
    plexServer.findCollectionRatingKey.mockResolvedValue('rk-main');
    plexServer.deleteCollection.mockResolvedValue(undefined);

    await service.update('user-1', 'profile-2', {
      enabled: true,
    });

    expect(plexServer.deleteCollection).toHaveBeenCalledWith({
      baseUrl: 'http://plex:32400',
      token: 'plex-token',
      collectionRatingKey: 'rk-empty',
    });
    expect(plexServer.createCollection).not.toHaveBeenCalled();
  });

  it('recreates when looked-up collection exists but is empty', async () => {
    const { service, prisma, settings, plexServer, plexUsers } =
      createService();
    const current = makeProfile({
      id: 'profile-2',
      name: 'Kids',
      isDefault: false,
      enabled: false,
      mediaType: 'movie',
      movieCollectionBaseName: null,
    });
    const updated = makeProfile({
      ...current,
      enabled: true,
      updatedAt: new Date('2026-01-01T00:10:00.000Z'),
    });

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      makeProfile({
        id: 'default-profile',
        name: 'Default',
        isDefault: true,
        enabled: true,
      }),
      current,
    ]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...updated, userOverrides: [] });
    prisma.immaculateTasteProfile.update.mockResolvedValue(updated);
    prisma.immaculateTasteProfileUserOverride.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex:32400' } },
      secrets: { plex: { token: 'plex-token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plexServer.getMachineIdentifier.mockResolvedValue('machine-1');
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'user-1',
      plexAccountTitle: 'ohmz_i',
    });
    prisma.plexUser.findMany.mockResolvedValue([
      { id: 'user-1', plexAccountTitle: 'ohmz_i', isAdmin: true },
    ]);
    plexServer.findCollectionRatingKey.mockResolvedValue('rk-empty');
    plexServer.getCollectionItems.mockResolvedValue([]);
    plexServer.deleteCollection.mockResolvedValue(undefined);
    prisma.immaculateTasteMovieLibrary.findMany.mockResolvedValue([
      { tmdbId: 12345 },
    ]);
    plexServer.listMoviesWithTmdbIdsForSectionKey.mockResolvedValue([
      {
        ratingKey: 'rk-seed',
        title: 'Seed Movie',
        tmdbId: 12345,
        addedAt: 1700000000,
        year: 2024,
      },
    ]);
    plexServer.createCollection.mockResolvedValue('rk-created');

    await service.update('user-1', 'profile-2', {
      enabled: true,
    });

    expect(plexServer.deleteCollection).toHaveBeenCalledWith({
      baseUrl: 'http://plex:32400',
      token: 'plex-token',
      collectionRatingKey: 'rk-empty',
    });
    expect(plexServer.createCollection).toHaveBeenCalledWith({
      baseUrl: 'http://plex:32400',
      token: 'plex-token',
      machineIdentifier: 'machine-1',
      librarySectionKey: '1',
      collectionName: 'Inspired by your Immaculate Taste in Movies (ohmz_i)',
      type: 1,
      initialItemRatingKey: 'rk-seed',
    });
  });

  it('recreates when looked-up collection already exists and a seed item is available', async () => {
    const { service, prisma, settings, plexServer, plexUsers } =
      createService();
    const current = makeProfile({
      id: 'profile-2',
      name: 'Kids',
      isDefault: false,
      enabled: false,
      mediaType: 'movie',
      movieCollectionBaseName: null,
    });
    const updated = makeProfile({
      ...current,
      enabled: true,
      updatedAt: new Date('2026-01-01T00:11:00.000Z'),
    });

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      makeProfile({
        id: 'default-profile',
        name: 'Default',
        isDefault: true,
        enabled: true,
      }),
      current,
    ]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...updated, userOverrides: [] });
    prisma.immaculateTasteProfile.update.mockResolvedValue(updated);
    prisma.immaculateTasteProfileUserOverride.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex:32400' } },
      secrets: { plex: { token: 'plex-token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plexServer.getMachineIdentifier.mockResolvedValue('machine-1');
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'user-1',
      plexAccountTitle: 'ohmz_i',
    });
    prisma.plexUser.findMany.mockResolvedValue([
      { id: 'user-1', plexAccountTitle: 'ohmz_i', isAdmin: true },
    ]);
    plexServer.findCollectionRatingKey.mockResolvedValue('rk-existing');
    plexServer.deleteCollection.mockResolvedValue(undefined);
    prisma.immaculateTasteMovieLibrary.findMany.mockResolvedValue([
      { tmdbId: 12345 },
    ]);
    plexServer.listMoviesWithTmdbIdsForSectionKey.mockResolvedValue([
      {
        ratingKey: 'rk-seed',
        title: 'Seed Movie',
        tmdbId: 12345,
        addedAt: 1700000000,
        year: 2024,
      },
    ]);
    plexServer.createCollection.mockResolvedValue('rk-created');

    await service.update('user-1', 'profile-2', {
      enabled: true,
    });

    expect(plexServer.deleteCollection).toHaveBeenCalledWith({
      baseUrl: 'http://plex:32400',
      token: 'plex-token',
      collectionRatingKey: 'rk-existing',
    });
    expect(plexServer.createCollection).toHaveBeenCalledWith({
      baseUrl: 'http://plex:32400',
      token: 'plex-token',
      machineIdentifier: 'machine-1',
      librarySectionKey: '1',
      collectionName: 'Inspired by your Immaculate Taste in Movies (ohmz_i)',
      type: 1,
      initialItemRatingKey: 'rk-seed',
    });
  });

  it('populates additional collection items after recreate seed', async () => {
    const { service, prisma, settings, plexServer, plexUsers } =
      createService();
    const current = makeProfile({
      id: 'profile-2',
      name: 'Kids',
      isDefault: false,
      enabled: false,
      mediaType: 'movie',
      movieCollectionBaseName: null,
    });
    const updated = makeProfile({
      ...current,
      enabled: true,
      updatedAt: new Date('2026-01-01T00:12:00.000Z'),
    });

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      makeProfile({
        id: 'default-profile',
        name: 'Default',
        isDefault: true,
        enabled: true,
      }),
      current,
    ]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...updated, userOverrides: [] });
    prisma.immaculateTasteProfile.update.mockResolvedValue(updated);
    prisma.immaculateTasteProfileUserOverride.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex:32400' } },
      secrets: { plex: { token: 'plex-token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plexServer.getMachineIdentifier.mockResolvedValue('machine-1');
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'user-1',
      plexAccountTitle: 'ohmz_i',
    });
    prisma.plexUser.findMany.mockResolvedValue([
      { id: 'user-1', plexAccountTitle: 'ohmz_i', isAdmin: true },
    ]);
    plexServer.findCollectionRatingKey.mockResolvedValue(null);
    prisma.immaculateTasteMovieLibrary.findMany.mockResolvedValue([
      { tmdbId: 101 },
      { tmdbId: 202 },
      { tmdbId: 303 },
    ]);
    plexServer.listMoviesWithTmdbIdsForSectionKey.mockResolvedValue([
      {
        ratingKey: 'rk-101',
        title: 'Movie 101',
        tmdbId: 101,
        addedAt: 1700000000,
        year: 2024,
      },
      {
        ratingKey: 'rk-202',
        title: 'Movie 202',
        tmdbId: 202,
        addedAt: 1700000100,
        year: 2024,
      },
      {
        ratingKey: 'rk-303',
        title: 'Movie 303',
        tmdbId: 303,
        addedAt: 1700000200,
        year: 2024,
      },
    ]);
    plexServer.createCollection.mockResolvedValue('rk-created');

    await service.update('user-1', 'profile-2', {
      enabled: true,
    });

    expect(plexServer.createCollection).toHaveBeenCalledWith({
      baseUrl: 'http://plex:32400',
      token: 'plex-token',
      machineIdentifier: 'machine-1',
      librarySectionKey: '1',
      collectionName: 'Inspired by your Immaculate Taste in Movies (ohmz_i)',
      type: 1,
      initialItemRatingKey: 'rk-101',
    });
    expect(plexServer.addItemToCollection).toHaveBeenNthCalledWith(1, {
      baseUrl: 'http://plex:32400',
      token: 'plex-token',
      machineIdentifier: 'machine-1',
      collectionRatingKey: 'rk-created',
      itemRatingKey: 'rk-202',
    });
    expect(plexServer.addItemToCollection).toHaveBeenNthCalledWith(2, {
      baseUrl: 'http://plex:32400',
      token: 'plex-token',
      machineIdentifier: 'machine-1',
      collectionRatingKey: 'rk-created',
      itemRatingKey: 'rk-303',
    });
  });

  it('reapplies curated poster artwork after recreate', async () => {
    const { service, prisma, settings, plexServer, plexUsers } =
      createService();
    const current = makeProfile({
      id: 'profile-2',
      name: 'Kids',
      isDefault: false,
      enabled: false,
      mediaType: 'movie',
      movieCollectionBaseName: null,
    });
    const updated = makeProfile({
      ...current,
      enabled: true,
      updatedAt: new Date('2026-01-01T00:13:00.000Z'),
    });

    jest
      .spyOn(
        service as unknown as { resolveCollectionArtworkPaths: () => unknown },
        'resolveCollectionArtworkPaths',
      )
      .mockReturnValue({
        poster: '/tmp/fake-poster.png',
        background: null,
      });

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      makeProfile({
        id: 'default-profile',
        name: 'Default',
        isDefault: true,
        enabled: true,
      }),
      current,
    ]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...updated, userOverrides: [] });
    prisma.immaculateTasteProfile.update.mockResolvedValue(updated);
    prisma.immaculateTasteProfileUserOverride.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex:32400' } },
      secrets: { plex: { token: 'plex-token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plexServer.getMachineIdentifier.mockResolvedValue('machine-1');
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'user-1',
      plexAccountTitle: 'ohmz_i',
    });
    prisma.plexUser.findMany.mockResolvedValue([
      { id: 'user-1', plexAccountTitle: 'ohmz_i', isAdmin: true },
    ]);
    plexServer.findCollectionRatingKey.mockResolvedValue(null);
    prisma.immaculateTasteMovieLibrary.findMany.mockResolvedValue([
      { tmdbId: 101 },
    ]);
    plexServer.listMoviesWithTmdbIdsForSectionKey.mockResolvedValue([
      {
        ratingKey: 'rk-101',
        title: 'Movie 101',
        tmdbId: 101,
        addedAt: 1700000000,
        year: 2024,
      },
    ]);
    plexServer.createCollection.mockResolvedValue('rk-created');

    await service.update('user-1', 'profile-2', {
      enabled: true,
    });

    expect(plexServer.uploadCollectionPoster).toHaveBeenCalledWith({
      baseUrl: 'http://plex:32400',
      token: 'plex-token',
      collectionRatingKey: 'rk-created',
      filepath: '/tmp/fake-poster.png',
    });
  });

  it('blocks disabling default profile when no other enabled profile exists', async () => {
    const { service, prisma } = createService();
    const current = makeProfile({
      id: 'profile-1',
      enabled: true,
      isDefault: true,
    });

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([current]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(null);

    await expect(
      service.update('user-1', 'profile-1', {
        enabled: false,
      }),
    ).rejects.toThrow(
      'Default profile can only be disabled when another enabled profile exists',
    );
    expect(prisma.immaculateTasteProfile.update).not.toHaveBeenCalled();
  });

  it('re-enables default profile when disabling leaves no enabled profiles', async () => {
    const { service, prisma } = createService();
    const defaultProfile = makeProfile({
      id: 'default-profile',
      name: 'Default',
      isDefault: true,
      enabled: false,
      sortOrder: 0,
    });
    const secondaryProfile = makeProfile({
      id: 'profile-2',
      name: 'Kids',
      isDefault: false,
      enabled: true,
      sortOrder: 1,
    });
    const updatedSecondaryProfile = {
      ...secondaryProfile,
      enabled: false,
      updatedAt: new Date('2026-01-01T00:05:00.000Z'),
    };

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      defaultProfile,
      secondaryProfile,
    ]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(secondaryProfile)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...updatedSecondaryProfile, userOverrides: [] });
    prisma.immaculateTasteProfileUserOverride.findMany.mockResolvedValue([]);
    prisma.immaculateTasteProfile.update.mockResolvedValue(
      updatedSecondaryProfile,
    );
    prisma.immaculateTasteProfile.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.update('user-1', 'profile-2', {
      enabled: false,
    });

    expect(result.enabled).toBe(false);
    expect(prisma.immaculateTasteProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isDefault: true, enabled: false },
      data: { enabled: true },
    });
  });

  it('resets scoped override and renames to default naming with user suffix', async () => {
    const { service, prisma, settings, plexServer, plexUsers } =
      createService();
    const current = makeProfile({
      id: 'profile-1',
      movieCollectionBaseName: null,
      showCollectionBaseName: null,
    });
    const existingOverride: ImmaculateTasteProfileUserOverride = {
      id: 'override-1',
      profileId: 'profile-1',
      plexUserId: 'plex-user-2',
      mediaType: 'both',
      matchMode: 'all',
      genres: '[]',
      audioLanguages: '[]',
      excludedGenres: '[]',
      excludedAudioLanguages: '[]',
      radarrInstanceId: null,
      sonarrInstanceId: null,
      movieCollectionBaseName: 'Movie Night Picks',
      showCollectionBaseName: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([current]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, userOverrides: [] });
    prisma.plexUser.findFirst.mockResolvedValue({ id: 'plex-user-2' });
    prisma.immaculateTasteProfileUserOverride.findUnique.mockResolvedValue(
      existingOverride,
    );
    prisma.immaculateTasteProfileUserOverride.delete.mockResolvedValue(
      existingOverride,
    );
    settings.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex:32400' } },
      secrets: { plex: { token: 'plex-token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'user-1',
      plexAccountTitle: 'admin',
    });
    prisma.plexUser.findMany.mockResolvedValue([
      { id: 'user-1', plexAccountTitle: 'admin', isAdmin: true },
      { id: 'plex-user-2', plexAccountTitle: 'ohmz_i', isAdmin: false },
    ]);
    plexServer.findCollectionRatingKey.mockImplementation(
      (params: { collectionName: string }) =>
        params.collectionName === 'Movie Night Picks'
          ? Promise.resolve('rk-movie-custom')
          : Promise.resolve(null),
    );
    plexServer.renameCollection.mockResolvedValue(undefined);

    const result = await service.update('user-1', 'profile-1', {
      scopePlexUserId: 'plex-user-2',
      resetScopeToDefaultNaming: true,
    });

    expect(result.userOverrides).toEqual([]);
    expect(
      prisma.immaculateTasteProfileUserOverride.delete,
    ).toHaveBeenCalledWith({
      where: { id: 'override-1' },
    });
    expect(plexServer.renameCollection).toHaveBeenCalledWith({
      baseUrl: 'http://plex:32400',
      token: 'plex-token',
      librarySectionKey: '1',
      collectionRatingKey: 'rk-movie-custom',
      collectionName: 'Inspired by your Immaculate Taste in Movies (ohmz_i)',
    });
  });

  it('re-enables default profile when deleting leaves no enabled profiles', async () => {
    const { service, prisma } = createService();
    const defaultProfile = makeProfile({
      id: 'default-profile',
      name: 'Default',
      isDefault: true,
      enabled: false,
      sortOrder: 0,
    });
    const secondaryProfile = makeProfile({
      id: 'profile-2',
      name: 'Kids',
      isDefault: false,
      enabled: true,
      sortOrder: 1,
    });

    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      defaultProfile,
      secondaryProfile,
    ]);
    prisma.immaculateTasteProfile.findFirst
      .mockResolvedValueOnce(secondaryProfile)
      .mockResolvedValueOnce(null);
    prisma.immaculateTasteProfileUserOverride.findMany.mockResolvedValue([]);
    prisma.immaculateTasteMovieLibrary.updateMany.mockResolvedValue({
      count: 0,
    });
    prisma.immaculateTasteShowLibrary.updateMany.mockResolvedValue({
      count: 0,
    });
    prisma.immaculateTasteProfile.delete.mockResolvedValue(secondaryProfile);
    prisma.immaculateTasteProfile.updateMany.mockResolvedValue({ count: 1 });

    await service.delete('user-1', 'profile-2');

    expect(prisma.immaculateTasteProfile.delete).toHaveBeenCalledWith({
      where: { id: 'profile-2' },
    });
    expect(prisma.immaculateTasteProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isDefault: true },
      data: { enabled: true },
    });
  });
});

describe('ImmaculateTasteProfileService resolveProfileForSeed exclusion filters', () => {
  it('treats default catch-all as fallback when a later profile matches', async () => {
    const { service, prisma } = createService();
    const defaultProfile = makeProfile({
      id: 'default-profile',
      name: 'Default',
      isDefault: true,
      sortOrder: 0,
    });
    const kidsProfile = makeProfile({
      id: 'kids-profile',
      name: 'Kids',
      isDefault: false,
      sortOrder: 1,
      mediaType: 'show',
      genres: JSON.stringify(['Animation']),
    });
    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      { ...defaultProfile, userOverrides: [] },
      { ...kidsProfile, userOverrides: [] },
    ]);

    const matchedKids = await service.resolveProfileForSeed('user-1', {
      seedGenres: ['Animation'],
      seedAudioLanguages: ['English'],
      seedMediaType: 'show',
    });
    expect(matchedKids?.id).toBe('kids-profile');

    const fallbackDefault = await service.resolveProfileForSeed('user-1', {
      seedGenres: ['Documentary'],
      seedAudioLanguages: ['English'],
      seedMediaType: 'show',
    });
    expect(fallbackDefault?.id).toBe('default-profile');
  });

  it('skips a matching include profile when seed matches excluded genre', async () => {
    const { service, prisma } = createService();
    const includeProfile = makeProfile({
      id: 'profile-include',
      name: 'Action English',
      isDefault: false,
      sortOrder: 0,
      genres: JSON.stringify(['Action']),
      audioLanguages: JSON.stringify(['English']),
      excludedGenres: JSON.stringify(['Horror']),
    });
    const defaultProfile = makeProfile({
      id: 'default-profile',
      name: 'Default',
      isDefault: true,
      sortOrder: 1,
    });
    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      { ...includeProfile, userOverrides: [] },
      { ...defaultProfile, userOverrides: [] },
    ]);

    const resolved = await service.resolveProfileForSeed('user-1', {
      seedGenres: ['Action', 'Horror'],
      seedAudioLanguages: ['English'],
      seedMediaType: 'movie',
    });

    expect(resolved?.id).toBe('default-profile');
  });

  it('applies excluded audio language filter for seed matching', async () => {
    const { service, prisma } = createService();
    const includeProfile = makeProfile({
      id: 'profile-include',
      name: 'English only',
      isDefault: false,
      sortOrder: 0,
      genres: JSON.stringify(['Action']),
      audioLanguages: JSON.stringify(['English']),
      excludedAudioLanguages: JSON.stringify(['Japanese']),
    });
    const defaultProfile = makeProfile({
      id: 'default-profile',
      name: 'Default',
      isDefault: true,
      sortOrder: 1,
    });
    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      { ...includeProfile, userOverrides: [] },
      { ...defaultProfile, userOverrides: [] },
    ]);

    const excludedMatch = await service.resolveProfileForSeed('user-1', {
      seedGenres: ['Action'],
      seedAudioLanguages: ['English', 'Japanese'],
      seedMediaType: 'movie',
    });
    expect(excludedMatch?.id).toBe('default-profile');

    const allowedMatch = await service.resolveProfileForSeed('user-1', {
      seedGenres: ['Action'],
      seedAudioLanguages: ['English'],
      seedMediaType: 'movie',
    });
    expect(allowedMatch?.id).toBe('profile-include');
  });

  it('does not match an any-mode include profile unless an include criterion actually matches', async () => {
    const { service, prisma } = createService();
    const defaultProfile = makeProfile({
      id: 'default-profile',
      name: 'Default',
      isDefault: true,
      sortOrder: 0,
      excludedGenres: JSON.stringify(['Animation']),
    });
    const crimeProfile = makeProfile({
      id: 'crime-profile',
      name: 'Crime',
      isDefault: false,
      sortOrder: 1,
      matchMode: 'any',
      genres: JSON.stringify(['Crime']),
      audioLanguages: JSON.stringify([]),
    });
    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      { ...defaultProfile, userOverrides: [] },
      { ...crimeProfile, userOverrides: [] },
    ]);

    const unmatched = await service.resolveProfileForSeed('user-1', {
      seedGenres: ['Animation', 'Comedy'],
      seedAudioLanguages: ['Japanese'],
      seedMediaType: 'show',
    });
    expect(unmatched).toBeNull();

    const matched = await service.resolveProfileForSeed('user-1', {
      seedGenres: ['Crime', 'Drama'],
      seedAudioLanguages: ['Japanese'],
      seedMediaType: 'show',
    });
    expect(matched?.id).toBe('crime-profile');
  });

  it('does not treat non-default empty-include profiles as catch-all', async () => {
    const { service, prisma } = createService();
    const defaultProfile = makeProfile({
      id: 'default-profile',
      name: 'Default',
      isDefault: true,
      sortOrder: 0,
      excludedGenres: JSON.stringify(['Animation']),
    });
    const customEmptyProfile = makeProfile({
      id: 'custom-empty',
      name: 'Custom Empty',
      isDefault: false,
      sortOrder: 1,
      genres: JSON.stringify([]),
      audioLanguages: JSON.stringify([]),
    });
    prisma.immaculateTasteProfile.findMany.mockResolvedValue([
      { ...defaultProfile, userOverrides: [] },
      { ...customEmptyProfile, userOverrides: [] },
    ]);

    const resolved = await service.resolveProfileForSeed('user-1', {
      seedGenres: ['Animation'],
      seedAudioLanguages: ['English'],
      seedMediaType: 'show',
    });

    expect(resolved).toBeNull();
  });
});
