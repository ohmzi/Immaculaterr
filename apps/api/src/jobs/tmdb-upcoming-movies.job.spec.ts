import { TmdbUpcomingMoviesJob } from './tmdb-upcoming-movies.job';
import type { JobContext, JobRunTrigger, JsonObject } from './jobs.types';
import { PrismaService } from '../db/prisma.service';
import { PlexServerService } from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { RadarrService } from '../radarr/radarr.service';
import { SeerrService } from '../seerr/seerr.service';

type PrismaMock = {
  jobRun: {
    findMany: jest.Mock;
  };
};

type SettingsMock = Pick<
  SettingsService,
  'getInternalSettings' | 'readServiceSecret'
>;
type TmdbMock = Pick<
  TmdbService,
  'discoverUpcomingMovies' | 'getMovieCertification'
>;
type PlexMock = Pick<
  PlexServerService,
  'getSections' | 'getMovieTmdbIdSetForSectionKey'
>;
type RadarrMock = Pick<
  RadarrService,
  'listRootFolders' | 'listQualityProfiles' | 'listTags' | 'addMovie'
>;
type SeerrMock = Pick<SeerrService, 'requestMovie'>;

function createContext(params?: {
  trigger?: JobRunTrigger;
  dryRun?: boolean;
}): JobContext {
  const trigger = params?.trigger ?? 'manual';
  const dryRun = params?.dryRun ?? false;
  let currentSummary: JsonObject | null = null;
  const setSummary = jest.fn((summary: JsonObject | null) => {
    currentSummary = summary;
    return Promise.resolve();
  });
  const patchSummary = jest.fn((patch: JsonObject) => {
    currentSummary = { ...(currentSummary ?? {}), ...patch };
    return Promise.resolve();
  });
  const log = jest.fn(() => Promise.resolve());

  return {
    jobId: 'tmdbUpcomingMovies',
    runId: 'run-1',
    userId: 'user-1',
    trigger,
    dryRun,
    getSummary: () => currentSummary,
    setSummary,
    patchSummary,
    log,
    debug: log,
    info: log,
    warn: log,
    error: log,
  };
}

function createJob() {
  const prisma: PrismaMock = {
    jobRun: {
      findMany: jest.fn(),
    },
  };
  const settings: jest.Mocked<SettingsMock> = {
    getInternalSettings: jest.fn(),
    readServiceSecret: jest.fn(),
  };
  const tmdb: jest.Mocked<TmdbMock> = {
    discoverUpcomingMovies: jest.fn(),
    getMovieCertification: jest.fn(),
  };
  const plex: jest.Mocked<PlexMock> = {
    getSections: jest.fn(),
    getMovieTmdbIdSetForSectionKey: jest.fn(),
  };
  const radarr: jest.Mocked<RadarrMock> = {
    listRootFolders: jest.fn(),
    listQualityProfiles: jest.fn(),
    listTags: jest.fn(),
    addMovie: jest.fn(),
  };
  const seerr: jest.Mocked<SeerrMock> = {
    requestMovie: jest.fn(),
  };

  const job = new TmdbUpcomingMoviesJob(
    prisma as unknown as PrismaService,
    settings as unknown as SettingsService,
    tmdb as unknown as TmdbService,
    plex as unknown as PlexServerService,
    radarr as unknown as RadarrService,
    seerr as unknown as SeerrService,
  );

  return { job, prisma, settings, tmdb, plex, radarr, seerr };
}

describe('TmdbUpcomingMoviesJob', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('clamps the release window end date by calendar day', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-31T12:00:00'));

    const { job, prisma, settings, tmdb } = createJob();
    const ctx = createContext({ dryRun: true, trigger: 'manual' });

    prisma.jobRun.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          tmdbUpcomingMovies: {
            releaseWindowMonths: 1,
            globalLimit: 100,
            routeViaSeerr: false,
            filters: [
              {
                id: 'default',
                enabled: true,
                genres: [],
                languages: [],
                certifications: [],
                scoreMin: 6,
                scoreMax: 10,
              },
            ],
          },
        },
      },
      secrets: {
        tmdb: { apiKey: 'tmdb-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'tmdb') return 'tmdb-key';
      return '';
    });
    tmdb.discoverUpcomingMovies.mockResolvedValue([]);

    await job.run(ctx);

    expect(tmdb.discoverUpcomingMovies).toHaveBeenCalledWith(
      expect.objectContaining({
        fromDate: '2026-01-31',
        toDate: '2026-02-28',
      }),
    );
  });

  it('uses explicit date timeline values including past start dates', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-15T12:00:00'));

    const { job, prisma, settings, tmdb } = createJob();
    const ctx = createContext({ dryRun: true, trigger: 'manual' });

    prisma.jobRun.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          tmdbUpcomingMovies: {
            routeViaSeerr: false,
            globalLimit: 100,
            windowStart: '2026-01-01',
            windowEnd: '2026-03-15',
            filters: [],
          },
        },
      },
      secrets: {
        tmdb: { apiKey: 'tmdb-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'tmdb') return 'tmdb-key';
      return '';
    });
    tmdb.discoverUpcomingMovies.mockResolvedValue([]);

    await job.run(ctx);

    expect(tmdb.discoverUpcomingMovies).toHaveBeenCalledWith(
      expect.objectContaining({
        fromDate: '2026-01-01',
        toDate: '2026-03-15',
      }),
    );
  });

  it('ignores watch providers, enforces single language, and fixes max score', async () => {
    const { job, prisma, settings, tmdb } = createJob();
    const ctx = createContext({ dryRun: true, trigger: 'manual' });

    prisma.jobRun.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          tmdbUpcomingMovies: {
            routeViaSeerr: false,
            globalLimit: 100,
            releaseWindowMonths: 2,
            filters: [
              {
                id: 'f1',
                enabled: true,
                genres: [],
                languages: ['en', 'fr', 'en'],
                watchProviders: ['8', '337', '8', 'invalid'],
                certifications: [],
                scoreMin: 6,
                scoreMax: 3,
              },
            ],
          },
        },
      },
      secrets: {
        tmdb: { apiKey: 'tmdb-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'tmdb') return 'tmdb-key';
      return '';
    });
    tmdb.discoverUpcomingMovies.mockResolvedValue([]);

    await job.run(ctx);

    const discoverArgs = tmdb.discoverUpcomingMovies.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(discoverArgs).toBeDefined();
    expect(discoverArgs).not.toHaveProperty('watchProviderIds');
    expect(discoverArgs).not.toHaveProperty('watchRegion');
    expect(discoverArgs?.languages).toEqual(['en']);
    expect(discoverArgs?.maxScore).toBe(10);
  });

  it('counts Radarr existing results as exists (non-fatal)', async () => {
    const { job, prisma, settings, tmdb, radarr } = createJob();
    const ctx = createContext({ dryRun: false, trigger: 'manual' });

    prisma.jobRun.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          tmdbUpcomingMovies: {
            routeViaSeerr: false,
            globalLimit: 100,
            releaseWindowMonths: 2,
            filters: [
              {
                id: 'default',
                enabled: true,
                genres: [],
                languages: [],
                certifications: [],
                scoreMin: 6,
                scoreMax: 10,
              },
            ],
          },
        },
        radarr: {
          baseUrl: 'http://radarr.local:7878',
          enabled: true,
          defaultRootFolderPath: '/movies',
          defaultQualityProfileId: 1,
        },
      },
      secrets: {
        tmdb: { apiKey: 'tmdb-key' },
        radarr: { apiKey: 'radarr-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'tmdb') return 'tmdb-key';
      if (service === 'radarr') return 'radarr-key';
      return '';
    });
    tmdb.discoverUpcomingMovies.mockResolvedValue([
      {
        tmdbId: 12,
        title: 'Example Movie',
        releaseDate: '2026-06-10',
        voteAverage: 7.4,
        voteCount: 120,
        popularity: 150,
        originalLanguage: 'en',
      },
    ]);
    radarr.listRootFolders.mockResolvedValue([{ id: 1, path: '/movies' }]);
    radarr.listQualityProfiles.mockResolvedValue([{ id: 1, name: 'Any' }]);
    radarr.listTags.mockResolvedValue([]);
    radarr.addMovie.mockResolvedValue({ status: 'exists', movie: null });

    const result = await job.run(ctx);
    const summary = result.summary as unknown as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;
    const destinationStats = raw.destinationStats as Record<string, unknown>;
    const tasks = summary.tasks as Array<Record<string, unknown>>;
    const destinationTask = tasks.find((task) => task.id === 'destination');
    const destinationFacts = Array.isArray(destinationTask?.facts)
      ? (destinationTask.facts as Array<Record<string, unknown>>)
      : [];
    const attemptedFact = destinationFacts.find(
      (fact) => fact.label === 'Attempted sends',
    );
    const existsFact = destinationFacts.find(
      (fact) => fact.label === 'Already exists in Radarr',
    );

    expect(radarr.addMovie).toHaveBeenCalledTimes(1);
    expect(destinationStats.exists).toBe(1);
    expect(destinationStats.failed).toBe(0);
    expect(
      (attemptedFact?.value as Record<string, unknown> | undefined)?.count,
    ).toBe(1);
    expect(
      (attemptedFact?.value as Record<string, unknown> | undefined)?.items,
    ).toEqual(['Example Movie']);
    expect(
      (existsFact?.value as Record<string, unknown> | undefined)?.count,
    ).toBe(1);
    expect(
      (existsFact?.value as Record<string, unknown> | undefined)?.items,
    ).toEqual(['Example Movie']);
  });

  it('backfills replacements when Radarr reports existing items', async () => {
    const { job, prisma, settings, tmdb, radarr } = createJob();
    const ctx = createContext({ dryRun: false, trigger: 'manual' });

    prisma.jobRun.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          tmdbUpcomingMovies: {
            routeViaSeerr: false,
            globalLimit: 2,
            releaseWindowMonths: 2,
            filters: [
              {
                id: 'f1',
                enabled: true,
                genres: [],
                languages: [],
                certifications: [],
                scoreMin: 6,
                scoreMax: 10,
              },
            ],
          },
        },
        radarr: {
          baseUrl: 'http://radarr.local:7878',
          enabled: true,
          defaultRootFolderPath: '/movies',
          defaultQualityProfileId: 1,
        },
      },
      secrets: {
        tmdb: { apiKey: 'tmdb-key' },
        radarr: { apiKey: 'radarr-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'tmdb') return 'tmdb-key';
      if (service === 'radarr') return 'radarr-key';
      return '';
    });
    tmdb.discoverUpcomingMovies.mockResolvedValue([
      {
        tmdbId: 101,
        title: 'Existing Movie',
        releaseDate: '2026-06-10',
        voteAverage: 7.9,
        voteCount: 220,
        popularity: 300,
        originalLanguage: 'en',
      },
      {
        tmdbId: 102,
        title: 'New Movie A',
        releaseDate: '2026-06-11',
        voteAverage: 7.8,
        voteCount: 210,
        popularity: 250,
        originalLanguage: 'en',
      },
      {
        tmdbId: 103,
        title: 'New Movie B',
        releaseDate: '2026-06-12',
        voteAverage: 7.7,
        voteCount: 200,
        popularity: 200,
        originalLanguage: 'en',
      },
    ]);
    radarr.listRootFolders.mockResolvedValue([{ id: 1, path: '/movies' }]);
    radarr.listQualityProfiles.mockResolvedValue([{ id: 1, name: 'Any' }]);
    radarr.listTags.mockResolvedValue([]);
    radarr.addMovie.mockImplementation(({ tmdbId }) =>
      Promise.resolve(
        tmdbId === 101
          ? { status: 'exists', movie: null }
          : { status: 'added', movie: null },
      ),
    );

    const result = await job.run(ctx);
    const summary = result.summary as unknown as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;
    const destinationStats = raw.destinationStats as Record<string, unknown>;

    expect(radarr.addMovie).toHaveBeenCalledTimes(3);
    expect(radarr.addMovie.mock.calls.map((call) => call[0].tmdbId)).toEqual([
      101, 103, 102,
    ]);
    expect(destinationStats.attempted).toBe(3);
    expect(destinationStats.exists).toBe(1);
    expect(destinationStats.added).toBe(2);
  });

  it('uses the hidden default baseline when no custom filters exist', async () => {
    const { job, prisma, settings, tmdb } = createJob();
    const ctx = createContext({ dryRun: true, trigger: 'manual' });

    prisma.jobRun.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          tmdbUpcomingMovies: {
            routeViaSeerr: true,
            globalLimit: 100,
            releaseWindowMonths: 2,
            filters: [],
          },
        },
      },
      secrets: {
        tmdb: { apiKey: 'tmdb-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'tmdb') return 'tmdb-key';
      return '';
    });
    tmdb.discoverUpcomingMovies.mockResolvedValue([]);

    const result = await job.run(ctx);
    const summary = result.summary as unknown as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;

    expect(tmdb.discoverUpcomingMovies).toHaveBeenCalledWith(
      expect.objectContaining({
        minScore: 6,
        maxScore: 10,
        languages: [],
      }),
    );
    expect(raw.usingDefaultBaseline).toBe(true);
  });

  it('uses baseline when all custom filters are disabled', async () => {
    const { job, prisma, settings, tmdb } = createJob();
    const ctx = createContext({ dryRun: true, trigger: 'manual' });

    prisma.jobRun.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          tmdbUpcomingMovies: {
            routeViaSeerr: true,
            globalLimit: 100,
            releaseWindowMonths: 2,
            filters: [
              {
                id: 'custom-1',
                enabled: false,
                genres: ['28'],
                languages: [],
                certifications: [],
                scoreMin: 6,
                scoreMax: 10,
              },
            ],
          },
        },
      },
      secrets: {
        tmdb: { apiKey: 'tmdb-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'tmdb') return 'tmdb-key';
      return '';
    });
    tmdb.discoverUpcomingMovies.mockResolvedValue([]);

    const result = await job.run(ctx);
    const summary = result.summary as unknown as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;

    expect(tmdb.discoverUpcomingMovies).toHaveBeenCalledWith(
      expect.objectContaining({
        minScore: 6,
        maxScore: 10,
        languages: [],
      }),
    );
    expect(raw.usingDefaultBaseline).toBe(true);
    expect(Array.isArray(raw.activeFilters)).toBe(true);
    expect((raw.activeFilters as unknown[]).length).toBe(1);
  });

  it('splits global cap allocation across enabled filters', async () => {
    const { job, prisma, settings, tmdb } = createJob();
    const ctx = createContext({ dryRun: true, trigger: 'manual' });

    prisma.jobRun.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          tmdbUpcomingMovies: {
            routeViaSeerr: true,
            globalLimit: 5,
            releaseWindowMonths: 2,
            filters: [
              {
                id: 'f1',
                enabled: true,
                genres: [],
                languages: ['en'],
                certifications: [],
                scoreMin: 6,
                scoreMax: 10,
              },
              {
                id: 'f2',
                enabled: true,
                genres: [],
                languages: ['fr'],
                certifications: [],
                scoreMin: 6,
                scoreMax: 10,
              },
            ],
          },
        },
      },
      secrets: {
        tmdb: { apiKey: 'tmdb-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'tmdb') return 'tmdb-key';
      return '';
    });
    tmdb.discoverUpcomingMovies.mockImplementation((params) => {
      if (params.languages.includes('en')) {
        return [
          {
            tmdbId: 101,
            title: 'EN 1',
            releaseDate: '2026-06-10',
            voteAverage: 8.1,
            voteCount: 500,
            popularity: 1000,
            originalLanguage: 'en',
          },
          {
            tmdbId: 102,
            title: 'EN 2',
            releaseDate: '2026-06-10',
            voteAverage: 7.9,
            voteCount: 300,
            popularity: 900,
            originalLanguage: 'en',
          },
          {
            tmdbId: 103,
            title: 'EN 3',
            releaseDate: '2026-06-10',
            voteAverage: 7.7,
            voteCount: 200,
            popularity: 800,
            originalLanguage: 'en',
          },
        ];
      }
      return [
        {
          tmdbId: 201,
          title: 'FR 1',
          releaseDate: '2026-06-10',
          voteAverage: 8.2,
          voteCount: 450,
          popularity: 950,
          originalLanguage: 'fr',
        },
        {
          tmdbId: 202,
          title: 'FR 2',
          releaseDate: '2026-06-10',
          voteAverage: 8,
          voteCount: 250,
          popularity: 850,
          originalLanguage: 'fr',
        },
        {
          tmdbId: 203,
          title: 'FR 3',
          releaseDate: '2026-06-10',
          voteAverage: 7.5,
          voteCount: 150,
          popularity: 700,
          originalLanguage: 'fr',
        },
      ];
    });

    const result = await job.run(ctx);
    const summary = result.summary as unknown as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;
    const selectedSample = raw.selectedSample as Array<Record<string, unknown>>;
    const filterAllocation = raw.filterAllocation as Array<
      Record<string, unknown>
    >;
    const tasks = summary.tasks as Array<Record<string, unknown>>;
    const discoverTask = tasks.find((task) => task.id === 'discover');
    const destinationTask = tasks.find((task) => task.id === 'destination');
    const discoverFacts = Array.isArray(discoverTask?.facts)
      ? (discoverTask.facts as Array<Record<string, unknown>>)
      : [];
    const destinationFacts = Array.isArray(destinationTask?.facts)
      ? (destinationTask.facts as Array<Record<string, unknown>>)
      : [];
    const filterOneFoundFact = discoverFacts.find(
      (fact) => fact.label === 'Filter #1 found',
    );
    const filterTwoFoundFact = discoverFacts.find(
      (fact) => fact.label === 'Filter #2 found',
    );
    const skippedFact = destinationFacts.find(
      (fact) => fact.label === 'Skipped sends',
    );

    expect(selectedSample).toHaveLength(5);
    expect(filterAllocation).toEqual([
      expect.objectContaining({ id: 'f1', allocatedLimit: 3 }),
      expect.objectContaining({ id: 'f2', allocatedLimit: 2 }),
    ]);
    expect(tmdb.discoverUpcomingMovies).toHaveBeenCalledTimes(2);
    for (const call of tmdb.discoverUpcomingMovies.mock.calls) {
      const params = call[0] as Record<string, unknown>;
      expect(params.maxItems).toBe(40);
      expect(params.maxPages).toBe(2);
    }
    expect(
      (filterOneFoundFact?.value as Record<string, unknown> | undefined)?.count,
    ).toBe(3);
    expect(
      (filterTwoFoundFact?.value as Record<string, unknown> | undefined)?.count,
    ).toBe(3);
    expect(
      (skippedFact?.value as Record<string, unknown> | undefined)?.count,
    ).toBe(5);
    expect(
      Array.isArray(
        (skippedFact?.value as Record<string, unknown> | undefined)?.items,
      ),
    ).toBe(true);
  });

  it('expands discovery pages when initial chunk cannot satisfy allocation', async () => {
    const { job, prisma, settings, tmdb } = createJob();
    const ctx = createContext({ dryRun: true, trigger: 'manual' });

    prisma.jobRun.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          tmdbUpcomingMovies: {
            routeViaSeerr: true,
            globalLimit: 4,
            releaseWindowMonths: 2,
            filters: [
              {
                id: 'f1',
                enabled: true,
                genres: [],
                languages: ['en'],
                certifications: ['PG-13'],
                scoreMin: 6,
                scoreMax: 10,
              },
            ],
          },
        },
      },
      secrets: {
        tmdb: { apiKey: 'tmdb-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'tmdb') return 'tmdb-key';
      return '';
    });

    const makeCandidate = (
      tmdbId: number,
      title: string,
      popularity: number,
    ) => ({
      tmdbId,
      title,
      releaseDate: '2026-06-10',
      voteAverage: 7.5,
      voteCount: 100,
      popularity,
      originalLanguage: 'en',
    });
    tmdb.discoverUpcomingMovies.mockImplementation((params) => {
      const startPage = Number(params.startPage ?? 1);
      if (startPage === 1) {
        return [
          makeCandidate(1, 'Movie 1', 500),
          makeCandidate(2, 'Movie 2', 450),
          makeCandidate(3, 'Movie 3', 400),
          makeCandidate(4, 'Movie 4', 350),
        ];
      }
      return [
        makeCandidate(5, 'Movie 5', 300),
        makeCandidate(6, 'Movie 6', 250),
        makeCandidate(7, 'Movie 7', 200),
        makeCandidate(8, 'Movie 8', 150),
      ];
    });
    tmdb.getMovieCertification.mockImplementation((params) => {
      const allowed = new Set([1, 5, 6, 7, 8]);
      return allowed.has(params.tmdbId) ? 'PG-13' : 'R';
    });

    const result = await job.run(ctx);
    const summary = result.summary as unknown as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;
    const selectedSample = raw.selectedSample as Array<Record<string, unknown>>;

    expect(tmdb.discoverUpcomingMovies).toHaveBeenCalledTimes(2);
    expect(tmdb.discoverUpcomingMovies.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        startPage: 1,
        maxItems: 40,
        maxPages: 2,
      }),
    );
    expect(tmdb.discoverUpcomingMovies.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        startPage: 3,
        maxItems: 40,
        maxPages: 2,
      }),
    );
    expect(selectedSample).toHaveLength(4);
  });

  it('excludes Plex-existing movies before filling allocation', async () => {
    const { job, prisma, settings, tmdb, plex } = createJob();
    const ctx = createContext({ dryRun: true, trigger: 'manual' });

    prisma.jobRun.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          tmdbUpcomingMovies: {
            routeViaSeerr: true,
            globalLimit: 2,
            releaseWindowMonths: 2,
            filters: [
              {
                id: 'f1',
                enabled: true,
                genres: [],
                languages: ['en'],
                certifications: [],
                scoreMin: 6,
                scoreMax: 10,
              },
            ],
          },
        },
        plex: {
          enabled: true,
          baseUrl: 'http://plex.local:32400',
        },
      },
      secrets: {
        tmdb: { apiKey: 'tmdb-key' },
        plex: { token: 'plex-token' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'tmdb') return 'tmdb-key';
      return '';
    });
    plex.getSections.mockResolvedValue([
      {
        key: '1',
        title: 'Movies',
        type: 'movie',
      },
    ]);
    plex.getMovieTmdbIdSetForSectionKey.mockResolvedValue(new Set([101]));
    tmdb.discoverUpcomingMovies.mockImplementation((params) => {
      const startPage = Number(params.startPage ?? 1);
      if (startPage === 1) {
        return [
          {
            tmdbId: 101,
            title: 'Already In Plex',
            releaseDate: '2026-06-10',
            voteAverage: 7.8,
            voteCount: 200,
            popularity: 500,
            originalLanguage: 'en',
          },
          {
            tmdbId: 102,
            title: 'Fresh Movie 1',
            releaseDate: '2026-06-11',
            voteAverage: 7.6,
            voteCount: 180,
            popularity: 450,
            originalLanguage: 'en',
          },
        ];
      }
      return [
        {
          tmdbId: 103,
          title: 'Fresh Movie 2',
          releaseDate: '2026-06-12',
          voteAverage: 7.4,
          voteCount: 160,
          popularity: 400,
          originalLanguage: 'en',
        },
      ];
    });

    const result = await job.run(ctx);
    const summary = result.summary as unknown as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;
    const selectedSample = raw.selectedSample as Array<Record<string, unknown>>;
    const plexPrecheck = raw.plexPrecheck as Record<string, unknown>;
    const tasks = summary.tasks as Array<Record<string, unknown>>;
    const discoverTask = tasks.find((task) => task.id === 'discover');
    const discoverFacts = Array.isArray(discoverTask?.facts)
      ? (discoverTask.facts as Array<Record<string, unknown>>)
      : [];
    const skippedInPlexFact = discoverFacts.find(
      (fact) => fact.label === 'Filter #1 skipped (already in Plex)',
    );

    expect(plex.getSections).toHaveBeenCalledTimes(1);
    expect(plex.getMovieTmdbIdSetForSectionKey).toHaveBeenCalledTimes(1);
    expect(tmdb.discoverUpcomingMovies).toHaveBeenCalledTimes(2);
    expect(selectedSample.map((entry) => entry.tmdbId)).toEqual([102, 103]);
    expect(plexPrecheck.enabled).toBe(true);
    expect(plexPrecheck.configured).toBe(true);
    expect(plexPrecheck.movieLibrariesScanned).toBe(1);
    expect(plexPrecheck.existingTmdbIds).toBe(1);
    expect(
      (skippedInPlexFact?.value as Record<string, unknown> | undefined)?.count,
    ).toBe(1);
    expect(
      (skippedInPlexFact?.value as Record<string, unknown> | undefined)?.items,
    ).toEqual(['Already In Plex']);
  });

  it('continues gracefully when Plex pre-check fails', async () => {
    const { job, prisma, settings, tmdb, plex } = createJob();
    const ctx = createContext({ dryRun: true, trigger: 'manual' });

    prisma.jobRun.findMany.mockResolvedValue([]);
    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          tmdbUpcomingMovies: {
            routeViaSeerr: true,
            globalLimit: 1,
            releaseWindowMonths: 2,
            filters: [
              {
                id: 'f1',
                enabled: true,
                genres: [],
                languages: ['en'],
                certifications: [],
                scoreMin: 6,
                scoreMax: 10,
              },
            ],
          },
        },
        plex: {
          enabled: true,
          baseUrl: 'http://plex.local:32400',
        },
      },
      secrets: {
        tmdb: { apiKey: 'tmdb-key' },
        plex: { token: 'plex-token' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'tmdb') return 'tmdb-key';
      return '';
    });
    plex.getSections.mockRejectedValue(new Error('plex offline'));
    tmdb.discoverUpcomingMovies.mockResolvedValue([
      {
        tmdbId: 901,
        title: 'Fallback Candidate',
        releaseDate: '2026-06-20',
        voteAverage: 7.1,
        voteCount: 110,
        popularity: 250,
        originalLanguage: 'en',
      },
    ]);

    const result = await job.run(ctx);
    const summary = result.summary as unknown as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;
    const selectedSample = raw.selectedSample as Array<Record<string, unknown>>;
    const plexPrecheck = raw.plexPrecheck as Record<string, unknown>;
    const issues = summary.issues as Array<Record<string, unknown>>;

    expect(selectedSample).toHaveLength(1);
    expect(plex.getSections).toHaveBeenCalledTimes(1);
    expect(plex.getMovieTmdbIdSetForSectionKey).not.toHaveBeenCalled();
    expect(plexPrecheck.enabled).toBe(true);
    expect(plexPrecheck.error).toBe('plex offline');
    expect(
      issues.some((entry) => {
        const message = typeof entry.message === 'string' ? entry.message : '';
        return message.includes(
          'Plex library pre-check failed; continuing without Plex exclusion.',
        );
      }),
    ).toBe(true);
  });
});
