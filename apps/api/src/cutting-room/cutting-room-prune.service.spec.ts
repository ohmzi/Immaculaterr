import { CuttingRoomPruneService } from './cutting-room-prune.service';
import { DEFAULT_CUTTING_ROOM_RULES } from './cutting-room-scoring';

type AnyFn = jest.Mock;

function makeMocks(overrides?: {
  candidates?: Array<Record<string, unknown>>;
  stopAfterFirstCheck?: boolean;
}) {
  const candidates = overrides?.candidates ?? [
    {
      id: 'c1',
      mediaType: 'movie',
      title: 'Unwatched Movie',
      year: 2019,
      sizeBytes: BigInt(5_000_000_000),
      plexRatingKey: '101',
      librarySectionKey: '1',
      tmdbId: 111,
      tvdbId: null,
      arrInstanceId: 'primary-radarr',
      arrId: 42,
      rootFolderPath: '/data/movies',
      path: '/data/movies/Unwatched Movie (2019)',
      watchStatus: 'never',
    },
  ];

  let stopReads = 0;
  const prisma = {
    cuttingRoomSnapshot: {
      findUnique: jest.fn(
        (args: { where: { id: string }; select?: unknown }) => {
          if (
            args.select &&
            (args.select as { stopRequested?: boolean }).stopRequested
          ) {
            stopReads += 1;
            return Promise.resolve({
              stopRequested: overrides?.stopAfterFirstCheck
                ? stopReads > 0
                : false,
            });
          }
          return Promise.resolve({
            id: 'snap1',
            userId: 'user1',
            mediaType: 'movie',
            status: 'READY',
            createdAt: new Date(Date.now() - 3_600_000),
            rulesJson: DEFAULT_CUTTING_ROOM_RULES,
          });
        },
      ),
      update: jest.fn(() => Promise.resolve({})),
    },
    cuttingRoomCandidate: {
      findMany: jest.fn(() => Promise.resolve(candidates)),
      update: jest.fn(() => Promise.resolve({})),
      count: jest.fn(() => Promise.resolve(0)),
    },
    pruneRecord: {
      create: jest.fn(() => Promise.resolve({})),
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
    listSectionItemsForCuttingRoom: jest.fn(() =>
      Promise.resolve([
        {
          ratingKey: '101',
          viewCount: 0,
          viewedLeafCount: null,
          lastViewedAt: null,
        },
      ]),
    ),
    getSectionLocations: jest.fn(() => Promise.resolve(new Map())),
    refreshLibraryPath: jest.fn(() => Promise.resolve()),
    deleteMetadataByRatingKey: jest.fn(() => Promise.resolve()),
  };

  const radarr = {
    listMovies: jest.fn(() =>
      Promise.resolve([{ id: 42, movieFileId: 7, hasFile: true }]),
    ),
    listTags: jest.fn(() =>
      Promise.resolve([{ id: 9, label: 'deleted-by-immaculaterr' }]),
    ),
    createTag: jest.fn(() =>
      Promise.resolve({ id: 9, label: 'deleted-by-immaculaterr' }),
    ),
    updateMoviesEditor: jest.fn(() => Promise.resolve(true)),
    deleteMovieFile: jest.fn(() => Promise.resolve(true)),
    deleteMovie: jest.fn(() => Promise.resolve(true)),
  };

  const sonarr = {
    listSeries: jest.fn(() => Promise.resolve([])),
    listTags: jest.fn(() => Promise.resolve([])),
    createTag: jest.fn(() =>
      Promise.resolve({ id: 9, label: 'deleted-by-immaculaterr' }),
    ),
    updateSeriesEditor: jest.fn(() => Promise.resolve(true)),
    getEpisodeFiles: jest.fn(() => Promise.resolve([])),
    deleteEpisodeFilesBulk: jest.fn(() => Promise.resolve(true)),
    deleteEpisodeFile: jest.fn(() => Promise.resolve(true)),
  };

  const service = new CuttingRoomPruneService(
    prisma as never,
    settingsService as never,
    arrInstances as never,
    plexServer as never,
    radarr as never,
    sonarr as never,
  );

  return { service, prisma, radarr, sonarr, plexServer };
}

const baseParams = {
  userId: 'user1',
  snapshotId: 'snap1',
  runId: 'run1',
  waveSize: 25,
  removeEntry: false,
  addImportExclusion: false,
  progress: () => undefined,
  log: {
    info: async () => undefined,
    warn: async () => undefined,
  },
};

describe('CuttingRoomPruneService', () => {
  it('dry-run performs ZERO mutating calls anywhere', async () => {
    const { service, prisma, radarr, sonarr, plexServer } = makeMocks();

    const summary = await service.runPrune({ ...baseParams, dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(summary.pruned).toBe(1);
    expect(summary.wouldDelete.length).toBe(1);

    // Arr mutations
    expect(radarr.createTag).not.toHaveBeenCalled();
    expect(radarr.updateMoviesEditor).not.toHaveBeenCalled();
    expect(radarr.deleteMovieFile).not.toHaveBeenCalled();
    expect(radarr.deleteMovie).not.toHaveBeenCalled();
    expect(sonarr.updateSeriesEditor).not.toHaveBeenCalled();
    expect(sonarr.deleteEpisodeFilesBulk).not.toHaveBeenCalled();
    expect(sonarr.deleteEpisodeFile).not.toHaveBeenCalled();
    // Plex mutations
    expect(plexServer.deleteMetadataByRatingKey).not.toHaveBeenCalled();
    expect(plexServer.refreshLibraryPath).not.toHaveBeenCalled();
    // Persistence mutations (ledger + status flips)
    expect(prisma.pruneRecord.create).not.toHaveBeenCalled();
    expect(prisma.cuttingRoomCandidate.update).not.toHaveBeenCalled();
    expect(prisma.cuttingRoomSnapshot.update).not.toHaveBeenCalled();
  });

  it('real run deletes the file, tags, unmonitors, and writes the ledger', async () => {
    const { service, prisma, radarr } = makeMocks();

    const summary = await service.runPrune({ ...baseParams, dryRun: false });

    expect(summary.pruned).toBe(1);
    expect(radarr.updateMoviesEditor).toHaveBeenCalledTimes(1);
    const editorArgs = (radarr.updateMoviesEditor as AnyFn).mock.calls[0][0];
    expect(editorArgs.monitored).toBe(false);
    expect(editorArgs.tags).toEqual([9]);
    expect(radarr.deleteMovieFile).toHaveBeenCalledWith(
      expect.objectContaining({ movieFileId: 7 }),
    );
    expect(radarr.deleteMovie).not.toHaveBeenCalled(); // keep-entry default
    expect(prisma.pruneRecord.create).toHaveBeenCalledTimes(1);
    const record = (prisma.pruneRecord.create as AnyFn).mock.calls[0][0].data;
    expect(record.action).toBe('files_deleted_unmonitored');
    expect(record.tagApplied).toBe(true);
  });

  it('skips items watched since the scan (stale)', async () => {
    const { service, prisma, radarr, plexServer } = makeMocks();
    (plexServer.listSectionItemsForCuttingRoom as AnyFn).mockResolvedValue([
      {
        ratingKey: '101',
        viewCount: 2, // watched since analysis
        viewedLeafCount: null,
        lastViewedAt: Math.floor(Date.now() / 1000),
      },
    ]);

    const summary = await service.runPrune({ ...baseParams, dryRun: false });

    expect(summary.skippedStale).toBe(1);
    expect(summary.pruned).toBe(0);
    expect(radarr.deleteMovieFile).not.toHaveBeenCalled();
    expect(prisma.pruneRecord.create).not.toHaveBeenCalled();
  });

  it('skips Plex-only items when plex-only deletes are disabled', async () => {
    const { service, radarr, plexServer } = makeMocks({
      candidates: [
        {
          id: 'c2',
          mediaType: 'movie',
          title: 'Untracked Movie',
          year: 2018,
          sizeBytes: BigInt(1_000_000_000),
          plexRatingKey: '202',
          librarySectionKey: '1',
          tmdbId: null,
          tvdbId: null,
          arrInstanceId: null,
          arrId: null,
          rootFolderPath: null,
          path: null,
          watchStatus: 'never',
        },
      ],
    });
    (plexServer.listSectionItemsForCuttingRoom as AnyFn).mockResolvedValue([
      {
        ratingKey: '202',
        viewCount: 0,
        viewedLeafCount: null,
        lastViewedAt: null,
      },
    ]);

    const summary = await service.runPrune({ ...baseParams, dryRun: false });

    expect(summary.skippedPlexOnly).toBe(1);
    expect(summary.pruned).toBe(0);
    expect(plexServer.deleteMetadataByRatingKey).not.toHaveBeenCalled();
    expect(radarr.deleteMovieFile).not.toHaveBeenCalled();
  });

  it('stops between waves when stopRequested is set', async () => {
    const many = Array.from({ length: 4 }, (_, i) => ({
      id: `c${i}`,
      mediaType: 'movie',
      title: `Movie ${i}`,
      year: 2019,
      sizeBytes: BigInt(1_000_000_000),
      plexRatingKey: `10${i}`,
      librarySectionKey: '1',
      tmdbId: 100 + i,
      tvdbId: null,
      arrInstanceId: 'primary-radarr',
      arrId: 40 + i,
      rootFolderPath: '/data/movies',
      path: `/data/movies/Movie ${i}`,
      watchStatus: 'never',
    }));
    const { service, radarr, plexServer } = makeMocks({
      candidates: many,
      stopAfterFirstCheck: true,
    });
    (plexServer.listSectionItemsForCuttingRoom as AnyFn).mockResolvedValue(
      many.map((c) => ({
        ratingKey: c.plexRatingKey,
        viewCount: 0,
        viewedLeafCount: null,
        lastViewedAt: null,
      })),
    );

    const summary = await service.runPrune({
      ...baseParams,
      dryRun: false,
      waveSize: 2,
    });

    expect(summary.stopped).toBe(true);
    expect(summary.pruned).toBe(0);
    expect(radarr.deleteMovieFile).not.toHaveBeenCalled();
  });

  it('enforces the per-run item cap', async () => {
    const many = Array.from({ length: 3 }, (_, i) => ({
      id: `c${i}`,
      mediaType: 'movie',
      title: `Movie ${i}`,
      year: 2019,
      sizeBytes: BigInt(1_000_000_000),
      plexRatingKey: `10${i}`,
      librarySectionKey: '1',
      tmdbId: 100 + i,
      tvdbId: null,
      arrInstanceId: 'primary-radarr',
      arrId: 40 + i,
      rootFolderPath: '/data/movies',
      path: `/data/movies/Movie ${i}`,
      watchStatus: 'never',
    }));
    const { service, prisma } = makeMocks({ candidates: many });
    (prisma.cuttingRoomSnapshot.findUnique as AnyFn).mockImplementation(
      (args: { select?: unknown }) => {
        if (args.select) return Promise.resolve({ stopRequested: false });
        return Promise.resolve({
          id: 'snap1',
          userId: 'user1',
          mediaType: 'movie',
          status: 'READY',
          createdAt: new Date(),
          rulesJson: { ...DEFAULT_CUTTING_ROOM_RULES, maxItemsPerRun: 2 },
        });
      },
    );

    await expect(
      service.runPrune({ ...baseParams, dryRun: false }),
    ).rejects.toThrow(/per-run cap/);
  });
});
