import {
  RepairMonitoredJob,
  derivePathMap,
  translatePath,
} from './repair-monitored.job';
import type { JobContext, JsonObject } from './jobs.types';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from '../plex/plex-server.service';
import type { PlexSectionWithLocations } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
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
    expect(derivePathMap(SONARR_ROOTS, PLEX_LOCATIONS)).toEqual([
      { from: '/data', to: '/media' },
    ]);
  });

  it('translates a Sonarr bad-file path into the Plex namespace', () => {
    const map = derivePathMap(SONARR_ROOTS, PLEX_LOCATIONS);
    expect(
      translatePath(
        '/data/toshiba12tb/Plex/Complete/English/Shows/What If 2021/f.mkv',
        map,
      ),
    ).toBe('/media/toshiba12tb/Plex/Complete/English/Shows/What If 2021/f.mkv');
  });

  it('derives the /data -> /media mapping from Radarr movie roots too', () => {
    expect(
      derivePathMap(
        ['/data/WD18TB/Plex/Complete/English/Movies'],
        ['/media/WD18TB/Plex/Complete/English/Movies'],
      ),
    ).toEqual([{ from: '/data', to: '/media' }]);
  });

  it('returns the original path when no mapping matches', () => {
    const map = derivePathMap(SONARR_ROOTS, PLEX_LOCATIONS);
    expect(translatePath('/other/root/a.mkv', map)).toBe('/other/root/a.mkv');
  });

  it('does not match on a partial segment (segment-boundary aware)', () => {
    expect(
      translatePath('/database/x.mkv', [{ from: '/data', to: '/media' }]),
    ).toBe('/database/x.mkv');
  });
});

type SettingsMock = Pick<SettingsService, 'getInternalSettings'>;
type PlexMock = Pick<
  PlexServerService,
  | 'getSections'
  | 'getSectionLocations'
  | 'getTvdbShowRatingKeysMapForSectionKey'
  | 'getVerifiedEpisodeAvailabilityForShowRatingKey'
  | 'getMovieTmdbRatingKeysMapForSectionKey'
  | 'verifyPlayableMetadataByRatingKey'
  | 'findMovieRatingKeyByTitle'
  | 'refreshLibraryPath'
  | 'listActivities'
>;
type RadarrMock = Pick<
  RadarrService,
  | 'listRootFolders'
  | 'listMonitoredMovies'
  | 'setMovieMonitored'
  | 'deleteMovieFile'
  | 'listMovieHistory'
  | 'markHistoryFailed'
  | 'searchMovies'
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
        radarr: { baseUrl: 'http://radarr.local:7878' },
        sonarr: { baseUrl: 'http://sonarr.local:8989' },
      },
      secrets: {
        plex: { token: 'plex-token' },
        radarr: { apiKey: 'radarr-key' },
        sonarr: { apiKey: 'sonarr-key' },
      },
    }),
  };
  const plex: jest.Mocked<PlexMock> = {
    getSections: jest.fn().mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
      { key: '3', title: 'TV Shows', type: 'show' },
    ]),
    getSectionLocations: jest.fn().mockResolvedValue(
      new Map<string, PlexSectionWithLocations>([
        [
          '1',
          {
            key: '1',
            title: 'Movies',
            type: 'movie',
            locations: ['/media/toshiba12tb/Plex/Complete/English/Movies'],
          },
        ],
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
    // Only the "good" movie (tmdb 111) is in Plex; the bad one (tmdb 999) is absent.
    getMovieTmdbRatingKeysMapForSectionKey: jest
      .fn()
      .mockResolvedValue(new Map([[111, ['rk-111']]])),
    verifyPlayableMetadataByRatingKey: jest
      .fn()
      .mockResolvedValue({ playable: true, probeFailureCount: 0 }),
    findMovieRatingKeyByTitle: jest.fn().mockResolvedValue(null),
    refreshLibraryPath: jest.fn().mockResolvedValue(undefined),
    listActivities: jest.fn().mockResolvedValue([]),
  };
  const radarr: jest.Mocked<RadarrMock> = {
    listRootFolders: jest
      .fn()
      .mockResolvedValue([
        { id: 1, path: '/data/toshiba12tb/Plex/Complete/English/Movies' },
      ]),
    listMonitoredMovies: jest.fn().mockResolvedValue([
      // In Plex + playable + has file + monitored -> should be unmonitored.
      {
        id: 10,
        title: 'Good Movie',
        tmdbId: 111,
        monitored: true,
        hasFile: true,
        movieFileId: 500,
        movieFile: {
          id: 500,
          path: '/data/toshiba12tb/Plex/Complete/English/Movies/Good Movie (2020)/g.mkv',
        },
      },
      // Not in Plex, has a covered file -> repair candidate (wrong import).
      {
        id: 11,
        title: 'Bad Import',
        tmdbId: 999,
        monitored: true,
        hasFile: true,
        movieFileId: 501,
        movieFile: {
          id: 501,
          path: '/data/toshiba12tb/Plex/Complete/English/Movies/Bad Import (2021)/wrong.mkv',
        },
      },
    ]),
    setMovieMonitored: jest.fn().mockResolvedValue(true),
    deleteMovieFile: jest.fn().mockResolvedValue(true),
    listMovieHistory: jest.fn().mockResolvedValue([]),
    markHistoryFailed: jest.fn().mockResolvedValue(true),
    searchMovies: jest.fn().mockResolvedValue(true),
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
        path: '/data/toshiba12tb/Plex/Complete/English/Shows/What If 2021/f.mkv',
        relativePath: 'What If 2021/f.mkv',
      },
      {
        id: 861,
        seriesId: 275,
        seasonNumber: 1,
        path: '/data/toshiba12tb/Plex/Complete/English/Shows/TP S01E02/f.mkv',
        relativePath: 'TP S01E02/f.mkv',
      },
    ]),
    setEpisodeMonitored: jest.fn().mockResolvedValue(true),
    deleteEpisodeFile: jest.fn().mockResolvedValue(true),
    listEpisodeHistory: jest.fn().mockResolvedValue([]),
    markHistoryFailed: jest.fn().mockResolvedValue(true),
    searchEpisodes: jest.fn().mockResolvedValue(true),
  };

  const job = new RepairMonitoredJob(
    settings as unknown as SettingsService,
    plex as unknown as PlexServerService,
    radarr as unknown as RadarrService,
    sonarr as unknown as SonarrService,
  );
  return { job, settings, plex, radarr, sonarr };
}

function raw(result: { summary?: JsonObject }) {
  const report = result.summary as Record<string, unknown>;
  expect(report.template).toBe('jobReportV1');
  return report.raw as {
    radarr: Record<string, unknown>;
    sonarr: Record<string, unknown>;
  };
}

async function runLive(job: RepairMonitoredJob, ctx: JobContext) {
  jest.useFakeTimers();
  try {
    const p = job.run(ctx);
    // Two settle windows (Radarr pass + Sonarr pass).
    await jest.advanceTimersByTimeAsync(20000);
    return await p;
  } finally {
    jest.useRealTimers();
  }
}

describe('RepairMonitoredJob', () => {
  it('dry-run: projects unmonitor + repair candidates for both Radarr and Sonarr', async () => {
    const { job, radarr, sonarr } = createJob();
    const r = raw(await job.run(createContext(true)));

    expect(r.radarr.confirmedInPlex).toBe(1);
    expect(r.radarr.repairCandidates).toBe(1);
    expect(r.radarr.deletedFiles).toBe(0);
    expect(r.sonarr.confirmedInPlex).toBe(1);
    expect(r.sonarr.repairCandidates).toBe(1);

    expect(radarr.deleteMovieFile).not.toHaveBeenCalled();
    expect(radarr.setMovieMonitored).not.toHaveBeenCalled();
    expect(sonarr.deleteEpisodeFile).not.toHaveBeenCalled();
  });

  it('live Radarr: unmonitors the in-Plex movie, deletes the unfit one, re-searches', async () => {
    const { job, radarr } = createJob();
    const r = raw(await runLive(job, createContext(false)));

    expect(radarr.setMovieMonitored).toHaveBeenCalledWith(
      expect.objectContaining({
        monitored: false,
        movie: expect.objectContaining({ id: 10 }),
      }),
    );
    expect(radarr.deleteMovieFile).toHaveBeenCalledWith(
      expect.objectContaining({ movieFileId: 501 }),
    );
    expect(radarr.searchMovies).toHaveBeenCalledWith(
      expect.objectContaining({ movieIds: [11] }),
    );
    expect(r.radarr.deletedFiles).toBe(1);
    expect(r.radarr.unmonitored).toBe(1);
    expect(r.radarr.blocklistUnavailable).toBe(1); // no grab history
  });

  it('live Radarr safety: keeps a movie that Plex matches by title after the scan', async () => {
    const { job, plex, radarr } = createJob();
    plex.findMovieRatingKeyByTitle.mockResolvedValue({
      ratingKey: 'rk-x',
      title: 'Bad Import',
    });
    const r = raw(await runLive(job, createContext(false)));

    expect(radarr.deleteMovieFile).not.toHaveBeenCalled();
    expect(r.radarr.recoveredByScan).toBe(1);
    expect(r.radarr.deletedFiles).toBe(0);
  });

  it('live Radarr safety: reports uncovered movie paths without deleting', async () => {
    const { job, plex, radarr } = createJob();
    plex.getSectionLocations.mockResolvedValue(
      new Map<string, PlexSectionWithLocations>([
        [
          '1',
          {
            key: '1',
            title: 'Movies',
            type: 'movie',
            locations: ['/media/elsewhere/Films'],
          },
        ],
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
    );
    const r = raw(await runLive(job, createContext(false)));
    expect(r.radarr.uncoveredPaths).toBe(1);
    expect(radarr.deleteMovieFile).not.toHaveBeenCalled();
  });

  it('live Sonarr: deletes the unfit episode file and re-searches', async () => {
    const { job, sonarr } = createJob();
    const r = raw(await runLive(job, createContext(false)));

    expect(sonarr.setEpisodeMonitored).toHaveBeenCalledTimes(1); // E02 confirmed
    expect(sonarr.deleteEpisodeFile).toHaveBeenCalledWith(
      expect.objectContaining({ episodeFileId: 860 }),
    );
    expect(sonarr.searchEpisodes).toHaveBeenCalledWith(
      expect.objectContaining({ episodeIds: [1] }),
    );
    expect(r.sonarr.deletedFiles).toBe(1);
    expect(r.sonarr.blocklistUnavailable).toBe(1);
  });

  it('safety: never deletes episodes for a series not in Plex at all', async () => {
    const { job, plex, sonarr } = createJob();
    plex.getTvdbShowRatingKeysMapForSectionKey.mockResolvedValue(new Map());
    const r = raw(await runLive(job, createContext(false)));
    expect(r.sonarr.showsNotInPlex).toBe(1);
    expect(r.sonarr.repairCandidates).toBe(0);
    expect(sonarr.deleteEpisodeFile).not.toHaveBeenCalled();
  });
});
