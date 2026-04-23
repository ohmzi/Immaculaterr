import { MonitorConfirmJob } from './monitor-confirm.job';
import type { JobContext, JsonObject } from './jobs.types';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrService } from '../sonarr/sonarr.service';

type SettingsMock = Pick<SettingsService, 'getInternalSettings'>;
type PlexMock = Pick<
  PlexServerService,
  | 'getSections'
  | 'getMovieTmdbIdSetForSectionKey'
  | 'getTvdbShowMapForSectionKey'
  | 'getEpisodesSet'
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

function createJob() {
  const settings: jest.Mocked<SettingsMock> = {
    getInternalSettings: jest.fn(),
  };
  const plex: jest.Mocked<PlexMock> = {
    getSections: jest.fn(),
    getMovieTmdbIdSetForSectionKey: jest.fn(),
    getTvdbShowMapForSectionKey: jest.fn(),
    getEpisodesSet: jest.fn(),
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
    plex.getMovieTmdbIdSetForSectionKey.mockResolvedValue(new Set<number>());
    radarr.listMonitoredMovies.mockResolvedValue([]);

    const result = await job.run(ctx);
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawSonarr = raw.sonarr as Record<string, unknown>;
    const issues = Array.isArray(report.issues)
      ? (report.issues as Array<Record<string, unknown>>)
      : [];

    expect(radarr.listMonitoredMovies).toHaveBeenCalledTimes(1);
    expect(sonarr.listMonitoredSeries).not.toHaveBeenCalled();
    expect(rawSonarr.configured).toBe(false);
    expect(
      issues.some((i) =>
        (typeof i.message === 'string' ? i.message : '').includes(
          'MissingEpisodeSearch was not queued',
        ),
      ),
    ).toBe(false);
  });

  it('runs with only Radarr configured', async () => {
    const { job, settings, plex, radarr, sonarr } = createJob();
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
    plex.getMovieTmdbIdSetForSectionKey.mockResolvedValue(new Set<number>());
    radarr.listMonitoredMovies.mockResolvedValue([]);

    const result = await job.run(ctx);
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawRadarr = raw.radarr as Record<string, unknown>;
    const rawSonarr = raw.sonarr as Record<string, unknown>;
    const issues = Array.isArray(report.issues)
      ? (report.issues as Array<Record<string, unknown>>)
      : [];

    expect(radarr.listMonitoredMovies).toHaveBeenCalledTimes(1);
    expect(sonarr.listMonitoredSeries).not.toHaveBeenCalled();
    expect(plex.getTvdbShowMapForSectionKey).not.toHaveBeenCalled();
    expect(rawRadarr.configured).toBe(true);
    expect(rawSonarr.configured).toBe(false);
    expect(
      issues.some((i) =>
        (typeof i.message === 'string' ? i.message : '').includes(
          'MissingEpisodeSearch was not queued',
        ),
      ),
    ).toBe(false);
  });

  it('runs with only Sonarr configured', async () => {
    const { job, settings, plex, radarr, sonarr } = createJob();
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
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>(),
    );
    sonarr.listMonitoredSeries.mockResolvedValue([]);
    sonarr.searchMonitoredEpisodes.mockResolvedValue(true);

    const result = await job.run(ctx);
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawRadarr = raw.radarr as Record<string, unknown>;
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(radarr.listMonitoredMovies).not.toHaveBeenCalled();
    expect(plex.getMovieTmdbIdSetForSectionKey).not.toHaveBeenCalled();
    expect(sonarr.listMonitoredSeries).toHaveBeenCalledTimes(1);
    expect(sonarr.searchMonitoredEpisodes).toHaveBeenCalledTimes(1);
    expect(rawRadarr.configured).toBe(false);
    expect(rawSonarr.configured).toBe(true);
  });

  it('only unmonitors Sonarr episodes that Plex already has and leaves series monitoring unchanged when a season still has a missing episode', async () => {
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
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[42, ['show-1']]]),
    );
    plex.getEpisodesSet.mockResolvedValue(new Set(['1:1']));
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
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledTimes(1);
    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledWith({
      baseUrl: 'http://sonarr.local:8989',
      apiKey: 'sonarr-key',
      episode: { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: true },
      monitored: false,
    });
    expect(sonarr.updateSeries).not.toHaveBeenCalled();
    expect(rawSonarr.episodesInPlex).toBe(1);
    expect(rawSonarr.episodesUnmonitored).toBe(1);
    expect(rawSonarr.seasonsUnmonitored).toBe(0);
    expect(rawSonarr.seriesUnmonitored).toBe(0);
  });

  it('unmonitors a Sonarr season when all its positive-numbered episodes end unmonitored', async () => {
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
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[42, ['show-1']]]),
    );
    plex.getEpisodesSet.mockResolvedValue(new Set(['1:1', '1:2', '2:1']));
    sonarr.listMonitoredSeries.mockResolvedValue([
      {
        id: 1,
        title: 'Existing Show',
        tvdbId: 42,
        monitored: true,
        seasons: [
          { seasonNumber: 1, monitored: true },
          { seasonNumber: 2, monitored: true },
        ],
      },
    ]);
    sonarr.getEpisodesBySeries.mockResolvedValue([
      { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: true },
      { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: true },
      { id: 12, seasonNumber: 2, episodeNumber: 1, monitored: true },
      { id: 13, seasonNumber: 2, episodeNumber: 2, monitored: true },
    ]);
    sonarr.setEpisodeMonitored.mockResolvedValue(true);
    sonarr.updateSeries.mockResolvedValue(true);
    sonarr.searchMonitoredEpisodes.mockResolvedValue(true);

    const result = await job.run(ctx);
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledTimes(3);
    expect(sonarr.updateSeries).toHaveBeenCalledTimes(1);
    expect(sonarr.updateSeries).toHaveBeenCalledWith({
      baseUrl: 'http://sonarr.local:8989',
      apiKey: 'sonarr-key',
      series: {
        id: 1,
        title: 'Existing Show',
        tvdbId: 42,
        monitored: true,
        seasons: [
          { seasonNumber: 1, monitored: false },
          { seasonNumber: 2, monitored: true },
        ],
      },
    });
    expect(rawSonarr.episodesUnmonitored).toBe(3);
    expect(rawSonarr.seasonsUnmonitored).toBe(1);
    expect(rawSonarr.seriesUnmonitored).toBe(0);
  });

  it('unmonitors a Sonarr series when all tracked positive-numbered seasons end unmonitored', async () => {
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
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[42, ['show-1']]]),
    );
    plex.getEpisodesSet.mockResolvedValue(new Set(['1:1', '1:2', '2:1']));
    sonarr.listMonitoredSeries.mockResolvedValue([
      {
        id: 1,
        title: 'Existing Show',
        tvdbId: 42,
        monitored: true,
        seasons: [
          { seasonNumber: 1, monitored: false },
          { seasonNumber: 2, monitored: true },
          { seasonNumber: 0, monitored: true },
        ],
      },
    ]);
    sonarr.getEpisodesBySeries.mockResolvedValue([
      { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: false },
      { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: false },
      { id: 12, seasonNumber: 2, episodeNumber: 1, monitored: true },
      { id: 13, seasonNumber: 0, episodeNumber: 1, monitored: true },
    ]);
    sonarr.setEpisodeMonitored.mockResolvedValue(true);
    sonarr.updateSeries.mockResolvedValue(true);
    sonarr.searchMonitoredEpisodes.mockResolvedValue(true);

    const result = await job.run(ctx);
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledTimes(1);
    expect(sonarr.updateSeries).toHaveBeenCalledTimes(1);
    expect(sonarr.updateSeries).toHaveBeenCalledWith({
      baseUrl: 'http://sonarr.local:8989',
      apiKey: 'sonarr-key',
      series: {
        id: 1,
        title: 'Existing Show',
        tvdbId: 42,
        monitored: false,
        seasons: [
          { seasonNumber: 1, monitored: false },
          { seasonNumber: 2, monitored: false },
          { seasonNumber: 0, monitored: true },
        ],
      },
    });
    expect(rawSonarr.episodesUnmonitored).toBe(1);
    expect(rawSonarr.seasonsUnmonitored).toBe(1);
    expect(rawSonarr.seriesUnmonitored).toBe(1);
  });

  it('keeps Sonarr season and series monitoring unchanged when the show is not matched in Plex, even if every positive-numbered episode is already unmonitored', async () => {
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
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>(),
    );
    sonarr.listMonitoredSeries.mockResolvedValue([
      {
        id: 1,
        title: '13 Reasons Why',
        tvdbId: 323168,
        monitored: true,
        seasons: [
          { seasonNumber: 0, monitored: false },
          { seasonNumber: 1, monitored: true },
          { seasonNumber: 2, monitored: true },
        ],
      },
    ]);
    sonarr.getEpisodesBySeries.mockResolvedValue([
      { id: 10, seasonNumber: 0, episodeNumber: 1, monitored: false },
      { id: 11, seasonNumber: 1, episodeNumber: 1, monitored: false },
      { id: 12, seasonNumber: 1, episodeNumber: 2, monitored: false },
      { id: 13, seasonNumber: 2, episodeNumber: 1, monitored: false },
    ]);
    sonarr.updateSeries.mockResolvedValue(true);
    sonarr.searchMonitoredEpisodes.mockResolvedValue(true);

    const result = await job.run(ctx);
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(plex.getEpisodesSet).not.toHaveBeenCalled();
    expect(sonarr.setEpisodeMonitored).not.toHaveBeenCalled();
    expect(sonarr.updateSeries).not.toHaveBeenCalled();
    expect(rawSonarr.episodesInPlex).toBe(0);
    expect(rawSonarr.episodesUnmonitored).toBe(0);
    expect(rawSonarr.seasonsUnmonitored).toBe(0);
    expect(rawSonarr.seriesUnmonitored).toBe(0);
    expect(rawSonarr.seriesWithMissing).toBe(0);
  });

  it('reports Sonarr season and series cascade counts in dry-run mode without mutating Sonarr', async () => {
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
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[42, ['show-1']]]),
    );
    plex.getEpisodesSet.mockResolvedValue(new Set(['1:1', '1:2']));
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

    const result = await job.run(ctx);
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(sonarr.setEpisodeMonitored).not.toHaveBeenCalled();
    expect(sonarr.updateSeries).not.toHaveBeenCalled();
    expect(sonarr.searchMonitoredEpisodes).not.toHaveBeenCalled();
    expect(rawSonarr.episodesUnmonitored).toBe(2);
    expect(rawSonarr.seasonsUnmonitored).toBe(1);
    expect(rawSonarr.seriesUnmonitored).toBe(1);
  });

  it('does not unmonitor Sonarr items when Plex has the show but no episodes', async () => {
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
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[42, ['show-1']]]),
    );
    plex.getEpisodesSet.mockResolvedValue(new Set());
    sonarr.listMonitoredSeries.mockResolvedValue([
      { id: 1, title: 'Metadata Only Show', tvdbId: 42, monitored: true },
    ]);
    sonarr.getEpisodesBySeries.mockResolvedValue([
      { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: true },
      { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: true },
    ]);
    sonarr.searchMonitoredEpisodes.mockResolvedValue(true);

    const result = await job.run(ctx);
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(sonarr.setEpisodeMonitored).not.toHaveBeenCalled();
    expect(sonarr.updateSeries).not.toHaveBeenCalled();
    expect(rawSonarr.episodesInPlex).toBe(0);
    expect(rawSonarr.episodesUnmonitored).toBe(0);
    expect(rawSonarr.seasonsUnmonitored).toBe(0);
    expect(rawSonarr.seriesUnmonitored).toBe(0);
    expect(rawSonarr.seriesWithMissing).toBe(1);
  });

  it('keeps Sonarr series monitoring unchanged when monitored positive-numbered episodes remain under an already-unmonitored season', async () => {
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
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[42, ['show-1']]]),
    );
    plex.getEpisodesSet.mockResolvedValue(new Set());
    sonarr.listMonitoredSeries.mockResolvedValue([
      {
        id: 1,
        title: 'Metadata Drift Show',
        tvdbId: 42,
        monitored: true,
        seasons: [{ seasonNumber: 1, monitored: false }],
      },
    ]);
    sonarr.getEpisodesBySeries.mockResolvedValue([
      { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: true },
    ]);
    sonarr.searchMonitoredEpisodes.mockResolvedValue(true);

    const result = await job.run(ctx);
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(sonarr.setEpisodeMonitored).not.toHaveBeenCalled();
    expect(sonarr.updateSeries).not.toHaveBeenCalled();
    expect(rawSonarr.episodesInPlex).toBe(0);
    expect(rawSonarr.episodesUnmonitored).toBe(0);
    expect(rawSonarr.seasonsUnmonitored).toBe(0);
    expect(rawSonarr.seriesUnmonitored).toBe(0);
    expect(rawSonarr.seriesWithMissing).toBe(1);
  });

  it('keeps Sonarr season and series monitoring unchanged when season metadata is missing', async () => {
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
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(
      new Map<number, string[]>([[42, ['show-1']]]),
    );
    plex.getEpisodesSet.mockResolvedValue(new Set(['1:1', '1:2']));
    sonarr.listMonitoredSeries.mockResolvedValue([
      { id: 1, title: 'Existing Show', tvdbId: 42, monitored: true },
    ]);
    sonarr.getEpisodesBySeries.mockResolvedValue([
      { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: true },
      { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: true },
    ]);
    sonarr.setEpisodeMonitored.mockResolvedValue(true);
    sonarr.searchMonitoredEpisodes.mockResolvedValue(true);

    const result = await job.run(ctx);
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledTimes(2);
    expect(sonarr.updateSeries).not.toHaveBeenCalled();
    expect(rawSonarr.episodesUnmonitored).toBe(2);
    expect(rawSonarr.seasonsUnmonitored).toBe(0);
    expect(rawSonarr.seriesUnmonitored).toBe(0);
  });
});
