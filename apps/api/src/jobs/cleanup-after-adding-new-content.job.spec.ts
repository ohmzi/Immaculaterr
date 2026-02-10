import { CleanupAfterAddingNewContentJob } from './cleanup-after-adding-new-content.job';
import type { JobContext, JsonObject } from './jobs.types';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexWatchlistService } from '../plex/plex-watchlist.service';
import { PlexDuplicatesService } from '../plex/plex-duplicates.service';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrService } from '../sonarr/sonarr.service';

type SettingsMock = Pick<SettingsService, 'getInternalSettings'>;
type PlexServerMock = Pick<PlexServerService, 'getSections'>;
type RadarrMock = Pick<RadarrService, 'listMovies'>;
type SonarrMock = Pick<SonarrService, 'listSeries'>;

function createContext(input: JsonObject): JobContext {
  let currentSummary: JsonObject | null = null;
  const setSummary = jest.fn(async (summary: JsonObject | null) => {
    currentSummary = summary;
  });
  const patchSummary = jest.fn(async (patch: JsonObject) => {
    currentSummary = { ...(currentSummary ?? {}), ...patch };
  });
  const log = jest.fn(async () => undefined);

  return {
    jobId: 'mediaAddedCleanup',
    runId: 'run-1',
    userId: 'user-1',
    dryRun: false,
    trigger: 'auto',
    input,
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
  const plexServer: jest.Mocked<PlexServerMock> = {
    getSections: jest.fn(),
  };
  const radarr: jest.Mocked<RadarrMock> = {
    listMovies: jest.fn(),
  };
  const sonarr: jest.Mocked<SonarrMock> = {
    listSeries: jest.fn(),
  };

  const job = new CleanupAfterAddingNewContentJob(
    settings as unknown as SettingsService,
    plexServer as unknown as PlexServerService,
    {} as PlexWatchlistService,
    {} as PlexDuplicatesService,
    radarr as unknown as RadarrService,
    sonarr as unknown as SonarrService,
  );

  return { job, settings, plexServer, radarr, sonarr };
}

describe('CleanupAfterAddingNewContentJob', () => {
  it('treats disabled Radarr/Sonarr as not configured even when credentials are saved', async () => {
    const { job, settings, plexServer, radarr, sonarr } = createJob();
    const ctx = createContext({ mediaType: 'movie' });

    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.local:32400' },
        radarr: { baseUrl: 'http://radarr.local:7878', enabled: false },
        sonarr: { baseUrl: 'http://sonarr.local:8989', enabled: false },
      },
      secrets: {
        plex: { token: 'plex-token' },
        radarr: { apiKey: 'radarr-key' },
        sonarr: { apiKey: 'sonarr-key' },
      },
    });
    plexServer.getSections.mockResolvedValue([]);

    const result = await job.run(ctx);
    const report = result.summary as unknown as Record<string, unknown>;
    const raw = report.raw as Record<string, unknown>;
    const rawRadarr = raw.radarr as Record<string, unknown>;
    const rawSonarr = raw.sonarr as Record<string, unknown>;

    expect(rawRadarr.configured).toBe(false);
    expect(rawSonarr.configured).toBe(false);
    expect(radarr.listMovies).not.toHaveBeenCalled();
    expect(sonarr.listSeries).not.toHaveBeenCalled();
  });
});
