import { FreshOutOfTheOvenJob } from './fresh-out-of-the-oven.job';
import type { JobContext, JsonObject } from './jobs.types';
import {
  buildFreshOutMovieCollectionHubOrder,
  buildFreshOutShowCollectionHubOrder,
  FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
  FRESH_OUT_OF_THE_OVEN_SHOW_COLLECTION_BASE_NAME,
} from '../plex/plex-collections.utils';

type MovieUpsertArgs = {
  create: {
    tmdbId: number;
  };
};

type ShowUpsertArgs = {
  create: {
    tvdbId: number;
    tmdbId: number;
  };
};

function createCtx(overrides: Partial<JobContext> = {}): JobContext {
  let summary: JsonObject | null = null;
  const log = jest.fn(() => Promise.resolve());
  return {
    jobId: 'freshOutOfTheOven',
    runId: 'run-1',
    userId: 'user-1',
    dryRun: false,
    trigger: 'manual',
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
    ...overrides,
  };
}

function createPrismaMock() {
  return {
    freshReleaseMovieLibrary: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
    freshReleaseShowLibrary: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
    watchedMovieRecommendationLibrary: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    watchedShowRecommendationLibrary: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    ),
  };
}

describe('FreshOutOfTheOvenJob', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-17T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('runs movie and TV paths together with per-user unseen filtering and fresh-out pinning', async () => {
    const movieSection = { key: 'movies', title: 'Movies', type: 'movie' };
    const showSection = { key: 'shows', title: 'Shows', type: 'show' };
    const adminUser = {
      id: 'plex-admin',
      plexAccountId: 1,
      plexAccountTitle: 'Admin',
      isAdmin: true,
      lastSeenAt: new Date('2026-03-17T12:00:00.000Z'),
    };
    const sharedUser = {
      id: 'plex-shared',
      plexAccountId: 2,
      plexAccountTitle: 'Shared User',
      isAdmin: false,
      lastSeenAt: new Date('2026-03-16T12:00:00.000Z'),
    };

    const prisma = createPrismaMock();
    const settingsService = {
      getInternalSettings: jest.fn().mockResolvedValue({
        settings: {
          plex: { baseUrl: 'http://plex.local:32400' },
        },
        secrets: {
          plex: { token: 'plex-token' },
          tmdb: { apiKey: 'tmdb-key' },
        },
      }),
    };
    const plexServer = {
      getSections: jest.fn().mockResolvedValue([movieSection, showSection]),
      getMachineIdentifier: jest.fn().mockResolvedValue('machine-1'),
      listMoviesWithTmdbIdsForSectionKey: jest.fn().mockResolvedValue([
        {
          ratingKey: '10',
          title: 'Movie A',
          tmdbId: 10,
          addedAt: null,
          year: 2026,
        },
        {
          ratingKey: '20',
          title: 'Movie B',
          tmdbId: 20,
          addedAt: null,
          year: 2026,
        },
        {
          ratingKey: '30',
          title: 'Movie Old',
          tmdbId: 30,
          addedAt: null,
          year: 2025,
        },
      ]),
      listShowsWithTvdbIdsForSectionKey: jest.fn().mockResolvedValue([
        {
          ratingKey: 'show-101',
          title: 'Show A',
          tvdbId: 101,
          tmdbId: 1001,
          addedAt: null,
          year: 2026,
        },
        {
          ratingKey: 'show-202',
          title: 'Show B',
          tvdbId: 202,
          tmdbId: 2002,
          addedAt: null,
          year: 2026,
        },
        {
          ratingKey: 'show-303',
          title: 'Show Old',
          tvdbId: 303,
          tmdbId: 3003,
          addedAt: null,
          year: 2025,
        },
      ]),
      listWatchedMovieTmdbIdsForSectionKey: jest
        .fn()
        .mockResolvedValueOnce([10])
        .mockResolvedValueOnce([]),
      listWatchedShowTvdbIdsForSectionKey: jest
        .fn()
        .mockResolvedValueOnce([101])
        .mockResolvedValueOnce([]),
    };
    const plexService = {
      listSharedUsersWithAccessTokensForServer: jest.fn().mockResolvedValue([
        {
          plexAccountId: 2,
          plexAccountTitle: 'Shared User',
          username: 'shared',
          email: null,
          accessToken: 'shared-token',
          isHomeUser: true,
        },
      ]),
    };
    const plexUsers = {
      ensureAdminPlexUser: jest.fn().mockResolvedValue(adminUser),
      getOrCreateByPlexAccount: jest.fn().mockResolvedValue(sharedUser),
    };
    const tmdb = {
      getMovie: jest
        .fn()
        .mockImplementation(({ tmdbId }: { tmdbId: number }) => {
          if (tmdbId === 10) {
            return Promise.resolve({
              id: 10,
              title: 'Movie A',
              release_date: '2026-03-01',
              poster_path: '/a.jpg',
              vote_average: 7.1,
              vote_count: 100,
            });
          }
          if (tmdbId === 20) {
            return Promise.resolve({
              id: 20,
              title: 'Movie B',
              release_date: '2026-02-15',
              poster_path: '/b.jpg',
              vote_average: 7.5,
              vote_count: 90,
            });
          }
          return Promise.resolve({
            id: 30,
            title: 'Movie Old',
            release_date: '2025-10-01',
            poster_path: '/old.jpg',
            vote_average: 6.4,
            vote_count: 40,
          });
        }),
      getTv: jest.fn().mockImplementation(({ tmdbId }: { tmdbId: number }) => {
        if (tmdbId === 1001) {
          return Promise.resolve({
            id: 1001,
            name: 'Show A',
            first_air_date: '2026-03-05',
            poster_path: '/show-a.jpg',
            vote_average: 7.7,
            vote_count: 120,
          });
        }
        if (tmdbId === 2002) {
          return Promise.resolve({
            id: 2002,
            name: 'Show B',
            first_air_date: '2026-02-20',
            poster_path: '/show-b.jpg',
            vote_average: 8.1,
            vote_count: 95,
          });
        }
        return Promise.resolve({
          id: 3003,
          name: 'Show Old',
          first_air_date: '2025-10-01',
          poster_path: '/show-old.jpg',
          vote_average: 6.2,
          vote_count: 55,
        });
      }),
    };
    const watchedRefresher = {
      refresh: jest.fn().mockResolvedValue({ ok: true }),
    };

    const job = new FreshOutOfTheOvenJob(
      prisma as never,
      settingsService as never,
      plexServer as never,
      plexService as never,
      plexUsers as never,
      tmdb as never,
      watchedRefresher as never,
    );

    await job.run(createCtx());

    const movieUpserts = prisma.freshReleaseMovieLibrary.upsert.mock
      .calls as Array<[MovieUpsertArgs]>;
    const showUpserts = prisma.freshReleaseShowLibrary.upsert.mock
      .calls as Array<[ShowUpsertArgs]>;

    expect(prisma.freshReleaseMovieLibrary.upsert).toHaveBeenCalledTimes(2);
    expect(
      movieUpserts
        .map(([args]) => args.create.tmdbId)
        .sort((left, right) => left - right),
    ).toEqual([10, 20]);
    expect(prisma.freshReleaseShowLibrary.upsert).toHaveBeenCalledTimes(2);
    expect(
      showUpserts
        .map(([args]) => args.create.tvdbId)
        .sort((left, right) => left - right),
    ).toEqual([101, 202]);

    expect(
      prisma.watchedMovieRecommendationLibrary.createMany,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: [
          expect.objectContaining({ tmdbId: 20, plexUserId: 'plex-shared' }),
        ],
      }),
    );
    expect(
      prisma.watchedMovieRecommendationLibrary.createMany,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: [
          expect.objectContaining({ tmdbId: 10, plexUserId: 'plex-admin' }),
          expect.objectContaining({ tmdbId: 20, plexUserId: 'plex-admin' }),
        ],
      }),
    );
    expect(
      prisma.watchedShowRecommendationLibrary.createMany,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: [
          expect.objectContaining({ tvdbId: 202, plexUserId: 'plex-shared' }),
        ],
      }),
    );
    expect(
      prisma.watchedShowRecommendationLibrary.createMany,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: [
          expect.objectContaining({ tvdbId: 101, plexUserId: 'plex-admin' }),
          expect.objectContaining({ tvdbId: 202, plexUserId: 'plex-admin' }),
        ],
      }),
    );

    expect(watchedRefresher.refresh).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        plexUserId: 'plex-shared',
        pinTarget: 'friends',
        pinVisibilityProfile: 'shared_home_only',
        movieCollectionBaseNames: [
          FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
        ],
        tvCollectionBaseNames: [
          FRESH_OUT_OF_THE_OVEN_SHOW_COLLECTION_BASE_NAME,
        ],
        movieCollectionHubOrder:
          buildFreshOutMovieCollectionHubOrder('Shared User'),
        tvCollectionHubOrder:
          buildFreshOutShowCollectionHubOrder('Shared User'),
        limit: null,
      }),
    );
    expect(watchedRefresher.refresh).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        plexUserId: 'plex-admin',
        pinTarget: 'admin',
        pinVisibilityProfile: 'home_only',
        movieCollectionBaseNames: [
          FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
        ],
        tvCollectionBaseNames: [
          FRESH_OUT_OF_THE_OVEN_SHOW_COLLECTION_BASE_NAME,
        ],
        movieCollectionHubOrder: buildFreshOutMovieCollectionHubOrder('Admin'),
        tvCollectionHubOrder: buildFreshOutShowCollectionHubOrder('Admin'),
        limit: null,
      }),
    );
  });

  it('runs TV-only mode, skips missing tmdbId rows, excludes watched shows, and cleans up movie Fresh Out rows', async () => {
    const movieSection = { key: 'movies', title: 'Movies', type: 'movie' };
    const showSection = { key: 'shows', title: 'Shows', type: 'show' };
    const adminUser = {
      id: 'plex-admin',
      plexAccountId: 1,
      plexAccountTitle: 'Admin',
      isAdmin: true,
      lastSeenAt: new Date('2026-03-17T12:00:00.000Z'),
    };

    const prisma = createPrismaMock();
    prisma.freshReleaseMovieLibrary.deleteMany
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValue({ count: 0 });
    prisma.watchedMovieRecommendationLibrary.deleteMany
      .mockResolvedValueOnce({ count: 4 })
      .mockResolvedValue({ count: 0 });

    const settingsService = {
      getInternalSettings: jest.fn().mockResolvedValue({
        settings: {
          plex: { baseUrl: 'http://plex.local:32400' },
          jobs: {
            freshOutOfTheOven: { includeMovies: false, includeShows: true },
          },
        },
        secrets: {
          plex: { token: 'plex-token' },
          tmdb: { apiKey: 'tmdb-key' },
        },
      }),
    };
    const plexServer = {
      getSections: jest.fn().mockResolvedValue([movieSection, showSection]),
      getMachineIdentifier: jest.fn().mockResolvedValue('machine-1'),
      listMoviesWithTmdbIdsForSectionKey: jest.fn(),
      listShowsWithTvdbIdsForSectionKey: jest.fn().mockResolvedValue([
        {
          ratingKey: 'show-101',
          title: 'Show A',
          tvdbId: 101,
          tmdbId: 1001,
          addedAt: null,
          year: 2026,
        },
        {
          ratingKey: 'show-202',
          title: 'Show Old',
          tvdbId: 202,
          tmdbId: 2002,
          addedAt: null,
          year: 2025,
        },
        {
          ratingKey: 'show-303',
          title: 'Show Missing TMDB',
          tvdbId: 303,
          tmdbId: null,
          addedAt: null,
          year: 2026,
        },
        {
          ratingKey: 'show-404',
          title: 'Show B',
          tvdbId: 404,
          tmdbId: 4004,
          addedAt: null,
          year: 2026,
        },
      ]),
      listWatchedShowTvdbIdsForSectionKey: jest.fn().mockResolvedValue([101]),
    };
    const plexService = {
      listSharedUsersWithAccessTokensForServer: jest.fn().mockResolvedValue([]),
    };
    const plexUsers = {
      ensureAdminPlexUser: jest.fn().mockResolvedValue(adminUser),
      getOrCreateByPlexAccount: jest.fn(),
    };
    const tmdb = {
      getMovie: jest.fn(),
      getTv: jest.fn().mockImplementation(({ tmdbId }: { tmdbId: number }) => {
        if (tmdbId === 1001) {
          return Promise.resolve({
            id: 1001,
            name: 'Show A',
            first_air_date: '2026-03-10',
            poster_path: '/show-a.jpg',
            vote_average: 7.4,
            vote_count: 80,
          });
        }
        if (tmdbId === 4004) {
          return Promise.resolve({
            id: 4004,
            name: 'Show B',
            first_air_date: '2026-02-12',
            poster_path: '/show-b.jpg',
            vote_average: 8.0,
            vote_count: 65,
          });
        }
        return Promise.resolve({
          id: 2002,
          name: 'Show Old',
          first_air_date: '2025-10-01',
          poster_path: '/show-old.jpg',
          vote_average: 6.1,
          vote_count: 22,
        });
      }),
    };
    const watchedRefresher = {
      refresh: jest.fn().mockResolvedValue({ ok: true }),
    };

    const job = new FreshOutOfTheOvenJob(
      prisma as never,
      settingsService as never,
      plexServer as never,
      plexService as never,
      plexUsers as never,
      tmdb as never,
      watchedRefresher as never,
    );

    await job.run(createCtx());

    expect(prisma.freshReleaseMovieLibrary.deleteMany).toHaveBeenCalledTimes(1);
    expect(
      prisma.watchedMovieRecommendationLibrary.deleteMany,
    ).toHaveBeenNthCalledWith(1, {
      where: {
        collectionName: FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
      },
    });
    expect(
      plexServer.listMoviesWithTmdbIdsForSectionKey,
    ).not.toHaveBeenCalled();

    const showUpserts = prisma.freshReleaseShowLibrary.upsert.mock
      .calls as Array<[ShowUpsertArgs]>;
    expect(prisma.freshReleaseShowLibrary.upsert).toHaveBeenCalledTimes(2);
    expect(
      showUpserts
        .map(([args]) => args.create.tvdbId)
        .sort((left, right) => left - right),
    ).toEqual([101, 404]);

    expect(
      prisma.watchedShowRecommendationLibrary.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            tvdbId: 404,
            plexUserId: 'plex-admin',
          }),
        ],
      }),
    );
    expect(watchedRefresher.refresh).toHaveBeenCalledWith(
      expect.objectContaining({
        plexUserId: 'plex-admin',
        movieCollectionBaseNames: [
          FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
        ],
        tvCollectionBaseNames: [
          FRESH_OUT_OF_THE_OVEN_SHOW_COLLECTION_BASE_NAME,
        ],
        tvCollectionHubOrder: buildFreshOutShowCollectionHubOrder('Admin'),
        pinVisibilityProfile: 'home_only',
      }),
    );
  });

  it('runs movie-only mode and cleans up TV Fresh Out rows', async () => {
    const movieSection = { key: 'movies', title: 'Movies', type: 'movie' };
    const showSection = { key: 'shows', title: 'Shows', type: 'show' };
    const adminUser = {
      id: 'plex-admin',
      plexAccountId: 1,
      plexAccountTitle: 'Admin',
      isAdmin: true,
      lastSeenAt: new Date('2026-03-17T12:00:00.000Z'),
    };

    const prisma = createPrismaMock();
    prisma.freshReleaseShowLibrary.deleteMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValue({ count: 0 });
    prisma.watchedShowRecommendationLibrary.deleteMany
      .mockResolvedValueOnce({ count: 5 })
      .mockResolvedValue({ count: 0 });

    const settingsService = {
      getInternalSettings: jest.fn().mockResolvedValue({
        settings: {
          plex: { baseUrl: 'http://plex.local:32400' },
          jobs: {
            freshOutOfTheOven: { includeMovies: true, includeShows: false },
          },
        },
        secrets: {
          plex: { token: 'plex-token' },
          tmdb: { apiKey: 'tmdb-key' },
        },
      }),
    };
    const plexServer = {
      getSections: jest.fn().mockResolvedValue([movieSection, showSection]),
      getMachineIdentifier: jest.fn().mockResolvedValue('machine-1'),
      listMoviesWithTmdbIdsForSectionKey: jest.fn().mockResolvedValue([
        {
          ratingKey: '10',
          title: 'Movie A',
          tmdbId: 10,
          addedAt: null,
          year: 2026,
        },
      ]),
      listShowsWithTvdbIdsForSectionKey: jest.fn(),
      listWatchedMovieTmdbIdsForSectionKey: jest.fn().mockResolvedValue([]),
    };
    const plexService = {
      listSharedUsersWithAccessTokensForServer: jest.fn().mockResolvedValue([]),
    };
    const plexUsers = {
      ensureAdminPlexUser: jest.fn().mockResolvedValue(adminUser),
      getOrCreateByPlexAccount: jest.fn(),
    };
    const tmdb = {
      getMovie: jest.fn().mockResolvedValue({
        id: 10,
        title: 'Movie A',
        release_date: '2026-03-01',
        poster_path: '/a.jpg',
        vote_average: 7.1,
        vote_count: 100,
      }),
      getTv: jest.fn(),
    };
    const watchedRefresher = {
      refresh: jest.fn().mockResolvedValue({ ok: true }),
    };

    const job = new FreshOutOfTheOvenJob(
      prisma as never,
      settingsService as never,
      plexServer as never,
      plexService as never,
      plexUsers as never,
      tmdb as never,
      watchedRefresher as never,
    );

    await job.run(createCtx());

    expect(prisma.freshReleaseShowLibrary.deleteMany).toHaveBeenCalledTimes(1);
    expect(
      prisma.watchedShowRecommendationLibrary.deleteMany,
    ).toHaveBeenNthCalledWith(1, {
      where: {
        collectionName: FRESH_OUT_OF_THE_OVEN_SHOW_COLLECTION_BASE_NAME,
      },
    });
    expect(plexServer.listShowsWithTvdbIdsForSectionKey).not.toHaveBeenCalled();
    expect(
      prisma.watchedMovieRecommendationLibrary.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ tmdbId: 10, plexUserId: 'plex-admin' }),
        ],
      }),
    );
    expect(watchedRefresher.refresh).toHaveBeenCalledWith(
      expect.objectContaining({
        plexUserId: 'plex-admin',
        movieCollectionBaseNames: [
          FRESH_OUT_OF_THE_OVEN_MOVIE_COLLECTION_BASE_NAME,
        ],
        tvCollectionBaseNames: [
          FRESH_OUT_OF_THE_OVEN_SHOW_COLLECTION_BASE_NAME,
        ],
        movieCollectionHubOrder: buildFreshOutMovieCollectionHubOrder('Admin'),
        pinVisibilityProfile: 'home_only',
      }),
    );
  });

  it('skips and warns when both categories are disabled in settings', async () => {
    const ctx = createCtx();
    const prisma = createPrismaMock();
    const settingsService = {
      getInternalSettings: jest.fn().mockResolvedValue({
        settings: {
          plex: { baseUrl: 'http://plex.local:32400' },
          jobs: {
            freshOutOfTheOven: { includeMovies: false, includeShows: false },
          },
        },
        secrets: {
          plex: { token: 'plex-token' },
          tmdb: { apiKey: 'tmdb-key' },
        },
      }),
    };

    const job = new FreshOutOfTheOvenJob(
      prisma as never,
      settingsService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await job.run(ctx);

    expect(result.summary).toMatchObject({
      skipped: true,
      reason: 'all_categories_disabled',
      settings: { includeMovies: false, includeShows: false },
    });
    expect(ctx.warn).toHaveBeenCalledWith(
      'freshOutOfTheOven: skipping run because all categories are disabled',
      { includeMovies: false, includeShows: false },
    );
  });
});
