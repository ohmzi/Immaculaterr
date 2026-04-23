import { UnmonitorConfirmJob } from './unmonitor-confirm.job';
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
type RadarrMock = Pick<RadarrService, 'listMovies' | 'setMovieMonitored'>;
type SonarrMock = Pick<
  SonarrService,
  'listMonitoredSeries' | 'getEpisodesBySeries' | 'setEpisodeMonitored'
>;

function createContext(dryRun = false, input?: JsonObject): JobContext {
  let currentSummary: JsonObject | null = null;
  const setSummary = jest.fn((summary: JsonObject | null) => {
    currentSummary = summary;
    return Promise.resolve();
  });
  const patchSummary = jest.fn((patch: JsonObject) => {
    currentSummary = { ...(currentSummary ?? {}), ...patch };
    return Promise.resolve();
  });
  const log = jest.fn(() => Promise.resolve(undefined));

  return {
    jobId: 'unmonitorConfirm',
    runId: 'run-1',
    userId: 'user-1',
    dryRun,
    trigger: 'manual',
    ...(input ? { input } : {}),
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
    listMovies: jest.fn(),
    setMovieMonitored: jest.fn(),
  };
  const sonarr: jest.Mocked<SonarrMock> = {
    listMonitoredSeries: jest.fn(),
    getEpisodesBySeries: jest.fn(),
    setEpisodeMonitored: jest.fn(),
  };

  const job = new UnmonitorConfirmJob(
    settings as unknown as SettingsService,
    plex as unknown as PlexServerService,
    radarr as unknown as RadarrService,
    sonarr as unknown as SonarrService,
  );

  return { job, settings, plex, radarr, sonarr };
}

function mockRadarrConfiguredSettings(settings: jest.Mocked<SettingsMock>) {
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
}

function mockSonarrConfiguredSettings(settings: jest.Mocked<SettingsMock>) {
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
}

function expectReportRaw(
  result: Awaited<ReturnType<UnmonitorConfirmJob['run']>>,
) {
  const report = result.summary as Record<string, unknown>;
  expect(report.template).toBe('jobReportV1');
  expect(report.version).toBe(1);
  return report.raw as Record<string, unknown>;
}

function hasIssueMessage(entry: Record<string, unknown>, text: string) {
  return typeof entry.message === 'string' && entry.message.includes(text);
}

describe('UnmonitorConfirmJob', () => {
  it('default/no target still runs the existing Radarr path', async () => {
    const { job, settings, plex, radarr, sonarr } = createJob();
    const ctx = createContext(false);

    mockRadarrConfiguredSettings(settings);
    plex.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plex.getMovieTmdbIdSetForSectionKey.mockResolvedValue(new Set([100]));
    radarr.listMovies.mockResolvedValue([
      { id: 1, title: 'Exists', tmdbId: 100, monitored: false },
      { id: 2, title: 'Missing', tmdbId: 200, monitored: false },
    ]);
    radarr.setMovieMonitored.mockResolvedValue(true);

    const result = await job.run(ctx);
    const raw = expectReportRaw(result);
    const rawRadarr = raw.radarr as Record<string, unknown>;

    expect(raw.target).toBe('radarr');
    expect(radarr.setMovieMonitored).toHaveBeenCalledTimes(1);
    expect(radarr.setMovieMonitored).toHaveBeenCalledWith({
      baseUrl: 'http://radarr.local:7878',
      apiKey: 'radarr-key',
      movie: { id: 2, title: 'Missing', tmdbId: 200, monitored: false },
      monitored: true,
    });
    expect(sonarr.listMonitoredSeries).not.toHaveBeenCalled();
    expect(rawRadarr.missingFromPlex).toBe(1);
    expect(rawRadarr.remonitored).toBe(1);
  });

  it('explicit target radarr matches the default behavior', async () => {
    const defaultRun = createJob();
    const explicitRun = createJob();

    mockRadarrConfiguredSettings(defaultRun.settings);
    mockRadarrConfiguredSettings(explicitRun.settings);

    defaultRun.plex.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    explicitRun.plex.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    defaultRun.plex.getMovieTmdbIdSetForSectionKey.mockResolvedValue(
      new Set([100]),
    );
    explicitRun.plex.getMovieTmdbIdSetForSectionKey.mockResolvedValue(
      new Set([100]),
    );
    defaultRun.radarr.listMovies.mockResolvedValue([
      { id: 1, title: 'Exists', tmdbId: 100, monitored: false },
      { id: 2, title: 'Missing', tmdbId: 200, monitored: false },
      { id: 3, title: 'Unknown', monitored: false },
    ]);
    explicitRun.radarr.listMovies.mockResolvedValue([
      { id: 1, title: 'Exists', tmdbId: 100, monitored: false },
      { id: 2, title: 'Missing', tmdbId: 200, monitored: false },
      { id: 3, title: 'Unknown', monitored: false },
    ]);
    defaultRun.radarr.setMovieMonitored.mockResolvedValue(true);
    explicitRun.radarr.setMovieMonitored.mockResolvedValue(true);

    const defaultResult = await defaultRun.job.run(createContext(false));
    const explicitResult = await explicitRun.job.run(
      createContext(false, { target: 'radarr' }),
    );

    const defaultRaw = expectReportRaw(defaultResult);
    const explicitRaw = expectReportRaw(explicitResult);

    expect(explicitRaw.target).toBe('radarr');
    expect(explicitRaw.radarr).toEqual(defaultRaw.radarr);
  });

  it('Sonarr re-monitors only missing unmonitored episodes and leaves Plex episodes unchanged', async () => {
    const { job, settings, plex, sonarr, radarr } = createJob();
    const ctx = createContext(false, { target: 'sonarr' });

    mockSonarrConfiguredSettings(settings);
    plex.getSections.mockResolvedValue([
      { key: '2', title: 'Shows', type: 'show' },
    ]);
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(
      new Map<number, string>([[42, 'show-1']]),
    );
    plex.getEpisodesSet.mockResolvedValue(new Set(['1:1']));
    sonarr.listMonitoredSeries.mockResolvedValue([
      { id: 1, title: 'Existing Show', tvdbId: 42, monitored: true },
    ]);
    sonarr.getEpisodesBySeries
      .mockResolvedValueOnce([
        { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: false },
        { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: false },
        { id: 12, seasonNumber: 1, episodeNumber: 3, monitored: true },
      ])
      .mockResolvedValueOnce([
        { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: false },
        { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: true },
        { id: 12, seasonNumber: 1, episodeNumber: 3, monitored: true },
      ]);
    sonarr.setEpisodeMonitored.mockResolvedValue(true);

    const result = await job.run(ctx);
    const raw = expectReportRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(raw.target).toBe('sonarr');
    expect(radarr.listMovies).not.toHaveBeenCalled();
    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledTimes(1);
    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledWith({
      baseUrl: 'http://sonarr.local:8989',
      apiKey: 'sonarr-key',
      episode: { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: false },
      monitored: true,
    });
    expect(rawSonarr.unmonitoredEpisodesChecked).toBe(2);
    expect(rawSonarr.keptUnmonitored).toBe(1);
    expect(rawSonarr.missingFromPlex).toBe(1);
    expect(rawSonarr.remonitored).toBe(1);
  });

  it('Sonarr re-monitors all currently unmonitored non-special episodes when Plex has no matching show', async () => {
    const { job, settings, plex, sonarr } = createJob();
    const ctx = createContext(false, { target: 'sonarr' });

    mockSonarrConfiguredSettings(settings);
    plex.getSections.mockResolvedValue([
      { key: '2', title: 'Shows', type: 'show' },
    ]);
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(new Map());
    sonarr.listMonitoredSeries.mockResolvedValue([
      { id: 1, title: 'Show Missing In Plex', tvdbId: 42, monitored: true },
    ]);
    sonarr.getEpisodesBySeries
      .mockResolvedValueOnce([
        { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: false },
        { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: false },
        { id: 12, seasonNumber: 0, episodeNumber: 1, monitored: false },
      ])
      .mockResolvedValueOnce([
        { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: true },
        { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: true },
        { id: 12, seasonNumber: 0, episodeNumber: 1, monitored: false },
      ]);
    sonarr.setEpisodeMonitored.mockResolvedValue(true);

    const result = await job.run(ctx);
    const raw = expectReportRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(plex.getEpisodesSet).not.toHaveBeenCalled();
    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledTimes(2);
    expect(rawSonarr.missingFromPlex).toBe(2);
    expect(rawSonarr.remonitored).toBe(2);
    expect(rawSonarr.keptUnmonitored).toBe(0);
  });

  it('Sonarr partial Plex coverage only re-monitors the missing episode keys', async () => {
    const { job, settings, plex, sonarr } = createJob();
    const ctx = createContext(false, { target: 'sonarr' });

    mockSonarrConfiguredSettings(settings);
    plex.getSections.mockResolvedValue([
      { key: '2', title: 'Shows A', type: 'show' },
      { key: '3', title: 'Shows B', type: 'show' },
    ]);
    plex.getTvdbShowMapForSectionKey
      .mockResolvedValueOnce(new Map<number, string>([[42, 'show-1']]))
      .mockResolvedValueOnce(new Map<number, string>([[42, 'show-2']]));
    plex.getEpisodesSet
      .mockResolvedValueOnce(new Set(['1:1']))
      .mockResolvedValueOnce(new Set(['1:3']));
    sonarr.listMonitoredSeries.mockResolvedValue([
      { id: 1, title: 'Split Library Show', tvdbId: 42, monitored: true },
    ]);
    sonarr.getEpisodesBySeries
      .mockResolvedValueOnce([
        { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: false },
        { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: false },
        { id: 12, seasonNumber: 1, episodeNumber: 3, monitored: false },
      ])
      .mockResolvedValueOnce([
        { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: false },
        { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: true },
        { id: 12, seasonNumber: 1, episodeNumber: 3, monitored: false },
      ]);
    sonarr.setEpisodeMonitored.mockResolvedValue(true);

    const result = await job.run(ctx);
    const raw = expectReportRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledTimes(1);
    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledWith({
      baseUrl: 'http://sonarr.local:8989',
      apiKey: 'sonarr-key',
      episode: { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: false },
      monitored: true,
    });
    expect(rawSonarr.keptUnmonitored).toBe(2);
    expect(rawSonarr.missingFromPlex).toBe(1);
    expect(rawSonarr.remonitored).toBe(1);
  });

  it('Sonarr skips monitored series missing tvdbId', async () => {
    const { job, settings, plex, sonarr } = createJob();
    const ctx = createContext(false, { target: 'sonarr' });

    mockSonarrConfiguredSettings(settings);
    plex.getSections.mockResolvedValue([
      { key: '2', title: 'Shows', type: 'show' },
    ]);
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(new Map());
    sonarr.listMonitoredSeries.mockResolvedValue([
      { id: 1, title: 'No TVDB Id', monitored: true },
    ]);

    const result = await job.run(ctx);
    const report = result.summary as Record<string, unknown>;
    const raw = expectReportRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;
    const issues = Array.isArray(report.issues)
      ? (report.issues as Array<Record<string, unknown>>)
      : [];

    expect(sonarr.getEpisodesBySeries).not.toHaveBeenCalled();
    expect(rawSonarr.missingTvdbId).toBe(1);
    expect(rawSonarr.unmonitoredEpisodesChecked).toBe(0);
    expect(
      issues.some((entry) => hasIssueMessage(entry, 'missing TVDB id')),
    ).toBe(true);
  });

  it('Sonarr skips specials and invalid episode numbering', async () => {
    const { job, settings, plex, sonarr } = createJob();
    const ctx = createContext(false, { target: 'sonarr' });

    mockSonarrConfiguredSettings(settings);
    plex.getSections.mockResolvedValue([
      { key: '2', title: 'Shows', type: 'show' },
    ]);
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(
      new Map<number, string>([[42, 'show-1']]),
    );
    plex.getEpisodesSet.mockResolvedValue(new Set());
    sonarr.listMonitoredSeries.mockResolvedValue([
      { id: 1, title: 'Numbering Edge Cases', tvdbId: 42, monitored: true },
    ]);
    sonarr.getEpisodesBySeries.mockResolvedValue([
      { id: 10, seasonNumber: 0, episodeNumber: 1, monitored: false },
      { id: 11, seasonNumber: 1, episodeNumber: 0, monitored: false },
      { id: 12, seasonNumber: 1, monitored: false },
      { id: 13, seasonNumber: 1, episodeNumber: 1, monitored: true },
    ]);

    const result = await job.run(ctx);
    const raw = expectReportRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(sonarr.setEpisodeMonitored).not.toHaveBeenCalled();
    expect(rawSonarr.unmonitoredEpisodesChecked).toBe(0);
    expect(rawSonarr.missingFromPlex).toBe(0);
    expect(rawSonarr.remonitored).toBe(0);
  });

  it('Sonarr only counts episodes as re-monitored after a verification refresh', async () => {
    const { job, settings, plex, sonarr } = createJob();
    const ctx = createContext(false, { target: 'sonarr' });

    mockSonarrConfiguredSettings(settings);
    plex.getSections.mockResolvedValue([
      { key: '2', title: 'Shows', type: 'show' },
    ]);
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(
      new Map<number, string>([[42, 'show-1']]),
    );
    plex.getEpisodesSet.mockResolvedValue(new Set());
    sonarr.listMonitoredSeries.mockResolvedValue([
      { id: 1, title: 'Verification Show', tvdbId: 42, monitored: true },
    ]);
    sonarr.getEpisodesBySeries
      .mockResolvedValueOnce([
        { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: false },
      ])
      .mockResolvedValueOnce([
        { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: false },
      ]);
    sonarr.setEpisodeMonitored.mockResolvedValue(true);

    const result = await job.run(ctx);
    const report = result.summary as Record<string, unknown>;
    const raw = expectReportRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;
    const issues = Array.isArray(report.issues)
      ? (report.issues as Array<Record<string, unknown>>)
      : [];

    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledTimes(1);
    expect(sonarr.getEpisodesBySeries).toHaveBeenCalledTimes(2);
    expect(rawSonarr.missingFromPlex).toBe(1);
    expect(rawSonarr.remonitored).toBe(0);
    expect(rawSonarr.updateFailures).toBe(1);
    expect(
      issues.some((entry) => hasIssueMessage(entry, 'failed to re-monitor')),
    ).toBe(true);
  });

  it('Sonarr update failure becomes a warning and the rest of the run continues', async () => {
    const { job, settings, plex, sonarr } = createJob();
    const ctx = createContext(false, { target: 'sonarr' });

    mockSonarrConfiguredSettings(settings);
    plex.getSections.mockResolvedValue([
      { key: '2', title: 'Shows', type: 'show' },
    ]);
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(
      new Map<number, string>([[42, 'show-1']]),
    );
    plex.getEpisodesSet.mockResolvedValue(new Set());
    sonarr.listMonitoredSeries.mockResolvedValue([
      { id: 1, title: 'Retryable Show', tvdbId: 42, monitored: true },
    ]);
    sonarr.getEpisodesBySeries
      .mockResolvedValueOnce([
        { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: false },
        { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: false },
      ])
      .mockResolvedValueOnce([
        { id: 10, seasonNumber: 1, episodeNumber: 1, monitored: false },
        { id: 11, seasonNumber: 1, episodeNumber: 2, monitored: true },
      ]);
    sonarr.setEpisodeMonitored
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);

    const result = await job.run(ctx);
    const report = result.summary as Record<string, unknown>;
    const raw = expectReportRaw(result);
    const rawSonarr = raw.sonarr as Record<string, unknown>;
    const issues = Array.isArray(report.issues)
      ? (report.issues as Array<Record<string, unknown>>)
      : [];

    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledTimes(2);
    expect(rawSonarr.missingFromPlex).toBe(2);
    expect(rawSonarr.remonitored).toBe(1);
    expect(rawSonarr.updateFailures).toBe(1);
    expect(
      issues.some((entry) => hasIssueMessage(entry, 'failed to re-monitor')),
    ).toBe(true);
  });

  it('explicit invalid target throws a clear error', async () => {
    const { job, settings } = createJob();

    await expect(
      job.run(createContext(false, { target: 'bad-target' })),
    ).rejects.toThrow(
      'Confirm Unmonitored target must be either "radarr" or "sonarr".',
    );
    expect(settings.getInternalSettings).not.toHaveBeenCalled();
  });
});
