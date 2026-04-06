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

describe('ImportService', () => {
  let service: ImportService;
  let prisma: { importedWatchEntry: Record<string, jest.Mock> };
  let settingsService: { getInternalSettings: jest.Mock };
  let plexServer: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = {
      importedWatchEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
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
    } as unknown as { importedWatchEntry: Record<string, jest.Mock> };

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: TmdbService, useValue: {} },
        { provide: RecommendationsService, useValue: {} },
        { provide: SettingsService, useValue: settingsService },
        { provide: WatchedCollectionsRefresherService, useValue: {} },
        { provide: PlexServerService, useValue: plexServer },
        { provide: ImmaculateTasteCollectionService, useValue: {} },
        { provide: ImmaculateTasteShowCollectionService, useValue: {} },
      ],
    }).compile();

    service = module.get<ImportService>(ImportService);
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

      const movieCall = prisma.importedWatchEntry.create.mock.calls[0][0];
      expect(movieCall.data.source).toBe('plex');
      expect(movieCall.data.status).toBe('matched');
      expect(movieCall.data.mediaType).toBe('movie');
      expect(movieCall.data.tmdbId).toBe(100);

      const tvCall = prisma.importedWatchEntry.create.mock.calls[2][0];
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
      expect(
        prisma.importedWatchEntry.create.mock.calls[0][0].data.tmdbId,
      ).toBe(200);
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

  describe('processImportedEntries source parameterization', () => {
    it('should use source=plex in pending query when called with plex', async () => {
      prisma.importedWatchEntry.findMany.mockResolvedValue([]);

      const ctx = mockJobContext({ jobId: 'importPlexHistory' });
      await service.processImportedEntries(ctx, 'plex');

      const pendingCall = prisma.importedWatchEntry.findMany.mock.calls.find(
        (call: Record<string, Record<string, Record<string, unknown>>>[]) =>
          call[0]?.where?.status === 'pending',
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

      const pendingCall = prisma.importedWatchEntry.findMany.mock.calls.find(
        (call: Record<string, Record<string, Record<string, unknown>>>[]) =>
          call[0]?.where?.status === 'pending',
      );
      expect(pendingCall).toBeDefined();
      if (!pendingCall) {
        throw new Error('Expected pending query for netflix source');
      }
      expect(pendingCall[0].where.source).toBe('netflix');
    });
  });
});
