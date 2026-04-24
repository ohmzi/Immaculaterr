import { MonitorConfirmJob } from './monitor-confirm.job';
import type { JobContext, JsonObject } from './jobs.types';
import { SettingsService } from '../settings/settings.service';
import {
  PlexServerService,
  type PlexPartPlayableProbeResult,
  type PlexVerifiedEpisodeAvailability,
} from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrService } from '../sonarr/sonarr.service';

type SettingsMock = Pick<SettingsService, 'getInternalSettings'>;
type PlexMock = Pick<
  PlexServerService,
  | 'getSections'
  | 'getMovieTmdbRatingKeysMapForSectionKey'
  | 'verifyPlayableMetadataByRatingKey'
  | 'getTvdbShowRatingKeysMapForSectionKey'
  | 'getVerifiedEpisodeAvailabilityForShowRatingKey'
>;
type RadarrMock = Pick<
  RadarrService,
  'listMonitoredMovies' | 'setMovieMonitored'
>;
type SonarrMock = Pick<
  SonarrService,
  | 'listMonitoredSeries'
  | 'getEpisodesBySeries'
  | 'setEpisodeMonitored'
  | 'updateSeries'
  | 'searchMonitoredEpisodes'
>;

function createContext(dryRun = false): JobContext {
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
    jobId: 'monitorConfirm',
    runId: 'run-1',
    userId: 'user-1',
    dryRun,
    trigger: 'manual',
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

function playableResult(
  playable: boolean,
  probeFailureCount = 0,
): PlexPartPlayableProbeResult {
  return { playable, probeFailureCount };
}

function episodeAvailability(params: {
  verifiedEpisodes?: string[];
  metadataEpisodes?: string[];
  probeFailureCount?: number;
}): PlexVerifiedEpisodeAvailability {
  return {
    verifiedEpisodes: new Set(params.verifiedEpisodes ?? []),
    metadataEpisodes: new Set(params.metadataEpisodes ?? []),
    probeFailureCount: params.probeFailureCount ?? 0,
  };
}

function createJob() {
  const settings: jest.Mocked<SettingsMock> = {
    getInternalSettings: jest.fn(),
  };
  const plex: jest.Mocked<PlexMock> = {
    getSections: jest.fn(),
    getMovieTmdbRatingKeysMapForSectionKey: jest.fn(),
    verifyPlayableMetadataByRatingKey: jest.fn(),
    getTvdbShowRatingKeysMapForSectionKey: jest.fn(),
    getVerifiedEpisodeAvailabilityForShowRatingKey: jest.fn(),
  };
  const radarr: jest.Mocked<RadarrMock> = {
    listMonitoredMovies: jest.fn(),
    setMovieMonitored: jest.fn(),
  };
  const sonarr: jest.Mocked<SonarrMock> = {
    listMonitoredSeries: jest.fn(),
    getEpisodesBySeries: jest.fn(),
    setEpisodeMonitored: jest.fn(),
    updateSeries: jest.fn(),
    searchMonitoredEpisodes: jest.fn(),
  };

  const job = new MonitorConfirmJob(
    settings as unknown as SettingsService,
    plex as unknown as PlexServerService,
    radarr as unknown as RadarrService,
    sonarr as unknown as SonarrService,
  );

  return { job, settings, plex, radarr, sonarr };
}

function expectRaw(result: Awaited<ReturnType<MonitorConfirmJob['run']>>) {
  const report = result.summary as unknown as Record<string, unknown>;
  return report.raw as Record<string, unknown>;
}

describe('MonitorConfirmJob', () => {
  it('treats Sonarr as not configured when vault disables it, even if credentials exist', async () => {
    const { job, settings, plex, radarr, sonarr } = createJob();
    const ctx = createContext(false);

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.local:32400' },
        radarr: { baseUrl: 'http://radarr.local:7878', enabled: true },
        sonarr: { baseUrl: 'http://sonarr.local:8989', enabled: false },
      },
      secrets: {
        plex: { token: 'plex-token' },
        'plex.token': 'plex-token',
        radarr: { apiKey: 'radarr-key' },
        'radarr.apiKey': 'radarr-key',
        sonarr: { apiKey: 'sonarr-key' },
        'sonarr.apiKey': 'sonarr-key',
      },
    });
    plex.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plex.getMovieTmdbRatingKeysMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>(),
    );
    radarr.listMonitoredMovies.mockResolvedValue([]);

    const result = await job.run(ctx);
    const raw = expectRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(radarr.listMonitoredMovies).toHaveBeenCalledTimes(1);
    expect(sonarr.listMonitoredSeries).not.toHaveBeenCalled();
    expect(rawSonarr.configured).toBe(false);
  });

  it('unmonitors a Radarr movie only when a Plex metadata match is verified playable', async () => {
    const { job, settings, plex, radarr } = createJob();
    const ctx = createContext(false);

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.local:32400' },
        radarr: { baseUrl: 'http://radarr.local:7878' },
      },
      secrets: {
        plex: { token: 'plex-token' },
        'plex.token': 'plex-token',
        radarr: { apiKey: 'radarr-key' },
        'radarr.apiKey': 'radarr-key',
      },
    });
    plex.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plex.getMovieTmdbRatingKeysMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[101, ['movie-1']]]),
    );
    plex.verifyPlayableMetadataByRatingKey.mockResolvedValue(
      playableResult(true),
    );
    radarr.listMonitoredMovies.mockResolvedValue([
      { id: 7, title: 'Playable Movie', tmdbId: 101, monitored: true },
    ]);
    radarr.setMovieMonitored.mockResolvedValue(true);

    const result = await job.run(ctx);
    const raw = expectRaw(result);
    const rawRadarr = raw.radarr as Record<string, unknown>;

    const verifyCall =
      plex.verifyPlayableMetadataByRatingKey.mock.calls[0]?.[0] ?? null;

    expect(verifyCall?.baseUrl).toBe('http://plex.local:32400');
    expect(verifyCall?.token).toBe('plex-token');
    expect(verifyCall?.ratingKey).toBe('movie-1');
    expect(verifyCall?.partProbeCache).toBeInstanceOf(Map);
    expect(radarr.setMovieMonitored).toHaveBeenCalledWith({
      baseUrl: 'http://radarr.local:7878',
      apiKey: 'radarr-key',
      movie: { id: 7, title: 'Playable Movie', tmdbId: 101, monitored: true },
      monitored: false,
    });
    expect(rawRadarr.metadataMatches).toBe(1);
    expect(rawRadarr.alreadyInPlex).toBe(1);
    expect(rawRadarr.unverifiedMatches).toBe(0);
    expect(rawRadarr.unmonitored).toBe(1);
  });

  it('keeps a Radarr movie monitored when Plex metadata matches but media is not verified playable', async () => {
    const { job, settings, plex, radarr } = createJob();
    const ctx = createContext(false);

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.local:32400' },
        radarr: { baseUrl: 'http://radarr.local:7878' },
      },
      secrets: {
        plex: { token: 'plex-token' },
        'plex.token': 'plex-token',
        radarr: { apiKey: 'radarr-key' },
        'radarr.apiKey': 'radarr-key',
      },
    });
    plex.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plex.getMovieTmdbRatingKeysMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[101, ['movie-1']]]),
    );
    plex.verifyPlayableMetadataByRatingKey.mockResolvedValue(
      playableResult(false),
    );
    radarr.listMonitoredMovies.mockResolvedValue([
      { id: 7, title: 'Metadata Only Movie', tmdbId: 101, monitored: true },
    ]);

    const result = await job.run(ctx);
    const raw = expectRaw(result);
    const rawRadarr = raw.radarr as Record<string, unknown>;

    expect(radarr.setMovieMonitored).not.toHaveBeenCalled();
    expect(rawRadarr.metadataMatches).toBe(1);
    expect(rawRadarr.alreadyInPlex).toBe(0);
    expect(rawRadarr.unverifiedMatches).toBe(1);
    expect(rawRadarr.keptMonitored).toBe(1);
  });

  it('keeps a Radarr movie monitored and records probe failures when every candidate verification fails', async () => {
    const { job, settings, plex, radarr } = createJob();
    const ctx = createContext(false);

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.local:32400' },
        radarr: { baseUrl: 'http://radarr.local:7878' },
      },
      secrets: {
        plex: { token: 'plex-token' },
        'plex.token': 'plex-token',
        radarr: { apiKey: 'radarr-key' },
        'radarr.apiKey': 'radarr-key',
      },
    });
    plex.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plex.getMovieTmdbRatingKeysMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[101, ['movie-1', 'movie-2']]]),
    );
    plex.verifyPlayableMetadataByRatingKey
      .mockResolvedValueOnce(playableResult(false, 2))
      .mockResolvedValueOnce(playableResult(false, 1));
    radarr.listMonitoredMovies.mockResolvedValue([
      { id: 7, title: 'Probe Failure Movie', tmdbId: 101, monitored: true },
    ]);

    const result = await job.run(ctx);
    const raw = expectRaw(result);
    const rawRadarr = raw.radarr as Record<string, unknown>;

    expect(radarr.setMovieMonitored).not.toHaveBeenCalled();
    expect(rawRadarr.unverifiedMatches).toBe(1);
    expect(rawRadarr.probeFailures).toBe(3);
    expect(rawRadarr.keptMonitored).toBe(1);
  });

  it('only unmonitors exact Sonarr episodes verified playable in Plex and keeps the season monitored when another episode is missing', async () => {
    const { job, settings, plex, sonarr } = createJob();
    const ctx = createContext(false);

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.local:32400' },
        sonarr: { baseUrl: 'http://sonarr.local:8989' },
      },
      secrets: {
        plex: { token: 'plex-token' },
        'plex.token': 'plex-token',
        sonarr: { apiKey: 'sonarr-key' },
        'sonarr.apiKey': 'sonarr-key',
      },
    });
    plex.getSections.mockResolvedValue([
      { key: '2', title: 'Shows', type: 'show' },
    ]);
    plex.getTvdbShowRatingKeysMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[42, ['show-1']]]),
    );
    plex.getVerifiedEpisodeAvailabilityForShowRatingKey.mockResolvedValue(
      episodeAvailability({
        verifiedEpisodes: ['1:1'],
        metadataEpisodes: ['1:1'],
      }),
    );
    sonarr.listMonitoredSeries.mockResolvedValue([
      {
        id: 1,
        title: 'Existing Show',
        tvdbId: 42,
        monitored: true,
        seasons: [{ seasonNumber: 1, monitored: true }],
      },
    ]);
    sonarr.getEpisodesBySeries.mockResolvedValue([
      { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: true },
      { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: true },
    ]);
    sonarr.setEpisodeMonitored.mockResolvedValue(true);
    sonarr.searchMonitoredEpisodes.mockResolvedValue(true);

    const result = await job.run(ctx);
    const raw = expectRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledTimes(1);
    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledWith({
      baseUrl: 'http://sonarr.local:8989',
      apiKey: 'sonarr-key',
      episode: { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: true },
      monitored: false,
    });
    expect(sonarr.updateSeries).not.toHaveBeenCalled();
    expect(rawSonarr.episodeMetadataMatches).toBe(1);
    expect(rawSonarr.episodesInPlex).toBe(1);
    expect(rawSonarr.unverifiedEpisodes).toBe(0);
    expect(rawSonarr.seasonsUnmonitored).toBe(0);
    expect(rawSonarr.seriesUnmonitored).toBe(0);
  });

  it('keeps Sonarr episodes monitored when exact episode metadata exists but is not verified playable', async () => {
    const { job, settings, plex, sonarr } = createJob();
    const ctx = createContext(false);

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.local:32400' },
        sonarr: { baseUrl: 'http://sonarr.local:8989' },
      },
      secrets: {
        plex: { token: 'plex-token' },
        'plex.token': 'plex-token',
        sonarr: { apiKey: 'sonarr-key' },
        'sonarr.apiKey': 'sonarr-key',
      },
    });
    plex.getSections.mockResolvedValue([
      { key: '2', title: 'Shows', type: 'show' },
    ]);
    plex.getTvdbShowRatingKeysMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[42, ['show-1']]]),
    );
    plex.getVerifiedEpisodeAvailabilityForShowRatingKey.mockResolvedValue(
      episodeAvailability({
        metadataEpisodes: ['1:1'],
      }),
    );
    sonarr.listMonitoredSeries.mockResolvedValue([
      {
        id: 1,
        title: 'Metadata Only Show',
        tvdbId: 42,
        monitored: true,
        seasons: [{ seasonNumber: 1, monitored: true }],
      },
    ]);
    sonarr.getEpisodesBySeries.mockResolvedValue([
      { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: true },
    ]);
    sonarr.searchMonitoredEpisodes.mockResolvedValue(true);

    const result = await job.run(ctx);
    const raw = expectRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(sonarr.setEpisodeMonitored).not.toHaveBeenCalled();
    expect(sonarr.updateSeries).not.toHaveBeenCalled();
    expect(rawSonarr.episodeMetadataMatches).toBe(1);
    expect(rawSonarr.episodesInPlex).toBe(0);
    expect(rawSonarr.unverifiedEpisodes).toBe(1);
    expect(rawSonarr.seriesWithMissing).toBe(1);
  });

  it('runs Sonarr season cascade only after the episode pass completes for every series', async () => {
    const { job, settings, plex, sonarr } = createJob();
    const ctx = createContext(false);
    const callLog: string[] = [];

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.local:32400' },
        sonarr: { baseUrl: 'http://sonarr.local:8989' },
      },
      secrets: {
        plex: { token: 'plex-token' },
        'plex.token': 'plex-token',
        sonarr: { apiKey: 'sonarr-key' },
        'sonarr.apiKey': 'sonarr-key',
      },
    });
    plex.getSections.mockResolvedValue([
      { key: '2', title: 'Shows', type: 'show' },
    ]);
    plex.getTvdbShowRatingKeysMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([
        [42, ['show-1']],
        [43, ['show-2']],
      ]),
    );
    plex.getVerifiedEpisodeAvailabilityForShowRatingKey
      .mockResolvedValueOnce(
        episodeAvailability({
          verifiedEpisodes: ['1:1', '1:2'],
          metadataEpisodes: ['1:1', '1:2'],
        }),
      )
      .mockResolvedValueOnce(
        episodeAvailability({
          verifiedEpisodes: [],
          metadataEpisodes: [],
        }),
      );
    sonarr.listMonitoredSeries.mockResolvedValue([
      {
        id: 1,
        title: 'Season Cascade',
        tvdbId: 42,
        monitored: true,
        seasons: [
          { seasonNumber: 1, monitored: true },
          { seasonNumber: 2, monitored: true },
        ],
      },
      {
        id: 2,
        title: 'Still Missing',
        tvdbId: 43,
        monitored: true,
        seasons: [{ seasonNumber: 1, monitored: true }],
      },
    ]);
    sonarr.getEpisodesBySeries.mockImplementation(({ seriesId }) => {
      callLog.push(`episodes:${seriesId}`);
      if (seriesId === 1) {
        return Promise.resolve([
          { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: true },
          { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: true },
          { id: 12, seasonNumber: 2, episodeNumber: 1, monitored: true },
        ]);
      }
      return Promise.resolve([
        { id: 20, seasonNumber: 1, episodeNumber: 1, monitored: true },
      ]);
    });
    sonarr.setEpisodeMonitored.mockImplementation(({ episode }) => {
      callLog.push(`episode:${episode.id}`);
      return Promise.resolve(true);
    });
    sonarr.updateSeries.mockImplementation(({ series }) => {
      callLog.push(
        `update:${series.id}:${series.monitored === false ? 'series' : 'season'}`,
      );
      return Promise.resolve(true);
    });
    sonarr.searchMonitoredEpisodes.mockResolvedValue(true);

    const result = await job.run(ctx);
    const raw = expectRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(callLog).toEqual([
      'episodes:1',
      'episode:10',
      'episode:11',
      'episodes:2',
      'update:1:season',
    ]);
    expect(rawSonarr.seasonsUnmonitored).toBe(1);
    expect(rawSonarr.seriesUnmonitored).toBe(0);
  });

  it('runs Sonarr series cascade only after the season pass has completed', async () => {
    const { job, settings, plex, sonarr } = createJob();
    const ctx = createContext(false);
    const callLog: string[] = [];

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.local:32400' },
        sonarr: { baseUrl: 'http://sonarr.local:8989' },
      },
      secrets: {
        plex: { token: 'plex-token' },
        'plex.token': 'plex-token',
        sonarr: { apiKey: 'sonarr-key' },
        'sonarr.apiKey': 'sonarr-key',
      },
    });
    plex.getSections.mockResolvedValue([
      { key: '2', title: 'Shows', type: 'show' },
    ]);
    plex.getTvdbShowRatingKeysMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[42, ['show-1']]]),
    );
    plex.getVerifiedEpisodeAvailabilityForShowRatingKey.mockResolvedValue(
      episodeAvailability({
        verifiedEpisodes: ['2:1'],
        metadataEpisodes: ['2:1'],
      }),
    );
    sonarr.listMonitoredSeries.mockResolvedValue([
      {
        id: 1,
        title: 'Series Cascade',
        tvdbId: 42,
        monitored: true,
        seasons: [
          { seasonNumber: 1, monitored: false },
          { seasonNumber: 2, monitored: true },
          { seasonNumber: 0, monitored: true },
        ],
      },
    ]);
    sonarr.getEpisodesBySeries.mockImplementation(({ seriesId }) => {
      callLog.push(`episodes:${seriesId}`);
      return Promise.resolve([
        { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: false },
        { id: 20, seasonNumber: 2, episodeNumber: 1, monitored: true },
        { id: 30, seasonNumber: 0, episodeNumber: 1, monitored: true },
      ]);
    });
    sonarr.setEpisodeMonitored.mockImplementation(({ episode }) => {
      callLog.push(`episode:${episode.id}`);
      return Promise.resolve(true);
    });
    sonarr.updateSeries.mockImplementation(({ series }) => {
      callLog.push(
        `update:${series.id}:${series.monitored === false ? 'series' : 'season'}`,
      );
      return Promise.resolve(true);
    });
    sonarr.searchMonitoredEpisodes.mockResolvedValue(true);

    const result = await job.run(ctx);
    const raw = expectRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(callLog).toEqual([
      'episodes:1',
      'episode:20',
      'update:1:season',
      'update:1:series',
    ]);
    expect(rawSonarr.seasonsUnmonitored).toBe(1);
    expect(rawSonarr.seriesUnmonitored).toBe(1);
    expect(sonarr.updateSeries).toHaveBeenNthCalledWith(1, {
      baseUrl: 'http://sonarr.local:8989',
      apiKey: 'sonarr-key',
      series: {
        id: 1,
        title: 'Series Cascade',
        tvdbId: 42,
        monitored: true,
        seasons: [
          { seasonNumber: 1, monitored: false },
          { seasonNumber: 2, monitored: false },
          { seasonNumber: 0, monitored: true },
        ],
      },
    });
    expect(sonarr.updateSeries).toHaveBeenNthCalledWith(2, {
      baseUrl: 'http://sonarr.local:8989',
      apiKey: 'sonarr-key',
      series: {
        id: 1,
        title: 'Series Cascade',
        tvdbId: 42,
        monitored: false,
        seasons: [
          { seasonNumber: 1, monitored: false },
          { seasonNumber: 2, monitored: false },
          { seasonNumber: 0, monitored: true },
        ],
      },
    });
  });

  it('reports dry-run episode, season, and series outcomes without mutating Sonarr or Radarr', async () => {
    const { job, settings, plex, sonarr } = createJob();
    const ctx = createContext(true);

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.local:32400' },
        sonarr: { baseUrl: 'http://sonarr.local:8989' },
      },
      secrets: {
        plex: { token: 'plex-token' },
        'plex.token': 'plex-token',
        sonarr: { apiKey: 'sonarr-key' },
        'sonarr.apiKey': 'sonarr-key',
      },
    });
    plex.getSections.mockResolvedValue([
      { key: '2', title: 'Shows', type: 'show' },
    ]);
    plex.getTvdbShowRatingKeysMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[42, ['show-1']]]),
    );
    plex.getVerifiedEpisodeAvailabilityForShowRatingKey.mockResolvedValue(
      episodeAvailability({
        verifiedEpisodes: ['1:1', '1:2'],
        metadataEpisodes: ['1:1', '1:2'],
      }),
    );
    sonarr.listMonitoredSeries.mockResolvedValue([
      {
        id: 1,
        title: 'Dry Run Show',
        tvdbId: 42,
        monitored: true,
        seasons: [{ seasonNumber: 1, monitored: true }],
      },
    ]);
    sonarr.getEpisodesBySeries.mockResolvedValue([
      { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: true },
      { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: true },
    ]);

    const result = await job.run(ctx);
    const raw = expectRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(sonarr.setEpisodeMonitored).not.toHaveBeenCalled();
    expect(sonarr.updateSeries).not.toHaveBeenCalled();
    expect(sonarr.searchMonitoredEpisodes).not.toHaveBeenCalled();
    expect(rawSonarr.episodesUnmonitored).toBe(2);
    expect(rawSonarr.seasonsUnmonitored).toBe(1);
    expect(rawSonarr.seriesUnmonitored).toBe(1);
  });

  it('records Sonarr probe failures, keeps episodes monitored, and queues MissingEpisodeSearch after all passes finish', async () => {
    const { job, settings, plex, sonarr } = createJob();
    const ctx = createContext(false);
    const callLog: string[] = [];

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.local:32400' },
        sonarr: { baseUrl: 'http://sonarr.local:8989' },
      },
      secrets: {
        plex: { token: 'plex-token' },
        'plex.token': 'plex-token',
        sonarr: { apiKey: 'sonarr-key' },
        'sonarr.apiKey': 'sonarr-key',
      },
    });
    plex.getSections.mockResolvedValue([
      { key: '2', title: 'Shows', type: 'show' },
    ]);
    plex.getTvdbShowRatingKeysMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[42, ['show-1']]]),
    );
    plex.getVerifiedEpisodeAvailabilityForShowRatingKey.mockResolvedValue(
      episodeAvailability({
        probeFailureCount: 2,
      }),
    );
    sonarr.listMonitoredSeries.mockResolvedValue([
      {
        id: 1,
        title: 'Probe Failure Show',
        tvdbId: 42,
        monitored: true,
        seasons: [{ seasonNumber: 1, monitored: true }],
      },
    ]);
    sonarr.getEpisodesBySeries.mockImplementation(({ seriesId }) => {
      callLog.push(`episodes:${seriesId}`);
      return Promise.resolve([
        { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: true },
      ]);
    });
    sonarr.searchMonitoredEpisodes.mockImplementation(() => {
      callLog.push('search');
      return Promise.resolve(true);
    });

    const result = await job.run(ctx);
    const raw = expectRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(sonarr.setEpisodeMonitored).not.toHaveBeenCalled();
    expect(rawSonarr.probeFailures).toBe(2);
    expect(rawSonarr.episodesUnmonitored).toBe(0);
    expect(callLog).toEqual(['episodes:1', 'search']);
  });
});
