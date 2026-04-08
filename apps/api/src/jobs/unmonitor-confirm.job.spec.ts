import { UnmonitorConfirmJob } from './unmonitor-confirm.job';
import type { JobContext, JsonObject } from './jobs.types';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';

type SettingsMock = Pick<SettingsService, 'getInternalSettings'>;
type PlexMock = Pick<
  PlexServerService,
  'getSections' | 'getMovieTmdbIdSetForSectionKey'
>;
type RadarrMock = Pick<RadarrService, 'listMovies' | 'setMovieMonitored'>;

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
  const log = jest.fn(() => Promise.resolve(undefined));

  return {
    jobId: 'unmonitorConfirm',
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
  };
  const radarr: jest.Mocked<RadarrMock> = {
    listMovies: jest.fn(),
    setMovieMonitored: jest.fn(),
  };

  const job = new UnmonitorConfirmJob(
    settings as unknown as SettingsService,
    plex as unknown as PlexServerService,
    radarr as unknown as RadarrService,
  );

  return { job, settings, plex, radarr };
}

function mockConfiguredSettings(settings: jest.Mocked<SettingsMock>) {
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

describe('UnmonitorConfirmJob', () => {
  it('re-monitors unmonitored movies that are missing from Plex', async () => {
    const { job, settings, plex, radarr } = createJob();
    const ctx = createContext(false);

    mockConfiguredSettings(settings);
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
    const report = result.summary as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawRadarr = raw.radarr as Record<string, unknown>;

    expect(radarr.setMovieMonitored).toHaveBeenCalledTimes(1);
    expect(radarr.setMovieMonitored).toHaveBeenCalledWith({
      baseUrl: 'http://radarr.local:7878',
      apiKey: 'radarr-key',
      movie: { id: 2, title: 'Missing', tmdbId: 200, monitored: false },
      monitored: true,
    });
    expect(rawRadarr.missingFromPlex).toBe(1);
    expect(rawRadarr.remonitored).toBe(1);
  });

  it('keeps movies unmonitored when they already exist in Plex', async () => {
    const { job, settings, plex, radarr } = createJob();
    const ctx = createContext(false);

    mockConfiguredSettings(settings);
    plex.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plex.getMovieTmdbIdSetForSectionKey.mockResolvedValue(new Set([100]));
    radarr.listMovies.mockResolvedValue([
      { id: 1, title: 'Exists', tmdbId: 100, monitored: false },
    ]);

    const result = await job.run(ctx);
    const report = result.summary as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawRadarr = raw.radarr as Record<string, unknown>;

    expect(radarr.setMovieMonitored).not.toHaveBeenCalled();
    expect(rawRadarr.keptUnmonitored).toBe(1);
    expect(rawRadarr.missingFromPlex).toBe(0);
  });

  it('skips unmonitored movies missing tmdbId', async () => {
    const { job, settings, plex, radarr } = createJob();
    const ctx = createContext(false);

    mockConfiguredSettings(settings);
    plex.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plex.getMovieTmdbIdSetForSectionKey.mockResolvedValue(new Set<number>());
    radarr.listMovies.mockResolvedValue([
      { id: 1, title: 'Unknown', monitored: false },
    ]);

    const result = await job.run(ctx);
    const report = result.summary as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawRadarr = raw.radarr as Record<string, unknown>;

    expect(radarr.setMovieMonitored).not.toHaveBeenCalled();
    expect(rawRadarr.missingTmdbId).toBe(1);
  });

  it('records path conflicts when Radarr refuses to re-monitor', async () => {
    const { job, settings, plex, radarr } = createJob();
    const ctx = createContext(false);

    mockConfiguredSettings(settings);
    plex.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plex.getMovieTmdbIdSetForSectionKey.mockResolvedValue(new Set<number>());
    radarr.listMovies.mockResolvedValue([
      { id: 1, title: 'Missing', tmdbId: 200, monitored: false },
    ]);
    radarr.setMovieMonitored.mockResolvedValue(false);

    const result = await job.run(ctx);
    const report = result.summary as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawRadarr = raw.radarr as Record<string, unknown>;

    expect(rawRadarr.missingFromPlex).toBe(1);
    expect(rawRadarr.remonitored).toBe(0);
    expect(rawRadarr.skippedPathConflicts).toBe(1);
  });

  it('fails early when Radarr is not configured', async () => {
    const { job, settings } = createJob();
    const ctx = createContext(false);

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.local:32400' },
      },
      secrets: {
        plex: { token: 'plex-token' },
        'plex.token': 'plex-token',
      },
    });

    await expect(job.run(ctx)).rejects.toThrow(
      'Confirm Unmonitored requires Radarr to be configured',
    );
  });

  it('returns a JobReportV1 summary with expected facts and metrics', async () => {
    const { job, settings, plex, radarr } = createJob();
    const ctx = createContext(false);

    mockConfiguredSettings(settings);
    plex.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plex.getMovieTmdbIdSetForSectionKey.mockResolvedValue(new Set([100]));
    radarr.listMovies.mockResolvedValue([
      { id: 1, title: 'Exists', tmdbId: 100, monitored: false },
      { id: 2, title: 'Missing', tmdbId: 200, monitored: false },
      { id: 3, title: 'Unknown', monitored: false },
    ]);
    radarr.setMovieMonitored.mockResolvedValue(true);

    const result = await job.run(ctx);
    const report = result.summary as Record<string, unknown>;
    const tasks = Array.isArray(report.tasks)
      ? (report.tasks as Array<Record<string, unknown>>)
      : [];
    const sections = Array.isArray(report.sections)
      ? (report.sections as Array<Record<string, unknown>>)
      : [];
    const radarrTask = tasks.find(
      (task) => task.id === 'radarr_unmonitored_confirm',
    );
    const radarrFacts = Array.isArray(radarrTask?.facts)
      ? (radarrTask?.facts as Array<Record<string, unknown>>)
      : [];

    expect(report.template).toBe('jobReportV1');
    expect(report.version).toBe(1);
    expect(sections.some((section) => section.id === 'plex')).toBe(true);
    expect(sections.some((section) => section.id === 'radarr')).toBe(true);
    expect(radarrFacts.map((fact) => fact.label)).toEqual([
      'Configured',
      'Kept unmonitored',
      'Re-monitored',
      'Skipped missing TMDB id',
      'Skipped path conflicts',
    ]);
  });
});
