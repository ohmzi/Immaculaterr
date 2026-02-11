import {
  buildMediaAddedCleanupReport,
} from './cleanup-after-adding-new-content.job';
import type { JobContext, JsonObject } from './jobs.types';

function createCtx(dryRun = false): JobContext {
  const noop = async () => undefined;
  return {
    jobId: 'mediaAddedCleanup',
    runId: 'run-1',
    userId: 'user-1',
    dryRun,
    trigger: 'manual',
    getSummary: () => null,
    setSummary: noop,
    patchSummary: noop,
    log: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
}

describe('buildMediaAddedCleanupReport', () => {
  it('renders separate ARR tasks and skips unconfigured Sonarr without top-level ARR issue', () => {
    const ctx = createCtx(false);
    const raw: JsonObject = {
      mediaType: '',
      warnings: ['sonarr: failed to load series (continuing): timeout'],
      duplicates: {
        mode: 'fullSweep',
        movie: { metadataDeleted: 0, partsDeleted: 0, groupsWithDuplicates: 0, radarrUnmonitored: 1 },
        episode: { metadataDeleted: 0, partsDeleted: 0, groupsWithDuplicates: 0, sonarrUnmonitored: 0 },
        warnings: ['sonarr: failed to load series (continuing): timeout'],
      },
      watchlist: {
        mode: 'reconcile',
        movies: { removed: 0, wouldRemove: 0 },
        shows: { removed: 0, wouldRemove: 0 },
      },
      radarr: { configured: true, connected: true, moviesUnmonitored: 1, moviesWouldUnmonitor: 0 },
      sonarr: { configured: false, connected: null, episodesUnmonitored: 0, episodesWouldUnmonitor: 0 },
    };

    const report = buildMediaAddedCleanupReport({ ctx, raw });
    const sonarrTask = report.tasks.find((t) => t.id === 'arr_sonarr');
    const radarrTask = report.tasks.find((t) => t.id === 'arr_radarr');
    const issueMessages = report.issues.map((i) => i.message);
    const sonarrFacts = sonarrTask?.facts ?? [];

    expect(radarrTask).toBeTruthy();
    expect(sonarrTask).toBeTruthy();
    expect(sonarrTask?.status).toBe('skipped');
    expect(
      sonarrFacts.some((f) => f.label === 'Result' && String(f.value).includes('not configured')),
    ).toBe(true);
    expect(
      issueMessages.some((m) => m.includes('Unable to connect to Sonarr.')),
    ).toBe(false);
  });

  it('marks unreachable Sonarr as skipped without promoting it to a top-level issue', () => {
    const ctx = createCtx(false);
    const raw: JsonObject = {
      mediaType: '',
      warnings: ['sonarr: failed to load series (continuing): timeout'],
      duplicates: {
        mode: 'fullSweep',
        movie: { metadataDeleted: 0, partsDeleted: 0, groupsWithDuplicates: 0, radarrUnmonitored: 0 },
        episode: { metadataDeleted: 0, partsDeleted: 0, groupsWithDuplicates: 0, sonarrUnmonitored: 0 },
        warnings: ['sonarr: failed to load series (continuing): timeout'],
      },
      watchlist: {
        mode: 'reconcile',
        movies: { removed: 0, wouldRemove: 0 },
        shows: { removed: 0, wouldRemove: 0 },
      },
      radarr: { configured: true, connected: true, moviesUnmonitored: 0, moviesWouldUnmonitor: 0 },
      sonarr: { configured: true, connected: false, episodesUnmonitored: 0, episodesWouldUnmonitor: 0 },
    };

    const report = buildMediaAddedCleanupReport({ ctx, raw });
    const sonarrTask = report.tasks.find((t) => t.id === 'arr_sonarr');
    const issueMessages = report.issues.map((i) => i.message);

    expect(sonarrTask?.status).toBe('skipped');
    expect(sonarrTask?.issues ?? []).toEqual([]);
    expect(
      issueMessages.some((m) => m.includes('Unable to connect to Sonarr.')),
    ).toBe(false);
  });

  it('marks disabled feature tasks as skipped for no-feature runs', () => {
    const ctx = createCtx(false);
    const raw: JsonObject = {
      mediaType: '',
      skipped: true,
      skipReason: 'no_features_enabled',
      features: {
        deleteDuplicates: false,
        unmonitorInArr: false,
        removeFromWatchlist: false,
      },
      radarr: {
        configured: true,
        connected: true,
        moviesUnmonitored: 0,
        moviesWouldUnmonitor: 0,
      },
      sonarr: {
        configured: true,
        connected: true,
        episodesUnmonitored: 0,
        episodesWouldUnmonitor: 0,
      },
    };

    const report = buildMediaAddedCleanupReport({ ctx, raw });
    const duplicatesTask = report.tasks.find((t) => t.id === 'duplicates');
    const watchlistTask = report.tasks.find((t) => t.id === 'watchlist');
    const radarrTask = report.tasks.find((t) => t.id === 'arr_radarr');
    const sonarrTask = report.tasks.find((t) => t.id === 'arr_sonarr');

    expect(duplicatesTask?.status).toBe('skipped');
    expect(watchlistTask?.status).toBe('skipped');
    expect(radarrTask?.status).toBe('skipped');
    expect(sonarrTask?.status).toBe('skipped');
    expect(watchlistTask?.issues ?? []).toEqual([]);
    expect(
      (watchlistTask?.facts ?? []).some(
        (f) => f.label === 'Note' && String(f.value).includes('Disabled in task settings'),
      ),
    ).toBe(true);
  });

  it('does not emit a watchlist failure issue when watchlist feature is disabled', () => {
    const ctx = createCtx(false);
    const raw: JsonObject = {
      mediaType: '',
      features: {
        deleteDuplicates: true,
        unmonitorInArr: true,
        removeFromWatchlist: false,
      },
      duplicates: {
        mode: 'fullSweep',
        movie: {
          metadataDeleted: 0,
          partsDeleted: 0,
          groupsWithDuplicates: 0,
          radarrUnmonitored: 0,
        },
        episode: {
          metadataDeleted: 0,
          partsDeleted: 0,
          groupsWithDuplicates: 0,
          sonarrUnmonitored: 0,
        },
      },
      radarr: {
        configured: true,
        connected: true,
        moviesUnmonitored: 0,
        moviesWouldUnmonitor: 0,
      },
      sonarr: {
        configured: true,
        connected: true,
        episodesUnmonitored: 0,
        episodesWouldUnmonitor: 0,
      },
    };

    const report = buildMediaAddedCleanupReport({ ctx, raw });
    const watchlistTask = report.tasks.find((t) => t.id === 'watchlist');

    expect(watchlistTask?.status).toBe('skipped');
    expect(watchlistTask?.issues ?? []).toEqual([]);
    expect(
      (watchlistTask?.facts ?? []).some(
        (f) => f.label === 'Result' && String(f.value).includes('Disabled in task settings'),
      ),
    ).toBe(true);
  });
});
