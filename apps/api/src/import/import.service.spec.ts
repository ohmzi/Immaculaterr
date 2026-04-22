import { Test, TestingModule } from '@nestjs/testing';
import { ImportService } from './import.service';
import { PrismaService } from '../db/prisma.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { SettingsService } from '../settings/settings.service';
import { WatchedCollectionsRefresherService } from '../watched-movie-recommendations/watched-collections-refresher.service';
import { PlexServerService } from '../plex/plex-server.service';
import { ImmaculateTasteCollectionService } from '../immaculate-taste-collection/immaculate-taste-collection.service';
import { ImmaculateTasteShowCollectionService } from '../immaculate-taste-collection/immaculate-taste-show-collection.service';
import type { JobContext } from '../jobs/jobs.types';

function mockJobContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobId: 'importPlexHistory',
    userId: 'test-user-id',
    dryRun: false,
    trigger: 'manual',
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    patchSummary: jest.fn(),
    setSummary: jest.fn(),
    ...overrides,
  } as unknown as JobContext;
}

function buildTransientTmdbSeedError(): Error {
  return new Error(
    'TMDB request failed: HTTP 500 {"success":false,"status_code":11,"status_message":"Internal error: Something went wrong, contact TMDb."}',
  );
}

type ImportedWatchEntryMock = {
  findMany: jest.Mock;
  create: jest.Mock;
  createMany: jest.Mock;
  updateMany: jest.Mock;
  count: jest.Mock;
  groupBy: jest.Mock;
  update: jest.Mock;
};

type PrismaMock = {
  importedWatchEntry: ImportedWatchEntryMock;
  plexUser: { findMany: jest.Mock };
  immaculateTasteMovieLibrary: { findMany: jest.Mock };
  immaculateTasteShowLibrary: { findMany: jest.Mock };
};

type CreateEntryCall = {
  data: {
    source: string;
    status: string;
    mediaType: string;
    tmdbId: number;
    tvdbId?: number | null;
  };
};

type FindManyCall = {
  where?: {
    source?: string;
    status?: string;
  };
};

describe('ImportService', () => {
  let service: ImportService;
  let prisma: PrismaMock;
  let settingsService: { getInternalSettings: jest.Mock };
  let recommendations: {
    buildSimilarMovieTitles: jest.Mock;
    buildChangeOfTasteMovieTitles: jest.Mock;
    buildSimilarTvTitles: jest.Mock;
    buildChangeOfTasteTvTitles: jest.Mock;
  };
  let watchedRefresher: { refresh: jest.Mock };
  let plexServer: Record<string, jest.Mock>;
  let immaculateTaste: { applyPointsUpdate: jest.Mock };
  let immaculateTasteTv: { applyPointsUpdate: jest.Mock };

  beforeEach(async () => {
    prisma = {
      importedWatchEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      plexUser: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'admin-1', plexAccountTitle: 'Admin', isAdmin: true },
          ]),
      },
      immaculateTasteMovieLibrary: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      immaculateTasteShowLibrary: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    recommendations = {
      buildSimilarMovieTitles: jest.fn(),
      buildChangeOfTasteMovieTitles: jest.fn(),
      buildSimilarTvTitles: jest.fn(),
      buildChangeOfTasteTvTitles: jest.fn(),
    };

    watchedRefresher = {
      refresh: jest.fn().mockResolvedValue(undefined),
    };

    settingsService = {
      getInternalSettings: jest.fn().mockResolvedValue({
        settings: {
          plex: { baseUrl: 'http://plex:32400', useHistory: true },
          recommendations: {
            count: 50,
            upcomingPercent: 25,
            collectionLimit: 100,
          },
        },
        secrets: {
          plex: { token: 'test-token' },
          tmdb: { apiKey: 'test-tmdb-key' },
        },
      }),
    };

    plexServer = {
      getSections: jest.fn().mockResolvedValue([
        { key: '1', title: 'Movies', type: 'movie' },
        { key: '2', title: 'TV Shows', type: 'show' },
      ]),
      listWatchedMovieDetailsForSectionKey: jest.fn().mockResolvedValue([]),
      listWatchedShowDetailsForSectionKey: jest.fn().mockResolvedValue([]),
      getMachineIdentifier: jest.fn().mockResolvedValue('abc123'),
    };

    immaculateTaste = {
      applyPointsUpdate: jest.fn().mockResolvedValue(undefined),
    };

    immaculateTasteTv = {
      applyPointsUpdate: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: TmdbService, useValue: {} },
        { provide: RecommendationsService, useValue: recommendations },
        { provide: SettingsService, useValue: settingsService },
        {
          provide: WatchedCollectionsRefresherService,
          useValue: watchedRefresher,
        },
        { provide: PlexServerService, useValue: plexServer },
        {
          provide: ImmaculateTasteCollectionService,
          useValue: immaculateTaste,
        },
        {
          provide: ImmaculateTasteShowCollectionService,
          useValue: immaculateTasteTv,
        },
      ],
    }).compile();

    service = module.get<ImportService>(ImportService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('fetchAndStorePlexHistory', () => {
    it('should store entries with source=plex, status=matched, and correct mediaType', async () => {
      plexServer.listWatchedMovieDetailsForSectionKey.mockResolvedValue([
        { tmdbId: 100, title: 'The Matrix', lastViewedAt: 1700000000 },
        { tmdbId: 200, title: 'Inception', lastViewedAt: 1700100000 },
      ]);
      plexServer.listWatchedShowDetailsForSectionKey.mockResolvedValue([
        {
          tmdbId: 300,
          tvdbId: 400,
          title: 'Breaking Bad',
          lastViewedAt: 1700200000,
        },
      ]);

      const ctx = mockJobContext();
      await service.fetchAndStorePlexHistory('test-user-id', ctx);

      expect(prisma.importedWatchEntry.create).toHaveBeenCalledTimes(3);

      const createCalls = prisma.importedWatchEntry.create.mock.calls as [
        CreateEntryCall,
      ][];
      const movieCall = createCalls[0][0];
      expect(movieCall.data.source).toBe('plex');
      expect(movieCall.data.status).toBe('matched');
      expect(movieCall.data.mediaType).toBe('movie');
      expect(movieCall.data.tmdbId).toBe(100);

      const tvCall = createCalls[2][0];
      expect(tvCall.data.source).toBe('plex');
      expect(tvCall.data.status).toBe('matched');
      expect(tvCall.data.mediaType).toBe('tv');
      expect(tvCall.data.tmdbId).toBe(300);
      expect(tvCall.data.tvdbId).toBe(400);
    });

    it('should deduplicate by tmdbId from pre-fetched existing entries', async () => {
      prisma.importedWatchEntry.findMany.mockResolvedValue([{ tmdbId: 100 }]);

      plexServer.listWatchedMovieDetailsForSectionKey.mockResolvedValue([
        { tmdbId: 100, title: 'The Matrix', lastViewedAt: 1700000000 },
        { tmdbId: 200, title: 'Inception', lastViewedAt: 1700100000 },
      ]);

      const ctx = mockJobContext();
      await service.fetchAndStorePlexHistory('test-user-id', ctx);

      expect(prisma.importedWatchEntry.create).toHaveBeenCalledTimes(1);
      const createCalls = prisma.importedWatchEntry.create.mock.calls as [
        CreateEntryCall,
      ][];
      const createCall = createCalls[0][0];
      expect(createCall.data.tmdbId).toBe(200);
    });

    it('should handle empty history gracefully', async () => {
      plexServer.listWatchedMovieDetailsForSectionKey.mockResolvedValue([]);
      plexServer.listWatchedShowDetailsForSectionKey.mockResolvedValue([]);

      const ctx = mockJobContext();
      await service.fetchAndStorePlexHistory('test-user-id', ctx);

      expect(prisma.importedWatchEntry.create).not.toHaveBeenCalled();
      expect(ctx.info).toHaveBeenCalledWith(
        'No watched items found in your Plex libraries.',
      );
    });

    it('should skip when plex.useHistory is false and trigger is not manual', async () => {
      settingsService.getInternalSettings.mockResolvedValue({
        settings: { plex: { baseUrl: 'http://plex:32400', useHistory: false } },
        secrets: { plex: { token: 'test-token' } },
      });

      const ctx = mockJobContext({ trigger: 'schedule' });
      await service.fetchAndStorePlexHistory('test-user-id', ctx);

      expect(plexServer.getSections).not.toHaveBeenCalled();
      expect(ctx.info).toHaveBeenCalledWith(
        expect.stringContaining('disabled'),
      );
    });

    it('should continue scanning remaining sections when one fails', async () => {
      plexServer.getSections.mockResolvedValue([
        { key: '1', title: 'Films', type: 'movie' },
        { key: '2', title: 'More Films', type: 'movie' },
      ]);

      plexServer.listWatchedMovieDetailsForSectionKey
        .mockRejectedValueOnce(new Error('connection timed out'))
        .mockResolvedValueOnce([
          { tmdbId: 500, title: 'Interstellar', lastViewedAt: 1700000000 },
        ]);

      const ctx = mockJobContext();
      await service.fetchAndStorePlexHistory('test-user-id', ctx);

      expect(prisma.importedWatchEntry.create).toHaveBeenCalledTimes(1);
      expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining('Films'));
    });
  });

  describe('parseAndStoreNetflixCsv', () => {
    it('batches new titles after filtering out already imported entries', async () => {
      prisma.importedWatchEntry.findMany.mockResolvedValueOnce([
        { parsedTitle: 'The Matrix' },
      ]);
      prisma.importedWatchEntry.createMany.mockResolvedValueOnce({ count: 2 });

      const result = await service.parseAndStoreNetflixCsv(
        'test-user-id',
        Buffer.from(
          [
            'Title,Date',
            'The Matrix,1/1/24',
            'Inception,1/2/24',
            'Breaking Bad: Season 1,1/3/24',
          ].join('\n'),
        ),
      );

      expect(prisma.importedWatchEntry.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            userId: 'test-user-id',
            source: 'netflix',
            parsedTitle: 'Inception',
            status: 'pending',
          }),
          expect.objectContaining({
            userId: 'test-user-id',
            source: 'netflix',
            parsedTitle: 'Breaking Bad',
            status: 'pending',
          }),
        ],
      });
      expect(result).toEqual({
        totalRawRows: 3,
        totalUnique: 3,
        newlyInserted: 2,
        alreadyImported: 1,
      });
    });

    it('falls back to row-by-row inserts when a batch hits a unique race', async () => {
      prisma.importedWatchEntry.createMany.mockRejectedValueOnce({
        code: 'P2002',
      });
      prisma.importedWatchEntry.create
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce({ code: 'P2002' });

      const result = await service.parseAndStoreNetflixCsv(
        'test-user-id',
        Buffer.from(
          [
            'Title,Date',
            'Inception,1/2/24',
            'Breaking Bad: Season 1,1/3/24',
          ].join('\n'),
        ),
      );

      expect(prisma.importedWatchEntry.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.importedWatchEntry.create).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        totalRawRows: 2,
        totalUnique: 2,
        newlyInserted: 1,
        alreadyImported: 1,
      });
    });
  });

  describe('processImportedEntries source parameterization', () => {
    it('should use source=plex in pending query when called with plex', async () => {
      prisma.importedWatchEntry.findMany.mockResolvedValue([]);

      const ctx = mockJobContext({ jobId: 'importPlexHistory' });
      await service.processImportedEntries(ctx, 'plex');

      const findManyCalls = prisma.importedWatchEntry.findMany.mock.calls as [
        FindManyCall,
      ][];
      const pendingCall = findManyCalls.find(
        (call) => call[0]?.where?.status === 'pending',
      );
      expect(pendingCall).toBeDefined();
      if (!pendingCall) {
        throw new Error('Expected pending query for plex source');
      }
      expect(pendingCall[0].where.source).toBe('plex');
    });

    it('should default to netflix source when called without source', async () => {
      prisma.importedWatchEntry.findMany.mockResolvedValue([]);

      const ctx = mockJobContext({ jobId: 'importNetflixHistory' });
      await service.processImportedEntries(ctx);

      const findManyCalls = prisma.importedWatchEntry.findMany.mock.calls as [
        FindManyCall,
      ][];
      const pendingCall = findManyCalls.find(
        (call) => call[0]?.where?.status === 'pending',
      );
      expect(pendingCall).toBeDefined();
      if (!pendingCall) {
        throw new Error('Expected pending query for netflix source');
      }
      expect(pendingCall[0].where.source).toBe('netflix');
    });
  });

  describe('processImportedEntries transient TMDB retries', () => {
    const matchedMovieEntry = {
      tmdbId: 123,
      mediaType: 'movie',
      matchedTitle: 'Seed Movie',
      parsedTitle: 'Seed Movie',
      watchedAt: new Date('2026-04-21T00:00:00.000Z'),
    };

    beforeEach(() => {
      prisma.importedWatchEntry.findMany.mockReset();
      prisma.importedWatchEntry.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([matchedMovieEntry])
        .mockResolvedValueOnce([]);
      prisma.importedWatchEntry.updateMany.mockResolvedValue({ count: 1 });
      jest
        .spyOn(service as never, 'resolveAndDedup' as never)
        .mockResolvedValue([]);
    });

    it('retries transient TMDB seed failures immediately, then after 1 minute and 3 minutes before succeeding', async () => {
      jest.useFakeTimers();
      recommendations.buildSimilarMovieTitles
        .mockRejectedValueOnce(buildTransientTmdbSeedError())
        .mockRejectedValueOnce(buildTransientTmdbSeedError())
        .mockRejectedValueOnce(buildTransientTmdbSeedError())
        .mockResolvedValue({
          titles: ['Recovered Similar Pick'],
          strategy: 'tmdb',
          debug: {},
        });
      recommendations.buildChangeOfTasteMovieTitles.mockResolvedValue({
        titles: ['Recovered Contrast Pick'],
        strategy: 'tmdb',
        debug: {},
      });

      const ctx = mockJobContext({ jobId: 'importPlexHistory' });
      const runPromise = service.processImportedEntries(ctx, 'plex');

      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(60_000);
      await jest.advanceTimersByTimeAsync(180_000);
      const result = await runPromise;
      const summary = result.summary as unknown as {
        tasks?: Array<{ id?: string; status?: string }>;
      };

      expect(recommendations.buildSimilarMovieTitles).toHaveBeenCalledTimes(4);
      expect(
        recommendations.buildChangeOfTasteMovieTitles,
      ).toHaveBeenCalledTimes(1);
      expect(prisma.importedWatchEntry.updateMany).toHaveBeenCalledTimes(1);
      expect(ctx.warn).toHaveBeenCalledWith(
        'Seed transient TMDB failure: Seed Movie — retrying immediately',
        expect.objectContaining({ attempt: 1, totalAttempts: 4, delayMs: 0 }),
      );
      expect(ctx.warn).toHaveBeenCalledWith(
        'Seed transient TMDB failure: Seed Movie — retrying in 1 minute',
        expect.objectContaining({
          attempt: 2,
          totalAttempts: 4,
          delayMs: 60_000,
        }),
      );
      expect(ctx.warn).toHaveBeenCalledWith(
        'Seed transient TMDB failure: Seed Movie — retrying in 3 minutes',
        expect.objectContaining({
          attempt: 3,
          totalAttempts: 4,
          delayMs: 180_000,
        }),
      );
      expect(summary.tasks?.some((task) => task.id === 'failed_seeds')).toBe(
        false,
      );
    });

    it('marks the seed failed after the final transient TMDB retry is exhausted', async () => {
      jest.useFakeTimers();
      recommendations.buildSimilarMovieTitles.mockRejectedValue(
        buildTransientTmdbSeedError(),
      );

      const ctx = mockJobContext({ jobId: 'importPlexHistory' });
      const runPromise = service.processImportedEntries(ctx, 'plex');

      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(60_000);
      await jest.advanceTimersByTimeAsync(180_000);
      const result = await runPromise;
      const summary = result.summary as unknown as {
        tasks?: Array<{ id?: string; status?: string }>;
      };

      expect(recommendations.buildSimilarMovieTitles).toHaveBeenCalledTimes(4);
      expect(
        recommendations.buildChangeOfTasteMovieTitles,
      ).not.toHaveBeenCalled();
      expect(prisma.importedWatchEntry.updateMany).not.toHaveBeenCalled();
      expect(summary.tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'failed_seeds',
            status: 'failed',
          }),
        ]),
      );
      expect(ctx.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Seed failed: Seed Movie — TMDB request failed',
        ),
      );
    });
  });
});
