import type { PlexVerifiedEpisodeAvailability } from '../plex/plex-server.service';
import type { JobContext, JobRunTrigger, JsonObject } from './jobs.types';
import {
  RottenTomatoesUpcomingMoviesJob,
  buildRadarrMovieIndex,
  dedupeScrapedMovies,
  dedupeScrapedShows,
  parseRottenTomatoesMoviesFromHtml,
  parseRottenTomatoesShowsFromHtml,
  selectLookupMovie,
} from './rotten-tomatoes-upcoming-movies.job';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import { SeerrService } from '../seerr/seerr.service';
import { SettingsService } from '../settings/settings.service';
import {
  SonarrService,
  type SonarrEpisode,
  type SonarrSeries,
} from '../sonarr/sonarr.service';
import { TmdbService } from '../tmdb/tmdb.service';

type SettingsMock = Pick<
  SettingsService,
  'getInternalSettings' | 'readServiceSecret'
>;
type PlexMock = Pick<
  PlexServerService,
  | 'getSections'
  | 'getTvdbShowRatingKeysMapForSectionKey'
  | 'getVerifiedEpisodeAvailabilityForShowRatingKey'
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
type SonarrMock = Pick<
  SonarrService,
  | 'listSeries'
  | 'getEpisodesBySeries'
  | 'setEpisodeMonitored'
  | 'updateSeries'
  | 'listRootFolders'
  | 'listQualityProfiles'
  | 'listTags'
  | 'addSeries'
>;
type SeerrMock = Pick<SeerrService, 'requestMovie' | 'requestTvAllSeasons'>;
type TmdbMock = Pick<TmdbService, 'searchTv' | 'getTvExternalIds'>;

function createContext(params?: {
  trigger?: JobRunTrigger;
  dryRun?: boolean;
  input?: JsonObject;
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
    input: params?.input,
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
  const plex: jest.Mocked<PlexMock> = {
    getSections: jest.fn(),
    getTvdbShowRatingKeysMapForSectionKey: jest.fn(),
    getVerifiedEpisodeAvailabilityForShowRatingKey: jest.fn(),
  };
  const radarr: jest.Mocked<RadarrMock> = {
    listMovies: jest.fn(),
    lookupMovies: jest.fn(),
    listRootFolders: jest.fn(),
    listQualityProfiles: jest.fn(),
    listTags: jest.fn(),
    addMovie: jest.fn(),
  };
  const sonarr: jest.Mocked<SonarrMock> = {
    listSeries: jest.fn(),
    getEpisodesBySeries: jest.fn(),
    setEpisodeMonitored: jest.fn(),
    updateSeries: jest.fn(),
    listRootFolders: jest.fn(),
    listQualityProfiles: jest.fn(),
    listTags: jest.fn(),
    addSeries: jest.fn(),
  };
  const seerr: jest.Mocked<SeerrMock> = {
    requestMovie: jest.fn(),
    requestTvAllSeasons: jest.fn(),
  };
  const tmdb: jest.Mocked<TmdbMock> = {
    searchTv: jest.fn(),
    getTvExternalIds: jest.fn(),
  };

  const job = new RottenTomatoesUpcomingMoviesJob(
    settings as unknown as SettingsService,
    plex as unknown as PlexServerService,
    radarr as unknown as RadarrService,
    sonarr as unknown as SonarrService,
    seerr as unknown as SeerrService,
    tmdb as unknown as TmdbService,
  );

  return { job, settings, plex, radarr, sonarr, seerr, tmdb };
}

function createMovieSourceHtml(
  entries: Array<{ title: string; href: string; startDate: string }>,
  options?: { textTag?: 'span' | 'rt-text' },
): string {
  const textTag = options?.textTag ?? 'span';

  return entries
    .map(
      (entry) => `
        <a data-qa="discovery-media-list-item-caption" href="${entry.href}">
          <${textTag} data-qa="discovery-media-list-item-title">${entry.title}</${textTag}>
          <${textTag} data-qa="discovery-media-list-item-start-date">${entry.startDate}</${textTag}>
        </a>
      `,
    )
    .join('\n');
}

function createShowSourceHtml(
  entries: Array<{
    title: string;
    href: string;
    startDate: string;
    criticsScore: number | null;
    audienceScore: number | null;
  }>,
  options?: { textTag?: 'span' | 'rt-text' },
): string {
  const textTag = options?.textTag ?? 'rt-text';

  return entries
    .map((entry) => {
      const criticsMarkup =
        entry.criticsScore === null
          ? ''
          : `<rt-text slot="criticsScore">${entry.criticsScore}%</rt-text>`;
      const audienceMarkup =
        entry.audienceScore === null
          ? ''
          : `<rt-text slot="audienceScore">${entry.audienceScore}%</rt-text>`;

      return `
        <a data-qa="discovery-media-list-item-caption" href="${entry.href}">
          <${textTag} data-qa="discovery-media-list-item-title">${entry.title}</${textTag}>
          <${textTag} data-qa="discovery-media-list-item-start-date">${entry.startDate}</${textTag}>
          ${criticsMarkup}
          ${audienceMarkup}
        </a>
      `;
    })
    .join('\n');
}

function toFetchUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return '';
}

function mockFetchWithMovieAndShowPages(params?: {
  movieHtml?: string;
  showHtml?: string;
}) {
  return jest.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = toFetchUrl(input);
    if (url.includes('/browse/movies_')) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(params?.movieHtml ?? ''),
      } as Response);
    }
    if (url.includes('/browse/tv_series_browse')) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(params?.showHtml ?? ''),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve(''),
    } as Response);
  });
}

function createVerifiedAvailability(
  verifiedEpisodes: string[],
): PlexVerifiedEpisodeAvailability {
  return {
    verifiedEpisodes: new Set(verifiedEpisodes),
    metadataEpisodes: new Set(verifiedEpisodes),
    probeFailureCount: 0,
  };
}

describe('RottenTomatoesUpcomingMoviesJob', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses Rotten Tomatoes movie cards and prefers year from slug before start-date', () => {
    const parsed = parseRottenTomatoesMoviesFromHtml({
      sourceUrl:
        'https://www.rottentomatoes.com/browse/movies_in_theaters/sort:newest',
      html: createMovieSourceHtml(
        [
          {
            title: 'The Example',
            href: '/m/the_example_2026',
            startDate: 'Streaming Apr 7, 2025',
          },
        ],
        { textTag: 'rt-text' },
      ),
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

  it('parses Rotten Tomatoes TV cards with critic and audience scores', () => {
    const parsed = parseRottenTomatoesShowsFromHtml({
      sourceUrl:
        'https://www.rottentomatoes.com/browse/tv_series_browse/sort:newest?hl=en_US',
      html: createShowSourceHtml([
        {
          title: 'The Studio',
          href: '/tv/the_studio/s01',
          startDate: 'Premiered Mar 26, 2025',
          criticsScore: 94,
          audienceScore: 71,
        },
      ]),
    });

    expect(parsed.discoveredEntries).toBe(1);
    expect(parsed.shows).toEqual([
      expect.objectContaining({
        title: 'The Studio',
        year: '2025',
        criticsScore: 94,
        audienceScore: 71,
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

  it('dedupes scraped TV shows by normalized title and year or slug', () => {
    const deduped = dedupeScrapedShows([
      {
        title: 'The Studio',
        year: '2025',
        href: '/tv/the_studio/s01',
        slugKey: '/tv/the_studio/s01',
        startDate: 'Premiered Mar 26, 2025',
        criticsScore: 94,
        audienceScore: 71,
        sourceUrl: 'source-a',
      },
      {
        title: 'The Studio',
        year: '2025',
        href: '/tv/the_studio/s01',
        slugKey: '/tv/the_studio/s01',
        startDate: 'Premiered Mar 26, 2025',
        criticsScore: 94,
        audienceScore: 71,
        sourceUrl: 'source-b',
      },
      {
        title: 'Murderbot',
        year: null,
        href: '/tv/murderbot/s01',
        slugKey: '/tv/murderbot/s01',
        startDate: 'Premiered May 16, 2025',
        criticsScore: 96,
        audienceScore: 79,
        sourceUrl: 'source-c',
      },
      {
        title: 'Murderbot',
        year: null,
        href: '/tv/murderbot/s01',
        slugKey: '/tv/murderbot/s01',
        startDate: 'Premiered May 16, 2025',
        criticsScore: 96,
        audienceScore: 79,
        sourceUrl: 'source-d',
      },
    ]);

    expect(deduped).toHaveLength(2);
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

  it('normalizes missing Rotten Tomatoes settings to movie-on, show-off, top-10, Seerr-off', async () => {
    const { job, settings } = createJob();
    const ctx = createContext({ dryRun: true });
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    settings.getInternalSettings.mockResolvedValue({
      settings: {},
      secrets: {},
    });
    settings.readServiceSecret.mockReturnValue('');
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    } as Response);

    const result = await job.run(ctx);
    const summary = result.summary as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;

    expect(raw.effectiveIncludeMovies).toBe(true);
    expect(raw.effectiveIncludeShows).toBe(false);
    expect(raw.effectiveShowLimit).toBe(10);
    expect(raw.routeViaSeerr).toBe(false);
  });

  it('clamps the saved TV show limit to the supported range', async () => {
    const { job, settings } = createJob();
    const ctx = createContext({ dryRun: true });
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          rottenTomatoesUpcomingMovies: {
            showLimit: 999,
          },
        },
      },
      secrets: {},
    });
    settings.readServiceSecret.mockReturnValue('');
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    } as Response);

    const result = await job.run(ctx);
    const summary = result.summary as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;

    expect(raw.effectiveShowLimit).toBe(100);
  });

  it('rejects invalid manual categories clearly', async () => {
    const { job, settings } = createJob();
    const ctx = createContext({
      dryRun: true,
      input: { category: 'books' },
    });

    settings.getInternalSettings.mockResolvedValue({
      settings: {},
      secrets: {},
    });

    await expect(job.run(ctx)).rejects.toThrow(
      'Rotten Tomatoes Upcoming category must be either "movies" or "shows".',
    );
  });

  it('filters TV candidates to shows with both scores at least 60 and allows manual shows when saved TV is off', async () => {
    const { job, settings } = createJob();
    const ctx = createContext({
      dryRun: true,
      input: { category: 'shows' },
    });

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          rottenTomatoesUpcomingMovies: {
            includeShows: false,
            showLimit: 1,
          },
        },
      },
      secrets: {},
    });
    settings.readServiceSecret.mockReturnValue('');
    mockFetchWithMovieAndShowPages({
      showHtml: createShowSourceHtml([
        {
          title: 'The Studio',
          href: '/tv/the_studio/s01',
          startDate: 'Premiered Mar 26, 2025',
          criticsScore: 94,
          audienceScore: 71,
        },
        {
          title: 'Half Safe',
          href: '/tv/half_safe/s01',
          startDate: 'Premiered Apr 10, 2025',
          criticsScore: 94,
          audienceScore: 41,
        },
        {
          title: 'No Critics Yet',
          href: '/tv/no_critics_yet/s01',
          startDate: 'Premiered Apr 11, 2025',
          criticsScore: null,
          audienceScore: 85,
        },
      ]),
    });

    const result = await job.run(ctx);
    const summary = result.summary as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;
    const shows = raw.shows as Record<string, unknown>;
    const candidates = shows.sampleCandidates as Array<Record<string, unknown>>;

    expect(raw.effectiveIncludeMovies).toBe(false);
    expect(raw.effectiveIncludeShows).toBe(true);
    expect(raw.effectiveShowLimit).toBe(1);
    expect(shows.scoreFilteredOut).toBe(2);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.title).toBe('The Studio');
  });

  it('stops fetching TV sources once the deduped qualified pool reaches the saved show limit', async () => {
    const { job, settings } = createJob();
    const ctx = createContext({
      dryRun: true,
      input: { category: 'shows' },
    });
    let tvFetchCount = 0;

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          rottenTomatoesUpcomingMovies: {
            showLimit: 1,
          },
        },
      },
      secrets: {},
    });
    settings.readServiceSecret.mockReturnValue('');
    jest.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = toFetchUrl(input);
      if (url.includes('/browse/tv_series_browse')) {
        tvFetchCount += 1;
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              createShowSourceHtml([
                {
                  title: 'The Studio',
                  href: '/tv/the_studio/s01',
                  startDate: 'Premiered Mar 26, 2025',
                  criticsScore: 94,
                  audienceScore: 71,
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

    await job.run(ctx);

    expect(tvFetchCount).toBe(1);
  });

  it('routes matched TV shows to Sonarr directly when Seerr mode is off', async () => {
    const { job, settings, sonarr, seerr, tmdb } = createJob();
    const ctx = createContext({
      dryRun: false,
      input: { category: 'shows' },
    });

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          rottenTomatoesUpcomingMovies: {
            includeShows: true,
            showLimit: 1,
          },
        },
        sonarr: {
          enabled: true,
          baseUrl: 'http://sonarr.local:8989',
          defaultRootFolderPath: '/shows',
          defaultQualityProfileId: 4,
        },
      },
      secrets: {
        sonarr: { apiKey: 'sonarr-key' },
        tmdb: { apiKey: 'tmdb-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'sonarr') return 'sonarr-key';
      if (service === 'tmdb') return 'tmdb-key';
      return '';
    });
    mockFetchWithMovieAndShowPages({
      showHtml: createShowSourceHtml([
        {
          title: 'The Studio',
          href: '/tv/the_studio/s01',
          startDate: 'Premiered Mar 26, 2025',
          criticsScore: 94,
          audienceScore: 71,
        },
      ]),
    });
    sonarr.listSeries.mockResolvedValue([]);
    sonarr.listRootFolders.mockResolvedValue([{ id: 1, path: '/shows' }]);
    sonarr.listQualityProfiles.mockResolvedValue([{ id: 4, name: 'HD' }]);
    sonarr.listTags.mockResolvedValue([]);
    sonarr.addSeries.mockResolvedValue({ status: 'added', series: null });
    tmdb.searchTv.mockResolvedValue([
      { id: 1001, name: 'The Studio', first_air_date: '2025-03-26' },
    ]);
    tmdb.getTvExternalIds.mockResolvedValue({ tvdb_id: 2001 });

    const result = await job.run(ctx);
    const summary = result.summary as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;
    const shows = raw.shows as Record<string, unknown>;
    const destinationStats = shows.destinationStats as Record<string, unknown>;

    expect(sonarr.addSeries).toHaveBeenCalledWith({
      baseUrl: 'http://sonarr.local:8989',
      apiKey: 'sonarr-key',
      title: 'The Studio',
      tvdbId: 2001,
      qualityProfileId: 4,
      rootFolderPath: '/shows',
      tags: [],
      monitored: true,
      searchForMissingEpisodes: true,
      searchForCutoffUnmetEpisodes: true,
    });
    expect(seerr.requestTvAllSeasons).not.toHaveBeenCalled();
    expect(destinationStats.added).toBe(1);
    expect(destinationStats.failed).toBe(0);
  });

  it('routes matched TV shows to Seerr when Seerr mode is on', async () => {
    const { job, settings, sonarr, seerr, tmdb } = createJob();
    const ctx = createContext({
      dryRun: false,
      input: { category: 'shows' },
    });

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          rottenTomatoesUpcomingMovies: {
            routeViaSeerr: true,
            showLimit: 1,
          },
        },
        seerr: {
          enabled: true,
          baseUrl: 'http://seerr.local:5055',
        },
      },
      secrets: {
        seerr: { apiKey: 'seerr-key' },
        tmdb: { apiKey: 'tmdb-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'seerr') return 'seerr-key';
      if (service === 'tmdb') return 'tmdb-key';
      return '';
    });
    mockFetchWithMovieAndShowPages({
      showHtml: createShowSourceHtml([
        {
          title: 'The Studio',
          href: '/tv/the_studio/s01',
          startDate: 'Premiered Mar 26, 2025',
          criticsScore: 94,
          audienceScore: 71,
        },
      ]),
    });
    sonarr.listSeries.mockResolvedValue([]);
    seerr.requestTvAllSeasons.mockResolvedValue({
      status: 'requested',
      requestId: 42,
      error: null,
    });
    tmdb.searchTv.mockResolvedValue([
      { id: 1001, name: 'The Studio', first_air_date: '2025-03-26' },
    ]);
    tmdb.getTvExternalIds.mockResolvedValue({ tvdb_id: 2001 });

    const result = await job.run(ctx);
    const summary = result.summary as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;
    const shows = raw.shows as Record<string, unknown>;
    const destinationStats = shows.destinationStats as Record<string, unknown>;

    expect(seerr.requestTvAllSeasons).toHaveBeenCalledWith({
      baseUrl: 'http://seerr.local:5055',
      apiKey: 'seerr-key',
      tmdbId: 1001,
      tvdbId: 2001,
    });
    expect(sonarr.addSeries).not.toHaveBeenCalled();
    expect(destinationStats.requested).toBe(1);
    expect(destinationStats.failed).toBe(0);
  });

  it('runs the movie branch before the TV branch when both are enabled', async () => {
    const { job, settings, radarr, sonarr, tmdb } = createJob();
    const ctx = createContext({ dryRun: false, trigger: 'auto' });

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          rottenTomatoesUpcomingMovies: {
            includeMovies: true,
            includeShows: true,
            showLimit: 1,
          },
        },
        radarr: {
          enabled: true,
          baseUrl: 'http://radarr.local:7878',
          defaultRootFolderPath: '/movies',
          defaultQualityProfileId: 1,
        },
        sonarr: {
          enabled: true,
          baseUrl: 'http://sonarr.local:8989',
          defaultRootFolderPath: '/shows',
          defaultQualityProfileId: 4,
        },
      },
      secrets: {
        radarr: { apiKey: 'radarr-key' },
        sonarr: { apiKey: 'sonarr-key' },
        tmdb: { apiKey: 'tmdb-key' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'radarr') return 'radarr-key';
      if (service === 'sonarr') return 'sonarr-key';
      if (service === 'tmdb') return 'tmdb-key';
      return '';
    });
    mockFetchWithMovieAndShowPages({
      movieHtml: createMovieSourceHtml([
        {
          title: 'Touch Me',
          href: '/m/touch_me_2025',
          startDate: 'Streaming Apr 7, 2025',
        },
      ]),
      showHtml: createShowSourceHtml([
        {
          title: 'The Studio',
          href: '/tv/the_studio/s01',
          startDate: 'Premiered Mar 26, 2025',
          criticsScore: 94,
          audienceScore: 71,
        },
      ]),
    });
    radarr.listMovies.mockResolvedValue([]);
    radarr.listRootFolders.mockResolvedValue([{ id: 1, path: '/movies' }]);
    radarr.listQualityProfiles.mockResolvedValue([{ id: 1, name: 'Any' }]);
    radarr.listTags.mockResolvedValue([]);
    radarr.lookupMovies.mockResolvedValue([
      { id: 21, title: 'Touch Me', year: 2025, tmdbId: 1400763 },
    ]);
    radarr.addMovie.mockResolvedValue({ status: 'added', movie: null });
    sonarr.listSeries.mockResolvedValue([]);
    sonarr.listRootFolders.mockResolvedValue([{ id: 1, path: '/shows' }]);
    sonarr.listQualityProfiles.mockResolvedValue([{ id: 4, name: 'HD' }]);
    sonarr.listTags.mockResolvedValue([]);
    sonarr.addSeries.mockResolvedValue({ status: 'added', series: null });
    tmdb.searchTv.mockResolvedValue([
      { id: 1001, name: 'The Studio', first_air_date: '2025-03-26' },
    ]);
    tmdb.getTvExternalIds.mockResolvedValue({ tvdb_id: 2001 });

    await job.run(ctx);

    expect(radarr.lookupMovies.mock.invocationCallOrder[0]).toBeLessThan(
      tmdb.searchTv.mock.invocationCallOrder[0],
    );
  });

  it('reconciles existing Sonarr series in Seerr mode without directly adding the show to Sonarr', async () => {
    const { job, settings, plex, sonarr, seerr, tmdb } = createJob();
    const ctx = createContext({
      dryRun: false,
      input: { category: 'shows' },
    });
    const existingSeries: SonarrSeries = {
      id: 10,
      title: 'The Studio',
      tvdbId: 2001,
      monitored: false,
      seasons: [{ seasonNumber: 1, monitored: false }],
    };
    const episodes: SonarrEpisode[] = [
      { id: 101, seasonNumber: 1, episodeNumber: 1, monitored: true },
      { id: 102, seasonNumber: 1, episodeNumber: 2, monitored: false },
    ];
    const availability = createVerifiedAvailability(['1:1']);

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: {
          rottenTomatoesUpcomingMovies: {
            routeViaSeerr: true,
            showLimit: 1,
          },
        },
        sonarr: {
          enabled: true,
          baseUrl: 'http://sonarr.local:8989',
        },
        seerr: {
          enabled: true,
          baseUrl: 'http://seerr.local:5055',
        },
        plex: {
          baseUrl: 'http://plex.local:32400',
        },
      },
      secrets: {
        sonarr: { apiKey: 'sonarr-key' },
        seerr: { apiKey: 'seerr-key' },
        tmdb: { apiKey: 'tmdb-key' },
        plex: { token: 'plex-token' },
      },
    });
    settings.readServiceSecret.mockImplementation((service) => {
      if (service === 'sonarr') return 'sonarr-key';
      if (service === 'seerr') return 'seerr-key';
      if (service === 'tmdb') return 'tmdb-key';
      if (service === 'plex') return 'plex-token';
      return '';
    });
    mockFetchWithMovieAndShowPages({
      showHtml: createShowSourceHtml([
        {
          title: 'The Studio',
          href: '/tv/the_studio/s01',
          startDate: 'Premiered Mar 26, 2025',
          criticsScore: 94,
          audienceScore: 71,
        },
      ]),
    });
    sonarr.listSeries.mockResolvedValue([existingSeries]);
    sonarr.getEpisodesBySeries.mockResolvedValue(episodes);
    sonarr.setEpisodeMonitored.mockResolvedValue(true);
    sonarr.updateSeries.mockResolvedValue(true);
    seerr.requestTvAllSeasons.mockResolvedValue({
      status: 'requested',
      requestId: 42,
      error: null,
    });
    tmdb.searchTv.mockResolvedValue([
      { id: 1001, name: 'The Studio', first_air_date: '2025-03-26' },
    ]);
    tmdb.getTvExternalIds.mockResolvedValue({ tvdb_id: 2001 });
    plex.getSections.mockResolvedValue([
      { key: '1', title: 'TV', type: 'show' },
    ]);
    plex.getTvdbShowRatingKeysMapForSectionKey.mockResolvedValue(
      new Map([[2001, ['show-rating-key-1']]]),
    );
    plex.getVerifiedEpisodeAvailabilityForShowRatingKey.mockResolvedValue(
      availability,
    );

    const result = await job.run(ctx);
    const summary = result.summary as Record<string, unknown>;
    const raw = summary.raw as Record<string, unknown>;
    const shows = raw.shows as Record<string, unknown>;
    const reconciliation = shows.reconciliation as Record<string, unknown>;
    const firstEpisodeUpdate = sonarr.setEpisodeMonitored.mock
      .calls[0]?.[0] as {
      monitored: boolean;
      episode: SonarrEpisode;
    };
    const secondEpisodeUpdate = sonarr.setEpisodeMonitored.mock
      .calls[1]?.[0] as {
      monitored: boolean;
      episode: SonarrEpisode;
    };

    expect(seerr.requestTvAllSeasons).not.toHaveBeenCalled();
    expect(sonarr.addSeries).not.toHaveBeenCalled();
    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledTimes(2);
    expect(firstEpisodeUpdate.monitored).toBe(false);
    expect(firstEpisodeUpdate.episode.id).toBe(101);
    expect(secondEpisodeUpdate.monitored).toBe(true);
    expect(secondEpisodeUpdate.episode.id).toBe(102);
    expect(sonarr.updateSeries).toHaveBeenCalledTimes(1);
    expect(reconciliation.reconciledSeries).toBe(1);
    expect(reconciliation.episodesMonitored).toBe(1);
    expect(reconciliation.episodesLeftUnmonitored).toBe(1);
  });
});
