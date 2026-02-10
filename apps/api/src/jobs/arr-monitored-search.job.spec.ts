import { ArrMonitoredSearchJob } from './arr-monitored-search.job';
import type { JobContext, JobRunTrigger, JsonObject } from './jobs.types';
import { SettingsService } from '../settings/settings.service';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrService } from '../sonarr/sonarr.service';

type SettingsMock = Pick<SettingsService, 'getInternalSettings'>;
type RadarrMock = Pick<RadarrService, 'searchMonitoredMovies'>;
type SonarrMock = Pick<SonarrService, 'searchMonitoredEpisodes'>;

function createContext(params?: {
  trigger?: JobRunTrigger;
  dryRun?: boolean;
}): JobContext {
  const trigger = params?.trigger ?? 'manual';
  const dryRun = params?.dryRun ?? false;
  let currentSummary: JsonObject | null = null;
  const setSummary = jest.fn(async (summary: JsonObject | null) => {
    currentSummary = summary;
  });
  const patchSummary = jest.fn(async (patch: JsonObject) => {
    currentSummary = { ...(currentSummary ?? {}), ...patch };
  });
  const log = jest.fn(async () => undefined);

  return {
    jobId: 'arrMonitoredSearch',
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
  };
  const radarr: jest.Mocked<RadarrMock> = {
    searchMonitoredMovies: jest.fn(),
  };
  const sonarr: jest.Mocked<SonarrMock> = {
    searchMonitoredEpisodes: jest.fn(),
  };

  const job = new ArrMonitoredSearchJob(
    settings as unknown as SettingsService,
    radarr as unknown as RadarrService,
    sonarr as unknown as SonarrService,
  );

  return { job, settings, radarr, sonarr };
}

describe('ArrMonitoredSearchJob', () => {
  it('skips Sonarr when vault setting disables it even if credentials are saved', async () => {
    const { job, settings, radarr, sonarr } = createJob();
    const ctx = createContext({ dryRun: false, trigger: 'manual' });

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: { arrMonitoredSearch: { includeRadarr: true, includeSonarr: true } },
        radarr: { baseUrl: 'http://radarr.local:7878', enabled: true },
        sonarr: { baseUrl: 'http://sonarr.local:8989', enabled: false },
      },
      secrets: {
        radarr: { apiKey: 'radarr-key' },
        sonarr: { apiKey: 'sonarr-key' },
      },
    });
    radarr.searchMonitoredMovies.mockResolvedValue(true);

    const result = await job.run(ctx);
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawSonarr = raw.sonarr as Record<string, unknown>;
    const issues = Array.isArray(report.issues)
      ? (report.issues as Array<Record<string, unknown>>)
      : [];
    const tasks = Array.isArray(report.tasks)
      ? (report.tasks as Array<Record<string, unknown>>)
      : [];
    const sonarrTask = tasks.find((task) => task.id === 'sonarr');
    const sonarrFacts = Array.isArray(sonarrTask?.facts)
      ? (sonarrTask.facts as Array<Record<string, unknown>>)
      : [];

    expect(radarr.searchMonitoredMovies).toHaveBeenCalledTimes(1);
    expect(sonarr.searchMonitoredEpisodes).not.toHaveBeenCalled();
    expect(rawSonarr.integrationEnabled).toBe(false);
    expect(rawSonarr.configured).toBe(false);
    expect(sonarrTask?.status).toBe('skipped');
    expect(
      sonarrFacts.some(
        (fact) =>
          fact.label === 'Result' &&
          String(fact.value ?? '').includes('integration disabled in Vault'),
      ),
    ).toBe(true);
    expect(
      issues.some((entry) =>
        String(entry.message ?? '').includes('Sonarr is enabled but not configured.'),
      ),
    ).toBe(false);
  });

  it('skips Radarr when vault setting disables it even if credentials are saved', async () => {
    const { job, settings, radarr, sonarr } = createJob();
    const ctx = createContext({ dryRun: false, trigger: 'manual' });

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        jobs: { arrMonitoredSearch: { includeRadarr: true, includeSonarr: true } },
        radarr: { baseUrl: 'http://radarr.local:7878', enabled: false },
        sonarr: { baseUrl: 'http://sonarr.local:8989', enabled: true },
      },
      secrets: {
        radarr: { apiKey: 'radarr-key' },
        sonarr: { apiKey: 'sonarr-key' },
      },
    });
    sonarr.searchMonitoredEpisodes.mockResolvedValue(true);

    const result = await job.run(ctx);
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawRadarr = raw.radarr as Record<string, unknown>;
    const tasks = Array.isArray(report.tasks)
      ? (report.tasks as Array<Record<string, unknown>>)
      : [];
    const radarrTask = tasks.find((task) => task.id === 'radarr');
    const radarrFacts = Array.isArray(radarrTask?.facts)
      ? (radarrTask.facts as Array<Record<string, unknown>>)
      : [];

    expect(radarr.searchMonitoredMovies).not.toHaveBeenCalled();
    expect(sonarr.searchMonitoredEpisodes).toHaveBeenCalledTimes(1);
    expect(rawRadarr.integrationEnabled).toBe(false);
    expect(rawRadarr.configured).toBe(false);
    expect(radarrTask?.status).toBe('skipped');
    expect(
      radarrFacts.some(
        (fact) =>
          fact.label === 'Result' &&
          String(fact.value ?? '').includes('integration disabled in Vault'),
      ),
    ).toBe(true);
  });
});
