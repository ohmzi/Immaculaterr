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
type RadarrMock = Pick<RadarrService, 'listMonitoredMovies' | 'setMovieMonitored'>;
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
  const setSummary = jest.fn(async (summary: JsonObject | null) => {
    currentSummary = summary;
  });
  const patchSummary = jest.fn(async (patch: JsonObject) => {
    currentSummary = { ...(currentSummary ?? {}), ...patch };
  });
  const log = jest.fn(async () => undefined);

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
    plex.getSections.mockResolvedValue([{ key: '1', title: 'Movies', type: 'movie' }]);
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
        String(i.message ?? '').includes('MissingEpisodeSearch was not queued'),
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
    plex.getSections.mockResolvedValue([{ key: '1', title: 'Movies', type: 'movie' }]);
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
        String(i.message ?? '').includes('MissingEpisodeSearch was not queued'),
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
    plex.getSections.mockResolvedValue([{ key: '2', title: 'Shows', type: 'show' }]);
    plex.getTvdbShowMapForSectionKey.mockResolvedValue(new Map<number, string[]>());
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
});
