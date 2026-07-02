import {
  RepairMonitoredJob,
  derivePathMap,
  translatePath,
} from './repair-monitored.job';
import type { JobContext, JsonObject } from './jobs.types';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from '../plex/plex-server.service';
import { SonarrService } from '../sonarr/sonarr.service';

// Real data captured from the live environment this feature targets.
const SONARR_ROOTS = [
  '/data/toshiba12tb/Plex/Complete/English/Shows',
  '/data/WD22TB/Plex/Complete/English/Shows',
  '/data/western18to14tb/Plex/Complete/English/Shows',
  '/data/western18to4tb/Plex/English/Shows',
  '/data/seagate16tb/Plex/Complete/English/Shows',
  '/data/WD18TB/Plex/Complete/English/Shows',
];
const PLEX_LOCATIONS = [
  '/media/WD18TB/Plex/Complete/English/Shows',
  '/media/seagate16tb/Plex/Complete/English/Shows',
  '/media/western18to14tb/Plex/Complete/English/Shows',
  '/media/western18to4tb/Plex/English/Shows',
  '/media/WD22TB/Plex/Complete/English/Shows',
  '/media/toshiba12tb/Plex/Complete/English/Shows',
];

describe('derivePathMap / translatePath', () => {
  it('derives a single /data -> /media prefix mapping from the live layout', () => {
    const map = derivePathMap(SONARR_ROOTS, PLEX_LOCATIONS);
    expect(map).toEqual([{ from: '/data', to: '/media' }]);
  });

  it('translates the Turning Point bad file path into the Plex namespace', () => {
    const map = derivePathMap(SONARR_ROOTS, PLEX_LOCATIONS);
    const sonarrPath =
      '/data/toshiba12tb/Plex/Complete/English/Shows/What If 2021 S01E01/f.mkv';
    expect(translatePath(sonarrPath, map)).toBe(
      '/media/toshiba12tb/Plex/Complete/English/Shows/What If 2021 S01E01/f.mkv',
    );
  });

  it('honors an explicit override before the derived mapping', () => {
    const map = [{ from: '/data/x', to: '/mnt/x' }];
    expect(translatePath('/data/x/Shows/a.mkv', map)).toBe(
      '/mnt/x/Shows/a.mkv',
    );
  });

  it('returns the original path when no mapping matches', () => {
    const map = derivePathMap(SONARR_ROOTS, PLEX_LOCATIONS);
    expect(translatePath('/other/root/a.mkv', map)).toBe('/other/root/a.mkv');
  });

  it('does not match on a partial segment (segment-boundary aware)', () => {
    const map = [{ from: '/data', to: '/media' }];
    // '/database/...' must not be rewritten by a '/data' prefix.
    expect(translatePath('/database/x.mkv', map)).toBe('/database/x.mkv');
  });
});

type SettingsMock = Pick<SettingsService, 'getInternalSettings'>;
type PlexMock = Pick<
  PlexServerService,
  | 'getSections'
  | 'getSectionLocations'
  | 'getTvdbShowRatingKeysMapForSectionKey'
  | 'getVerifiedEpisodeAvailabilityForShowRatingKey'
  | 'refreshLibraryPath'
  | 'listActivities'
>;
type SonarrMock = Pick<
  SonarrService,
  | 'listRootFolders'
  | 'listMonitoredSeries'
  | 'getEpisodesBySeries'
  | 'getEpisodeFiles'
  | 'setEpisodeMonitored'
  | 'deleteEpisodeFile'
  | 'listEpisodeHistory'
  | 'markHistoryFailed'
  | 'searchEpisodes'
>;

function createContext(dryRun = false): JobContext {
  let currentSummary: JsonObject | null = null;
  const patch = jest.fn((p: JsonObject) => {
    currentSummary = { ...(currentSummary ?? {}), ...p };
    return Promise.resolve();
  });
  const log = jest.fn(() => Promise.resolve(undefined));
  return {
    jobId: 'repairMonitored',
    runId: 'run-1',
    userId: 'user-1',
    dryRun,
    trigger: 'manual',
    getSummary: () => currentSummary,
    setSummary: jest.fn(() => Promise.resolve()),
    patchSummary: patch,
    log,
    debug: log,
    info: log,
    warn: log,
    error: log,
  };
}

function availability(verified: string[], metadata: string[]) {
  return {
    verifiedEpisodes: new Set(verified),
    metadataEpisodes: new Set(metadata),
    probeFailureCount: 0,
  };
}

function createJob() {
  const settings: jest.Mocked<SettingsMock> = {
    getInternalSettings: jest.fn().mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.local:32400' },
        sonarr: { baseUrl: 'http://sonarr.local:8989' },
      },
      secrets: {
        plex: { token: 'plex-token' },
        sonarr: { apiKey: 'sonarr-key' },
      },
    }),
  };
  const plex: jest.Mocked<PlexMock> = {
    getSections: jest
      .fn()
      .mockResolvedValue([{ key: '3', title: 'TV Shows', type: 'show' }]),
    getSectionLocations: jest.fn().mockResolvedValue(
      new Map([
        [
          '3',
          {
            key: '3',
            title: 'TV Shows',
            type: 'show',
            locations: ['/media/toshiba12tb/Plex/Complete/English/Shows'],
          },
        ],
      ]),
    ),
    getTvdbShowRatingKeysMapForSectionKey: jest
      .fn()
      .mockResolvedValue(new Map([[408892, ['296724']]])),
    getVerifiedEpisodeAvailabilityForShowRatingKey: jest
      .fn()
      .mockResolvedValue(availability(['1:2'], ['1:2'])),
    refreshLibraryPath: jest.fn().mockResolvedValue(undefined),
    listActivities: jest.fn().mockResolvedValue([]),
  };
  const sonarr: jest.Mocked<SonarrMock> = {
    listRootFolders: jest
      .fn()
      .mockResolvedValue([
        { id: 1, path: '/data/toshiba12tb/Plex/Complete/English/Shows' },
      ]),
    listMonitoredSeries: jest
      .fn()
      .mockResolvedValue([
        { id: 275, title: 'Turning Point', tvdbId: 408892, monitored: true },
      ]),
    getEpisodesBySeries: jest.fn().mockResolvedValue([
      {
        id: 1,
        seasonNumber: 1,
        episodeNumber: 1,
        monitored: true,
        hasFile: true,
        episodeFileId: 860,
      },
      {
        id: 2,
        seasonNumber: 1,
        episodeNumber: 2,
        monitored: true,
        hasFile: true,
        episodeFileId: 861,
      },
    ]),
    getEpisodeFiles: jest.fn().mockResolvedValue([
      {
        id: 860,
        seriesId: 275,
        seasonNumber: 1,
        path: '/data/toshiba12tb/Plex/Complete/English/Shows/What If 2021 S01E01/f.mkv',
        relativePath: 'What If 2021 S01E01/f.mkv',
      },
      {
        id: 861,
        seriesId: 275,
        seasonNumber: 1,
        path: '/data/toshiba12tb/Plex/Complete/English/Shows/Turning Point S01E02/f.mkv',
        relativePath: 'Turning Point S01E02/f.mkv',
      },
    ]),
    setEpisodeMonitored: jest.fn().mockResolvedValue(true),
    deleteEpisodeFile: jest.fn().mockResolvedValue(true),
    listEpisodeHistory: jest.fn().mockResolvedValue([
      {
        id: 99,
        episodeId: 1,
        eventType: 'grabbed',
        sourceTitle: 'What.If.2021.S01E01',
        date: '2024-01-01T00:00:00Z',
      },
    ]),
    markHistoryFailed: jest.fn().mockResolvedValue(true),
    searchEpisodes: jest.fn().mockResolvedValue(true),
  };

  const job = new RepairMonitoredJob(
    settings as unknown as SettingsService,
    plex as unknown as PlexServerService,
    sonarr as unknown as SonarrService,
  );
  return { job, settings, plex, sonarr };
}

function raw(result: { summary?: JsonObject }) {
  const report = result.summary as Record<string, unknown>;
  expect(report.template).toBe('jobReportV1');
  return report.raw as Record<string, unknown>;
}

// Drives run() through the scan-settle sleep using fake timers.
async function runLive(job: RepairMonitoredJob, ctx: JobContext) {
  jest.useFakeTimers();
  try {
    const p = job.run(ctx);
    // Flush the initial settle delay + a poll interval.
    await jest.advanceTimersByTimeAsync(9000);
    return await p;
  } finally {
    jest.useRealTimers();
  }
}

describe('RepairMonitoredJob', () => {
  it('dry-run: projects unmonitor + repair candidate without mutating', async () => {
    const { job, sonarr } = createJob();
    const result = await job.run(createContext(true));
    const r = raw(result);

    expect(r.confirmedInPlex).toBe(1); // E02 verified in Plex
    expect(r.unmonitored).toBe(1); // E02 would be unmonitored
    expect(r.repairCandidates).toBe(1); // E01 missing + covered
    expect(r.deletedFiles).toBe(0);
    expect((r.wouldRepairSamples as string[]).length).toBe(1);

    expect(sonarr.setEpisodeMonitored).not.toHaveBeenCalled();
    expect(sonarr.deleteEpisodeFile).not.toHaveBeenCalled();
    expect(sonarr.markHistoryFailed).not.toHaveBeenCalled();
  });

  it('live: deletes the unfit file, blocklists the grab, and re-searches', async () => {
    const { job, plex, sonarr } = createJob();
    const result = await runLive(job, createContext(false));
    const r = raw(result);

    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledTimes(1); // E02
    expect(plex.refreshLibraryPath).toHaveBeenCalledTimes(1);
    expect(sonarr.deleteEpisodeFile).toHaveBeenCalledWith(
      expect.objectContaining({ episodeFileId: 860 }),
    );
    expect(sonarr.markHistoryFailed).toHaveBeenCalledWith(
      expect.objectContaining({ historyId: 99 }),
    );
    expect(sonarr.searchEpisodes).toHaveBeenCalledWith(
      expect.objectContaining({ episodeIds: [1] }),
    );
    expect(r.deletedFiles).toBe(1);
    expect(r.blocklisted).toBe(1);
    expect(r.searchQueued).toBe(1);
  });

  it('live: deletes but flags blocklistUnavailable when there is no grab history', async () => {
    const { job, sonarr } = createJob();
    sonarr.listEpisodeHistory.mockResolvedValue([]);
    const result = await runLive(job, createContext(false));
    const r = raw(result);

    expect(sonarr.deleteEpisodeFile).toHaveBeenCalledTimes(1);
    expect(sonarr.markHistoryFailed).not.toHaveBeenCalled();
    expect(r.blocklistUnavailable).toBe(1);
    expect(r.deletedFiles).toBe(1);
    expect(sonarr.searchEpisodes).toHaveBeenCalledTimes(1); // still re-searches
  });

  it('safety: never deletes files for a series that is not in Plex at all', async () => {
    const { job, plex, sonarr } = createJob();
    plex.getTvdbShowRatingKeysMapForSectionKey.mockResolvedValue(new Map());
    const result = await job.run(createContext(false));
    const r = raw(result);

    expect(r.showsNotInPlex).toBe(1);
    expect(r.repairCandidates).toBe(0);
    expect(sonarr.deleteEpisodeFile).not.toHaveBeenCalled();
  });

  it('safety: reports uncovered paths without deleting', async () => {
    const { job, plex, sonarr } = createJob();
    // A Plex library location that shares no suffix with the Sonarr root, so no
    // prefix mapping is derived and the file translates to nothing covered.
    plex.getSectionLocations.mockResolvedValue(
      new Map([
        [
          '3',
          {
            key: '3',
            title: 'TV Shows',
            type: 'show',
            locations: ['/media/movies/Films'],
          },
        ],
      ]),
    );
    const result = await job.run(createContext(false));
    const r = raw(result);
    expect(r.uncoveredPaths).toBe(1);
    expect(sonarr.deleteEpisodeFile).not.toHaveBeenCalled();
  });
});
