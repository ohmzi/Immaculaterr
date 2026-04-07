import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService, type RadarrMovie } from '../radarr/radarr.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import type { JobReportV1 } from './job-report-v1';
import { issue, metricRow } from './job-report-v1';

const MAX_REPORTED_TITLES = 250;
const RADARR_PROGRESS_LOG_INTERVAL = 250;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function pickString(obj: Record<string, unknown>, path: string): string | null {
  const v = pick(obj, path);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

function pickBool(obj: Record<string, unknown>, path: string): boolean | null {
  const v = pick(obj, path);
  return typeof v === 'boolean' ? v : null;
}

function requireString(obj: Record<string, unknown>, path: string): string {
  const s = pickString(obj, path);
  if (!s) throw new Error(`Missing required setting: ${path}`);
  return s;
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function pushCappedTitle(list: string[], title: string) {
  if (list.length >= MAX_REPORTED_TITLES) return;
  list.push(title);
}

function describeMovie(movie: RadarrMovie): string {
  const title =
    typeof movie.title === 'string' && movie.title.trim()
      ? movie.title.trim()
      : `movie#${movie.id}`;
  const year = toInt(movie['year']);
  return year ? `${title} (${year})` : title;
}

@Injectable()
export class UnmonitorConfirmJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly radarr: RadarrService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const setProgress = (params: {
      step: string;
      message: string;
      current?: number;
      total?: number;
      unit?: string;
      extra?: JsonObject;
    }) => {
      const { step, message, current, total, unit, extra } = params;
      void ctx
        .patchSummary({
          phase: 'unmonitorConfirm',
          progress: {
            step,
            message,
            ...(typeof current === 'number' ? { current } : {}),
            ...(typeof total === 'number' ? { total } : {}),
            ...(unit ? { unit } : {}),
            ...(extra ? { extra } : {}),
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);
    };

    const summary: JsonObject = {
      phase: 'unmonitorConfirm',
      dryRun: ctx.dryRun,
      plex: {
        totalLibraries: 0,
        movieLibraries: [],
        tmdbIds: 0,
      },
      radarr: {
        configured: false,
        totalMovies: 0,
        totalUnmonitored: 0,
        checked: 0,
        keptUnmonitored: 0,
        missingFromPlex: 0,
        remonitored: 0,
        wouldRemonitor: 0,
        missingTmdbId: 0,
        skippedPathConflicts: 0,
        keptTitles: [],
        remonitoredTitles: [],
        missingTmdbTitles: [],
        pathConflictTitles: [],
      },
    };

    await ctx.setSummary({
      ...summary,
      progress: {
        step: 'init',
        message: 'Initializing…',
        updatedAt: new Date().toISOString(),
      },
    });

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

    const plexBaseUrl =
      pickString(settings, 'plex.baseUrl') ??
      pickString(settings, 'plex.url') ??
      requireString(settings, 'plex.baseUrl');
    const plexToken =
      pickString(secrets, 'plex.token') ??
      pickString(secrets, 'plexToken') ??
      requireString(secrets, 'plex.token');

    const radarrBaseUrl =
      pickString(settings, 'radarr.baseUrl') ??
      pickString(settings, 'radarr.url') ??
      null;
    const radarrApiKey =
      pickString(secrets, 'radarr.apiKey') ??
      pickString(secrets, 'radarrApiKey') ??
      null;
    const radarrEnabledSetting = pickBool(settings, 'radarr.enabled');
    const radarrIntegrationEnabled =
      (radarrEnabledSetting ?? Boolean(radarrApiKey)) === true;
    const radarrConfigured =
      radarrIntegrationEnabled && Boolean(radarrBaseUrl && radarrApiKey);

    if (!radarrConfigured) {
      throw new Error(
        'Confirm Unmonitored requires Radarr to be configured (baseUrl + apiKey).',
      );
    }

    summary.radarr = {
      ...(summary.radarr as unknown as Record<string, unknown>),
      configured: true,
    } as unknown as JsonObject;
    await ctx.patchSummary({ radarr: summary.radarr as JsonObject });

    await ctx.info('unmonitorConfirm: start', {
      dryRun: ctx.dryRun,
      plexBaseUrl,
      radarrBaseUrl,
    });

    setProgress({
      step: 'plex_discovery',
      message: 'Discovering Plex libraries…',
    });

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const movieSections = sections.filter(
      (section) => (section.type ?? '').toLowerCase() === 'movie',
    );

    if (movieSections.length === 0) {
      throw new Error(
        'Confirm Unmonitored requires at least one Plex movie library to verify Radarr titles safely.',
      );
    }

    summary.plex = {
      totalLibraries: sections.length,
      movieLibraries: movieSections.map((section) => section.title),
      tmdbIds: 0,
    };
    await ctx.patchSummary({ plex: summary.plex as JsonObject });

    await ctx.info('plex: discovered movie libraries', {
      totalLibraries: sections.length,
      movieLibraries: movieSections.map((section) => section.title),
    });

    const plexTmdbIds = new Set<number>();
    setProgress({
      step: 'plex_tmdb_index',
      message: 'Scanning Plex movie libraries for TMDB ids…',
      current: 0,
      total: movieSections.length,
      unit: 'libraries',
    });

    let movieLibraryIndex = 0;
    for (const section of movieSections) {
      movieLibraryIndex += 1;
      setProgress({
        step: 'plex_tmdb_index',
        message: `Scanning Plex movie library: ${section.title}`,
        current: movieLibraryIndex,
        total: movieSections.length,
        unit: 'libraries',
      });
      const ids = await this.plexServer.getMovieTmdbIdSetForSectionKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey: section.key,
        sectionTitle: section.title,
      });
      for (const id of ids) plexTmdbIds.add(id);
      summary.plex = {
        ...(summary.plex as unknown as Record<string, unknown>),
        tmdbIds: plexTmdbIds.size,
      } as unknown as JsonObject;
      void ctx
        .patchSummary({ plex: summary.plex as JsonObject })
        .catch(() => undefined);
    }

    await ctx.info('plex: TMDB id set built', {
      size: plexTmdbIds.size,
      movieLibraries: movieSections.length,
    });

    setProgress({
      step: 'radarr_load',
      message: 'Loading Radarr movies…',
    });

    const allMovies = await this.radarr.listMovies({
      baseUrl: radarrBaseUrl as string,
      apiKey: radarrApiKey as string,
    });
    const unmonitoredMovies = allMovies.filter((movie) => !movie?.monitored);

    let checked = 0;
    let keptUnmonitored = 0;
    let missingFromPlex = 0;
    let remonitored = 0;
    let wouldRemonitor = 0;
    let missingTmdbId = 0;
    let skippedPathConflicts = 0;

    const keptTitles: string[] = [];
    const remonitoredTitles: string[] = [];
    const missingTmdbTitles: string[] = [];
    const pathConflictTitles: string[] = [];

    summary.radarr = {
      configured: true,
      totalMovies: allMovies.length,
      totalUnmonitored: unmonitoredMovies.length,
      checked: 0,
      keptUnmonitored: 0,
      missingFromPlex: 0,
      remonitored: 0,
      wouldRemonitor: 0,
      missingTmdbId: 0,
      skippedPathConflicts: 0,
      keptTitles,
      remonitoredTitles,
      missingTmdbTitles,
      pathConflictTitles,
    };
    await ctx.patchSummary({ radarr: summary.radarr as JsonObject });

    await ctx.info('radarr: loaded movies', {
      totalMovies: allMovies.length,
      totalUnmonitored: unmonitoredMovies.length,
    });

    setProgress({
      step: 'radarr_scan',
      message: 'Scanning Radarr unmonitored movies…',
      current: 0,
      total: unmonitoredMovies.length,
      unit: 'movies',
    });

    for (const movie of unmonitoredMovies) {
      checked += 1;
      const label = describeMovie(movie);
      const tmdbId = toInt(movie.tmdbId);

      if (!tmdbId) {
        missingTmdbId += 1;
        pushCappedTitle(missingTmdbTitles, label);
        await ctx.warn('radarr: unmonitored movie missing tmdbId (skipping)', {
          title: label,
          id: movie.id,
        });
      } else if (plexTmdbIds.has(tmdbId)) {
        keptUnmonitored += 1;
        pushCappedTitle(keptTitles, label);
      } else {
        missingFromPlex += 1;
        if (ctx.dryRun) {
          wouldRemonitor += 1;
          pushCappedTitle(remonitoredTitles, label);
        } else {
          const success = await this.radarr.setMovieMonitored({
            baseUrl: radarrBaseUrl as string,
            apiKey: radarrApiKey as string,
            movie,
            monitored: true,
          });
          if (success) {
            remonitored += 1;
            pushCappedTitle(remonitoredTitles, label);
          } else {
            skippedPathConflicts += 1;
            pushCappedTitle(pathConflictTitles, label);
            await ctx.warn(
              'radarr: skipped re-monitor due to path conflict (duplicate path in Radarr)',
              {
                title: label,
                tmdbId,
              },
            );
          }
        }
      }

      if (
        checked % RADARR_PROGRESS_LOG_INTERVAL === 0 ||
        checked === unmonitoredMovies.length
      ) {
        const currentRadarrSummary = {
          configured: true,
          totalMovies: allMovies.length,
          totalUnmonitored: unmonitoredMovies.length,
          checked,
          keptUnmonitored,
          missingFromPlex,
          remonitored,
          wouldRemonitor,
          missingTmdbId,
          skippedPathConflicts,
          keptTitles,
          remonitoredTitles,
          missingTmdbTitles,
          pathConflictTitles,
        } satisfies JsonObject;

        summary.radarr = currentRadarrSummary;
        await ctx.info('radarr: progress', {
          checked,
          totalUnmonitored: unmonitoredMovies.length,
          keptUnmonitored,
          missingFromPlex,
          remonitored,
          wouldRemonitor,
          missingTmdbId,
          skippedPathConflicts,
        });
        void ctx
          .patchSummary({ radarr: summary.radarr as JsonObject })
          .catch(() => undefined);
        setProgress({
          step: 'radarr_scan',
          message: 'Scanning Radarr unmonitored movies…',
          current: checked,
          total: unmonitoredMovies.length,
          unit: 'movies',
        });
      }
    }

    summary.plex = {
      totalLibraries: sections.length,
      movieLibraries: movieSections.map((section) => section.title),
      tmdbIds: plexTmdbIds.size,
    };
    summary.radarr = {
      configured: true,
      totalMovies: allMovies.length,
      totalUnmonitored: unmonitoredMovies.length,
      checked,
      keptUnmonitored,
      missingFromPlex,
      remonitored,
      wouldRemonitor,
      missingTmdbId,
      skippedPathConflicts,
      keptTitles,
      remonitoredTitles,
      missingTmdbTitles,
      pathConflictTitles,
    };

    await ctx.patchSummary({
      plex: summary.plex as JsonObject,
      radarr: summary.radarr as JsonObject,
      progress: {
        step: 'done',
        message: 'Completed.',
        updatedAt: new Date().toISOString(),
      },
    });

    await ctx.info('unmonitorConfirm: done', {
      plex: summary.plex,
      radarr: summary.radarr,
    });

    return {
      summary: buildUnmonitorConfirmReport({
        ctx,
        raw: summary,
      }) as unknown as JsonObject,
    };
  }
}

function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (value): value is string =>
      typeof value === 'string' && value.trim().length > 0,
  );
}

function buildFact(
  label: string,
  count: number,
  items: string[],
): { label: string; value: { count: number; unit: string; items: string[] } } {
  return {
    label,
    value: {
      count,
      unit: 'movies',
      items,
    },
  };
}

function buildUnmonitorConfirmReport(params: {
  ctx: JobContext;
  raw: JsonObject;
}): JobReportV1 {
  const { ctx, raw } = params;

  const plex = isPlainObject(raw.plex) ? raw.plex : {};
  const radarr = isPlainObject(raw.radarr) ? radarrSafe(raw.radarr) : {};

  const plexMovieLibraries = Array.isArray(plex.movieLibraries)
    ? plex.movieLibraries.length
    : null;
  const plexTmdbIds = asNum(plex.tmdbIds);

  const radarrConfigured = asBool(radarr.configured) ?? true;
  const totalUnmonitored = asNum(radarr.totalUnmonitored) ?? 0;
  const keptUnmonitored = asNum(radarr.keptUnmonitored) ?? 0;
  const missingFromPlex = asNum(radarr.missingFromPlex) ?? 0;
  const remonitored = asNum(radarr.remonitored) ?? 0;
  const wouldRemonitor = asNum(radarr.wouldRemonitor) ?? 0;
  const missingTmdbId = asNum(radarr.missingTmdbId) ?? 0;
  const skippedPathConflicts = asNum(radarr.skippedPathConflicts) ?? 0;
  const skipped = missingTmdbId + skippedPathConflicts;
  const changedCount = ctx.dryRun ? wouldRemonitor : remonitored;
  const endUnmonitored = Math.max(0, totalUnmonitored - changedCount);

  const keptTitles = asStringArray(radarr.keptTitles);
  const remonitoredTitles = asStringArray(radarr.remonitoredTitles);
  const missingTmdbTitles = asStringArray(radarr.missingTmdbTitles);
  const pathConflictTitles = asStringArray(radarr.pathConflictTitles);

  const issues = [
    ...(missingTmdbId
      ? [
          issue(
            'warn',
            `Radarr: ${missingTmdbId} unmonitored movie(s) missing TMDB id (skipped).`,
          ),
        ]
      : []),
    ...(skippedPathConflicts
      ? [
          issue(
            'warn',
            `Radarr: ${skippedPathConflicts} movie(s) could not be re-monitored due to path conflicts.`,
          ),
        ]
      : []),
  ];

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: ctx.jobId,
    dryRun: ctx.dryRun,
    trigger: ctx.trigger,
    headline: ctx.dryRun
      ? 'Dry-run complete.'
      : 'Confirm unmonitored complete.',
    sections: [
      {
        id: 'plex',
        title: 'Plex',
        rows: [
          metricRow({
            label: 'Movie libraries',
            end: plexMovieLibraries,
            unit: 'libraries',
          }),
          metricRow({
            label: 'TMDB ids indexed',
            end: plexTmdbIds,
            unit: 'ids',
          }),
        ],
      },
      {
        id: 'radarr',
        title: 'Radarr',
        rows: [
          metricRow({
            label: 'Unmonitored movies',
            start: totalUnmonitored,
            changed: -changedCount,
            end: endUnmonitored,
            unit: 'movies',
            note: ctx.dryRun ? 'Dry-run projection.' : null,
          }),
          metricRow({
            label: 'Confirmed still in Plex',
            end: keptUnmonitored,
            unit: 'movies',
          }),
          metricRow({
            label: ctx.dryRun ? 'Would re-monitor' : 'Re-monitored',
            end: changedCount,
            unit: 'movies',
          }),
          metricRow({
            label: 'Skipped',
            end: skipped,
            unit: 'movies',
          }),
        ],
      },
    ],
    tasks: [
      {
        id: 'plex_inventory',
        title: 'Plex inventory',
        status: 'success',
        rows: [
          metricRow({
            label: 'Movie libraries',
            end: plexMovieLibraries,
            unit: 'libraries',
          }),
          metricRow({
            label: 'TMDB ids indexed',
            end: plexTmdbIds,
            unit: 'ids',
          }),
        ],
      },
      {
        id: 'radarr_unmonitored_confirm',
        title: 'Radarr: confirm unmonitored movies against Plex',
        status: radarrConfigured ? 'success' : 'skipped',
        rows: [
          metricRow({
            label: 'Unmonitored movies',
            start: totalUnmonitored,
            changed: -changedCount,
            end: endUnmonitored,
            unit: 'movies',
            note: ctx.dryRun ? 'Dry-run projection.' : null,
          }),
          metricRow({
            label: 'Confirmed still in Plex',
            end: keptUnmonitored,
            unit: 'movies',
          }),
          metricRow({
            label: 'Missing from Plex',
            end: missingFromPlex,
            unit: 'movies',
          }),
          metricRow({
            label: ctx.dryRun ? 'Would re-monitor' : 'Re-monitored',
            end: changedCount,
            unit: 'movies',
          }),
          metricRow({
            label: 'Skipped',
            end: skipped,
            unit: 'movies',
          }),
        ],
        facts: [
          { label: 'Configured', value: radarrConfigured },
          buildFact('Kept unmonitored', keptUnmonitored, keptTitles),
          buildFact(
            ctx.dryRun ? 'Would re-monitor' : 'Re-monitored',
            changedCount,
            remonitoredTitles,
          ),
          buildFact(
            'Skipped missing TMDB id',
            missingTmdbId,
            missingTmdbTitles,
          ),
          buildFact(
            'Skipped path conflicts',
            skippedPathConflicts,
            pathConflictTitles,
          ),
        ],
        issues: issues.length ? issues : undefined,
      },
    ],
    issues,
    raw,
  };
}

function radarrSafe(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}
