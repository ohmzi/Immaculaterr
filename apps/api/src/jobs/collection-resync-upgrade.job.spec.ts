import {
  buildUserCollectionHubOrder,
  CHANGE_OF_MOVIE_TASTE_COLLECTION_BASE_NAME,
  CURATED_MOVIE_COLLECTION_HUB_ORDER,
  CHANGE_OF_SHOW_TASTE_COLLECTION_BASE_NAME,
  IMMACULATE_TASTE_SHOWS_COLLECTION_BASE_NAME,
  IMMACULATE_TASTE_MOVIES_COLLECTION_BASE_NAME,
  RECENTLY_WATCHED_MOVIE_COLLECTION_BASE_NAME,
} from '../plex/plex-collections.utils';
import {
  buildCollectionResyncQueueItemKey,
  COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY,
  COLLECTION_RESYNC_UPGRADE_COMPLETED_VERSIONS_KEY,
  COLLECTION_RESYNC_UPGRADE_LAST_COMPLETED_VERSION_KEY,
  COLLECTION_RESYNC_UPGRADE_RELEASE_VERSION,
  COLLECTION_RESYNC_UPGRADE_STATE_KEY,
  COLLECTION_RESYNC_UPGRADE_VERSION,
  CollectionResyncUpgradeJob,
  type CollectionResyncQueueItem,
  getPendingQueueItemsInOrder,
} from './collection-resync-upgrade.job';
import type { JobContext, JsonObject } from './jobs.types';

function createCtx(): JobContext {
  let summary: JsonObject | null = null;
  const log = jest.fn(() => Promise.resolve());
  return {
    jobId: 'collectionResyncUpgrade',
    runId: 'run-1',
    userId: 'user-1',
    dryRun: false,
    trigger: 'auto',
    getSummary: () => summary,
    setSummary: jest.fn((next: JsonObject | null) => {
      summary = next;
      return Promise.resolve();
    }),
    patchSummary: jest.fn((patch: JsonObject) => {
      summary = { ...(summary ?? {}), ...(patch ?? {}) };
      return Promise.resolve();
    }),
    log,
    debug: log,
    info: log,
    warn: log,
    error: log,
  };
}

function createQueueItem(params: {
  plexUserId: string;
  mediaType: 'movie' | 'tv';
  librarySectionKey: string;
  collectionBaseName: string;
}): CollectionResyncQueueItem {
  const key = buildCollectionResyncQueueItemKey(params);
  return {
    key,
    plexUserId: params.plexUserId,
    mediaType: params.mediaType,
    librarySectionKey: params.librarySectionKey,
    collectionBaseName: params.collectionBaseName,
    targetCollectionName: `${params.collectionBaseName} (User)`,
    sourceTable: 'WatchedMovieRecommendationLibrary',
    rowCount: 1,
    activeRowCount: 1,
    pinTarget: 'friends',
  };
}

function createSettingStore(initialValues: Record<string, string> = {}) {
  const values = new Map<string, string>(Object.entries(initialValues));
  const findUnique = jest.fn(
    ({
      where,
    }: {
      where: { key: string };
    }): Promise<{ value: string } | null> => {
      const value = values.get(where.key);
      return Promise.resolve(value === undefined ? null : { value });
    },
  );
  const upsert = jest.fn(
    (params: {
      where: { key: string };
      update: { value: string };
      create: { value: string };
    }): Promise<{ key: string; value: string }> => {
      const nextValue = params.update.value ?? params.create.value;
      values.set(params.where.key, nextValue);
      return Promise.resolve({ key: params.where.key, value: nextValue });
    },
  );
  const deleteMany = jest.fn(({ where }: { where: { key: string } }) => {
    values.delete(where.key);
    return Promise.resolve({ count: 1 });
  });

  return {
    values,
    findUnique,
    upsert,
    deleteMany,
    prisma: {
      setting: {
        findUnique,
        upsert,
        deleteMany,
      },
    },
  };
}

describe('CollectionResyncUpgradeJob', () => {
  it('keeps release and internal migration versions aligned', () => {
    expect(COLLECTION_RESYNC_UPGRADE_VERSION).toBe(
      `v${COLLECTION_RESYNC_UPGRADE_RELEASE_VERSION.replaceAll('.', '_')}`,
    );
  });

  it('backfills release markers when migration already completed', async () => {
    const settings = createSettingStore({
      [COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY]: '2026-02-16T00:00:00.000Z',
    });

    const plexServer = {
      deleteCollection: jest.fn(),
    } as unknown as ConstructorParameters<typeof CollectionResyncUpgradeJob>[4];

    const job = new CollectionResyncUpgradeJob(
      settings.prisma as never,
      {} as never,
      {} as never,
      {} as never,
      plexServer as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await job.run(createCtx());
    const report = result.summary as unknown as Record<string, unknown>;
    const tasks = (report['tasks'] ?? []) as Array<Record<string, unknown>>;

    expect(report['headline']).toBe(
      'Collection resync upgrade already completed.',
    );
    expect(tasks.length).toBe(4);
    expect(tasks.every((task) => task['status'] === 'skipped')).toBe(true);
    expect((plexServer.deleteCollection as jest.Mock).mock.calls).toHaveLength(
      0,
    );
    expect(
      settings.values.get(COLLECTION_RESYNC_UPGRADE_LAST_COMPLETED_VERSION_KEY),
    ).toBe(COLLECTION_RESYNC_UPGRADE_RELEASE_VERSION);

    const completedVersionsRaw = settings.values.get(
      COLLECTION_RESYNC_UPGRADE_COMPLETED_VERSIONS_KEY,
    );
    expect(completedVersionsRaw).toBeTruthy();
    const completedVersions = JSON.parse(
      String(completedVersionsRaw),
    ) as Record<string, string>;
    expect(completedVersions[COLLECTION_RESYNC_UPGRADE_RELEASE_VERSION]).toBe(
      '2026-02-16T00:00:00.000Z',
    );
  });

  it('merges existing completedVersions history while backfilling release markers', async () => {
    const settings = createSettingStore({
      [COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY]: '2026-02-17T00:00:00.000Z',
      [COLLECTION_RESYNC_UPGRADE_COMPLETED_VERSIONS_KEY]:
        '{"1.6.0":"2026-01-15T00:00:00.000Z"}',
    });

    const job = new CollectionResyncUpgradeJob(
      settings.prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await job.run(createCtx());

    const completedVersionsRaw = settings.values.get(
      COLLECTION_RESYNC_UPGRADE_COMPLETED_VERSIONS_KEY,
    );
    const completedVersions = JSON.parse(
      String(completedVersionsRaw),
    ) as Record<string, string>;

    expect(completedVersions['1.6.0']).toBe('2026-01-15T00:00:00.000Z');
    expect(completedVersions[COLLECTION_RESYNC_UPGRADE_RELEASE_VERSION]).toBe(
      '2026-02-17T00:00:00.000Z',
    );
  });

  it('persists release markers during finalize', async () => {
    const settings = createSettingStore();

    const job = new CollectionResyncUpgradeJob(
      settings.prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const createEmptyState = (
      job as unknown as {
        createEmptyState: (adminUserId: string) => Record<string, unknown>;
      }
    ).createEmptyState.bind(job);
    const verifyAndFinalize = (
      job as unknown as {
        verifyAndFinalize: (params: {
          state: Record<string, unknown>;
        }) => Promise<Record<string, unknown>>;
      }
    ).verifyAndFinalize.bind(job);

    const state = createEmptyState('admin-user');
    const result = await verifyAndFinalize({ state });

    expect(result['releaseVersion']).toBe(
      COLLECTION_RESYNC_UPGRADE_RELEASE_VERSION,
    );
    expect(
      settings.values.get(COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY),
    ).toBeTruthy();
    expect(
      settings.values.get(COLLECTION_RESYNC_UPGRADE_LAST_COMPLETED_VERSION_KEY),
    ).toBe(COLLECTION_RESYNC_UPGRADE_RELEASE_VERSION);
    expect(
      settings.values.get(COLLECTION_RESYNC_UPGRADE_COMPLETED_VERSIONS_KEY),
    ).toBeTruthy();
    expect(
      settings.values.get(COLLECTION_RESYNC_UPGRADE_STATE_KEY),
    ).toBeTruthy();
  });

  it('captures delete queue for Immaculaterr curated collections only', async () => {
    const settings = createSettingStore();
    const plexServer = {
      getSections: jest.fn(() =>
        Promise.resolve([
          { key: '1', title: 'Movies', type: 'movie' },
          { key: '2', title: 'Shows', type: 'show' },
        ]),
      ),
      listCollectionsForSectionKey: jest.fn(
        ({ librarySectionKey }: { librarySectionKey: string }) => {
          if (librarySectionKey === '1') {
            return Promise.resolve([
              { ratingKey: 'm-1', title: 'Change of Taste (Alice)' },
              { ratingKey: 'm-2', title: 'Weekend Favorites' },
            ]);
          }
          return Promise.resolve([
            {
              ratingKey: 's-1',
              title: 'Inspired by your Immaculate Taste (Alice)',
            },
            { ratingKey: 's-2', title: 'Kids Shows' },
          ]);
        },
      ),
    };

    const job = new CollectionResyncUpgradeJob(
      settings.prisma as never,
      {} as never,
      {} as never,
      {} as never,
      plexServer as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const createEmptyState = (
      job as unknown as {
        createEmptyState: (adminUserId: string) => Record<string, unknown>;
      }
    ).createEmptyState.bind(job);
    const captureSnapshotAndDeleteQueue = (
      job as unknown as {
        captureSnapshotAndDeleteQueue: (params: {
          state: Record<string, unknown>;
          plexBaseUrl: string;
          plexToken: string;
          suggestionCounts: Record<string, number>;
        }) => Promise<{ deleteQueue: Array<{ collectionTitle: string }> }>;
      }
    ).captureSnapshotAndDeleteQueue.bind(job);

    const state = createEmptyState('admin-user');
    const result = await captureSnapshotAndDeleteQueue({
      state,
      plexBaseUrl: 'http://localhost:32400',
      plexToken: 'token',
      suggestionCounts: {
        immaculateMovieRows: 0,
        immaculateShowRows: 0,
        watchedMovieRows: 0,
        watchedShowRows: 0,
      },
    });

    expect(result.deleteQueue.map((entry) => entry.collectionTitle)).toEqual([
      'Change of Taste (Alice)',
      'Inspired by your Immaculate Taste (Alice)',
    ]);
  });

  it('canonicalizes legacy watched collection names to new naming convention in queue build', async () => {
    const settings = createSettingStore();
    const prisma = {
      ...settings.prisma,
      immaculateTasteMovieLibrary: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
      immaculateTasteShowLibrary: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
      watchedMovieRecommendationLibrary: {
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              plexUserId: 'u-1',
              librarySectionKey: 'movie-1',
              collectionName: 'Change of Taste',
              status: 'active',
            },
            {
              plexUserId: 'u-1',
              librarySectionKey: 'movie-1',
              collectionName: 'Based on your recently watched',
              status: 'active',
            },
            {
              plexUserId: 'u-1',
              librarySectionKey: 'movie-1',
              collectionName: 'Not a curated name',
              status: 'active',
            },
          ]),
        ),
      },
      watchedShowRecommendationLibrary: {
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              plexUserId: 'u-1',
              librarySectionKey: 'show-1',
              collectionName: 'Inspired by your Immaculate Taste',
              status: 'active',
            },
          ]),
        ),
      },
    };

    const job = new CollectionResyncUpgradeJob(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const buildDeterministicQueue = (
      job as unknown as {
        buildDeterministicQueue: (params: {
          plexUserLookup: Map<
            string,
            {
              id: string;
              plexAccountId: number | null;
              plexAccountTitle: string;
              isAdmin: boolean;
            }
          >;
          adminPlexUser: {
            id: string;
            plexAccountId: number | null;
            plexAccountTitle: string;
            isAdmin: boolean;
          };
        }) => Promise<
          Array<{ collectionBaseName: string; targetCollectionName: string }>
        >;
      }
    ).buildDeterministicQueue.bind(job);

    const queue = await buildDeterministicQueue({
      plexUserLookup: new Map([
        [
          'u-1',
          {
            id: 'u-1',
            plexAccountId: 101,
            plexAccountTitle: 'Alice',
            isAdmin: false,
          },
        ],
      ]),
      adminPlexUser: {
        id: 'admin',
        plexAccountId: 1,
        plexAccountTitle: 'Admin',
        isAdmin: true,
      },
    });

    const baseNames = new Set(queue.map((entry) => entry.collectionBaseName));
    expect(baseNames.has(CHANGE_OF_MOVIE_TASTE_COLLECTION_BASE_NAME)).toBe(
      true,
    );
    expect(baseNames.has(RECENTLY_WATCHED_MOVIE_COLLECTION_BASE_NAME)).toBe(
      true,
    );
    expect(baseNames.has(IMMACULATE_TASTE_SHOWS_COLLECTION_BASE_NAME)).toBe(
      true,
    );
    expect(
      queue.some((entry) => entry.collectionBaseName === 'Not a curated name'),
    ).toBe(false);
  });

  it('matches watched movie rows by curated base across legacy and canonical names', async () => {
    const settings = createSettingStore();
    const watchedMovieFindMany = jest.fn(
      ({ where }: { where: { status?: string } }) => {
        if (where?.status === 'pending') {
          return Promise.resolve([]);
        }
        return Promise.resolve([
          {
            collectionName: 'Change of Taste',
            tmdbId: 10,
          },
          {
            collectionName: 'Change of Movie Taste',
            tmdbId: 20,
          },
          {
            collectionName: 'Based on your recently watched Movie',
            tmdbId: 30,
          },
        ]);
      },
    );

    const prisma = {
      ...settings.prisma,
      watchedMovieRecommendationLibrary: {
        findMany: watchedMovieFindMany,
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      watchedShowRecommendationLibrary: {
        findMany: jest.fn(() => Promise.resolve([])),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
    };
    const plexServer = {
      listMoviesWithTmdbIdsForSectionKey: jest.fn(() =>
        Promise.resolve([
          { tmdbId: 10, ratingKey: 'movie-10', title: 'Movie Ten' },
          { tmdbId: 20, ratingKey: 'movie-20', title: 'Movie Twenty' },
          { tmdbId: 30, ratingKey: 'movie-30', title: 'Movie Thirty' },
        ]),
      ),
    };

    const job = new CollectionResyncUpgradeJob(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      plexServer as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const buildDesiredItemsForQueueItem = (
      job as unknown as {
        buildDesiredItemsForQueueItem: (params: {
          item: CollectionResyncQueueItem;
          dryRun: boolean;
          watchedLimit: number;
          movieIndexBySection: Map<
            string,
            Map<number, { ratingKey: string; title: string }>
          >;
          tvIndexBySection: Map<
            string,
            Map<number, { ratingKey: string; title: string }>
          >;
          plexBaseUrl: string;
          plexToken: string;
        }) => Promise<Array<{ ratingKey: string; title: string }>>;
      }
    ).buildDesiredItemsForQueueItem.bind(job);

    const desired = await buildDesiredItemsForQueueItem({
      item: createQueueItem({
        plexUserId: 'u-1',
        mediaType: 'movie',
        librarySectionKey: 'movie-lib',
        collectionBaseName: CHANGE_OF_MOVIE_TASTE_COLLECTION_BASE_NAME,
      }),
      dryRun: false,
      watchedLimit: 15,
      movieIndexBySection: new Map(),
      tvIndexBySection: new Map(),
      plexBaseUrl: 'http://plex.local:32400',
      plexToken: 'token',
    });

    expect(desired).toEqual([
      { ratingKey: 'movie-10', title: 'Movie Ten' },
      { ratingKey: 'movie-20', title: 'Movie Twenty' },
    ]);
    expect(
      prisma.watchedMovieRecommendationLibrary.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('activates pending watched show rows before selecting active snapshot rows', async () => {
    const settings = createSettingStore();
    const watchedShowFindMany = jest.fn(
      ({ where }: { where: { status?: string } }) => {
        if (where?.status === 'pending') {
          return Promise.resolve([
            {
              collectionName: 'Change of Taste',
              tvdbId: 101,
            },
            {
              collectionName: 'Change of Show Taste',
              tvdbId: 202,
            },
          ]);
        }
        return Promise.resolve([
          {
            collectionName: 'Change of Show Taste',
            tvdbId: 101,
          },
          {
            collectionName: 'Change of Show Taste',
            tvdbId: 303,
          },
        ]);
      },
    );

    const prisma = {
      ...settings.prisma,
      watchedMovieRecommendationLibrary: {
        findMany: jest.fn(() => Promise.resolve([])),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      watchedShowRecommendationLibrary: {
        findMany: watchedShowFindMany,
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
    };
    const plexServer = {
      listShowsWithTvdbIdsForSectionKey: jest.fn(() =>
        Promise.resolve([
          { tvdbId: 101, ratingKey: 'show-101', title: 'Show One' },
          { tvdbId: 303, ratingKey: 'show-303', title: 'Show Three' },
        ]),
      ),
    };

    const job = new CollectionResyncUpgradeJob(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      plexServer as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const buildDesiredItemsForQueueItem = (
      job as unknown as {
        buildDesiredItemsForQueueItem: (params: {
          item: CollectionResyncQueueItem;
          dryRun: boolean;
          watchedLimit: number;
          movieIndexBySection: Map<
            string,
            Map<number, { ratingKey: string; title: string }>
          >;
          tvIndexBySection: Map<
            string,
            Map<number, { ratingKey: string; title: string }>
          >;
          plexBaseUrl: string;
          plexToken: string;
        }) => Promise<Array<{ ratingKey: string; title: string }>>;
      }
    ).buildDesiredItemsForQueueItem.bind(job);

    const desired = await buildDesiredItemsForQueueItem({
      item: createQueueItem({
        plexUserId: 'u-2',
        mediaType: 'tv',
        librarySectionKey: 'tv-lib',
        collectionBaseName: CHANGE_OF_SHOW_TASTE_COLLECTION_BASE_NAME,
      }),
      dryRun: false,
      watchedLimit: 15,
      movieIndexBySection: new Map(),
      tvIndexBySection: new Map(),
      plexBaseUrl: 'http://plex.local:32400',
      plexToken: 'token',
    });

    expect(prisma.watchedShowRecommendationLibrary.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          plexUserId: 'u-2',
          librarySectionKey: 'tv-lib',
          status: 'pending',
          collectionName: { in: ['Change of Taste'] },
          tvdbId: { in: [101] },
        }),
        data: { status: 'active' },
      }),
    );
    expect(desired).toEqual([
      { ratingKey: 'show-101', title: 'Show One' },
      { ratingKey: 'show-303', title: 'Show Three' },
    ]);
  });

  it('rebuilds with pinned curated hub order during upgrade replay', async () => {
    const settings = createSettingStore();
    const item = createQueueItem({
      plexUserId: 'u-3',
      mediaType: 'movie',
      librarySectionKey: 'movie-lib',
      collectionBaseName: IMMACULATE_TASTE_MOVIES_COLLECTION_BASE_NAME,
    });
    item.targetCollectionName = `${IMMACULATE_TASTE_MOVIES_COLLECTION_BASE_NAME} (Alice)`;
    item.pinTarget = 'friends';
    item.sourceTable = 'ImmaculateTasteMovieLibrary';

    const prisma = {
      ...settings.prisma,
      watchedMovieRecommendationLibrary: {
        findMany: jest.fn(() => Promise.resolve([])),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      watchedShowRecommendationLibrary: {
        findMany: jest.fn(() => Promise.resolve([])),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
    };

    const plexServer = {
      listMoviesWithTmdbIdsForSectionKey: jest.fn(() =>
        Promise.resolve([
          { tmdbId: 11, ratingKey: 'movie-11', title: 'Movie Eleven' },
        ]),
      ),
      findCollectionRatingKey: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('collection-11'),
      getCollectionItems: jest.fn(() =>
        Promise.resolve([{ ratingKey: 'movie-11', title: 'Movie Eleven' }]),
      ),
    };
    const plexCurated = {
      rebuildMovieCollection: jest.fn(() => Promise.resolve({})),
    };
    const immaculateMovies = {
      getActiveMovies: jest.fn(() =>
        Promise.resolve([{ tmdbId: 11, status: 'active', points: 2 }]),
      ),
    };

    const job = new CollectionResyncUpgradeJob(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      plexServer as never,
      plexCurated as never,
      immaculateMovies as never,
      {} as never,
    );
    const recreateCollectionsSequentially = (
      job as unknown as {
        recreateCollectionsSequentially: (params: {
          ctx: JobContext;
          state: Record<string, unknown>;
          plexBaseUrl: string;
          plexToken: string;
          machineIdentifier: string;
          watchedLimit: number;
        }) => Promise<Record<string, unknown>>;
      }
    ).recreateCollectionsSequentially.bind(job);

    const state = {
      queue: [item],
      itemProgress: {
        [item.key]: {
          phase: 'captured',
          source: 'immaculaterr',
          attempts: 0,
          lastError: null,
          updatedAt: '2026-02-28T00:00:00.000Z',
          capturedAt: '2026-02-28T00:00:00.000Z',
          deletedAt: null,
          recreatedAt: null,
          verifiedAt: null,
          doneAt: null,
        },
      },
      deleteQueue: [
        {
          deleteKey: 'd1',
          librarySectionKey: 'movie-lib',
          libraryTitle: 'Movies',
          libraryType: 'movie',
          collectionRatingKey: 'legacy-1',
          collectionTitle: `${IMMACULATE_TASTE_MOVIES_COLLECTION_BASE_NAME} (Alice)`,
        },
      ],
      deleteProgress: {},
      deletedCollections: [],
      preRefreshUserTitles: {},
      failures: [],
      phases: {
        queueBuiltAt: null,
        captureCompletedAt: null,
        deleteCompletedAt: null,
        recreateCompletedAt: null,
        finalizedAt: null,
      },
      version: 1,
      startedAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:00:00.000Z',
      adminUserId: 'admin',
      snapshot: null,
    };

    await recreateCollectionsSequentially({
      ctx: createCtx(),
      state,
      plexBaseUrl: 'http://plex.local:32400',
      plexToken: 'token',
      machineIdentifier: 'machine-1',
      watchedLimit: 15,
    });

    expect(plexCurated.rebuildMovieCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: `${IMMACULATE_TASTE_MOVIES_COLLECTION_BASE_NAME} (Alice)`,
        pinCollections: true,
        pinTarget: 'friends',
        collectionHubOrder: buildUserCollectionHubOrder(
          CURATED_MOVIE_COLLECTION_HUB_ORDER,
          'Alice',
        ),
      }),
    );
  });

  it('keeps queue processing order deterministic (sequential)', () => {
    const first = createQueueItem({
      plexUserId: 'u-1',
      mediaType: 'movie',
      librarySectionKey: '1',
      collectionBaseName: 'Based on your recently watched Movie',
    });
    const second = createQueueItem({
      plexUserId: 'u-1',
      mediaType: 'tv',
      librarySectionKey: '2',
      collectionBaseName: 'Based on your recently watched Show',
    });
    const third = createQueueItem({
      plexUserId: 'u-2',
      mediaType: 'movie',
      librarySectionKey: '3',
      collectionBaseName: 'Change of Movie Taste',
    });

    const ordered = getPendingQueueItemsInOrder({
      queue: [first, second, third],
      itemProgress: {
        [first.key]: { phase: 'captured' },
        [second.key]: { phase: 'pending' },
        [third.key]: { phase: 'recreated' },
      },
    });

    expect(ordered.map((item) => item.key)).toEqual([
      first.key,
      second.key,
      third.key,
    ]);
  });

  it('resumes only incomplete items after a crash/restart', () => {
    const first = createQueueItem({
      plexUserId: 'u-1',
      mediaType: 'movie',
      librarySectionKey: '1',
      collectionBaseName: 'Based on your recently watched Movie',
    });
    const second = createQueueItem({
      plexUserId: 'u-1',
      mediaType: 'tv',
      librarySectionKey: '2',
      collectionBaseName: 'Based on your recently watched Show',
    });
    const third = createQueueItem({
      plexUserId: 'u-2',
      mediaType: 'movie',
      librarySectionKey: '3',
      collectionBaseName: 'Inspired by your Immaculate Taste in Movies',
    });

    const pending = getPendingQueueItemsInOrder({
      queue: [first, second, third],
      itemProgress: {
        [first.key]: { phase: 'done' },
        [second.key]: { phase: 'failed' },
        [third.key]: { phase: 'done' },
      },
    });

    expect(pending.map((item) => item.key)).toEqual([second.key]);
  });
});
