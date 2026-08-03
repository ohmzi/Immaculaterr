import { CuttingRoomAnalysisService } from './cutting-room-analysis.service';
import { DEFAULT_CUTTING_ROOM_RULES } from './cutting-room-scoring';

type AnyFn = jest.Mock;

const NOW_SEC = Math.floor(Date.now() / 1000);
const THREE_YEARS_SEC = NOW_SEC - 3 * 365 * 86400;

function makeMocks(overrides?: {
  plexItems?: Array<Record<string, unknown>>;
  radarrMovies?: Array<Record<string, unknown>>;
  plexHistory?: Array<Record<string, unknown>>;
  watchlist?: Array<Record<string, unknown>>;
}) {
  const plexItems = overrides?.plexItems ?? [
    {
      // Never watched, tracked by Radarr, low rating with many votes.
      ratingKey: '100',
      librarySectionKey: '1',
      mediaType: 'movie',
      title: 'Old Junk',
      year: 2015,
      addedAt: THREE_YEARS_SEC,
      viewCount: 0,
      lastViewedAt: null,
      viewOffset: null,
      durationMs: null,
      rating: null,
      audienceRating: null,
      userRating: null,
      leafCount: null,
      viewedLeafCount: null,
      tmdbId: 111,
      tvdbId: null,
      totalSizeBytes: 5_000_000_000,
      fileCount: 1,
      firstFilePath: '/media/movies/Old Junk (2015)/file.mkv',
    },
    {
      // Plex-only (no arr match), never watched.
      ratingKey: '200',
      librarySectionKey: '1',
      mediaType: 'movie',
      title: 'Untracked Thing',
      year: 2016,
      addedAt: THREE_YEARS_SEC,
      viewCount: 0,
      lastViewedAt: null,
      viewOffset: null,
      durationMs: null,
      rating: null,
      audienceRating: 6.9,
      userRating: null,
      leafCount: null,
      viewedLeafCount: null,
      tmdbId: 222,
      tvdbId: null,
      totalSizeBytes: 2_000_000_000,
      fileCount: 1,
      firstFilePath: '/media/movies/Untracked Thing (2016)/file.mkv',
    },
    {
      // Watched via server history only (viewCount 0) -> protected.
      ratingKey: '300',
      librarySectionKey: '1',
      mediaType: 'movie',
      title: 'History Watched',
      year: 2018,
      addedAt: THREE_YEARS_SEC,
      viewCount: 0,
      lastViewedAt: null,
      viewOffset: null,
      durationMs: null,
      rating: null,
      audienceRating: null,
      userRating: null,
      leafCount: null,
      viewedLeafCount: null,
      tmdbId: 333,
      tvdbId: null,
      totalSizeBytes: 1_000_000_000,
      fileCount: 1,
      firstFilePath: '/media/movies/History Watched (2018)/file.mkv',
    },
  ];

  const radarrMovies = overrides?.radarrMovies ?? [
    {
      id: 42,
      title: 'Old Junk',
      year: 2015,
      tmdbId: 111,
      monitored: false,
      hasFile: true,
      status: 'released',
      path: '/data/movies/Old Junk (2015)',
      rootFolderPath: '/data/movies',
      sizeOnDisk: 5_100_000_000,
      tags: [7],
      ratings: {
        imdb: { value: 4.0, votes: 9000 },
        tmdb: { value: 5.0, votes: 800 },
      },
    },
  ];

  const prisma = {
    cuttingRoomSnapshot: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: 'snap1',
          userId: 'user1',
          mediaType: 'movie',
          status: 'RUNNING',
          rulesJson: DEFAULT_CUTTING_ROOM_RULES,
          sectionKeys: { sections: ['1'], instances: [] },
          createdAt: new Date(),
        }),
      ),
      update: jest.fn(() => Promise.resolve({})),
      findMany: jest.fn(() => Promise.resolve([])),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    cuttingRoomCandidate: {
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
      createMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    importedWatchEntry: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
    curatedCollectionItem: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
  };

  const settingsService = {
    getInternalSettings: jest.fn(() =>
      Promise.resolve({
        settings: { plex: { baseUrl: 'http://plex:32400' } },
        secrets: { plex: { token: 'token' } },
      }),
    ),
  };

  const arrInstances = {
    resolveInstance: jest.fn(() =>
      Promise.resolve({
        id: 'primary-radarr',
        baseUrl: 'http://radarr:7878',
        apiKey: 'key',
      }),
    ),
  };

  const plexServer = {
    listSectionItemsForCuttingRoom: jest.fn(() => Promise.resolve(plexItems)),
    getWatchHistory: jest.fn(() =>
      Promise.resolve(overrides?.plexHistory ?? []),
    ),
    getOnDeck: jest.fn(() => Promise.resolve([])),
  };

  const plexWatchlist = {
    listWatchlist: jest.fn(() =>
      Promise.resolve({
        ok: true,
        baseUrl: '',
        items: overrides?.watchlist ?? [],
      }),
    ),
  };

  const radarr = {
    listMovies: jest.fn(() => Promise.resolve(radarrMovies)),
    listTags: jest.fn(() => Promise.resolve([{ id: 7, label: 'guest' }])),
  };
  const sonarr = {
    listSeries: jest.fn(() => Promise.resolve([])),
    listTags: jest.fn(() => Promise.resolve([])),
  };
  const seerr = {
    listRecentRequests: jest.fn(() => Promise.resolve([])),
  };
  const tautulli = {
    getLibraryMediaInfo: jest.fn(() => Promise.resolve([])),
    getHistory: jest.fn(() => Promise.resolve([])),
  };

  const service = new CuttingRoomAnalysisService(
    prisma as never,
    settingsService as never,
    arrInstances as never,
    plexServer as never,
    plexWatchlist as never,
    radarr as never,
    sonarr as never,
    seerr as never,
    tautulli as never,
  );

  return { service, prisma, plexServer, radarr };
}

const runParams = {
  userId: 'user1',
  snapshotId: 'snap1',
  progress: () => undefined,
  log: { info: async () => undefined, warn: async () => undefined },
};

describe('CuttingRoomAnalysisService', () => {
  it('joins Plex items to Radarr by tmdbId and blends ratings with votes', async () => {
    const { service, prisma } = makeMocks();
    const summary = await service.runAnalysis(runParams);

    expect(summary.libraryCount).toBe(3);
    const rows = (prisma.cuttingRoomCandidate.createMany as AnyFn).mock
      .calls[0][0].data as Array<Record<string, unknown>>;

    const tracked = rows.find((r) => r['plexRatingKey'] === '100');
    expect(tracked).toBeDefined();
    expect(tracked?.['arrId']).toBe(42);
    expect(tracked?.['monitored']).toBe(false);
    // Blend of imdb 4.0 + tmdb 5.0 = 4.5 (no plex audience rating present).
    expect(tracked?.['rating']).toBeCloseTo(4.5, 5);
    // Guest tag resolved from arr tag ids → provenance reason present.
    const reasons = (tracked?.['reasonsJson'] ?? []) as Array<{
      code: string;
    }>;
    expect(reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(['guest_request', 'low_rating']),
    );
    // Size prefers the larger of Plex vs arr sizeOnDisk.
    expect(Number(tracked?.['sizeBytes'])).toBe(5_100_000_000);
  });

  it('marks unmatched items as plex-only candidates', async () => {
    const { service, prisma } = makeMocks();
    await service.runAnalysis(runParams);
    const rows = (prisma.cuttingRoomCandidate.createMany as AnyFn).mock
      .calls[0][0].data as Array<Record<string, unknown>>;
    const untracked = rows.find((r) => r['plexRatingKey'] === '200');
    expect(untracked?.['arrId']).toBeNull();
    expect(untracked?.['confidence']).toBe('plex_only');
  });

  it('treats server-history plays as watched (union) and protects them', async () => {
    const { service, prisma } = makeMocks({
      plexHistory: [
        {
          ratingKey: '300',
          grandparentRatingKey: null,
          type: 'movie',
          accountId: 1,
          viewedAt: NOW_SEC - 10 * 86400,
        },
      ],
    });
    const summary = await service.runAnalysis(runParams);
    const rows = (prisma.cuttingRoomCandidate.createMany as AnyFn).mock
      .calls[0][0].data as Array<Record<string, unknown>>;
    expect(rows.find((r) => r['plexRatingKey'] === '300')).toBeUndefined();
    expect(summary.protectedAgg['watched_recently']).toBe(1);
  });

  it('protects watchlist items by title+year', async () => {
    const { service, prisma } = makeMocks({
      watchlist: [
        { ratingKey: 'x', title: 'Untracked Thing', year: 2016, type: 'movie' },
      ],
    });
    const summary = await service.runAnalysis(runParams);
    const rows = (prisma.cuttingRoomCandidate.createMany as AnyFn).mock
      .calls[0][0].data as Array<Record<string, unknown>>;
    expect(rows.find((r) => r['plexRatingKey'] === '200')).toBeUndefined();
    expect(summary.protectedAgg['on_watchlist']).toBe(1);
  });

  it('finalizes the snapshot with aggregates', async () => {
    const { service, prisma } = makeMocks();
    await service.runAnalysis(runParams);
    const update = (prisma.cuttingRoomSnapshot.update as AnyFn).mock.calls.find(
      (call) => call[0]?.data?.status === 'READY',
    );
    expect(update).toBeDefined();
    expect(update[0].data.candidateCount).toBeGreaterThan(0);
    expect(update[0].data.libraryCount).toBe(3);
  });
});
