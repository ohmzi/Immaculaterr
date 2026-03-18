import { FreshOutOfTheOvenJob } from './fresh-out-of-the-oven.job';
import type { JobContext, JsonObject } from './jobs.types';

type FreshReleaseUpsertArgs = {
  create: {
    tmdbId: number;
  };
};

function createCtx(): JobContext {
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

  it('builds a recent-release baseline, filters watched titles per user, and uses home-only visibility for Fresh Out', async () => {
    const section = { key: 'movies', title: 'Movies', type: 'movie' };
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

    const prisma = {
      freshReleaseMovieLibrary: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      watchedMovieRecommendationLibrary: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };

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
      getSections: jest
        .fn()
        .mockResolvedValueOnce([section])
        .mockResolvedValueOnce([section]),
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
      listWatchedMovieTmdbIdsForSectionKey: jest
        .fn()
        .mockResolvedValueOnce([10])
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

    const upsertCalls = prisma.freshReleaseMovieLibrary.upsert.mock
      .calls as Array<[FreshReleaseUpsertArgs]>;

    expect(prisma.freshReleaseMovieLibrary.upsert).toHaveBeenCalledTimes(2);
    expect(
      upsertCalls
        .map(([args]) => args.create.tmdbId)
        .sort((left, right) => left - right),
    ).toEqual([10, 20]);

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

    expect(watchedRefresher.refresh).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        plexUserId: 'plex-shared',
        pinTarget: 'friends',
        pinVisibilityProfile: 'shared_home_only',
        movieCollectionBaseNames: ['Fresh Out Of The Oven'],
        limit: null,
      }),
    );
    expect(watchedRefresher.refresh).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        plexUserId: 'plex-admin',
        pinTarget: 'admin',
        pinVisibilityProfile: 'home_only',
        movieCollectionBaseNames: ['Fresh Out Of The Oven'],
        limit: null,
      }),
    );
  });

  it('skips shared users when Plex does not provide a trustworthy per-user token', async () => {
    const section = { key: 'movies', title: 'Movies', type: 'movie' };
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

    const prisma = {
      freshReleaseMovieLibrary: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      watchedMovieRecommendationLibrary: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };

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
      getSections: jest.fn().mockResolvedValue([section]),
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
      listWatchedMovieTmdbIdsForSectionKey: jest.fn().mockResolvedValue([]),
    };

    const plexService = {
      listSharedUsersWithAccessTokensForServer: jest.fn().mockResolvedValue([
        {
          plexAccountId: 2,
          plexAccountTitle: 'Shared User',
          username: 'shared',
          email: null,
          accessToken: null,
          isHomeUser: true,
        },
      ]),
    };

    const plexUsers = {
      ensureAdminPlexUser: jest.fn().mockResolvedValue(adminUser),
      getOrCreateByPlexAccount: jest.fn().mockResolvedValue(sharedUser),
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

    expect(watchedRefresher.refresh).toHaveBeenCalledTimes(1);
    expect(watchedRefresher.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ plexUserId: 'plex-admin' }),
    );
  });
});
