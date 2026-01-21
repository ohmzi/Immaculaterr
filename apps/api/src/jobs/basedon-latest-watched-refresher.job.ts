import { Injectable } from '@nestjs/common';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexUsersService } from '../plex/plex-users.service';
import { SettingsService } from '../settings/settings.service';
import { WatchedCollectionsRefresherService } from '../watched-movie-recommendations/watched-collections-refresher.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import type { JobReportV1 } from './job-report-v1';
import { metricRow } from './job-report-v1';

const MOVIE_COLLECTIONS = [
  'Based on your recently watched movie',
  'Change of Taste',
] as const;

const TV_COLLECTIONS = [
  'Based on your recently watched show',
  'Change of Taste',
] as const;

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

function pickString(obj: Record<string, unknown>, path: string): string {
  const v = pick(obj, path);
  return typeof v === 'string' ? v.trim() : '';
}

function pickNumber(obj: Record<string, unknown>, path: string): number | null {
  const v = pick(obj, path);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseFloat(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(baseUrl);
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error('baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const it of v) {
    if (typeof it !== 'string') continue;
    const s = it.trim();
    if (!s) continue;
    out.push(s);
  }
  return out;
}

function uniqueStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of list) {
    const s = String(it ?? '').trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

@Injectable()
export class BasedonLatestWatchedRefresherJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexUsers: PlexUsersService,
    private readonly watchedRefresher: WatchedCollectionsRefresherService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const input = ctx.input ?? {};
    const { plexUserId, plexUserTitle, pinCollections } =
      await this.resolvePlexUserContext(ctx);
    const limitRaw = typeof input['limit'] === 'number' ? input['limit'] : null;
    const inputLimit =
      typeof limitRaw === 'number' && Number.isFinite(limitRaw)
        ? Math.max(1, Math.trunc(limitRaw))
        : null;

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

    void ctx
      .patchSummary({
        progress: {
          step: 'plex_libraries',
          message: 'Scanning Plex movie + TV libraries…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new Error('Plex baseUrl is not set');
    if (!plexToken) throw new Error('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const movieSections = sections
      .filter((s) => (s.type ?? '').toLowerCase() === 'movie')
      .sort((a, b) => a.title.localeCompare(b.title));
    const tvSections = sections
      .filter((s) => (s.type ?? '').toLowerCase() === 'show')
      .sort((a, b) => a.title.localeCompare(b.title));
    if (!movieSections.length && !tvSections.length) {
      throw new Error('No Plex movie or TV libraries found');
    }

    const machineIdentifier = await this.plexServer.getMachineIdentifier({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });

    // Collection size is controlled separately; do NOT default it to recommendations.count.
    const configuredLimitRaw =
      pickNumber(settings, 'recommendations.collectionLimit') ?? 15;
    const configuredLimit = Math.max(
      1,
      Math.min(200, Math.trunc(configuredLimitRaw || 15)),
    );
    const limit = inputLimit ?? configuredLimit;

    await ctx.info('recentlyWatchedRefresher: start', {
      dryRun: ctx.dryRun,
      plexUserId,
      plexUserTitle,
      movieLibraries: movieSections.map((s) => s.title),
      tvLibraries: tvSections.map((s) => s.title),
      collectionsMovie: Array.from(MOVIE_COLLECTIONS),
      collectionsTv: Array.from(TV_COLLECTIONS),
      limit,
      inputLimit,
      configuredLimit,
    });

    const refresh = await this.watchedRefresher.refresh({
      ctx,
      plexBaseUrl,
      plexToken,
      machineIdentifier,
      plexUserId,
      plexUserTitle,
      pinCollections,
      movieSections,
      tvSections,
      limit,
      scope: null,
    });

    const summary: JsonObject = {
      dryRun: ctx.dryRun,
      limit,
      refresh,
    };

    await ctx.info('recentlyWatchedRefresher: done', summary);
    const report = buildRecentlyWatchedRefresherReport({ ctx, raw: summary });
    return { summary: report as unknown as JsonObject };
  }

  private async resolvePlexUserContext(ctx: JobContext) {
    const input = ctx.input ?? {};
    const plexUserIdRaw =
      typeof input['plexUserId'] === 'string' ? input['plexUserId'].trim() : '';

    const fromInput = plexUserIdRaw
      ? await this.plexUsers.getPlexUserById(plexUserIdRaw)
      : null;
    const resolved =
      fromInput ?? (await this.plexUsers.ensureAdminPlexUser({ userId: ctx.userId }));

    return {
      plexUserId: resolved.id,
      plexUserTitle: resolved.plexAccountTitle,
      pinCollections: resolved.isAdmin,
    };
  }
}

function buildRecentlyWatchedRefresherReport(params: {
  ctx: JobContext;
  raw: JsonObject;
}): JobReportV1 {
  const { ctx, raw } = params;

  const refreshRaw = (raw as Record<string, unknown>).refresh;
  const refresh = isPlainObject(refreshRaw)
    ? (refreshRaw as Record<string, unknown>)
    : null;

  const tasks: JobReportV1['tasks'] = [];
  const issues: JobReportV1['issues'] = [];

  const addSide = (params: {
    prefix: 'movie' | 'tv';
    titlePrefix: 'Movie library:' | 'TV library:';
    collections: readonly string[];
    sentLabel: 'Sent to Radarr' | 'Sent to Sonarr';
  }) => {
    const sideRaw = refresh ? refresh[params.prefix] : null;
    const side = isPlainObject(sideRaw) ? (sideRaw as Record<string, unknown>) : null;
    const byLibraryRaw = side?.byLibrary;
    const byLibrary = Array.isArray(byLibraryRaw)
      ? byLibraryRaw.filter((b): b is Record<string, unknown> => isPlainObject(b))
      : [];

    for (const lib of byLibrary) {
      const library = String(lib.library ?? lib.librarySectionKey ?? 'Library');
      const librarySectionKey = String(lib.librarySectionKey ?? library);
      const colsRaw = lib.collections;
      const cols = Array.isArray(colsRaw)
        ? colsRaw.filter((c): c is Record<string, unknown> => isPlainObject(c))
        : [];

      for (const collectionName of params.collections) {
        const col = cols.find(
          (c) => String(c.collectionName ?? '').trim() === collectionName,
        );
        if (!col) continue;

        const desiredTitles = uniqueStrings(asStringArray(col.desiredTitles));
        const applying = asNum(col.applying) ?? desiredTitles.length;
        if (applying <= 0) {
          // If the collection wasn't updated, don't show a table for it.
          continue;
        }

        const plex = isPlainObject(col.plex) ? (col.plex as Record<string, unknown>) : null;
        const existingCount = plex ? asNum(plex.existingCount) : null;
        const desiredCount =
          (plex ? asNum(plex.desiredCount) : null) ?? (asNum(col.applying) ?? desiredTitles.length);

        const activatedNow = asNum(col.activatedNow) ?? 0;
        const tmdbBackfilled = asNum((col as Record<string, unknown>).tmdbBackfilled) ?? 0;

        const sent =
          params.prefix === 'movie'
            ? asNum((col as Record<string, unknown>).sentToRadarr) ?? 0
            : asNum((col as Record<string, unknown>).sentToSonarr) ?? 0;

        tasks.push({
          id: `${params.prefix}_${librarySectionKey}_${collectionName}`,
          title: `${params.titlePrefix} ${library} — ${collectionName}`,
          status: 'success',
          rows: [
            metricRow({
              label: 'Collection items',
              start: existingCount,
              changed:
                existingCount !== null && desiredCount !== null ? desiredCount - existingCount : null,
              end: desiredCount,
              unit: 'items',
            }),
            metricRow({ label: 'Activated now', end: activatedNow, unit: 'items' }),
            metricRow({ label: params.sentLabel, end: sent, unit: 'titles' }),
            metricRow({ label: 'TMDB ratings backfilled', end: tmdbBackfilled, unit: 'items' }),
          ],
        });
      }
    }
  };

  addSide({
    prefix: 'movie',
    titlePrefix: 'Movie library:',
    collections: MOVIE_COLLECTIONS,
    sentLabel: 'Sent to Radarr',
  });
  addSide({
    prefix: 'tv',
    titlePrefix: 'TV library:',
    collections: TV_COLLECTIONS,
    sentLabel: 'Sent to Sonarr',
  });

  if (tasks.length === 0) {
    tasks.push({
      id: 'nothing_to_do',
      title: 'well i got paid to do nothing',
      status: 'success',
      facts: [
        {
          label: 'Note',
          value:
            'this database will start suggesting as you watch more movies or run the Based on Latest Watched Collection task manually',
        },
      ],
    });
  }

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: ctx.jobId,
    dryRun: ctx.dryRun,
    trigger: ctx.trigger,
    headline: 'Refresher complete.',
    // Keep Summary card clean; the per-collection breakdown is shown in the step-by-step tasks.
    sections: [],
    tasks,
    issues,
    raw,
  };
}

