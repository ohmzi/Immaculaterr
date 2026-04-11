import type { JobContext, JobRunTrigger, JsonObject } from './jobs.types';
import {
  RottenTomatoesUpcomingMoviesJob,
  buildRadarrMovieIndex,
  dedupeScrapedMovies,
  parseRottenTomatoesMoviesFromHtml,
  selectLookupMovie,
} from './rotten-tomatoes-upcoming-movies.job';
import { SettingsService } from '../settings/settings.service';
import { RadarrService } from '../radarr/radarr.service';
import { SeerrService } from '../seerr/seerr.service';

type SettingsMock = Pick<
  SettingsService,
  'getInternalSettings' | 'readServiceSecret'
>;
type RadarrMock = Pick<
  RadarrService,
  | 'listMovies'
  | 'lookupMovies'
  | 'listRootFolders'
  | 'listQualityProfiles'
  | 'listTags'
  | 'addMovie'
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
    jobId: 'rottenTomatoesUpcomingMovies',
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
  const settings: jest.Mocked<SettingsMock> = {
    getInternalSettings: jest.fn(),
    readServiceSecret: jest.fn(),
  };
  const radarr: jest.Mocked<RadarrMock> = {
    listMovies: jest.fn(),
    lookupMovies: jest.fn(),
    listRootFolders: jest.fn(),
    listQualityProfiles: jest.fn(),
    listTags: jest.fn(),
    addMovie: jest.fn(),
  };
  const seerr: jest.Mocked<SeerrMock> = {
    requestMovie: jest.fn(),
  };

  const job = new RottenTomatoesUpcomingMoviesJob(
    settings as unknown as SettingsService,
    radarr as unknown as RadarrService,
    seerr as unknown as SeerrService,
  );

  return { job, settings, radarr, seerr };
}

function createSourceHtml(
  entries: Array<{ title: string; href: string; startDate: string }>,
): string {
  return entries
    .map(
      (entry) => `
        <a data-qa="discovery-media-list-item-caption" href="${entry.href}">
          <span data-qa="discovery-media-list-item-title">${entry.title}</span>
          <span data-qa="discovery-media-list-item-start-date">${entry.startDate}</span>
        </a>
      `,
    )
    .join('\n');
}

describe('RottenTomatoesUpcomingMoviesJob', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses Rotten Tomatoes cards and prefers year from slug before start-date', () => {
    const parsed = parseRottenTomatoesMoviesFromHtml({
      sourceUrl:
        'https://www.rottentomatoes.com/browse/movies_in_theaters/sort:newest',
      html: createSourceHtml([
        {
          title: 'The Example',
          href: '/m/the_example_2026',
          startDate: 'Streaming Apr 7, 2025',
        },
      ]),
    });

    expect(parsed.discoveredEntries).toBe(1);
    expect(parsed.skippedNoYear).toBe(0);
    expect(parsed.movies).toEqual([
      expect.objectContaining({
        title: 'The Example',
        year: '2026',
        href: '/m/the_example_2026',
      }),
    ]);
  });

  it('dedupes scraped movies by normalized title and year across sources', () => {
    const deduped = dedupeScrapedMovies([
      {
        title: 'Touch Me',
        year: '2025',
        href: '/m/touch_me_2025',
        startDate: 'Streaming Apr 7, 2025',
        sourceUrl: 'source-a',
      },
      {
        title: 'Touch Me',
        year: '2025',
        href: '/m/touch_me_2025',
        startDate: 'Streaming Apr 7, 2025',
        sourceUrl: 'source-b',
      },
      {
        title: 'Touch Me',
        year: '2026',
        href: '/m/touch_me_2026',
        startDate: 'Streaming Apr 7, 2026',
        sourceUrl: 'source-c',
      },
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((movie) => `${movie.title}:${movie.year}`)).toEqual([
      'Touch Me:2025',
      'Touch Me:2026',
    ]);
  });

  it('selects conservative title-only lookup matches and rejects unrelated same-title years', () => {
    const safeMatch = selectLookupMovie(
      [
        { id: 1, title: 'Touch Me', year: 2024, tmdbId: 101 },
        { id: 2, title: 'Touch Me', year: 2026, tmdbId: 102 },
      ],
      'Touch Me',
      '2025',
    );
    const rejectedMatch = selectLookupMovie(
      [{ id: 3, title: 'Family Tree', year: 2009, tmdbId: 201 }],
      'Family Tree',
      '2025',
    );

    expect(safeMatch).toEqual(
      expect.objectContaining({ title: 'Touch Me', year: 2024, tmdbId: 101 }),
    );
    expect(rejectedMatch).toBeNull();
  });

  it('builds Radarr index from tmdb ids and normalized title-year keys', () => {
    const index = buildRadarrMovieIndex([
      { id: 1, title: 'The Bride!', year: 2026, tmdbId: 101 },
      { id: 2, title: 'Touch Me', year: 2025, tmdbId: 102 },
    ]);

    expect(index.tmdbIds.has(101)).toBe(true);
    expect(index.tmdbIds.has(102)).toBe(true);
    expect(index.titleYearKeys.has('the bride|2026')).toBe(true);
    expect(index.titleYearKeys.has('touch me|2025')).toBe(true);
  });

  it('continues when one Rotten Tomatoes source fails', async () => {
    const { job, settings } = createJob();
    const ctx = createContext({ dryRun: true });
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    settings.getInternalSettings.mockResolvedValue({
      settings: {},
      secrets: {},
    });
    settings.readServiceSecret.mockReturnValue('');
    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.reject(new Error('boom'));
      }
      if (callCount === 2) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              createSourceHtml([
                {
                  title: 'Touch Me',
                  href: '/m/touch_me_2025',
                  startDate: 'Streaming Apr 7, 2025',
                },
              ]),
            ),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(''),
      } as Response);
    });

    const result = await job.run(ctx);
    const summary = result.summary as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;
    const sourceStats = raw.sourceStats as Array<Record<string, unknown>>;
    const destinationStats = raw.destinationStats as Record<string, unknown>;

    expect(sourceStats.some((row) => row.failed === true)).toBe(true);
    expect((raw.sampleCandidates as Array<unknown>).length).toBe(1);
    expect(destinationStats.skipped).toBe(1);
  });

  it('fails discovery clearly when all Rotten Tomatoes sources fail', async () => {
    const { job, settings } = createJob();
    const ctx = createContext({ dryRun: true });
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    settings.getInternalSettings.mockResolvedValue({
      settings: {},
      secrets: {},
    });
    settings.readServiceSecret.mockReturnValue('');
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await job.run(ctx);
    const summary = result.summary as Record<string, unknown>;
    const tasks = summary.tasks as Array<Record<string, unknown>>;
    const scrapeTask = tasks.find((task) => task.id === 'scrape_sources');
    const issues = summary.issues as Array<Record<string, unknown>>;

    expect(scrapeTask?.status).toBe('failed');
    expect(
      issues.some(
        (issue) =>
          typeof issue.message === 'string' &&
          issue.message.includes('Rotten Tomatoes discovery failed'),
      ),
    ).toBe(true);
  });

  it('treats Radarr prechecked duplicates as exists instead of add failures', async () => {
    const { job, settings, radarr } = createJob();
    const ctx = createContext({ dryRun: false });
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        radarr: {
          enabled: true,
          baseUrl: 'http://radarr.local:7878',
          defaultRootFolderPath: '/movies',
          defaultQualityProfileId: 1,
        },
      },
      secrets: {
        radarr: { apiKey: 'radarr-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) =>
      service === 'radarr' ? 'radarr-key' : '',
    );
    fetchMock.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          createSourceHtml([
            {
              title: 'Avatar: Fire and Ash',
              href: '/m/avatar_fire_and_ash_2026',
              startDate: 'In Theaters Dec 18, 2026',
            },
          ]),
        ),
    } as Response);
    radarr.listMovies.mockResolvedValue([]);
    radarr.listRootFolders.mockResolvedValue([{ id: 1, path: '/movies' }]);
    radarr.listQualityProfiles.mockResolvedValue([{ id: 1, name: 'Any' }]);
    radarr.listTags.mockResolvedValue([]);
    radarr.lookupMovies
      .mockResolvedValueOnce([
        { id: 11, title: 'Avatar: Fire and Ash', year: 2025, tmdbId: 83533 },
      ])
      .mockResolvedValueOnce([
        { id: 11, title: 'Avatar: Fire and Ash', year: 2025, tmdbId: 83533 },
      ]);
    radarr.addMovie.mockResolvedValue({ status: 'exists', movie: null });

    const result = await job.run(ctx);
    const summary = result.summary as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;
    const destinationStats = raw.destinationStats as Record<string, unknown>;

    expect(radarr.addMovie).toHaveBeenCalledTimes(1);
    expect(destinationStats.exists).toBe(1);
    expect(destinationStats.failed).toBe(0);
  });

  it('routes matched movies to Seerr when enabled', async () => {
    const { job, settings, radarr, seerr } = createJob();
    const ctx = createContext({ dryRun: false });
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          rottenTomatoesUpcomingMovies: {
            routeViaSeerr: true,
          },
        },
        radarr: {
          enabled: true,
          baseUrl: 'http://radarr.local:7878',
        },
        seerr: {
          enabled: true,
          baseUrl: 'http://seerr.local:5055',
        },
      },
      secrets: {
        radarr: { apiKey: 'radarr-key' },
        seerr: { apiKey: 'seerr-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'radarr') return 'radarr-key';
      if (service === 'seerr') return 'seerr-key';
      return '';
    });
    fetchMock.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          createSourceHtml([
            {
              title: 'Touch Me',
              href: '/m/touch_me_2025',
              startDate: 'Streaming Apr 7, 2025',
            },
          ]),
        ),
    } as Response);
    radarr.listMovies.mockResolvedValue([]);
    radarr.lookupMovies.mockResolvedValue([
      { id: 21, title: 'Touch Me', year: 2025, tmdbId: 1400763 },
    ]);
    seerr.requestMovie.mockResolvedValue({
      status: 'requested',
      requestId: 77,
      error: null,
    });

    const result = await job.run(ctx);
    const summary = result.summary as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;
    const destinationStats = raw.destinationStats as Record<string, unknown>;

    expect(seerr.requestMovie).toHaveBeenCalledWith({
      baseUrl: 'http://seerr.local:5055',
      apiKey: 'seerr-key',
      tmdbId: 1400763,
    });
    expect(radarr.addMovie).not.toHaveBeenCalled();
    expect(radarr.listRootFolders).not.toHaveBeenCalled();
    expect(radarr.listQualityProfiles).not.toHaveBeenCalled();
    expect(radarr.listTags).not.toHaveBeenCalled();
    expect(destinationStats.attempted).toBe(1);
    expect(destinationStats.requested).toBe(1);
    expect(destinationStats.failed).toBe(0);
  });

  it('skips Seerr routing gracefully when Seerr is not configured', async () => {
    const { job, settings, radarr, seerr } = createJob();
    const ctx = createContext({ dryRun: false });
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          rottenTomatoesUpcomingMovies: {
            routeViaSeerr: true,
          },
        },
        radarr: {
          enabled: true,
          baseUrl: 'http://radarr.local:7878',
        },
      },
      secrets: {
        radarr: { apiKey: 'radarr-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) =>
      service === 'radarr' ? 'radarr-key' : '',
    );
    fetchMock.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          createSourceHtml([
            {
              title: 'Touch Me',
              href: '/m/touch_me_2025',
              startDate: 'Streaming Apr 7, 2025',
            },
          ]),
        ),
    } as Response);
    radarr.listMovies.mockResolvedValue([]);

    const result = await job.run(ctx);
    const summary = result.summary as Record<string, unknown>;
    const tasks = summary.tasks as Array<Record<string, unknown>>;
    const prepareTask = tasks.find((task) => task.id === 'prepare_radarr');
    const routeTask = tasks.find((task) => task.id === 'route_movies');
    const raw = summary.raw as Record<string, unknown>;
    const destinationStats = raw.destinationStats as Record<string, unknown>;

    expect(prepareTask?.status).toBe('skipped');
    expect(routeTask?.status).toBe('skipped');
    expect(destinationStats.skipped).toBe(1);
    expect(radarr.lookupMovies).not.toHaveBeenCalled();
    expect(radarr.addMovie).not.toHaveBeenCalled();
    expect(seerr.requestMovie).not.toHaveBeenCalled();
  });

  it('skips destination gracefully when Radarr is not configured', async () => {
    const { job, settings, radarr } = createJob();
    const ctx = createContext({ dryRun: false });
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    settings.getInternalSettings.mockResolvedValue({
      settings: {},
      secrets: {},
    });
    settings.readServiceSecret.mockReturnValue('');
    fetchMock.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          createSourceHtml([
            {
              title: 'Touch Me',
              href: '/m/touch_me_2025',
              startDate: 'Streaming Apr 7, 2025',
            },
          ]),
        ),
    } as Response);

    const result = await job.run(ctx);
    const summary = result.summary as Record<string, unknown>;
    const tasks = summary.tasks as Array<Record<string, unknown>>;
    const prepareTask = tasks.find((task) => task.id === 'prepare_radarr');
    const routeTask = tasks.find((task) => task.id === 'route_movies');
    const raw = summary.raw as Record<string, unknown>;
    const destinationStats = raw.destinationStats as Record<string, unknown>;

    expect(prepareTask?.status).toBe('skipped');
    expect(routeTask?.status).toBe('skipped');
    expect(destinationStats.skipped).toBe(1);
    expect(radarr.lookupMovies).not.toHaveBeenCalled();
    expect(radarr.addMovie).not.toHaveBeenCalled();
  });
});
