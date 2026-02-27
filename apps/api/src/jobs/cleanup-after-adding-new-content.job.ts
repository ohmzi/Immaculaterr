import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexWatchlistService } from '../plex/plex-watchlist.service';
import {
  PlexDuplicatesService,
  type PlexDeletePreference,
} from '../plex/plex-duplicates.service';
import { RadarrService, type RadarrMovie } from '../radarr/radarr.service';
import {
  SonarrService,
  type SonarrEpisode,
  type SonarrSeries,
} from '../sonarr/sonarr.service';
import type { JobContext, JobRunResult, JsonObject, JsonValue } from './jobs.types';
import type { JobReportV1 } from './job-report-v1';
import { issue, issuesFromWarnings, metricRow } from './job-report-v1';

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

function pickNumber(obj: Record<string, unknown>, path: string): number | null {
  const v = pick(obj, path);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseInt(v.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickStringArray(obj: Record<string, unknown>, path: string): string[] {
  const v = pick(obj, path);
  if (Array.isArray(v)) {
    return v
      .filter((x) => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function normTitle(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .split('')
    .filter((ch) => /[a-z0-9]/.test(ch))
    .join('');
}

function diceCoefficient(a: string, b: string): number {
  const s1 = normTitle(a);
  const s2 = normTitle(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  const bigrams = (s: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) ?? 0) + 1);
    }
    return map;
  };

  const m1 = bigrams(s1);
  const m2 = bigrams(s2);
  let intersection = 0;
  for (const [bg, c1] of m1.entries()) {
    const c2 = m2.get(bg) ?? 0;
    intersection += Math.min(c1, c2);
  }
  return (2 * intersection) / (s1.length - 1 + (s2.length - 1));
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function episodeKey(season: number, episode: number) {
  return `${season}:${episode}`;
}

function parseSeasonTitleFallback(title: string): {
  seriesTitle: string | null;
  seasonNumber: number | null;
} {
  // Match Python expectation: "Series Name - Season X"
  const raw = title.trim();
  if (!raw) return { seriesTitle: null, seasonNumber: null };
  if (!raw.includes(' - Season '))
    return { seriesTitle: null, seasonNumber: null };
  const [seriesTitleRaw, seasonPartRaw] = raw.split(' - Season ', 2);
  const seriesTitle = seriesTitleRaw.trim() || null;
  const match = seasonPartRaw.match(/(\d+)/);
  const seasonNumber = match ? Number.parseInt(match[1], 10) : null;
  return {
    seriesTitle,
    seasonNumber: Number.isFinite(seasonNumber) ? seasonNumber : null,
  };
}

function coerceDeletePreference(raw: string | null): PlexDeletePreference {
  const v = (raw ?? '').trim();
  if (v === 'smallest_file') return 'smallest_file';
  if (v === 'largest_file') return 'largest_file';
  if (v === 'newest') return 'newest';
  if (v === 'oldest') return 'oldest';
  return 'smallest_file';
}

function resolutionPriority(resolution: string | null): number {
  if (!resolution) return 1;
  const r = String(resolution).toLowerCase().trim();
  if (r.includes('4k') || r.includes('2160')) return 4;
  if (r.includes('1080')) return 3;
  if (r.includes('720')) return 2;
  if (r.includes('480')) return 1;
  return 1;
}

type MediaAddedCleanupFeatures = {
  deleteDuplicates: boolean;
  unmonitorInArr: boolean;
  removeFromWatchlist: boolean;
};

function readMediaAddedCleanupFeatures(
  settings: Record<string, unknown>,
): MediaAddedCleanupFeatures {
  return {
    deleteDuplicates:
      pickBool(
        settings,
        'jobs.mediaAddedCleanup.features.deleteDuplicates',
      ) ?? true,
    unmonitorInArr:
      pickBool(settings, 'jobs.mediaAddedCleanup.features.unmonitorInArr') ??
      true,
    removeFromWatchlist:
      pickBool(
        settings,
        'jobs.mediaAddedCleanup.features.removeFromWatchlist',
      ) ?? true,
  };
}

@Injectable()
export class CleanupAfterAddingNewContentJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexWatchlist: PlexWatchlistService,
    private readonly plexDuplicates: PlexDuplicatesService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const PROGRESS_TOTAL_STEPS = 6;
    const setProgress = async (
      current: number,
      step: string,
      message: string,
      extra?: JsonObject,
    ) => {
      await ctx.patchSummary({
        phase: 'running',
        progress: {
          step,
          message,
          current,
          total: PROGRESS_TOTAL_STEPS,
          updatedAt: new Date().toISOString(),
          ...(extra ?? {}),
        },
      });
    };

    // Ensure the UI has a meaningful live progress indicator immediately (JobsService sets a minimal one too).
    await setProgress(1, 'starting', 'Starting cleanup…');

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

    // Manual runs (Task Manager "Run now") should behave like a global cleanup sweep.
    // Treat any provided input as optional/no-op in manual mode.
    const input = ctx.trigger === 'manual' ? {} : (ctx.input ?? {});
    const mediaType = (pickString(input, 'mediaType') ?? '').toLowerCase();
    const title = pickString(input, 'title') ?? '';
    const year = pickNumber(input, 'year') ?? null;
    const ratingKey = pickString(input, 'ratingKey') ?? null;
    const showTitle =
      pickString(input, 'showTitle') ??
      // Some Plex webhook payloads include this style.
      pickString(input, 'grandparentTitle') ??
      null;
    const showRatingKey =
      pickString(input, 'showRatingKey') ??
      pickString(input, 'grandparentRatingKey') ??
      null;
    const seasonNumber = pickNumber(input, 'seasonNumber') ?? null;
    const episodeNumber = pickNumber(input, 'episodeNumber') ?? null;
    const tvdbIdInput = pickNumber(input, 'tvdbId');
    const tmdbIdInput = pickNumber(input, 'tmdbId');
    const plexEvent = pickString(input, 'plexEvent') ?? null;
    const persistedPath = pickString(input, 'persistedPath') ?? null;

    const features = readMediaAddedCleanupFeatures(settings);
    const featuresSummary: JsonObject = {
      deleteDuplicates: features.deleteDuplicates,
      unmonitorInArr: features.unmonitorInArr,
      removeFromWatchlist: features.removeFromWatchlist,
    };

    const radarrBaseUrlRaw =
      pickString(settings, 'radarr.baseUrl') ??
      pickString(settings, 'radarr.url') ??
      null;
    const radarrApiKey = pickString(secrets, 'radarr.apiKey') ?? null;
    const radarrEnabledSetting = pickBool(settings, 'radarr.enabled');
    const radarrIntegrationEnabled =
      (radarrEnabledSetting ?? Boolean(radarrApiKey)) === true;
    const radarrConfigured = Boolean(
      radarrIntegrationEnabled && radarrBaseUrlRaw && radarrApiKey,
    );

    const sonarrBaseUrlRaw =
      pickString(settings, 'sonarr.baseUrl') ??
      pickString(settings, 'sonarr.url') ??
      null;
    const sonarrApiKey = pickString(secrets, 'sonarr.apiKey') ?? null;
    const sonarrEnabledSetting = pickBool(settings, 'sonarr.enabled');
    const sonarrIntegrationEnabled =
      (sonarrEnabledSetting ?? Boolean(sonarrApiKey)) === true;
    const sonarrConfigured = Boolean(
      sonarrIntegrationEnabled && sonarrBaseUrlRaw && sonarrApiKey,
    );

    const summary: JsonObject = {
      dryRun: ctx.dryRun,
      plexEvent,
      mediaType,
      title,
      year,
      ratingKey,
      showTitle,
      showRatingKey,
      seasonNumber,
      episodeNumber,
      features: featuresSummary,
      skipReason: null as string | null,
      radarr: {
        configured: radarrConfigured,
        connected: null as boolean | null,
        moviesUnmonitored: 0,
        moviesWouldUnmonitor: 0,
        error: null as string | null,
      },
      sonarr: {
        configured: sonarrConfigured,
        connected: null as boolean | null,
        episodesUnmonitored: 0,
        episodesWouldUnmonitor: 0,
        error: null as string | null,
      },
      watchlist: { removed: 0, attempted: 0, matchedBy: 'none' as const },
      duplicates: null,
      skipped: false,
      warnings: [] as string[],
    };

    // Make this job show a live "what it's doing" card while running. The final jobReportV1
    // produced by `toReport(...)` replaces this summary on completion.
    await ctx.setSummary({
      phase: 'running',
      ...summary,
      progress: {
        step: 'starting',
        message: 'Starting cleanup…',
        current: 1,
        total: PROGRESS_TOTAL_STEPS,
        updatedAt: new Date().toISOString(),
      },
    });

    const toReport = (rawSummary: JsonObject): JobRunResult => {
      const report = buildMediaAddedCleanupReport({ ctx, raw: rawSummary });
      return { summary: report as unknown as JsonObject };
    };

    if (
      !features.deleteDuplicates &&
      !features.unmonitorInArr &&
      !features.removeFromWatchlist
    ) {
      summary.skipped = true;
      summary.skipReason = 'no_features_enabled';
      await ctx.info(
        'mediaAddedCleanup: all features disabled; exiting as no-op',
        {
          dryRun: ctx.dryRun,
          trigger: ctx.trigger,
          features,
          mediaType,
          title,
        },
      );
      return toReport(summary);
    }

    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') ??
      pickString(settings, 'plex.url') ??
      null;
    const plexToken = pickString(secrets, 'plex.token') ?? null;

    if (!plexBaseUrlRaw || !plexToken) {
      throw new Error(
        'Missing Plex configuration (plex.baseUrl + secrets.plex.token)',
      );
    }
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    const plexSections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const plexMovieSections = plexSections.filter(
      (s) => (s.type ?? '').toLowerCase() === 'movie',
    );
    const plexTvSections = plexSections.filter(
      (s) => (s.type ?? '').toLowerCase() === 'show',
    );

    const deletePreference = coerceDeletePreference(
      pickString(settings, 'plex.deletePreference') ??
        pickString(settings, 'plex.delete_preference') ??
        null,
    );
    const preserveQualityTerms = [
      ...pickStringArray(settings, 'plex.preserveQuality'),
      ...pickStringArray(settings, 'plex.preserve_quality'),
    ];

    const radarrBaseUrl =
      radarrIntegrationEnabled && radarrBaseUrlRaw && radarrApiKey
        ? normalizeHttpUrl(radarrBaseUrlRaw)
        : null;

    const sonarrBaseUrl =
      sonarrIntegrationEnabled && sonarrBaseUrlRaw && sonarrApiKey
        ? normalizeHttpUrl(sonarrBaseUrlRaw)
        : null;

    await ctx.info('mediaAddedCleanup: start', {
      dryRun: ctx.dryRun,
      plexEvent,
      mediaType,
      title,
      year,
      ratingKey,
      showTitle,
      showRatingKey,
      seasonNumber,
      episodeNumber,
      persistedPath,
      features,
      deletePreference,
      preserveQualityTerms,
      radarrConfigured: Boolean(radarrBaseUrl && radarrApiKey),
      sonarrConfigured: Boolean(sonarrBaseUrl && sonarrApiKey),
    });

    if (!mediaType) {
      await ctx.info(
        'mediaAddedCleanup: no mediaType provided; running full duplicates sweep',
        {
          trigger: ctx.trigger,
          dryRun: ctx.dryRun,
        },
      );

      const sweepWarnings: string[] = [];
      const pushItem = (
        list: string[],
        item: string,
        max: number,
        onTruncate: () => void,
      ) => {
        if (list.length >= max) {
          onTruncate();
          return;
        }
        const s = String(item ?? '').trim();
        if (!s) return;
        list.push(s);
      };
      let plexTvdbRatingKeysForSweep: Map<number, string[]> | null = null;

      // --- Load Radarr index once (best-effort)
      let radarrMovies: RadarrMovie[] = [];
      const radarrByTmdb = new Map<number, RadarrMovie>();
      const radarrByNormTitle = new Map<string, RadarrMovie>();
      let fullSweepRadarrConnected: boolean | null = null;
      if (features.unmonitorInArr && radarrBaseUrl && radarrApiKey) {
        try {
          radarrMovies = await this.radarr.listMovies({
            baseUrl: radarrBaseUrl,
            apiKey: radarrApiKey,
          });
          fullSweepRadarrConnected = true;
          for (const m of radarrMovies) {
            const tmdb = toInt(m.tmdbId);
            if (tmdb) radarrByTmdb.set(tmdb, m);
            const t = typeof m.title === 'string' ? m.title : '';
            if (t) radarrByNormTitle.set(normTitle(t), m);
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          fullSweepRadarrConnected = false;
          sweepWarnings.push(
            `radarr: failed to load movies (continuing): ${msg}`,
          );
          await ctx.warn('radarr: failed to load movies (continuing)', {
            error: msg,
          });
        }
      }

      // --- Load Sonarr series index once (best-effort)
      let sonarrSeriesList: SonarrSeries[] = [];
      const sonarrByTvdb = new Map<number, SonarrSeries>();
      const sonarrByNormTitle = new Map<string, SonarrSeries>();
      const sonarrEpisodesCache = new Map<number, Map<string, SonarrEpisode>>();
      let fullSweepSonarrConnected: boolean | null = null;
      if (
        sonarrBaseUrl &&
        sonarrApiKey &&
        (features.removeFromWatchlist || features.unmonitorInArr)
      ) {
        try {
          sonarrSeriesList = await this.sonarr.listSeries({
            baseUrl: sonarrBaseUrl,
            apiKey: sonarrApiKey,
          });
          fullSweepSonarrConnected = true;
          for (const s of sonarrSeriesList) {
            const tvdb = toInt(s.tvdbId);
            if (tvdb) sonarrByTvdb.set(tvdb, s);
            const t = typeof s.title === 'string' ? s.title : '';
            if (t) sonarrByNormTitle.set(normTitle(t), s);
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          fullSweepSonarrConnected = false;
          sweepWarnings.push(
            `sonarr: failed to load series (continuing): ${msg}`,
          );
          await ctx.warn('sonarr: failed to load series (continuing)', {
            error: msg,
          });
        }
      }

      const findSonarrSeriesFromCache = (params: {
        tvdbId?: number | null;
        title: string;
      }): SonarrSeries | null => {
        const tvdbId = params.tvdbId ?? null;
        if (tvdbId) {
          const byTvdb = sonarrByTvdb.get(tvdbId);
          if (byTvdb) return byTvdb;
        }
        const q = params.title.trim();
        if (!q) return null;
        const norm = normTitle(q);
        const exact = sonarrByNormTitle.get(norm);
        if (exact) return exact;
        // Fuzzy fallback
        let best: { s: SonarrSeries; score: number } | null = null;
        for (const s of sonarrSeriesList) {
          const t = typeof s.title === 'string' ? s.title : '';
          if (!t) continue;
          const score = diceCoefficient(q, t);
          if (!best || score > best.score) best = { s, score };
        }
        if (best && best.score >= 0.7) return best.s;
        return null;
      };

      const getSonarrEpisodeMap = async (seriesId: number) => {
        const cached = sonarrEpisodesCache.get(seriesId);
        if (cached) return cached;
        if (!sonarrBaseUrl || !sonarrApiKey)
          return new Map<string, SonarrEpisode>();
        const eps = await this.sonarr.getEpisodesBySeries({
          baseUrl: sonarrBaseUrl,
          apiKey: sonarrApiKey,
          seriesId,
        });
        const map = new Map<string, SonarrEpisode>();
        for (const ep of eps) {
          const season = toInt(ep.seasonNumber);
          const epNum = toInt(ep.episodeNumber);
          if (!season || !epNum) continue;
          map.set(episodeKey(season, epNum), ep);
        }
        sonarrEpisodesCache.set(seriesId, map);
        return map;
      };

      const preserveTerms = preserveQualityTerms
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const metaHasPreservedCopy = (meta: {
        media: Array<{
          videoResolution: string | null;
          parts: Array<{ file: string | null }>;
        }>;
      }) => {
        if (!preserveTerms.length) return false;
        for (const m of meta.media ?? []) {
          for (const p of m.parts ?? []) {
            const target =
              `${m.videoResolution ?? ''} ${p.file ?? ''}`.toLowerCase();
            if (preserveTerms.some((t) => target.includes(t))) return true;
          }
        }
        return false;
      };

      const pickRadarrMovie = (tmdbId: number | null, title: string) => {
        if (tmdbId) {
          const byTmdb = radarrByTmdb.get(tmdbId);
          if (byTmdb) return byTmdb;
        }
        const byTitle = radarrByNormTitle.get(normTitle(title));
        return byTitle ?? null;
      };

      const movieStats = {
        scanned: 0,
        groups: 0,
        groupsWithDuplicates: 0,
        metadataDeleted: 0,
        metadataWouldDelete: 0,
        partsDeleted: 0,
        partsWouldDelete: 0,
        failures: 0,
        radarrUnmonitored: 0,
        radarrWouldUnmonitor: 0,
        radarrNotFound: 0,
        deletedMetadataItems: [] as string[],
        deletedVersionItems: [] as string[],
        radarrUnmonitoredItems: [] as string[],
        itemsTruncated: false,
      };
      const episodeStats = {
        candidates: 0,
        groupsWithDuplicates: 0,
        metadataDeleted: 0,
        metadataWouldDelete: 0,
        partsDeleted: 0,
        partsWouldDelete: 0,
        failures: 0,
        sonarrUnmonitored: 0,
        sonarrWouldUnmonitor: 0,
        sonarrNotFound: 0,
        deletedMetadataItems: [] as string[],
        deletedVersionItems: [] as string[],
        sonarrUnmonitoredItems: [] as string[],
        itemsTruncated: false,
      };

      const deletedMovieRatingKeys = new Set<string>();
      const movies: Array<{
        ratingKey: string;
        title: string;
        tmdbId: number | null;
        addedAt: number | null;
        year: number | null;
        libraryTitle: string;
      }> = [];

      if (features.deleteDuplicates) {
        await setProgress(
          2,
          'scan_movies',
          'Scanning Plex movies for duplicates…',
          {
            libraries: plexMovieSections.map((s) => s.title),
          },
        );
        try {
        await ctx.info('plex: loading movies (tmdb index)', {
          libraries: plexMovieSections.map((s) => s.title),
        });

        for (const sec of plexMovieSections) {
          try {
            const items =
              await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
                baseUrl: plexBaseUrl,
                token: plexToken,
                librarySectionKey: sec.key,
                sectionTitle: sec.title,
              });
            for (const it of items) {
              movies.push({ ...it, libraryTitle: sec.title });
            }
          } catch (err) {
            const msg = (err as Error)?.message ?? String(err);
            sweepWarnings.push(
              `plex: failed listing movies for section=${sec.title} (continuing): ${msg}`,
            );
            await ctx.warn(
              'plex: failed listing movies for section (continuing)',
              {
                section: sec.title,
                error: msg,
              },
            );
          }
        }

        movieStats.scanned = movies.length;

        const groups = new Map<
          number,
          Array<{ ratingKey: string; title: string; addedAt: number | null }>
        >();
        for (const m of movies) {
          if (!m.tmdbId) continue;
          const list = groups.get(m.tmdbId) ?? [];
          list.push({
            ratingKey: m.ratingKey,
            title: m.title,
            addedAt: m.addedAt,
          });
          groups.set(m.tmdbId, list);
        }
        movieStats.groups = groups.size;

        await setProgress(
          3,
          'clean_movies',
          'Deleting duplicate movies (Plex) and unmonitoring in Radarr…',
        );

        for (const [tmdbId, items] of groups.entries()) {
          if (items.length < 2) continue;
          movieStats.groupsWithDuplicates += 1;

          await ctx.info('plex: duplicate movie group found', {
            tmdbId,
            candidates: items.length,
            ratingKeys: items.map((i) => i.ratingKey),
          });

          // Load details for each candidate (so we can choose a winner).
          const metas: Array<{
            ratingKey: string;
            title: string;
            addedAt: number | null;
            preserved: boolean;
            bestResolution: number;
            bestSize: number | null;
          }> = [];

          for (const it of items) {
            try {
              const meta = await this.plexServer.getMetadataDetails({
                baseUrl: plexBaseUrl,
                token: plexToken,
                ratingKey: it.ratingKey,
              });
              if (!meta) continue;

              let bestRes = 1;
              let bestSize: number | null = null;
              for (const m of meta.media ?? []) {
                bestRes = Math.max(
                  bestRes,
                  resolutionPriority(m.videoResolution),
                );
                for (const p of m.parts ?? []) {
                  if (typeof p.size === 'number' && Number.isFinite(p.size)) {
                    bestSize =
                      bestSize === null ? p.size : Math.max(bestSize, p.size);
                  }
                }
              }

              metas.push({
                ratingKey: meta.ratingKey,
                title: meta.title || it.title,
                addedAt: meta.addedAt ?? it.addedAt ?? null,
                preserved: metaHasPreservedCopy(meta),
                bestResolution: bestRes,
                bestSize,
              });
            } catch (err) {
              movieStats.failures += 1;
              await ctx.warn(
                'plex: failed loading movie metadata (continuing)',
                {
                  ratingKey: it.ratingKey,
                  error: (err as Error)?.message ?? String(err),
                },
              );
            }
          }

          if (metas.length < 2) continue;

          const pref = deletePreference;
          const pool = metas.some((m) => m.preserved)
            ? metas.filter((m) => m.preserved)
            : metas;

          const sorted = pool.slice().sort((a, b) => {
            if (pref === 'newest' || pref === 'oldest') {
              const aa = a.addedAt ?? 0;
              const bb = b.addedAt ?? 0;
              // delete newest => keep oldest; delete oldest => keep newest
              if (aa !== bb) return pref === 'newest' ? aa - bb : bb - aa;
            } else if (pref === 'largest_file' || pref === 'smallest_file') {
              const sa =
                a.bestSize ??
                (pref === 'smallest_file' ? Number.POSITIVE_INFINITY : 0);
              const sb =
                b.bestSize ??
                (pref === 'smallest_file' ? Number.POSITIVE_INFINITY : 0);
              // delete smallest => keep largest; delete largest => keep smallest
              if (sa !== sb)
                return pref === 'smallest_file' ? sb - sa : sa - sb;
            }

            // Tie-breaker: higher resolution, then larger size.
            if (a.bestResolution !== b.bestResolution) {
              return b.bestResolution - a.bestResolution;
            }
            const sa2 = a.bestSize ?? 0;
            const sb2 = b.bestSize ?? 0;
            return sb2 - sa2;
          });

          const keep = sorted[0];
          const deleteKeys = metas
            .map((m) => m.ratingKey)
            .filter((rk) => rk !== keep.ratingKey);

          await ctx.info('plex: keeping best movie candidate', {
            tmdbId,
            keepRatingKey: keep.ratingKey,
            keepTitle: keep.title,
            preference: deletePreference,
            preservedPreferred: metas.some((m) => m.preserved),
            deleteRatingKeys: deleteKeys,
          });

          // Unmonitor in Radarr once per TMDB group (best-effort).
          if (features.unmonitorInArr && radarrBaseUrl && radarrApiKey) {
            const candidate = pickRadarrMovie(tmdbId, keep.title);
            if (!candidate) {
              movieStats.radarrNotFound += 1;
              await ctx.warn('radarr: movie not found for duplicate group', {
                tmdbId,
                title: keep.title,
              });
            } else if (!candidate.monitored) {
              await ctx.debug('radarr: already unmonitored (duplicate group)', {
                tmdbId,
                title:
                  typeof candidate.title === 'string'
                    ? candidate.title
                    : keep.title,
              });
            } else if (ctx.dryRun) {
              movieStats.radarrWouldUnmonitor += 1;
              await ctx.info(
                'radarr: dry-run would unmonitor (duplicate group)',
                {
                  tmdbId,
                  title:
                    typeof candidate.title === 'string'
                      ? candidate.title
                      : keep.title,
                },
              );
            } else {
              const ok = await this.radarr
                .setMovieMonitored({
                  baseUrl: radarrBaseUrl,
                  apiKey: radarrApiKey,
                  movie: candidate,
                  monitored: false,
                })
                .catch(() => false);
              if (ok) movieStats.radarrUnmonitored += 1;
              if (ok) {
                pushItem(
                  movieStats.radarrUnmonitoredItems,
                  `${keep.title} [tmdbId=${tmdbId}]`,
                  200,
                  () => (movieStats.itemsTruncated = true),
                );
              }
              if (!ok) {
                await ctx.warn('radarr: failed to unmonitor (duplicate group)', {
                  tmdbId,
                  radarrId: toInt((candidate as unknown as Record<string, unknown>)['id']),
                  title:
                    typeof candidate.title === 'string'
                      ? candidate.title
                      : keep.title,
                });
              }
              await ctx.info('radarr: unmonitor result (duplicate group)', {
                ok,
                tmdbId,
                title:
                  typeof candidate.title === 'string'
                    ? candidate.title
                    : keep.title,
              });
            }
          }

          // Delete extra metadata items (duplicates across ratingKeys).
          for (const rk of deleteKeys) {
            if (ctx.dryRun) {
              movieStats.metadataWouldDelete += 1;
              continue;
            }
            try {
              await this.plexServer.deleteMetadataByRatingKey({
                baseUrl: plexBaseUrl,
                token: plexToken,
                ratingKey: rk,
              });
              movieStats.metadataDeleted += 1;
              deletedMovieRatingKeys.add(rk);
              const metaTitle =
                metas.find((m) => m.ratingKey === rk)?.title ?? `ratingKey=${rk}`;
              pushItem(
                movieStats.deletedMetadataItems,
                `${metaTitle} [ratingKey=${rk}]`,
                200,
                () => (movieStats.itemsTruncated = true),
              );
            } catch (err) {
              movieStats.failures += 1;
              await ctx.warn(
                'plex: failed deleting duplicate movie metadata (continuing)',
                {
                  ratingKey: rk,
                  tmdbId,
                  error: (err as Error)?.message ?? String(err),
                },
              );
            }
          }

          // Cleanup extra versions within the kept item (if any).
          try {
            const dup = await this.plexDuplicates.cleanupMovieDuplicates({
              baseUrl: plexBaseUrl,
              token: plexToken,
              ratingKey: keep.ratingKey,
              dryRun: ctx.dryRun,
              deletePreference,
              preserveQualityTerms,
            });
            movieStats.partsDeleted += dup.deleted;
            movieStats.partsWouldDelete += dup.wouldDelete;
            const relevantDeletes = (dup.deletions ?? []).filter((d) =>
              ctx.dryRun ? Boolean(d) : d.deleted === true,
            );
            for (const d of relevantDeletes) {
              const mid = d.mediaId ? `mediaId=${d.mediaId}` : 'mediaId=?';
              pushItem(
                movieStats.deletedVersionItems,
                `${dup.title} [ratingKey=${dup.ratingKey}] ${mid}`,
                200,
                () => (movieStats.itemsTruncated = true),
              );
            }

            // Verification: if Plex still reports multiple Media entries, we likely lacked deletable part keys.
            try {
              const post = await this.plexServer.getMetadataDetails({
                baseUrl: plexBaseUrl,
                token: plexToken,
                ratingKey: keep.ratingKey,
              });
              const mediaCount = post?.media?.length ?? 0;
              if (mediaCount > 1) {
                sweepWarnings.push(
                  `plex: movie still has multiple media versions after cleanup ratingKey=${keep.ratingKey} media=${mediaCount}`,
                );
                await ctx.warn('plex: movie still has multiple media versions after cleanup', {
                  ratingKey: keep.ratingKey,
                  tmdbId,
                  mediaCount,
                });
              }
            } catch {
              // ignore verification failures
            }
          } catch (err) {
            movieStats.failures += 1;
            await ctx.warn(
              'plex: failed cleaning movie versions (continuing)',
              {
                ratingKey: keep.ratingKey,
                tmdbId,
                error: (err as Error)?.message ?? String(err),
              },
            );
          }
        }

        // Additionally: movies with internal duplicates (multiple versions) might not
        // show up as TMDB groups. Ask Plex for duplicate-filtered movies and clean them.
        try {
          const dupKeys: Array<{ ratingKey: string; libraryTitle: string }> =
            [];
          for (const sec of plexMovieSections) {
            try {
              const items =
                await this.plexServer.listDuplicateMovieRatingKeysForSectionKey(
                  {
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    librarySectionKey: sec.key,
                  },
                );
              for (const it of items)
                dupKeys.push({
                  ratingKey: it.ratingKey,
                  libraryTitle: sec.title,
                });
            } catch (err) {
              const msg = (err as Error)?.message ?? String(err);
              sweepWarnings.push(
                `plex: movie duplicate listing failed section=${sec.title} (continuing): ${msg}`,
              );
              await ctx.warn(
                'plex: movie duplicate listing failed (continuing)',
                {
                  section: sec.title,
                  error: msg,
                },
              );
            }
          }

          for (const { ratingKey: rk, libraryTitle } of dupKeys) {
            if (deletedMovieRatingKeys.has(rk)) continue;
            try {
              const dup = await this.plexDuplicates.cleanupMovieDuplicates({
                baseUrl: plexBaseUrl,
                token: plexToken,
                ratingKey: rk,
                dryRun: ctx.dryRun,
                deletePreference,
                preserveQualityTerms,
              });
              if (dup.deleted || dup.wouldDelete) {
                movieStats.partsDeleted += dup.deleted;
                movieStats.partsWouldDelete += dup.wouldDelete;
                const relevantDeletes = (dup.deletions ?? []).filter((d) =>
                  ctx.dryRun ? Boolean(d) : d.deleted === true,
                );
                for (const d of relevantDeletes) {
                  const mid = d.mediaId ? `mediaId=${d.mediaId}` : 'mediaId=?';
                  pushItem(
                    movieStats.deletedVersionItems,
                    `${dup.title} [ratingKey=${dup.ratingKey}] ${mid}`,
                    200,
                    () => (movieStats.itemsTruncated = true),
                  );
                }

                const tmdbId = dup.metadata.tmdbIds[0] ?? null;
                const candidate =
                  radarrBaseUrl && radarrApiKey
                    ? pickRadarrMovie(tmdbId, dup.title)
                    : null;

                if (features.unmonitorInArr && radarrBaseUrl && radarrApiKey) {
                  if (!candidate) {
                    movieStats.radarrNotFound += 1;
                  await ctx.warn('radarr: movie not found for duplicate-only item', {
                    ratingKey: rk,
                    tmdbId,
                    title: dup.title,
                  });
                  } else if (candidate.monitored) {
                    if (ctx.dryRun) {
                      movieStats.radarrWouldUnmonitor += 1;
                    } else {
                      const ok = await this.radarr
                        .setMovieMonitored({
                          baseUrl: radarrBaseUrl,
                          apiKey: radarrApiKey,
                          movie: candidate,
                          monitored: false,
                        })
                        .catch(() => false);
                      if (ok) movieStats.radarrUnmonitored += 1;
                      if (ok) {
                        pushItem(
                          movieStats.radarrUnmonitoredItems,
                          `${dup.title}${dup.metadata.year ? ` (${dup.metadata.year})` : ''} [tmdbId=${tmdbId ?? 'unknown'}]`,
                          200,
                          () => (movieStats.itemsTruncated = true),
                        );
                      }
                    if (!ok) {
                      await ctx.warn('radarr: failed to unmonitor (duplicate-only item)', {
                        ratingKey: rk,
                        tmdbId,
                        radarrId: toInt((candidate as unknown as Record<string, unknown>)['id']),
                        title:
                          typeof candidate.title === 'string'
                            ? candidate.title
                            : dup.title,
                      });
                    }
                    }
                } else {
                  await ctx.debug('radarr: already unmonitored (duplicate-only item)', {
                    ratingKey: rk,
                    tmdbId,
                    title:
                      typeof candidate.title === 'string'
                        ? candidate.title
                        : dup.title,
                  });
                  }
                }
              }

            // Verification: if Plex still reports multiple Media entries, we likely lacked deletable part keys.
            try {
              const post = await this.plexServer.getMetadataDetails({
                baseUrl: plexBaseUrl,
                token: plexToken,
                ratingKey: rk,
              });
              const mediaCount = post?.media?.length ?? 0;
              if (mediaCount > 1) {
                sweepWarnings.push(
                  `plex: movie still has multiple media versions after cleanup ratingKey=${rk} media=${mediaCount}`,
                );
                await ctx.warn('plex: movie still has multiple media versions after cleanup', {
                  ratingKey: rk,
                  tmdbId: dup.metadata.tmdbIds[0] ?? null,
                  mediaCount,
                });
              }
            } catch {
              // ignore verification failures
            }
            } catch (err) {
              movieStats.failures += 1;
              await ctx.warn(
                'plex: failed cleaning duplicate movie (continuing)',
                {
                  ratingKey: rk,
                  section: libraryTitle,
                  error: (err as Error)?.message ?? String(err),
                },
              );
            }
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          sweepWarnings.push(`plex: movie duplicate listing failed: ${msg}`);
          await ctx.warn('plex: movie duplicate listing failed (continuing)', {
            error: msg,
          });
        }
        } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        sweepWarnings.push(`plex: movie scan failed: ${msg}`);
        await ctx.warn('plex: movie scan failed (continuing)', { error: msg });
      }

      // --- Episode duplicates sweep
      type EpisodeCandidate = {
        ratingKey: string;
        showTitle: string | null;
        season: number | null;
        episode: number | null;
        bestResolution: number;
        bestSize: number | null;
      };

      const episodeCandidates: EpisodeCandidate[] = [];

      await setProgress(4, 'scan_episodes', 'Scanning Plex episodes for duplicates…', {
        libraries: plexTvSections.map((s) => s.title),
      });

      const loadDuplicateEpisodeKeys = async (): Promise<string[]> => {
        const out = new Set<string>();
        let anySucceeded = false;

        for (const sec of plexTvSections) {
          try {
            const rows =
              await this.plexServer.listDuplicateEpisodeRatingKeysForSectionKey(
                {
                  baseUrl: plexBaseUrl,
                  token: plexToken,
                  librarySectionKey: sec.key,
                },
              );
            for (const r of rows) out.add(r.ratingKey);
            anySucceeded = true;
          } catch (err) {
            await ctx.warn(
              'plex: duplicate episode listing failed for section (continuing)',
              {
                section: sec.title,
                error: (err as Error)?.message ?? String(err),
              },
            );
          }
        }

        if (anySucceeded) return Array.from(out);

        // Fallback: per-show duplicate leaves
        await ctx.warn(
          'plex: duplicate episode listing failed; falling back to per-show scan',
        );
        try {
          for (const sec of plexTvSections) {
            const shows = await this.plexServer.listTvShowsForSectionKey({
              baseUrl: plexBaseUrl,
              token: plexToken,
              librarySectionKey: sec.key,
            });
            for (const show of shows) {
              try {
                const eps = await this.plexServer.listEpisodesForShow({
                  baseUrl: plexBaseUrl,
                  token: plexToken,
                  showRatingKey: show.ratingKey,
                  duplicateOnly: true,
                });
                for (const ep of eps) out.add(ep.ratingKey);
              } catch {
                // ignore per-show errors
              }
            }
          }
        } catch {
          // ignore fallback errors
        }

        return Array.from(out);
      };

      try {
        const dupEpisodeKeys = await loadDuplicateEpisodeKeys();
        episodeStats.candidates = dupEpisodeKeys.length;

        for (const rk of dupEpisodeKeys) {
          try {
            const meta = await this.plexServer.getMetadataDetails({
              baseUrl: plexBaseUrl,
              token: plexToken,
              ratingKey: rk,
            });
            if (!meta) continue;
            const showTitle = meta.grandparentTitle;
            const season = meta.parentIndex;
            const epNum = meta.index;

            let bestRes = 1;
            let bestSize: number | null = null;
            for (const m of meta.media ?? []) {
              bestRes = Math.max(
                bestRes,
                resolutionPriority(m.videoResolution),
              );
              for (const p of m.parts ?? []) {
                if (typeof p.size === 'number' && Number.isFinite(p.size)) {
                  bestSize =
                    bestSize === null ? p.size : Math.max(bestSize, p.size);
                }
              }
            }

            episodeCandidates.push({
              ratingKey: meta.ratingKey,
              showTitle,
              season,
              episode: epNum,
              bestResolution: bestRes,
              bestSize,
            });
          } catch (err) {
            episodeStats.failures += 1;
            await ctx.warn(
              'plex: failed loading episode metadata (continuing)',
              {
                ratingKey: rk,
                error: (err as Error)?.message ?? String(err),
              },
            );
          }
        }

        // Group by show+season+episode across ratingKeys.
        const byKey = new Map<string, EpisodeCandidate[]>();
        for (const c of episodeCandidates) {
          // Only group across ratingKeys when we have stable identifiers (show+SxxExx).
          // Otherwise, keep groups isolated per ratingKey for safety.
          const show =
            typeof c.showTitle === 'string' && c.showTitle.trim()
              ? normTitle(c.showTitle)
              : null;
          const season =
            typeof c.season === 'number' && Number.isFinite(c.season)
              ? c.season
              : null;
          const ep =
            typeof c.episode === 'number' && Number.isFinite(c.episode)
              ? c.episode
              : null;
          const key =
            show && season !== null && ep !== null
              ? `${show}:${season}:${ep}`
              : `rk:${c.ratingKey}`;
          const list = byKey.get(key) ?? [];
          list.push(c);
          byKey.set(key, list);
        }

        await setProgress(
          5,
          'clean_episodes',
          'Deleting duplicate episodes (Plex) and unmonitoring in Sonarr…',
        );

        for (const [key, group] of byKey.entries()) {
          if (!key || group.length === 0) continue;

          const season = group[0]?.season ?? null;
          const epNum = group[0]?.episode ?? null;
          const showTitle = group[0]?.showTitle ?? null;

          // Pick keep candidate (best resolution, then size).
          const sorted = group.slice().sort((a, b) => {
            if (a.bestResolution !== b.bestResolution)
              return b.bestResolution - a.bestResolution;
            const sa = a.bestSize ?? 0;
            const sb = b.bestSize ?? 0;
            return sb - sa;
          });
          const keep = sorted[0];
          const deleteKeys = group
            .map((g) => g.ratingKey)
            .filter((rk) => rk !== keep.ratingKey);

          if (group.length > 1) episodeStats.groupsWithDuplicates += 1;

          // Unmonitor in Sonarr once per logical episode key (best-effort)
          if (
            features.unmonitorInArr &&
            sonarrBaseUrl &&
            sonarrApiKey &&
            showTitle &&
            typeof season === 'number' &&
            typeof epNum === 'number'
          ) {
            const series = findSonarrSeriesFromCache({ title: showTitle });
            if (!series) {
              episodeStats.sonarrNotFound += 1;
            } else {
              try {
                const epMap = await getSonarrEpisodeMap(series.id);
                const sonarrEp = epMap.get(episodeKey(season, epNum)) ?? null;
                if (!sonarrEp) {
                  episodeStats.sonarrNotFound += 1;
                } else if (!sonarrEp.monitored) {
                  // already unmonitored
                } else if (ctx.dryRun) {
                  episodeStats.sonarrWouldUnmonitor += 1;
                } else {
                  const ok = await this.sonarr
                    .setEpisodeMonitored({
                      baseUrl: sonarrBaseUrl,
                      apiKey: sonarrApiKey,
                      episode: sonarrEp,
                      monitored: false,
                    })
                    .then(() => true)
                    .catch(() => false);
                  if (ok) episodeStats.sonarrUnmonitored += 1;
                  if (ok) {
                    const s = String(showTitle ?? '').trim() || 'Unknown show';
                    pushItem(
                      episodeStats.sonarrUnmonitoredItems,
                      `${s} S${String(season).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`,
                      200,
                      () => (episodeStats.itemsTruncated = true),
                    );
                  } else {
                    await ctx.warn('sonarr: failed to unmonitor episode (duplicate group)', {
                      title: showTitle,
                      season,
                      episode: epNum,
                      sonarrSeriesId: toInt((series as unknown as Record<string, unknown>)['id']),
                      sonarrEpisodeId: toInt((sonarrEp as unknown as Record<string, unknown>)['id']),
                    });
                  }
                }
              } catch (err) {
                episodeStats.failures += 1;
                await ctx.warn(
                  'sonarr: failed unmonitoring episode (continuing)',
                  {
                    title: showTitle,
                    season,
                    episode: epNum,
                    error: (err as Error)?.message ?? String(err),
                  },
                );
              }
            }
          }

          // Delete extra metadata items (duplicates across ratingKeys), if any.
          for (const rk of deleteKeys) {
            if (ctx.dryRun) {
              episodeStats.metadataWouldDelete += 1;
              continue;
            }
            try {
              await this.plexServer.deleteMetadataByRatingKey({
                baseUrl: plexBaseUrl,
                token: plexToken,
                ratingKey: rk,
              });
              episodeStats.metadataDeleted += 1;
              const s = String(showTitle ?? '').trim() || 'Unknown show';
              pushItem(
                episodeStats.deletedMetadataItems,
                `${s} S${String(season).padStart(2, '0')}E${String(epNum).padStart(2, '0')} [ratingKey=${rk}]`,
                200,
                () => (episodeStats.itemsTruncated = true),
              );
            } catch (err) {
              episodeStats.failures += 1;
              await ctx.warn(
                'plex: failed deleting duplicate episode metadata (continuing)',
                {
                  ratingKey: rk,
                  error: (err as Error)?.message ?? String(err),
                },
              );
            }
          }

          // Cleanup extra versions within kept episode (if any).
          try {
            const dup = await this.plexDuplicates.cleanupEpisodeDuplicates({
              baseUrl: plexBaseUrl,
              token: plexToken,
              ratingKey: keep.ratingKey,
              dryRun: ctx.dryRun,
            });
            episodeStats.partsDeleted += dup.deleted;
            episodeStats.partsWouldDelete += dup.wouldDelete;
            const relevantDeletes = (dup.deletions ?? []).filter((d) =>
              ctx.dryRun ? Boolean(d) : d.deleted === true,
            );
            for (const d of relevantDeletes) {
              const mid = d.mediaId ? `mediaId=${d.mediaId}` : 'mediaId=?';
              pushItem(
                episodeStats.deletedVersionItems,
                `${dup.title} [ratingKey=${dup.ratingKey}] ${mid}`,
                200,
                () => (episodeStats.itemsTruncated = true),
              );
            }

            // Verification: if Plex still reports multiple Media entries, we likely lacked deletable part keys.
            try {
              const post = await this.plexServer.getMetadataDetails({
                baseUrl: plexBaseUrl,
                token: plexToken,
                ratingKey: keep.ratingKey,
              });
              const mediaCount = post?.media?.length ?? 0;
              if (mediaCount > 1) {
                sweepWarnings.push(
                  `plex: episode still has multiple media versions after cleanup ratingKey=${keep.ratingKey} media=${mediaCount}`,
                );
                await ctx.warn('plex: episode still has multiple media versions after cleanup', {
                  ratingKey: keep.ratingKey,
                  showTitle,
                  season,
                  episode: epNum,
                  mediaCount,
                });
              }
            } catch {
              // ignore verification failures
            }

          } catch (err) {
            episodeStats.failures += 1;
            await ctx.warn(
              'plex: failed cleaning episode versions (continuing)',
              {
                ratingKey: keep.ratingKey,
                error: (err as Error)?.message ?? String(err),
              },
            );
          }
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        sweepWarnings.push(`plex: episode scan failed: ${msg}`);
        await ctx.warn('plex: episode scan failed (continuing)', {
          error: msg,
        });
      }

      // --- Cross-library episode duplicates (same TVDB series present in multiple Plex libraries)
      try {
        if (plexTvSections.length > 0) {
          await ctx.info('plex: scanning cross-library episode duplicates', {
            tvLibraries: plexTvSections.map((s) => s.title),
          });

          const plexTvdbRatingKeys = new Map<number, string[]>();
          for (const sec of plexTvSections) {
            try {
              const map = await this.plexServer.getTvdbShowMapForSectionKey({
                baseUrl: plexBaseUrl,
                token: plexToken,
                librarySectionKey: sec.key,
                sectionTitle: sec.title,
              });
              for (const [tvdbId, rk] of map.entries()) {
                const prev = plexTvdbRatingKeys.get(tvdbId) ?? [];
                if (!prev.includes(rk)) prev.push(rk);
                plexTvdbRatingKeys.set(tvdbId, prev);
              }
            } catch (err) {
              await ctx.warn(
                'plex: failed building TVDB map for section (continuing)',
                {
                  section: sec.title,
                  error: (err as Error)?.message ?? String(err),
                },
              );
            }
          }
          plexTvdbRatingKeysForSweep = plexTvdbRatingKeys;

          const dupSeries = Array.from(plexTvdbRatingKeys.entries()).filter(
            ([, rks]) => rks.length > 1,
          );

          for (const [tvdbId, showRatingKeys] of dupSeries) {
            // Group episodes by season/episode across all show ratingKeys.
            const episodeToRatingKeys = new Map<string, string[]>();
            for (const showRk of showRatingKeys) {
              const eps = await this.plexServer.listEpisodesForShow({
                baseUrl: plexBaseUrl,
                token: plexToken,
                showRatingKey: showRk,
              });
              for (const ep of eps) {
                const s = ep.seasonNumber;
                const e = ep.episodeNumber;
                if (!s || !e) continue;
                const key = episodeKey(s, e);
                const list = episodeToRatingKeys.get(key) ?? [];
                if (!list.includes(ep.ratingKey)) list.push(ep.ratingKey);
                episodeToRatingKeys.set(key, list);
              }
            }

            const series = sonarrByTvdb.get(tvdbId) ?? null;
            const epMap = series ? await getSonarrEpisodeMap(series.id) : null;

            for (const [key, rks] of episodeToRatingKeys.entries()) {
              if (rks.length < 2) continue;

              // Pick best ratingKey by resolution + size.
              const metas: Array<{
                ratingKey: string;
                bestResolution: number;
                bestSize: number | null;
              }> = [];
              for (const rk of rks) {
                try {
                  const meta = await this.plexServer.getMetadataDetails({
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    ratingKey: rk,
                  });
                  if (!meta) continue;
                  let bestRes = 1;
                  let bestSize: number | null = null;
                  for (const m of meta.media ?? []) {
                    bestRes = Math.max(
                      bestRes,
                      resolutionPriority(m.videoResolution),
                    );
                    for (const p of m.parts ?? []) {
                      if (
                        typeof p.size === 'number' &&
                        Number.isFinite(p.size)
                      ) {
                        bestSize =
                          bestSize === null
                            ? p.size
                            : Math.max(bestSize, p.size);
                      }
                    }
                  }
                  metas.push({
                    ratingKey: rk,
                    bestResolution: bestRes,
                    bestSize,
                  });
                } catch {
                  // ignore
                }
              }
              const sorted = metas.slice().sort((a, b) => {
                if (a.bestResolution !== b.bestResolution)
                  return b.bestResolution - a.bestResolution;
                const sa = a.bestSize ?? 0;
                const sb = b.bestSize ?? 0;
                return sb - sa;
              });
              const keep = sorted[0];
              if (!keep) continue;

              const deleteKeys = rks.filter((rk) => rk !== keep.ratingKey);

              // Unmonitor in Sonarr (exact episode) if possible
              if (features.unmonitorInArr && epMap) {
                const sonarrEp = epMap.get(key) ?? null;
                if (sonarrEp && sonarrEp.monitored) {
                  if (ctx.dryRun) {
                    episodeStats.sonarrWouldUnmonitor += 1;
                  } else {
                    const ok = await this.sonarr
                      .setEpisodeMonitored({
                        baseUrl: sonarrBaseUrl as string,
                        apiKey: sonarrApiKey as string,
                        episode: sonarrEp,
                        monitored: false,
                      })
                      .then(() => true)
                      .catch(() => false);
                    if (ok) episodeStats.sonarrUnmonitored += 1;
                  }
                }
              }

              // Delete extra metadata items (duplicates across libraries)
              for (const rk of deleteKeys) {
                if (ctx.dryRun) {
                  episodeStats.metadataWouldDelete += 1;
                  continue;
                }
                try {
                  await this.plexServer.deleteMetadataByRatingKey({
                    baseUrl: plexBaseUrl,
                    token: plexToken,
                    ratingKey: rk,
                  });
                  episodeStats.metadataDeleted += 1;
                } catch (err) {
                  episodeStats.failures += 1;
                  await ctx.warn(
                    'plex: failed deleting duplicate episode metadata (continuing)',
                    {
                      ratingKey: rk,
                      error: (err as Error)?.message ?? String(err),
                    },
                  );
                }
              }

              // Cleanup extra versions within kept episode (if any)
              try {
                const dup = await this.plexDuplicates.cleanupEpisodeDuplicates({
                  baseUrl: plexBaseUrl,
                  token: plexToken,
                  ratingKey: keep.ratingKey,
                  dryRun: ctx.dryRun,
                });
                episodeStats.partsDeleted += dup.deleted;
                episodeStats.partsWouldDelete += dup.wouldDelete;
                const relevantDeletes = (dup.deletions ?? []).filter((d) =>
                  ctx.dryRun ? Boolean(d) : d.deleted === true,
                );
                for (const d of relevantDeletes) {
                  const mid = d.mediaId ? `mediaId=${d.mediaId}` : 'mediaId=?';
                  pushItem(
                    episodeStats.deletedVersionItems,
                    `${dup.title} [ratingKey=${dup.ratingKey}] ${mid}`,
                    200,
                    () => (episodeStats.itemsTruncated = true),
                  );
                }
              } catch (err) {
                episodeStats.failures += 1;
                await ctx.warn(
                  'plex: failed cleaning episode versions (continuing)',
                  {
                    ratingKey: keep.ratingKey,
                    error: (err as Error)?.message ?? String(err),
                  },
                );
              }
            }
          }
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        sweepWarnings.push(`plex: cross-library episode scan failed: ${msg}`);
        await ctx.warn('plex: cross-library episode scan failed (continuing)', {
          error: msg,
        });
      }
      } else {
        await ctx.info(
          'mediaAddedCleanup: duplicate cleanup feature disabled; skipping duplicate sweeps',
          { trigger: ctx.trigger, dryRun: ctx.dryRun },
        );
      }

      // --- Watchlist reconciliation (best-effort)
      const watchlistWarnings: string[] = [];
      const watchlistStats = {
        mode: (features.removeFromWatchlist ? 'reconcile' : 'disabled') as
          | 'reconcile'
          | 'disabled',
        movies: {
          total: 0,
          inPlex: 0,
          removed: 0,
          wouldRemove: 0,
          failures: 0,
          radarrUnmonitored: 0,
          radarrWouldUnmonitor: 0,
          radarrNotFound: 0,
          removedItems: [] as string[],
          radarrUnmonitoredItems: [] as string[],
          itemsTruncated: false,
        },
        shows: {
          total: 0,
          completeInPlex: 0,
          removed: 0,
          wouldRemove: 0,
          failures: 0,
          skippedNotInPlex: 0,
          skippedNotComplete: 0,
          skippedNoSonarr: 0,
          sonarrUnmonitored: 0,
          sonarrWouldUnmonitor: 0,
          removedItems: [] as string[],
          sonarrUnmonitoredItems: [] as string[],
          itemsTruncated: false,
        },
        warnings: watchlistWarnings,
      };

      if (features.removeFromWatchlist) {
        const plexMovieYearsByNormTitle = new Map<string, Set<number | null>>();
        const addMovieToYearIndex = (
          movieTitle: string | null | undefined,
          movieYear: number | null | undefined,
        ) => {
          const t = movieTitle?.trim();
          if (!t) return;
          const norm = normTitle(t);
          if (!norm) return;
          const set =
            plexMovieYearsByNormTitle.get(norm) ?? new Set<number | null>();
          set.add(movieYear ?? null);
          plexMovieYearsByNormTitle.set(norm, set);
        };

        // Reuse movie index already gathered by duplicate sweep when available.
        for (const m of movies) {
          addMovieToYearIndex(m.title, m.year ?? null);
        }

        // Watchlist-only runs still need a Plex movie index.
        if (plexMovieYearsByNormTitle.size === 0) {
          for (const sec of plexMovieSections) {
            try {
              const items = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
                baseUrl: plexBaseUrl,
                token: plexToken,
                librarySectionKey: sec.key,
                sectionTitle: sec.title,
              });
              for (const it of items) {
                addMovieToYearIndex(it.title, it.year ?? null);
              }
            } catch (err) {
              const msg = (err as Error)?.message ?? String(err);
              watchlistWarnings.push(
                `plex: failed indexing movies for watchlist reconciliation section=${sec.title} (continuing): ${msg}`,
              );
              await ctx.warn(
                'plex: failed indexing movies for watchlist reconciliation (continuing)',
                {
                  section: sec.title,
                  error: msg,
                },
              );
            }
          }
        }

        await setProgress(
          6,
          'watchlist',
          'Reconciling Plex watchlist (and unmonitoring in Radarr/Sonarr)…',
        );

        // Movies: remove from watchlist if now in Plex; unmonitor in Radarr (best-effort)
        try {
        const wlMovies = await this.plexWatchlist.listWatchlist({
          token: plexToken,
          kind: 'movie',
        });
        watchlistStats.movies.total = wlMovies.items.length;

        for (const it of wlMovies.items) {
          const norm = normTitle(it.title);
          const years = plexMovieYearsByNormTitle.get(norm) ?? null;
          const inPlex = (() => {
            if (!years) return false;
            if (typeof it.year === 'number' && Number.isFinite(it.year)) {
              return years.has(it.year);
            }
            return true;
          })();
          if (!inPlex) continue;
          watchlistStats.movies.inPlex += 1;

          // Remove from Plex watchlist
          if (ctx.dryRun) {
            watchlistStats.movies.wouldRemove += 1;
          } else {
            const ok = await this.plexWatchlist
              .removeFromWatchlistByRatingKey({
                token: plexToken,
                ratingKey: it.ratingKey,
              })
              .catch(() => false);
            if (ok) watchlistStats.movies.removed += 1;
            else watchlistStats.movies.failures += 1;
            if (ok) {
              pushItem(
                watchlistStats.movies.removedItems,
                `${it.title}${it.year ? ` (${it.year})` : ''} [ratingKey=${it.ratingKey}]`,
                200,
                () => (watchlistStats.movies.itemsTruncated = true),
              );
            }
          }

          // Unmonitor in Radarr (best-effort)
          if (features.unmonitorInArr && radarrBaseUrl && radarrApiKey) {
            const candidate =
              radarrByNormTitle.get(normTitle(it.title)) ?? null;
            if (!candidate) {
              watchlistStats.movies.radarrNotFound += 1;
            } else if (!candidate.monitored) {
              // already unmonitored
            } else if (ctx.dryRun) {
              watchlistStats.movies.radarrWouldUnmonitor += 1;
            } else {
              const ok = await this.radarr
                .setMovieMonitored({
                  baseUrl: radarrBaseUrl,
                  apiKey: radarrApiKey,
                  movie: candidate,
                  monitored: false,
                })
                .catch(() => false);
              if (ok) watchlistStats.movies.radarrUnmonitored += 1;
              if (ok) {
                pushItem(
                  watchlistStats.movies.radarrUnmonitoredItems,
                  `${it.title}${it.year ? ` (${it.year})` : ''}`,
                  200,
                  () => (watchlistStats.movies.itemsTruncated = true),
                );
              }
            }
          }
        }
        } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        watchlistWarnings.push(
          `plex: failed loading movie watchlist (continuing): ${msg}`,
        );
        await ctx.warn('plex: failed loading movie watchlist (continuing)', {
          error: msg,
        });
      }

        // Shows: only remove from watchlist if Plex has ALL episodes (per Sonarr), then unmonitor in Sonarr.
        if (!sonarrBaseUrl || !sonarrApiKey) {
        watchlistWarnings.push(
          'sonarr: not configured; skipping show watchlist reconciliation',
        );
        } else {
          try {
          const wlShows = await this.plexWatchlist.listWatchlist({
            token: plexToken,
            kind: 'show',
          });
          watchlistStats.shows.total = wlShows.items.length;

          // Build (or reuse) Plex TVDB->ratingKeys map across all TV libraries
          const plexTvdbRatingKeys =
            plexTvdbRatingKeysForSweep ?? new Map<number, string[]>();
          if (!plexTvdbRatingKeysForSweep) {
            for (const sec of plexTvSections) {
              try {
                const map = await this.plexServer.getTvdbShowMapForSectionKey({
                  baseUrl: plexBaseUrl,
                  token: plexToken,
                  librarySectionKey: sec.key,
                  sectionTitle: sec.title,
                });
                for (const [tvdbId, rk] of map.entries()) {
                  const prev = plexTvdbRatingKeys.get(tvdbId) ?? [];
                  if (!prev.includes(rk)) prev.push(rk);
                  plexTvdbRatingKeys.set(tvdbId, prev);
                }
              } catch (err) {
                const msg = (err as Error)?.message ?? String(err);
                watchlistWarnings.push(
                  `plex: failed building TVDB map for section=${sec.title} (continuing): ${msg}`,
                );
                await ctx.warn(
                  'plex: failed building TVDB map for section (continuing)',
                  {
                    section: sec.title,
                    error: msg,
                  },
                );
              }
            }
            plexTvdbRatingKeysForSweep = plexTvdbRatingKeys;
          }

          const plexEpisodesCache = new Map<string, Set<string>>();

          for (const it of wlShows.items) {
            const title = it.title.trim();
            if (!title) continue;

            const series = findSonarrSeriesFromCache({ title });
            if (!series) {
              watchlistStats.shows.skippedNoSonarr += 1;
              continue;
            }

            const tvdbId = toInt(series.tvdbId) ?? null;
            if (!tvdbId) {
              watchlistStats.shows.skippedNoSonarr += 1;
              continue;
            }

            const ratingKeys = plexTvdbRatingKeys.get(tvdbId) ?? [];
            if (ratingKeys.length === 0) {
              watchlistStats.shows.skippedNotInPlex += 1;
              continue;
            }

            // Union Plex episodes across all matching shows/libraries.
            const plexEpisodes = new Set<string>();
            for (const rk of ratingKeys) {
              const cached = plexEpisodesCache.get(rk);
              const eps =
                cached ??
                (await this.plexServer.getEpisodesSet({
                  baseUrl: plexBaseUrl,
                  token: plexToken,
                  showRatingKey: rk,
                }));
              if (!cached) plexEpisodesCache.set(rk, eps);
              for (const k of eps) plexEpisodes.add(k);
            }

            // Desired episodes from Sonarr (ignore specials season 0)
            const epMap = await getSonarrEpisodeMap(series.id);
            const desired = Array.from(epMap.keys()).filter((k) => {
              const [sRaw] = k.split(':', 1);
              const s = Number.parseInt(sRaw, 10);
              return Number.isFinite(s) && s > 0;
            });
            const missing = desired.filter((k) => !plexEpisodes.has(k));
            if (missing.length > 0) {
              watchlistStats.shows.skippedNotComplete += 1;
              continue;
            }

            watchlistStats.shows.completeInPlex += 1;

            // Remove from Plex watchlist
            if (ctx.dryRun) {
              watchlistStats.shows.wouldRemove += 1;
            } else {
              const ok = await this.plexWatchlist
                .removeFromWatchlistByRatingKey({
                  token: plexToken,
                  ratingKey: it.ratingKey,
                })
                .catch(() => false);
              if (ok) watchlistStats.shows.removed += 1;
              else watchlistStats.shows.failures += 1;
              if (ok) {
                pushItem(
                  watchlistStats.shows.removedItems,
                  `${it.title}${it.year ? ` (${it.year})` : ''} [ratingKey=${it.ratingKey}]`,
                  200,
                  () => (watchlistStats.shows.itemsTruncated = true),
                );
              }
            }

            // Unmonitor in Sonarr (best-effort)
            if (!features.unmonitorInArr) {
              // ARR monitoring mutation disabled for this task.
            } else if (!series.monitored) {
              // already unmonitored
            } else if (ctx.dryRun) {
              watchlistStats.shows.sonarrWouldUnmonitor += 1;
            } else {
              try {
                await this.sonarr.updateSeries({
                  baseUrl: sonarrBaseUrl,
                  apiKey: sonarrApiKey,
                  series: { ...series, monitored: false },
                });
                watchlistStats.shows.sonarrUnmonitored += 1;
                pushItem(
                  watchlistStats.shows.sonarrUnmonitoredItems,
                  `${it.title}${it.year ? ` (${it.year})` : ''}`,
                  200,
                  () => (watchlistStats.shows.itemsTruncated = true),
                );
              } catch {
                // ignore update error; count as warning for visibility
                watchlistWarnings.push(
                  `sonarr: failed to unmonitor series title=${title}`,
                );
              }
            }
          }
          } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          watchlistWarnings.push(
            `plex: failed loading show watchlist (continuing): ${msg}`,
          );
          await ctx.warn('plex: failed loading show watchlist (continuing)', {
            error: msg,
          });
          }
        }
      } else {
        await ctx.info(
          'mediaAddedCleanup: watchlist cleanup feature disabled; skipping watchlist reconciliation',
          { trigger: ctx.trigger, dryRun: ctx.dryRun },
        );
      }

      // Manual-run (Run now): if a monitored Sonarr show has a season that is fully present in Plex,
      // unmonitor that season (do NOT unmonitor the entire show).
      //
      // Note: This intentionally runs only for manual runs; auto runs are tied to a specific "added"
      // payload and should stay narrow.
      let sonarrSeasonsUnmonitored = 0;
      let sonarrSeasonsWouldUnmonitor = 0;
      const seasonSyncWarnings: string[] = [];
      if (
        features.unmonitorInArr &&
        ctx.trigger === 'manual' &&
        sonarrBaseUrl &&
        sonarrApiKey
      ) {
        try {
          // Build (or reuse) Plex TVDB->ratingKeys map across all TV libraries
          const plexTvdbRatingKeys =
            plexTvdbRatingKeysForSweep ?? new Map<number, string[]>();
          if (!plexTvdbRatingKeysForSweep) {
            for (const sec of plexTvSections) {
              try {
                const map = await this.plexServer.getTvdbShowMapForSectionKey({
                  baseUrl: plexBaseUrl,
                  token: plexToken,
                  librarySectionKey: sec.key,
                  sectionTitle: sec.title,
                });
                for (const [tvdbId, rk] of map.entries()) {
                  const prev = plexTvdbRatingKeys.get(tvdbId) ?? [];
                  if (!prev.includes(rk)) prev.push(rk);
                  plexTvdbRatingKeys.set(tvdbId, prev);
                }
              } catch (err) {
                const msg = (err as Error)?.message ?? String(err);
                seasonSyncWarnings.push(
                  `plex: failed building TVDB map for section=${sec.title} (season sync continuing): ${msg}`,
                );
                await ctx.warn(
                  'plex: failed building TVDB map for section (season sync continuing)',
                  { section: sec.title, error: msg },
                );
              }
            }
            plexTvdbRatingKeysForSweep = plexTvdbRatingKeys;
          }

          const plexEpisodesCache = new Map<string, Set<string>>();
          const getPlexEpisodesSet = async (rk: string): Promise<Set<string>> => {
            const key = rk.trim();
            if (!key) return new Set<string>();
            const cached = plexEpisodesCache.get(key);
            if (cached) return cached;
            const eps = await this.plexServer.getEpisodesSet({
              baseUrl: plexBaseUrl,
              token: plexToken,
              showRatingKey: key,
            });
            plexEpisodesCache.set(key, eps);
            return eps;
          };
          const getUnionEpisodesAcrossShows = async (ratingKeys: string[]) => {
            const set = new Set<string>();
            for (const rk of ratingKeys) {
              try {
                const eps = await getPlexEpisodesSet(rk);
                for (const k of eps) set.add(k);
              } catch (err) {
                const msg = (err as Error)?.message ?? String(err);
                seasonSyncWarnings.push(
                  `plex: failed loading episodes for showRatingKey=${rk} (season sync continuing): ${msg}`,
                );
              }
            }
            return set;
          };

          for (const series of sonarrSeriesList) {
            if (!series.monitored) continue;
            const tvdbId = toInt(series.tvdbId) ?? null;
            if (!tvdbId) continue;
            const showRatingKeys = plexTvdbRatingKeys.get(tvdbId) ?? [];
            if (showRatingKeys.length === 0) continue;

            const seasons = Array.isArray(series.seasons) ? series.seasons : [];
            const monitoredSeasonNums = seasons
              .map((s) => ({
                n: toInt(s.seasonNumber),
                monitored: typeof s.monitored === 'boolean' ? s.monitored : null,
              }))
              .filter((x) => typeof x.n === 'number' && x.n > 0 && x.monitored === true)
              .map((x) => x.n as number);
            if (monitoredSeasonNums.length === 0) continue;

            const epMap = await getSonarrEpisodeMap(series.id);
            const desiredBySeason = new Map<number, string[]>();
            for (const k of epMap.keys()) {
              const [sRaw] = k.split(':', 1);
              const sNum = Number.parseInt(sRaw, 10);
              if (!Number.isFinite(sNum) || sNum <= 0) continue;
              const list = desiredBySeason.get(sNum) ?? [];
              list.push(k);
              desiredBySeason.set(sNum, list);
            }

            const plexEpisodes = await getUnionEpisodesAcrossShows(showRatingKeys);
            const seasonsToUnmonitor: number[] = [];
            for (const seasonNum of monitoredSeasonNums) {
              const desired = desiredBySeason.get(seasonNum) ?? [];
              if (desired.length === 0) continue;
              const missing = desired.filter((k) => !plexEpisodes.has(k));
              if (missing.length === 0) seasonsToUnmonitor.push(seasonNum);
            }
            if (seasonsToUnmonitor.length === 0) continue;

            if (ctx.dryRun) {
              sonarrSeasonsWouldUnmonitor += seasonsToUnmonitor.length;
              continue;
            }

            try {
              const nextSeasons = seasons.map((s) => {
                const n = toInt(s.seasonNumber);
                if (!n || n <= 0) return s;
                if (!seasonsToUnmonitor.includes(n)) return s;
                if (typeof s.monitored !== 'boolean' || s.monitored !== true) return s;
                return { ...s, monitored: false };
              });

              await this.sonarr.updateSeries({
                baseUrl: sonarrBaseUrl,
                apiKey: sonarrApiKey,
                series: { ...series, seasons: nextSeasons },
              });
              sonarrSeasonsUnmonitored += seasonsToUnmonitor.length;
            } catch (err) {
              const msg = (err as Error)?.message ?? String(err);
              seasonSyncWarnings.push(
                `sonarr: failed unmonitoring seasons for seriesId=${series.id} (continuing): ${msg}`,
              );
              await ctx.warn(
                'sonarr: failed unmonitoring seasons (continuing)',
                { seriesId: series.id, tvdbId, seasons: seasonsToUnmonitor, error: msg },
              );
            }
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          seasonSyncWarnings.push(`sonarr: season sync failed (continuing): ${msg}`);
          await ctx.warn('sonarr: season sync failed (continuing)', { error: msg });
        }
      }

      // Populate high-level ARR stats for the report UI (full sweep mode doesn't have a single mediaType).
      // These counts may include both "duplicates" + "watchlist" unmonitor actions.
      const sweepRadarrUnmonitored = ctx.dryRun
        ? movieStats.radarrWouldUnmonitor + watchlistStats.movies.radarrWouldUnmonitor
        : movieStats.radarrUnmonitored + watchlistStats.movies.radarrUnmonitored;
      const sweepSonarrEpisodeUnmonitored = ctx.dryRun
        ? episodeStats.sonarrWouldUnmonitor
        : episodeStats.sonarrUnmonitored;

      summary.radarr = {
        ...(summary.radarr as unknown as Record<string, unknown>),
        connected: fullSweepRadarrConnected,
        moviesUnmonitored: ctx.dryRun ? 0 : sweepRadarrUnmonitored,
        moviesWouldUnmonitor: ctx.dryRun ? sweepRadarrUnmonitored : 0,
      } as unknown as JsonObject;
      summary.sonarr = {
        ...(summary.sonarr as unknown as Record<string, unknown>),
        connected: fullSweepSonarrConnected,
        episodesUnmonitored: ctx.dryRun ? 0 : sweepSonarrEpisodeUnmonitored,
        episodesWouldUnmonitor: ctx.dryRun ? sweepSonarrEpisodeUnmonitored : 0,
        seasonsUnmonitored: ctx.dryRun ? 0 : sonarrSeasonsUnmonitored,
        seasonsWouldUnmonitor: ctx.dryRun ? sonarrSeasonsWouldUnmonitor : 0,
      } as unknown as JsonObject;

      (summary.warnings as string[]).push(...seasonSyncWarnings);

      summary.watchlist = watchlistStats as unknown as JsonObject;

      summary.duplicates = features.deleteDuplicates
        ? ({
            mode: 'fullSweep',
            movie: movieStats,
            episode: episodeStats,
            warnings: sweepWarnings,
          } as unknown as JsonObject)
        : ({
            mode: 'disabled',
            reason: 'feature_disabled',
          } as unknown as JsonObject);

      (summary.warnings as string[]).push(
        ...sweepWarnings,
        ...watchlistWarnings,
      );
      await ctx.info('mediaAddedCleanup(duplicatesSweep): done', summary);
      return toReport(summary);
    }

    // --- Helpers for Sonarr matching
    const findSonarrSeries = async (params: {
      tvdbId?: number | null;
      title: string;
    }): Promise<SonarrSeries | null> => {
      if (!sonarrBaseUrl || !sonarrApiKey) return null;
      const all = await this.sonarr.listSeries({
        baseUrl: sonarrBaseUrl,
        apiKey: sonarrApiKey,
      });

      if (params.tvdbId) {
        const byTvdb = all.find((s) => toInt(s.tvdbId) === params.tvdbId);
        if (byTvdb) return byTvdb;
      }

      const q = params.title.trim();
      if (!q) return null;

      const exact = all.find(
        (s) =>
          typeof s.title === 'string' &&
          s.title.toLowerCase() === q.toLowerCase(),
      );
      if (exact) return exact;

      // Fuzzy fallback (similar spirit to Python difflib cutoff ~0.7)
      let best: { s: SonarrSeries; score: number } | null = null;
      for (const s of all) {
        const t = typeof s.title === 'string' ? s.title : '';
        if (!t) continue;
        const score = diceCoefficient(q, t);
        if (!best || score > best.score) best = { s, score };
      }
      if (best && best.score >= 0.7) return best.s;
      return null;
    };

    // --- Helpers for Plex multi-library lookups
    let plexTvdbRatingKeysCache: Map<number, string[]> | null = null;
    const plexEpisodesByShowRatingKey = new Map<string, Set<string>>();

    const getPlexTvdbRatingKeys = async (): Promise<Map<number, string[]>> => {
      if (plexTvdbRatingKeysCache) return plexTvdbRatingKeysCache;
      const out = new Map<number, string[]>();

      for (const sec of plexTvSections) {
        try {
          const map = await this.plexServer.getTvdbShowMapForSectionKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: sec.key,
            sectionTitle: sec.title,
          });
          for (const [tvdbId, rk] of map.entries()) {
            const prev = out.get(tvdbId) ?? [];
            if (!prev.includes(rk)) prev.push(rk);
            out.set(tvdbId, prev);
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          (summary.warnings as string[]).push(
            `plex: failed building TVDB map for section=${sec.title} (continuing): ${msg}`,
          );
          await ctx.warn(
            'plex: failed building TVDB map for section (continuing)',
            {
              section: sec.title,
              error: msg,
            },
          );
        }
      }

      plexTvdbRatingKeysCache = out;
      return out;
    };

    const getPlexEpisodesSetCached = async (
      rk: string,
    ): Promise<Set<string>> => {
      const key = rk.trim();
      if (!key) return new Set<string>();
      const cached = plexEpisodesByShowRatingKey.get(key);
      if (cached) return cached;
      const eps = await this.plexServer.getEpisodesSet({
        baseUrl: plexBaseUrl,
        token: plexToken,
        showRatingKey: key,
      });
      plexEpisodesByShowRatingKey.set(key, eps);
      return eps;
    };

    const getUnionEpisodesAcrossShows = async (ratingKeys: string[]) => {
      const set = new Set<string>();
      for (const rk of ratingKeys) {
        const eps = await getPlexEpisodesSetCached(rk);
        for (const k of eps) set.add(k);
      }
      return set;
    };

    const resolvePlexLibrarySectionForRatingKey = async (
      rk: string | null,
    ): Promise<{ key: string | null; title: string | null }> => {
      const ratingKey = (rk ?? '').trim();
      if (!ratingKey) return { key: null, title: null };
      try {
        const meta = await this.plexServer.getMetadataDetails({
          baseUrl: plexBaseUrl,
          token: plexToken,
          ratingKey,
        });
        return {
          key: meta?.librarySectionId ?? null,
          title: meta?.librarySectionTitle ?? null,
        };
      } catch (err) {
        await ctx.warn(
          'plex: failed resolving library section for ratingKey (continuing)',
          {
            ratingKey,
            error: (err as Error)?.message ?? String(err),
          },
        );
        return { key: null, title: null };
      }
    };

    const runMovieLibraryDuplicateSweep = async (params: {
      librarySectionKey: string;
      librarySectionTitle: string | null;
    }): Promise<JsonObject> => {
      const { librarySectionKey, librarySectionTitle } = params;

      const warnings: string[] = [];
      const movieStats = {
        scanned: 0,
        groups: 0,
        groupsWithDuplicates: 0,
        metadataDeleted: 0,
        metadataWouldDelete: 0,
        partsDeleted: 0,
        partsWouldDelete: 0,
        failures: 0,
      };

      const deletedMovieRatingKeys = new Set<string>();
      const cleanedMovieRatingKeys = new Set<string>();

      // Prefer terms that should never be deleted (e.g. "remux", "bluray") if configured.
      const preserveTerms = preserveQualityTerms
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const metaHasPreservedCopy = (meta: {
        media: Array<{
          videoResolution: string | null;
          parts: Array<{ file: string | null }>;
        }>;
      }) => {
        if (!preserveTerms.length) return false;
        for (const m of meta.media ?? []) {
          for (const p of m.parts ?? []) {
            const target = `${m.videoResolution ?? ''} ${p.file ?? ''}`.toLowerCase();
            if (preserveTerms.some((t) => target.includes(t))) return true;
          }
        }
        return false;
      };

      // 1) Multi-metadata duplicates within this library (group by TMDB id when available).
      try {
        const movies = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
          baseUrl: plexBaseUrl,
          token: plexToken,
          librarySectionKey,
          sectionTitle: librarySectionTitle ?? undefined,
          // Use Plex's duplicate filter to keep this scan lightweight.
          duplicateOnly: true,
        });

        movieStats.scanned = movies.length;

        const groups = new Map<
          number,
          Array<{ ratingKey: string; title: string; addedAt: number | null }>
        >();
        for (const m of movies) {
          if (!m.tmdbId) continue;
          const list = groups.get(m.tmdbId) ?? [];
          list.push({
            ratingKey: m.ratingKey,
            title: m.title,
            addedAt: m.addedAt,
          });
          groups.set(m.tmdbId, list);
        }
        movieStats.groups = groups.size;

        for (const [tmdbId, items] of groups.entries()) {
          if (items.length < 2) continue;
          movieStats.groupsWithDuplicates += 1;

          const metas: Array<{
            ratingKey: string;
            title: string;
            addedAt: number | null;
            preserved: boolean;
            bestResolution: number;
            bestSize: number | null;
          }> = [];

          for (const it of items) {
            try {
              const meta = await this.plexServer.getMetadataDetails({
                baseUrl: plexBaseUrl,
                token: plexToken,
                ratingKey: it.ratingKey,
              });
              if (!meta) continue;

              let bestRes = 1;
              let bestSize: number | null = null;
              for (const m of meta.media ?? []) {
                bestRes = Math.max(bestRes, resolutionPriority(m.videoResolution));
                for (const p of m.parts ?? []) {
                  if (typeof p.size === 'number' && Number.isFinite(p.size)) {
                    bestSize = bestSize === null ? p.size : Math.max(bestSize, p.size);
                  }
                }
              }

              metas.push({
                ratingKey: meta.ratingKey,
                title: meta.title || it.title,
                addedAt: meta.addedAt ?? it.addedAt ?? null,
                preserved: metaHasPreservedCopy(meta),
                bestResolution: bestRes,
                bestSize,
              });
            } catch (err) {
              movieStats.failures += 1;
              await ctx.warn('plex: failed loading movie metadata (continuing)', {
                ratingKey: it.ratingKey,
                tmdbId,
                error: (err as Error)?.message ?? String(err),
              });
            }
          }

          if (metas.length < 2) continue;

          const pref = deletePreference;
          const pool = metas.some((m) => m.preserved) ? metas.filter((m) => m.preserved) : metas;
          const sorted = pool.slice().sort((a, b) => {
            if (pref === 'newest' || pref === 'oldest') {
              const aa = a.addedAt ?? 0;
              const bb = b.addedAt ?? 0;
              // delete newest => keep oldest; delete oldest => keep newest
              if (aa !== bb) return pref === 'newest' ? aa - bb : bb - aa;
            } else if (pref === 'largest_file' || pref === 'smallest_file') {
              const sa =
                a.bestSize ??
                (pref === 'smallest_file' ? Number.POSITIVE_INFINITY : 0);
              const sb =
                b.bestSize ??
                (pref === 'smallest_file' ? Number.POSITIVE_INFINITY : 0);
              // delete smallest => keep largest; delete largest => keep smallest
              if (sa !== sb) return pref === 'smallest_file' ? sb - sa : sa - sb;
            }

            // Tie-breaker: higher resolution, then larger size.
            if (a.bestResolution !== b.bestResolution) {
              return b.bestResolution - a.bestResolution;
            }
            const sa2 = a.bestSize ?? 0;
            const sb2 = b.bestSize ?? 0;
            return sb2 - sa2;
          });

          const keep = sorted[0] ?? null;
          if (!keep) continue;

          const deleteKeys = metas.map((m) => m.ratingKey).filter((rk) => rk !== keep.ratingKey);

          // Delete extra metadata items (duplicates across ratingKeys)
          for (const rk of deleteKeys) {
            if (ctx.dryRun) {
              movieStats.metadataWouldDelete += 1;
              deletedMovieRatingKeys.add(rk);
              continue;
            }
            try {
              await this.plexServer.deleteMetadataByRatingKey({
                baseUrl: plexBaseUrl,
                token: plexToken,
                ratingKey: rk,
              });
              movieStats.metadataDeleted += 1;
              deletedMovieRatingKeys.add(rk);
            } catch (err) {
              movieStats.failures += 1;
              await ctx.warn('plex: failed deleting duplicate movie metadata (continuing)', {
                ratingKey: rk,
                tmdbId,
                error: (err as Error)?.message ?? String(err),
              });
            }
          }

          // Cleanup extra versions within the kept item (if any)
          try {
            const dup = await this.plexDuplicates.cleanupMovieDuplicates({
              baseUrl: plexBaseUrl,
              token: plexToken,
              ratingKey: keep.ratingKey,
              dryRun: ctx.dryRun,
              deletePreference,
              preserveQualityTerms,
            });
            movieStats.partsDeleted += dup.deleted;
            movieStats.partsWouldDelete += dup.wouldDelete;
            cleanedMovieRatingKeys.add(keep.ratingKey);
          } catch (err) {
            movieStats.failures += 1;
            warnings.push(
              `plex: failed cleaning movie versions ratingKey=${keep.ratingKey} (continuing): ${(err as Error)?.message ?? String(err)}`,
            );
          }
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        movieStats.failures += 1;
        warnings.push(
          `plex: failed listing duplicate movies for section=${librarySectionTitle ?? librarySectionKey} (continuing): ${msg}`,
        );
      }

      // 2) Single-item internal duplicates (versions) in this library.
      try {
        const dupKeys = await this.plexServer.listDuplicateMovieRatingKeysForSectionKey({
          baseUrl: plexBaseUrl,
          token: plexToken,
          librarySectionKey,
        });

        for (const { ratingKey: rk } of dupKeys) {
          if (!rk) continue;
          if (deletedMovieRatingKeys.has(rk)) continue;
          if (cleanedMovieRatingKeys.has(rk)) continue;
          try {
            const dup = await this.plexDuplicates.cleanupMovieDuplicates({
              baseUrl: plexBaseUrl,
              token: plexToken,
              ratingKey: rk,
              dryRun: ctx.dryRun,
              deletePreference,
              preserveQualityTerms,
            });
            movieStats.partsDeleted += dup.deleted;
            movieStats.partsWouldDelete += dup.wouldDelete;
            cleanedMovieRatingKeys.add(rk);
          } catch (err) {
            movieStats.failures += 1;
            warnings.push(
              `plex: failed cleaning movie versions ratingKey=${rk} (continuing): ${(err as Error)?.message ?? String(err)}`,
            );
          }
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        movieStats.failures += 1;
        warnings.push(
          `plex: failed listing duplicate movie keys for section=${librarySectionTitle ?? librarySectionKey} (continuing): ${msg}`,
        );
      }

      return {
        mode: 'librarySweep',
        librarySectionId: librarySectionKey,
        librarySectionTitle,
        movie: movieStats,
        warnings,
      } as unknown as JsonObject;
    };

    const runTvLibraryEpisodeDuplicateSweep = async (params: {
      librarySectionKey: string;
      librarySectionTitle: string | null;
    }): Promise<JsonObject> => {
      const { librarySectionKey, librarySectionTitle } = params;

      const warnings: string[] = [];
      const episodeStats = {
        candidates: 0,
        groupsWithDuplicates: 0,
        metadataDeleted: 0,
        metadataWouldDelete: 0,
        partsDeleted: 0,
        partsWouldDelete: 0,
        failures: 0,
      };

      type EpisodeCandidate = {
        ratingKey: string;
        showTitle: string | null;
        showRatingKey: string | null;
        season: number | null;
        episode: number | null;
        bestResolution: number;
        bestSize: number | null;
      };

      const candidates: EpisodeCandidate[] = [];

      let dupEpisodeKeys: Array<{ ratingKey: string; title: string }> = [];
      try {
        dupEpisodeKeys = await this.plexServer.listDuplicateEpisodeRatingKeysForSectionKey({
          baseUrl: plexBaseUrl,
          token: plexToken,
          librarySectionKey,
        });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        episodeStats.failures += 1;
        warnings.push(
          `plex: duplicate episode listing failed section=${librarySectionTitle ?? librarySectionKey} (continuing): ${msg}`,
        );
        return {
          mode: 'librarySweep',
          librarySectionId: librarySectionKey,
          librarySectionTitle,
          episode: episodeStats,
          warnings,
        } as unknown as JsonObject;
      }

      episodeStats.candidates = dupEpisodeKeys.length;

      for (const { ratingKey: rk } of dupEpisodeKeys) {
        try {
          const meta = await this.plexServer.getMetadataDetails({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey: rk,
          });
          if (!meta) continue;

          const showTitle = meta.grandparentTitle ?? null;
          const showRatingKey = meta.grandparentRatingKey ?? null;
          const season = meta.parentIndex ?? null;
          const epNum = meta.index ?? null;

          let bestRes = 1;
          let bestSize: number | null = null;
          for (const m of meta.media ?? []) {
            bestRes = Math.max(bestRes, resolutionPriority(m.videoResolution));
            for (const p of m.parts ?? []) {
              if (typeof p.size === 'number' && Number.isFinite(p.size)) {
                bestSize = bestSize === null ? p.size : Math.max(bestSize, p.size);
              }
            }
          }

          candidates.push({
            ratingKey: meta.ratingKey,
            showTitle,
            showRatingKey,
            season,
            episode: epNum,
            bestResolution: bestRes,
            bestSize,
          });
        } catch (err) {
          episodeStats.failures += 1;
          await ctx.warn('plex: failed loading episode metadata (continuing)', {
            ratingKey: rk,
            error: (err as Error)?.message ?? String(err),
          });
        }
      }

      const byKey = new Map<string, EpisodeCandidate[]>();
      for (const c of candidates) {
        const showKey = (() => {
          const rk = (c.showRatingKey ?? '').trim();
          if (rk) return `showRk:${rk}`;
          const title = typeof c.showTitle === 'string' ? c.showTitle.trim() : '';
          return title ? `show:${normTitle(title)}` : null;
        })();
        const season = typeof c.season === 'number' && Number.isFinite(c.season) ? c.season : null;
        const ep = typeof c.episode === 'number' && Number.isFinite(c.episode) ? c.episode : null;
        const key = showKey && season !== null && ep !== null ? `${showKey}:${season}:${ep}` : `rk:${c.ratingKey}`;
        const list = byKey.get(key) ?? [];
        list.push(c);
        byKey.set(key, list);
      }

      for (const [, group] of byKey.entries()) {
        if (group.length === 0) continue;
        const sorted = group.slice().sort((a, b) => {
          if (a.bestResolution !== b.bestResolution) return b.bestResolution - a.bestResolution;
          const sa = a.bestSize ?? 0;
          const sb = b.bestSize ?? 0;
          return sb - sa;
        });
        const keep = sorted[0];
        if (!keep) continue;
        const deleteKeys = group.map((g) => g.ratingKey).filter((rk) => rk !== keep.ratingKey);

        if (group.length > 1) episodeStats.groupsWithDuplicates += 1;

        for (const rk of deleteKeys) {
          if (ctx.dryRun) {
            episodeStats.metadataWouldDelete += 1;
            continue;
          }
          try {
            await this.plexServer.deleteMetadataByRatingKey({
              baseUrl: plexBaseUrl,
              token: plexToken,
              ratingKey: rk,
            });
            episodeStats.metadataDeleted += 1;
          } catch (err) {
            episodeStats.failures += 1;
            await ctx.warn('plex: failed deleting duplicate episode metadata (continuing)', {
              ratingKey: rk,
              error: (err as Error)?.message ?? String(err),
            });
          }
        }

        try {
          const dup = await this.plexDuplicates.cleanupEpisodeDuplicates({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey: keep.ratingKey,
            dryRun: ctx.dryRun,
          });
          episodeStats.partsDeleted += dup.deleted;
          episodeStats.partsWouldDelete += dup.wouldDelete;
        } catch (err) {
          episodeStats.failures += 1;
          warnings.push(
            `plex: failed cleaning episode versions ratingKey=${keep.ratingKey} (continuing): ${(err as Error)?.message ?? String(err)}`,
          );
        }
      }

      return {
        mode: 'librarySweep',
        librarySectionId: librarySectionKey,
        librarySectionTitle,
        episode: episodeStats,
        warnings,
      } as unknown as JsonObject;
    };

    // --- Movie flow
    if (mediaType === 'movie') {
      if (!title && !ratingKey) {
        await ctx.warn(
          'mediaAddedCleanup(movie): missing title and ratingKey (skipping)',
        );
        summary.skipped = true;
        return toReport(summary);
      }

      // 1) Duplicate cleanup (only within the Plex movie library where this item was added)
      let movieRatingKey = ratingKey;
      let movieSectionKeyHint: string | null = null;
      let movieSectionTitleHint: string | null = null;
      if (!movieRatingKey && title) {
        for (const sec of plexMovieSections) {
          const found = await this.plexServer
            .findMovieRatingKeyByTitle({
              baseUrl: plexBaseUrl,
              token: plexToken,
              librarySectionKey: sec.key,
              title,
            })
            .catch(() => null);
          if (found?.ratingKey) {
            movieRatingKey = found.ratingKey;
            movieSectionKeyHint = sec.key;
            movieSectionTitleHint = sec.title;
            break;
          }
        }
      }

      let tmdbId: number | null = tmdbIdInput ?? null;
      let resolvedTitle = title;
      let resolvedYear = year;
      let movieLibrarySectionKey: string | null = movieSectionKeyHint;
      let movieLibrarySectionTitle: string | null = movieSectionTitleHint;

      if (movieRatingKey) {
        try {
          const meta = await this.plexServer.getMetadataDetails({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey: movieRatingKey,
          });
          tmdbId = tmdbId ?? meta?.tmdbIds?.[0] ?? null;
          resolvedTitle = meta?.title?.trim() || resolvedTitle;
          resolvedYear = meta?.year ?? resolvedYear;
          movieLibrarySectionKey =
            meta?.librarySectionId ?? movieLibrarySectionKey;
          movieLibrarySectionTitle =
            meta?.librarySectionTitle ?? movieLibrarySectionTitle;
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          (summary.warnings as string[]).push(
            `plex: failed to read movie metadata (continuing): ${msg}`,
          );
          await ctx.warn('plex: failed to read movie metadata (continuing)', {
            ratingKey: movieRatingKey,
            error: msg,
          });
        }
      }

      // Duplicate cleanup: scan the entire Plex movie library section where this item was added,
      // and clean up ALL duplicates in that library (not just the added title).
      if (features.deleteDuplicates) {
        if (movieLibrarySectionKey) {
          summary.duplicates = await runMovieLibraryDuplicateSweep({
            librarySectionKey: movieLibrarySectionKey,
            librarySectionTitle: movieLibrarySectionTitle,
          });
        } else {
          (summary.warnings as string[]).push(
            'plex: could not resolve movie library section; skipping duplicate sweep',
          );
          summary.duplicates = null;
        }
      } else {
        summary.duplicates = {
          mode: 'disabled',
          reason: 'feature_disabled',
        } as unknown as JsonObject;
        await ctx.info(
          'mediaAddedCleanup(movie): duplicate cleanup feature disabled',
        );
      }
      // Keep summary fields consistent for downstream steps (Radarr/watchlist)
      summary.title = resolvedTitle;
      summary.year = resolvedYear;

      // 2) Unmonitor in Radarr (best-effort)
      const radarrSummary: JsonObject = {
        configured: Boolean(radarrBaseUrl && radarrApiKey),
        connected: null as boolean | null,
        movieFound: null as boolean | null,
        movieId: null as number | null,
        monitoredBefore: null as boolean | null,
        unmonitored: false,
        wouldUnmonitor: false,
        moviesUnmonitored: 0,
        moviesWouldUnmonitor: 0,
        error: null as string | null,
      };
      if (!features.unmonitorInArr) {
        radarrSummary.connected = null;
        await ctx.info('radarr: unmonitor feature disabled (skipping)', {});
      } else if (radarrBaseUrl && radarrApiKey) {
        try {
          const movieTitle = resolvedTitle || title;
          await ctx.info('radarr: attempting unmonitor for movie', {
            title: movieTitle,
          });
          const movies = await this.radarr.listMovies({
            baseUrl: radarrBaseUrl,
            apiKey: radarrApiKey,
          });
          radarrSummary.connected = true;

          const tmdbIdForRadarr = tmdbId;

          const normalizedWanted = normTitle(movieTitle);
          const findByTitle = (m: RadarrMovie) => {
            const t = typeof m.title === 'string' ? m.title : '';
            return t && normTitle(t) === normalizedWanted;
          };

          const candidate =
            (tmdbIdForRadarr
              ? movies.find((m) => toInt(m.tmdbId) === tmdbIdForRadarr)
              : null) ??
            movies.find(findByTitle) ??
            null;

          if (!candidate) {
            radarrSummary.movieFound = false;
            await ctx.warn('radarr: movie not found (skipping unmonitor)', {
              title: movieTitle,
              tmdbId: tmdbIdForRadarr ?? null,
            });
          } else if (!candidate.monitored) {
            radarrSummary.movieFound = true;
            radarrSummary.movieId = typeof candidate.id === 'number' ? candidate.id : null;
            radarrSummary.monitoredBefore = false;
            await ctx.info('radarr: already unmonitored', {
              title:
                typeof candidate.title === 'string'
                  ? candidate.title
                  : movieTitle,
              id: candidate.id,
            });
          } else if (ctx.dryRun) {
            radarrSummary.movieFound = true;
            radarrSummary.movieId = typeof candidate.id === 'number' ? candidate.id : null;
            radarrSummary.monitoredBefore = true;
            radarrSummary.wouldUnmonitor = true;
            radarrSummary.moviesWouldUnmonitor = 1;
            await ctx.info('radarr: dry-run would unmonitor', {
              title:
                typeof candidate.title === 'string'
                  ? candidate.title
                  : movieTitle,
              id: candidate.id,
            });
          } else {
            const ok = await this.radarr.setMovieMonitored({
              baseUrl: radarrBaseUrl,
              apiKey: radarrApiKey,
              movie: candidate,
              monitored: false,
            });
            radarrSummary.movieFound = true;
            radarrSummary.movieId = typeof candidate.id === 'number' ? candidate.id : null;
            radarrSummary.monitoredBefore = true;
            radarrSummary.unmonitored = Boolean(ok);
            radarrSummary.moviesUnmonitored = ok ? 1 : 0;
            await ctx.info('radarr: unmonitor result', {
              ok,
              title:
                typeof candidate.title === 'string'
                  ? candidate.title
                  : movieTitle,
              id: candidate.id,
              tmdbId: candidate.tmdbId ?? tmdbIdForRadarr ?? null,
            });
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          radarrSummary.connected = false;
          radarrSummary.error = msg;
          (summary.warnings as string[]).push(
            `radarr: failed (continuing): ${msg}`,
          );
          await ctx.warn('radarr: failed (continuing)', { error: msg });
        }
      } else {
        radarrSummary.connected = null;
        await ctx.info('radarr: not configured (skipping)', {});
      }
      summary.radarr = radarrSummary as unknown as JsonObject;

      // 3) Remove from Plex watchlist (best-effort)
      {
        if (!features.removeFromWatchlist) {
          summary.watchlist = {
            mode: 'disabled',
            reason: 'feature_disabled',
          } as unknown as JsonObject;
          await ctx.info(
            'plex: watchlist cleanup feature disabled (skipping)',
          );
        } else {
          const movieTitle = resolvedTitle || title;
          const movieYear = resolvedYear ?? year;
          if (!movieTitle) {
            await ctx.info(
              'plex: missing movie title (skipping watchlist removal)',
            );
          } else {
            await ctx.info('plex: removing movie from watchlist (best-effort)', {
              title: movieTitle,
              year: movieYear,
              dryRun: ctx.dryRun,
            });
            try {
              const wl = await this.plexWatchlist.removeMovieFromWatchlistByTitle(
                {
                  token: plexToken,
                  title: movieTitle,
                  year: movieYear,
                  dryRun: ctx.dryRun,
                },
              );
              summary.watchlist = wl as unknown as JsonObject;
            } catch (err) {
              const msg = (err as Error)?.message ?? String(err);
              (summary.warnings as string[]).push(
                `plex: watchlist removal failed (non-critical): ${msg}`,
              );
              await ctx.warn('plex: watchlist removal failed (non-critical)', {
                error: msg,
              });
              summary.watchlist = {
                ok: false,
                error: msg,
              } as unknown as JsonObject;
            }
          }
        }
      }

      await ctx.info('mediaAddedCleanup(movie): done', summary);
      return toReport(summary);
    }

    // --- Show flow
    if (mediaType === 'show') {
      const seriesTitle = title;
      if (!seriesTitle && !ratingKey) {
        await ctx.warn(
          'mediaAddedCleanup(show): missing title and ratingKey (skipping)',
        );
        summary.skipped = true;
        return toReport(summary);
      }

      // Determine TVDB id if possible (best-effort)
      let tvdbId: number | null = tvdbIdInput ?? null;
      const plexShowKeyForMeta = ratingKey ?? showRatingKey ?? null;
      if (!tvdbId && plexShowKeyForMeta) {
        try {
          const meta = await this.plexServer.getMetadataDetails({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey: plexShowKeyForMeta,
          });
          tvdbId = meta?.tvdbIds?.[0] ?? null;
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          (summary.warnings as string[]).push(
            `plex: failed to read show tvdbId from metadata (continuing): ${msg}`,
          );
          await ctx.warn('plex: failed to read show tvdbId from metadata', {
            ratingKey: plexShowKeyForMeta,
            error: msg,
          });
        }
      }

      // Duplicate cleanup: scan the entire Plex TV library section where this item was added,
      // and clean up ALL duplicate episodes in that library (not just the show title).
      if (features.deleteDuplicates) {
        const sec = await resolvePlexLibrarySectionForRatingKey(
          ratingKey ?? showRatingKey ?? null,
        );
        if (sec.key) {
          summary.duplicates = await runTvLibraryEpisodeDuplicateSweep({
            librarySectionKey: sec.key,
            librarySectionTitle: sec.title,
          });
        } else {
          (summary.warnings as string[]).push(
            'plex: could not resolve TV library section; skipping duplicate sweep',
          );
          summary.duplicates = null;
        }
      } else {
        summary.duplicates = {
          mode: 'disabled',
          reason: 'feature_disabled',
        } as unknown as JsonObject;
        await ctx.info(
          'mediaAddedCleanup(show): duplicate cleanup feature disabled',
        );
      }

      const sonarrSummary: JsonObject = {
        configured: Boolean(sonarrBaseUrl && sonarrApiKey),
        connected: null as boolean | null,
        seriesFound: null as boolean | null,
        seriesId: null as number | null,
        monitoredBefore: null as boolean | null,
        seriesUnmonitored: false,
        wouldUnmonitor: false,
        error: null as string | null,
      };
      const showNeedsSonarr =
        features.unmonitorInArr || features.removeFromWatchlist;

      // Only remove show from watchlist if Plex has ALL episodes (per Sonarr).
      if (!showNeedsSonarr) {
        summary.sonarr = sonarrSummary as unknown as JsonObject;
        summary.watchlist = {
          mode: 'disabled',
          reason: 'feature_disabled',
        } as unknown as JsonObject;
        await ctx.info(
          'mediaAddedCleanup(show): unmonitor/watchlist features disabled; done',
        );
        return toReport(summary);
      }

      if (!sonarrBaseUrl || !sonarrApiKey || !seriesTitle) {
        await ctx.info(
          'sonarr: not configured or missing title (skipping show flow)',
          {},
        );
        summary.sonarr = sonarrSummary as unknown as JsonObject;
        summary.skipped = true;
        return toReport(summary);
      }

      let series: SonarrSeries | null = null;
      try {
        series = await findSonarrSeries({ tvdbId, title: seriesTitle });
        sonarrSummary.connected = true;
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        sonarrSummary.connected = false;
        sonarrSummary.error = msg;
        (summary.warnings as string[]).push(
          `sonarr: failed to load series list (skipping show flow): ${msg}`,
        );
        await ctx.warn('sonarr: failed to load series list (skipping show flow)', {
          error: msg,
        });
        summary.sonarr = sonarrSummary as unknown as JsonObject;
        summary.skipped = true;
        return toReport(summary);
      }

      if (!series) {
        sonarrSummary.seriesFound = false;
        summary.sonarr = sonarrSummary as unknown as JsonObject;
        await ctx.warn('sonarr: series not found (skipping show flow)', {
          title: seriesTitle,
          tvdbId,
        });
        summary.skipped = true;
        return toReport(summary);
      }

      sonarrSummary.seriesFound = true;
      sonarrSummary.seriesId = typeof series.id === 'number' ? series.id : null;

      const seriesTvdbId = toInt(series.tvdbId) ?? tvdbId ?? null;

      // Resolve Plex show ratingKeys across ALL TV libraries for this TVDB id (if present).
      // Fall back to the webhook/poller ratingKey when TVDB isn't available.
      let plexShowRatingKeys = seriesTvdbId
        ? ((await getPlexTvdbRatingKeys()).get(seriesTvdbId) ?? [])
        : [];
      if (plexShowRatingKeys.length === 0 && plexShowKeyForMeta) {
        plexShowRatingKeys = [plexShowKeyForMeta];
      }

      if (plexShowRatingKeys.length === 0) {
        summary.sonarr = sonarrSummary as unknown as JsonObject;
        await ctx.warn(
          'plex: show not found in any Plex TV library (skipping)',
          {
            title: seriesTitle,
            tvdbId: seriesTvdbId ?? tvdbId ?? null,
          },
        );
        summary.skipped = true;
        return toReport(summary);
      }

      // Union Plex episodes across all matching show ratingKeys.
      const plexEpisodes =
        await getUnionEpisodesAcrossShows(plexShowRatingKeys);

      const episodes = await this.sonarr.getEpisodesBySeries({
        baseUrl: sonarrBaseUrl,
        apiKey: sonarrApiKey,
        seriesId: series.id,
      });

      // Desired Sonarr behavior:
      // - If an episode exists in Plex -> unmonitor it in Sonarr
      // - If an episode is missing from Plex -> monitor it in Sonarr
      //
      // This keeps Sonarr tracking only the missing bits, and avoids "skipping" the whole job
      // just because the show isn't complete.
      const episodeRows = episodes
        .map((ep) => {
          const season = toInt(ep.seasonNumber);
          const epNum = toInt(ep.episodeNumber);
          if (!season || !epNum) return null; // ignore specials/unknown
          if (season <= 0 || epNum <= 0) return null;
          const key = episodeKey(season, epNum);
          return {
            ep,
            key,
            inPlex: plexEpisodes.has(key),
            monitored: Boolean(ep.monitored),
          };
        })
        .filter(Boolean) as Array<{
        ep: SonarrEpisode;
        key: string;
        inPlex: boolean;
        monitored: boolean;
      }>;

      const missingKeys = episodeRows.filter((r) => !r.inPlex).map((r) => r.key);
      const showCompleteInPlex = missingKeys.length === 0;

      const toUnmonitor = episodeRows.filter((r) => r.inPlex && r.monitored);
      const toMonitor = episodeRows.filter((r) => !r.inPlex && !r.monitored);

      await ctx.info('sonarr: syncing episode monitoring vs Plex availability', {
        title: seriesTitle,
        seriesId: series.id,
        tvdbId: seriesTvdbId ?? tvdbId ?? null,
        episodesTotal: episodeRows.length,
        episodesInPlex: episodeRows.length - missingKeys.length,
        episodesMissing: missingKeys.length,
        willUnmonitor: toUnmonitor.length,
        willMonitor: toMonitor.length,
        dryRun: ctx.dryRun,
      });

      let episodesUnmonitored = 0;
      let episodesMonitored = 0;
      let failures = 0;

      if (features.unmonitorInArr) {
        // Unmonitor episodes that are present in Plex.
        for (const r of toUnmonitor) {
          if (ctx.dryRun) {
            episodesUnmonitored += 1;
            continue;
          }
          const ok = await this.sonarr
            .setEpisodeMonitored({
              baseUrl: sonarrBaseUrl,
              apiKey: sonarrApiKey,
              episode: r.ep,
              monitored: false,
            })
            .then(() => true)
            .catch((err) => {
              failures += 1;
              const msg = (err as Error)?.message ?? String(err);
              (summary.warnings as string[]).push(
                `sonarr episode: failed to unmonitor ${r.key} (continuing): ${msg}`,
              );
              return false;
            });
          if (ok) episodesUnmonitored += 1;
        }

        // Monitor episodes that are missing from Plex.
        for (const r of toMonitor) {
          if (ctx.dryRun) {
            episodesMonitored += 1;
            continue;
          }
          const ok = await this.sonarr
            .setEpisodeMonitored({
              baseUrl: sonarrBaseUrl,
              apiKey: sonarrApiKey,
              episode: r.ep,
              monitored: true,
            })
            .then(() => true)
            .catch((err) => {
              failures += 1;
              const msg = (err as Error)?.message ?? String(err);
              (summary.warnings as string[]).push(
                `sonarr episode: failed to monitor ${r.key} (continuing): ${msg}`,
              );
              return false;
            });
          if (ok) episodesMonitored += 1;
        }
      } else {
        await ctx.info(
          'sonarr: unmonitor feature disabled; skipping episode monitoring sync',
        );
      }

      summary.sonarr = {
        ...sonarrSummary,
        connected: true,
        seriesFound: true,
        seriesId: series.id,
        tvdbId: seriesTvdbId ?? tvdbId ?? null,
        showCompleteInPlex,
        episodesInPlex: episodeRows.length - missingKeys.length,
        episodesMissing: missingKeys.length,
        episodesUnmonitored: ctx.dryRun ? 0 : episodesUnmonitored,
        episodesWouldUnmonitor: ctx.dryRun ? episodesUnmonitored : 0,
        episodesMonitored: ctx.dryRun ? 0 : episodesMonitored,
        episodesWouldMonitor: ctx.dryRun ? episodesMonitored : 0,
        failures,
      } as unknown as JsonObject;

      // Watchlist behavior:
      // - If show is complete in Plex -> remove from watchlist (respect ctx.dryRun)
      // - Otherwise -> check-only (dry-run) so the UI can still show "found / not found"
      if (!features.removeFromWatchlist) {
        summary.watchlist = {
          mode: 'disabled',
          reason: 'feature_disabled',
        } as unknown as JsonObject;
      } else if (seriesTitle) {
        const watchlistDryRun = showCompleteInPlex ? ctx.dryRun : true;
        await ctx.info(
          showCompleteInPlex
            ? 'plex: removing show from watchlist (show complete)'
            : 'plex: checking show watchlist (show incomplete; keeping)',
          { title: seriesTitle, dryRun: watchlistDryRun },
        );
        try {
          const wl = await this.plexWatchlist.removeShowFromWatchlistByTitle({
            token: plexToken,
            title: seriesTitle,
            dryRun: watchlistDryRun,
          });
          summary.watchlist = wl as unknown as JsonObject;
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          (summary.warnings as string[]).push(
            `plex: watchlist check/removal failed (non-critical): ${msg}`,
          );
          await ctx.warn('plex: watchlist check/removal failed (non-critical)', {
            error: msg,
          });
          summary.watchlist = { ok: false, error: msg } as unknown as JsonObject;
        }
      }

      await ctx.info('mediaAddedCleanup(show): done', summary);
      return toReport(summary);
    }

    // --- Season flow
    if (mediaType === 'season') {
      const parsed = parseSeasonTitleFallback(title);
      const seriesTitle = showTitle ?? parsed.seriesTitle ?? null;
      const seasonNum = seasonNumber ?? parsed.seasonNumber ?? null;

      // Duplicate cleanup: scan the entire Plex TV library section where this item was added,
      // and clean up ALL duplicate episodes in that library.
      if (features.deleteDuplicates) {
        const sec = await resolvePlexLibrarySectionForRatingKey(
          ratingKey ?? showRatingKey ?? null,
        );
        if (sec.key) {
          summary.duplicates = await runTvLibraryEpisodeDuplicateSweep({
            librarySectionKey: sec.key,
            librarySectionTitle: sec.title,
          });
        } else {
          (summary.warnings as string[]).push(
            'plex: could not resolve TV library section; skipping duplicate sweep',
          );
          summary.duplicates = null;
        }
      } else {
        summary.duplicates = {
          mode: 'disabled',
          reason: 'feature_disabled',
        } as unknown as JsonObject;
        await ctx.info(
          'mediaAddedCleanup(season): duplicate cleanup feature disabled',
        );
      }

      if (!seriesTitle || !seasonNum) {
        await ctx.warn(
          'mediaAddedCleanup(season): missing seriesTitle/seasonNumber (skipping)',
          {
            title,
            showTitle,
            seasonNumber,
          },
        );
        summary.skipped = true;
        return toReport(summary);
      }

      const seasonNeedsSonarr =
        features.unmonitorInArr || features.removeFromWatchlist;
      if (!seasonNeedsSonarr) {
        summary.sonarr = {
          configured: Boolean(sonarrBaseUrl && sonarrApiKey),
          connected: null,
        } as unknown as JsonObject;
        summary.watchlist = {
          mode: 'disabled',
          reason: 'feature_disabled',
        } as unknown as JsonObject;
        await ctx.info(
          'mediaAddedCleanup(season): unmonitor/watchlist features disabled; done',
        );
        return toReport(summary);
      }

      // Find series in Sonarr (required for safety check + unmonitor)
      if (!sonarrBaseUrl || !sonarrApiKey) {
        await ctx.warn('sonarr: not configured (skipping season flow)', {});
        summary.skipped = true;
        return toReport(summary);
      }

      try {
        const series = await findSonarrSeries({
          tvdbId: tvdbIdInput ?? null,
          title: seriesTitle,
        });
        if (!series) {
          await ctx.warn('sonarr: series not found (skipping season flow)', {
            title: seriesTitle,
            tvdbId: tvdbIdInput ?? null,
          });
          summary.skipped = true;
          return toReport(summary);
        }

        // Resolve Plex show ratingKeys across ALL TV libraries (required for safety checks)
        const seriesTvdbId = toInt(series.tvdbId) ?? tvdbIdInput ?? null;
        let plexShowRatingKeys = seriesTvdbId
          ? ((await getPlexTvdbRatingKeys()).get(seriesTvdbId) ?? [])
          : [];
        if (plexShowRatingKeys.length === 0 && showRatingKey) {
          plexShowRatingKeys = [showRatingKey];
        }

        if (plexShowRatingKeys.length === 0) {
          await ctx.warn(
            'plex: show not found (cannot verify season completeness across libraries; skipping)',
            {
              title: seriesTitle,
              season: seasonNum,
            },
          );
          summary.skipped = true;
          return toReport(summary);
        }

        // Union Plex episodes across all matching shows/libraries.
        const plexEpisodes =
          await getUnionEpisodesAcrossShows(plexShowRatingKeys);

        const episodes = await this.sonarr.getEpisodesBySeries({
          baseUrl: sonarrBaseUrl,
          apiKey: sonarrApiKey,
          seriesId: series.id,
        });

        const seasonEpisodes = episodes.filter(
          (ep) => toInt(ep.seasonNumber) === seasonNum,
        );
        const desiredSeason = new Set<string>();
        const desiredAll = new Set<string>();
        for (const ep of seasonEpisodes) {
          const epNum = toInt(ep.episodeNumber);
          if (!epNum) continue;
          desiredSeason.add(episodeKey(seasonNum, epNum));
        }
        for (const ep of episodes) {
          const s = toInt(ep.seasonNumber);
          const e = toInt(ep.episodeNumber);
          if (!s || !e) continue; // ignore specials
          desiredAll.add(episodeKey(s, e));
        }

        const missingSeason = Array.from(desiredSeason).filter(
          (k) => !plexEpisodes.has(k),
        );
        const seasonCompleteInPlex = missingSeason.length === 0;

        // Desired Sonarr behavior (season-scoped):
        // - If an episode exists in Plex -> unmonitor it in Sonarr
        // - If an episode is missing from Plex -> monitor it in Sonarr
        const seasonEpisodeRows = seasonEpisodes
          .map((ep) => {
            const epNum = toInt(ep.episodeNumber);
            if (!epNum || epNum <= 0) return null;
            const key = episodeKey(seasonNum, epNum);
            return {
              ep,
              key,
              inPlex: plexEpisodes.has(key),
              monitored: Boolean(ep.monitored),
            };
          })
          .filter(Boolean) as Array<{
          ep: SonarrEpisode;
          key: string;
          inPlex: boolean;
          monitored: boolean;
        }>;

        const toUnmonitor = seasonEpisodeRows.filter((r) => r.inPlex && r.monitored);
        const toMonitor = seasonEpisodeRows.filter((r) => !r.inPlex && !r.monitored);

        await ctx.info('sonarr: syncing season episode monitoring vs Plex availability', {
          title: seriesTitle,
          seriesId: series.id,
          season: seasonNum,
          seasonCompleteInPlex,
          seasonEpisodes: seasonEpisodeRows.length,
          seasonEpisodesInPlex: seasonEpisodeRows.length - missingSeason.length,
          seasonEpisodesMissing: missingSeason.length,
          willUnmonitor: toUnmonitor.length,
          willMonitor: toMonitor.length,
          dryRun: ctx.dryRun,
        });

        let episodesUnmonitored = 0;
        let episodesMonitored = 0;
        let failures = 0;

        if (features.unmonitorInArr) {
          for (const r of toUnmonitor) {
            if (ctx.dryRun) {
              episodesUnmonitored += 1;
              continue;
            }
            const ok = await this.sonarr
              .setEpisodeMonitored({
                baseUrl: sonarrBaseUrl,
                apiKey: sonarrApiKey,
                episode: r.ep,
                monitored: false,
              })
              .then(() => true)
              .catch((err) => {
                failures += 1;
                const msg = (err as Error)?.message ?? String(err);
                (summary.warnings as string[]).push(
                  `sonarr episode: failed to unmonitor ${r.key} (continuing): ${msg}`,
                );
                return false;
              });
            if (ok) episodesUnmonitored += 1;
          }

          for (const r of toMonitor) {
            if (ctx.dryRun) {
              episodesMonitored += 1;
              continue;
            }
            const ok = await this.sonarr
              .setEpisodeMonitored({
                baseUrl: sonarrBaseUrl,
                apiKey: sonarrApiKey,
                episode: r.ep,
                monitored: true,
              })
              .then(() => true)
              .catch((err) => {
                failures += 1;
                const msg = (err as Error)?.message ?? String(err);
                (summary.warnings as string[]).push(
                  `sonarr episode: failed to monitor ${r.key} (continuing): ${msg}`,
                );
                return false;
              });
            if (ok) episodesMonitored += 1;
          }
        } else {
          await ctx.info(
            'sonarr: unmonitor feature disabled; skipping season monitoring sync',
          );
        }

        // Optional: if the season is fully present in Plex, unmonitor the season itself via series update.
        const updatedSeries: SonarrSeries = { ...series };
        const seasons = Array.isArray(series.seasons)
          ? series.seasons.map((s) => ({ ...s }))
          : [];
        const seasonObj = seasons.find((s) => toInt(s.seasonNumber) === seasonNum);
        const seasonWasMonitored = Boolean(seasonObj?.monitored);
        if (seasonObj && seasonCompleteInPlex) seasonObj.monitored = false;
        updatedSeries.seasons = seasons;

        const seasonChanged = seasonCompleteInPlex && seasonWasMonitored;
        if (features.unmonitorInArr && !ctx.dryRun && seasonChanged) {
          await this.sonarr.updateSeries({
            baseUrl: sonarrBaseUrl,
            apiKey: sonarrApiKey,
            series: updatedSeries,
          });
        }

        summary.sonarr = {
          configured: true,
          connected: true,
          seriesFound: true,
          seriesId: series.id,
          season: seasonNum,
          seasonCompleteInPlex,
          episodesInPlex: seasonEpisodeRows.length - missingSeason.length,
          episodesMissing: missingSeason.length,
          episodesUnmonitored: ctx.dryRun ? 0 : episodesUnmonitored,
          episodesWouldUnmonitor: ctx.dryRun ? episodesUnmonitored : 0,
          episodesMonitored: ctx.dryRun ? 0 : episodesMonitored,
          episodesWouldMonitor: ctx.dryRun ? episodesMonitored : 0,
          seasonUnmonitored: !ctx.dryRun && seasonChanged ? true : false,
          seasonWouldUnmonitor: ctx.dryRun && seasonChanged ? true : false,
          failures,
        } as unknown as JsonObject;

        // Remove show from watchlist ONLY if Plex has ALL episodes for the series.
        if (!features.removeFromWatchlist) {
          summary.watchlist = {
            mode: 'disabled',
            reason: 'feature_disabled',
          } as unknown as JsonObject;
        } else {
          const missingAll = Array.from(desiredAll).filter(
            (k) => !plexEpisodes.has(k),
          );
          const seriesCompleteInPlex = missingAll.length === 0;
          const watchlistDryRun = seriesCompleteInPlex ? ctx.dryRun : true;
          await ctx.info(
            seriesCompleteInPlex
              ? 'plex: removing show from watchlist (series complete)'
              : 'plex: checking show watchlist (series incomplete; keeping)',
            {
              title: seriesTitle,
              missingCount: missingAll.length,
              sampleMissing: missingAll.slice(0, 25),
              dryRun: watchlistDryRun,
            },
          );
          try {
            const wl = await this.plexWatchlist.removeShowFromWatchlistByTitle({
              token: plexToken,
              title: seriesTitle,
              dryRun: watchlistDryRun,
            });
            summary.watchlist = wl as unknown as JsonObject;
          } catch (err) {
            const msg = (err as Error)?.message ?? String(err);
            (summary.warnings as string[]).push(
              `plex: watchlist check/removal failed (non-critical): ${msg}`,
            );
            await ctx.warn('plex: watchlist check/removal failed (non-critical)', {
              error: msg,
            });
            summary.watchlist = {
              ok: false,
              error: msg,
            } as unknown as JsonObject;
          }
        }

        await ctx.info('mediaAddedCleanup(season): done', summary);
        return toReport(summary);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        (summary.warnings as string[]).push(
          `season flow failed (continuing): ${msg}`,
        );
        await ctx.warn('mediaAddedCleanup(season): failed (continuing)', {
          error: msg,
        });
        summary.skipped = true;
        return toReport(summary);
      }
    }

    // --- Episode flow
    if (mediaType === 'episode') {
      const seriesTitle = showTitle;
      const seasonNum = seasonNumber;
      const epNum = episodeNumber;

      // Duplicate cleanup: scan the entire Plex TV library section where this item was added,
      // and clean up ALL duplicate episodes in that library (not just this episode).
      if (features.deleteDuplicates) {
        const sec = await resolvePlexLibrarySectionForRatingKey(
          ratingKey ?? showRatingKey ?? null,
        );
        if (sec.key) {
          summary.duplicates = await runTvLibraryEpisodeDuplicateSweep({
            librarySectionKey: sec.key,
            librarySectionTitle: sec.title,
          });
        } else {
          (summary.warnings as string[]).push(
            'plex: could not resolve TV library section; skipping duplicate sweep',
          );
          summary.duplicates = null;
        }
      } else {
        summary.duplicates = {
          mode: 'disabled',
          reason: 'feature_disabled',
        } as unknown as JsonObject;
        await ctx.info(
          'mediaAddedCleanup(episode): duplicate cleanup feature disabled',
        );
      }

      if (!seriesTitle || !seasonNum || !epNum) {
        await ctx.warn(
          'mediaAddedCleanup(episode): missing seriesTitle/season/episode (skipping)',
          {
            title,
            showTitle,
            seasonNumber,
            episodeNumber,
          },
        );
        summary.skipped = true;
        return toReport(summary);
      }

      const sonarrSummary: JsonObject = {
        configured: Boolean(sonarrBaseUrl && sonarrApiKey),
        connected: null as boolean | null,
        seriesFound: null as boolean | null,
        seriesId: null as number | null,
        episodeFound: null as boolean | null,
        season: seasonNum,
        episode: epNum,
        monitoredBefore: null as boolean | null,
        episodeUnmonitored: false,
        wouldUnmonitor: false,
        episodesUnmonitored: 0,
        episodesWouldUnmonitor: 0,
        error: null as string | null,
      };

      if (!features.unmonitorInArr) {
        sonarrSummary.connected = null;
        await ctx.info(
          'sonarr: unmonitor feature disabled (skipping episode flow)',
          {},
        );
      } else if (sonarrBaseUrl && sonarrApiKey) {
        try {
          const series = await findSonarrSeries({
            tvdbId: tvdbIdInput ?? null,
            title: seriesTitle,
          });
          if (!series) {
            sonarrSummary.connected = true;
            sonarrSummary.seriesFound = false;
            await ctx.warn(
              'sonarr: series not found (skipping episode unmonitor)',
              {
                title: seriesTitle,
                tvdbId: tvdbIdInput ?? null,
              },
            );
          } else {
            sonarrSummary.connected = true;
            sonarrSummary.seriesFound = true;
            sonarrSummary.seriesId = typeof series.id === 'number' ? series.id : null;
            const episodes = await this.sonarr.getEpisodesBySeries({
              baseUrl: sonarrBaseUrl,
              apiKey: sonarrApiKey,
              seriesId: series.id,
            });
            const episode = episodes.find(
              (ep) =>
                toInt(ep.seasonNumber) === seasonNum &&
                toInt(ep.episodeNumber) === epNum,
            );
            if (!episode) {
              sonarrSummary.episodeFound = false;
              await ctx.warn('sonarr: episode not found (skipping)', {
                title: seriesTitle,
                season: seasonNum,
                episode: epNum,
              });
            } else if (!episode.monitored) {
              sonarrSummary.episodeFound = true;
              sonarrSummary.monitoredBefore = false;
              await ctx.info('sonarr: episode already unmonitored', {
                title: seriesTitle,
                season: seasonNum,
                episode: epNum,
              });
            } else if (ctx.dryRun) {
              sonarrSummary.episodeFound = true;
              sonarrSummary.monitoredBefore = true;
              sonarrSummary.wouldUnmonitor = true;
              sonarrSummary.episodesWouldUnmonitor = 1;
              await ctx.info('sonarr: dry-run would unmonitor episode', {
                title: seriesTitle,
                season: seasonNum,
                episode: epNum,
              });
            } else {
              await this.sonarr.setEpisodeMonitored({
                baseUrl: sonarrBaseUrl,
                apiKey: sonarrApiKey,
                episode,
                monitored: false,
              });
              sonarrSummary.episodeFound = true;
              sonarrSummary.monitoredBefore = true;
              sonarrSummary.episodeUnmonitored = true;
              sonarrSummary.episodesUnmonitored = 1;
              await ctx.info('sonarr: episode unmonitored', {
                title: seriesTitle,
                season: seasonNum,
                episode: epNum,
              });
            }
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          sonarrSummary.connected = false;
          sonarrSummary.error = msg;
          (summary.warnings as string[]).push(
            `sonarr: episode unmonitor failed (continuing): ${msg}`,
          );
          await ctx.warn('sonarr: episode unmonitor failed (continuing)', {
            error: msg,
          });
        }
      } else {
        sonarrSummary.connected = null;
        await ctx.info(
          'sonarr: not configured (skipping episode unmonitor)',
          {},
        );
      }
      summary.sonarr = sonarrSummary as unknown as JsonObject;

      // Duplicate cleanup is handled via a library-wide sweep earlier in this flow (summary.duplicates).

      await ctx.info('mediaAddedCleanup(episode): done', summary);
      return toReport(summary);
    }

    await ctx.warn('mediaAddedCleanup: unsupported mediaType (skipping)', {
      mediaType,
    });
    summary.skipped = true;
    return toReport(summary);
  }
}

export function buildMediaAddedCleanupReport(params: {
  ctx: JobContext;
  raw: JsonObject;
}): JobReportV1 {
  const { ctx, raw } = params;

  const rawRec = raw as Record<string, unknown>;

  const issues: JobReportV1['issues'] = [];
  const warningsRaw = Array.isArray(rawRec.warnings)
    ? rawRec.warnings
        .map((w) => String(w ?? '').trim())
        .filter(Boolean)
    : [];

  const mediaType = (pickString(rawRec, 'mediaType') ?? '').toLowerCase();
  const plexEvent = pickString(rawRec, 'plexEvent') ?? null;
  const title = pickString(rawRec, 'title') ?? '';
  const year = pickNumber(rawRec, 'year');
  const ratingKey = pickString(rawRec, 'ratingKey') ?? null;
  const showTitle = pickString(rawRec, 'showTitle') ?? null;
  const seasonNumber = pickNumber(rawRec, 'seasonNumber');
  const episodeNumber = pickNumber(rawRec, 'episodeNumber');
  const featuresRaw = isPlainObject(rawRec.features)
    ? (rawRec.features as Record<string, unknown>)
    : null;
  const features: MediaAddedCleanupFeatures = {
    deleteDuplicates:
      typeof featuresRaw?.deleteDuplicates === 'boolean'
        ? featuresRaw.deleteDuplicates
        : true,
    unmonitorInArr:
      typeof featuresRaw?.unmonitorInArr === 'boolean'
        ? featuresRaw.unmonitorInArr
        : true,
    removeFromWatchlist:
      typeof featuresRaw?.removeFromWatchlist === 'boolean'
        ? featuresRaw.removeFromWatchlist
        : true,
  };

  const duplicates = isPlainObject(rawRec.duplicates)
    ? (rawRec.duplicates as Record<string, unknown>)
    : null;
  const watchlist = isPlainObject(rawRec.watchlist)
    ? (rawRec.watchlist as Record<string, unknown>)
    : null;

  const radarr = isPlainObject(rawRec.radarr)
    ? (rawRec.radarr as Record<string, unknown>)
    : null;
  const sonarr = isPlainObject(rawRec.sonarr)
    ? (rawRec.sonarr as Record<string, unknown>)
    : null;

  const asBool = (v: unknown): boolean | null =>
    typeof v === 'boolean' ? v : null;

  for (const w of warningsRaw) {
    const lower = w.toLowerCase();
    if (lower.startsWith('radarr:')) continue;
    if (lower.startsWith('sonarr:')) continue;
    issues.push(issue('warn', w));
  }

  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const n = Number.parseInt(v.trim(), 10);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const versionDeletedCount = (vc: unknown) => {
    if (!isPlainObject(vc)) return 0;
    const rec = vc as Record<string, unknown>;
    const deleted = num(rec.deleted) ?? 0;
    const wouldDelete = num(rec.wouldDelete) ?? 0;
    return ctx.dryRun ? wouldDelete : deleted;
  };

  const versionCopiesCount = (vc: unknown): number | null => {
    if (!isPlainObject(vc)) return null;
    return num((vc as Record<string, unknown>).copies);
  };

  // Duplicates: compute per-type "copies deleted" (metadata deletions + part deletions).
  let movieDuplicatesDeleted = 0;
  let episodeDuplicatesDeleted = 0;
  let movieDuplicatesFound: boolean | null = null;
  let episodeDuplicatesFound: boolean | null = null;

  if (duplicates) {
    const mode = typeof duplicates.mode === 'string' ? duplicates.mode.trim() : '';

    // Full sweep mode (has nested movie/episode stats)
    if (isPlainObject(duplicates.movie) || isPlainObject(duplicates.episode)) {
      const m = isPlainObject(duplicates.movie)
        ? (duplicates.movie as Record<string, unknown>)
        : null;
      const e = isPlainObject(duplicates.episode)
        ? (duplicates.episode as Record<string, unknown>)
        : null;

      const mMeta = m
        ? (ctx.dryRun ? num(m.metadataWouldDelete) : num(m.metadataDeleted)) ?? 0
        : 0;
      const mParts = m
        ? (ctx.dryRun ? num(m.partsWouldDelete) : num(m.partsDeleted)) ?? 0
        : 0;
      movieDuplicatesDeleted = mMeta + mParts;
      movieDuplicatesFound = m
        ? movieDuplicatesDeleted > 0 || (num(m.groupsWithDuplicates) ?? 0) > 0
        : null;

      const eMeta = e
        ? (ctx.dryRun ? num(e.metadataWouldDelete) : num(e.metadataDeleted)) ?? 0
        : 0;
      const eParts = e
        ? (ctx.dryRun ? num(e.partsWouldDelete) : num(e.partsDeleted)) ?? 0
        : 0;
      episodeDuplicatesDeleted = eMeta + eParts;
      episodeDuplicatesFound = e
        ? episodeDuplicatesDeleted > 0 || (num(e.groupsWithDuplicates) ?? 0) > 0
        : null;
    } else if (mode.startsWith('movie')) {
      const metaDeleted = (ctx.dryRun
        ? num(duplicates.wouldDeleteMetadata)
        : num(duplicates.deletedMetadata)) ?? 0;
      const partsDeleted = versionDeletedCount(duplicates.versionCleanup);
      movieDuplicatesDeleted = metaDeleted + partsDeleted;

      const candidates = num(duplicates.candidates) ?? 0;
      const copies = versionCopiesCount(duplicates.versionCleanup);
      movieDuplicatesFound =
        movieDuplicatesDeleted > 0 || candidates > 1 || (copies !== null && copies > 1);
    } else if (mode.startsWith('episode')) {
      const metaDeleted = (ctx.dryRun
        ? num(duplicates.wouldDeleteMetadata)
        : num(duplicates.deletedMetadata)) ?? 0;
      const partsDeleted = versionDeletedCount(duplicates.versionCleanup);
      episodeDuplicatesDeleted = metaDeleted + partsDeleted;

      const candidates = num(duplicates.candidates) ?? 0;
      const copies = versionCopiesCount(duplicates.versionCleanup);
      episodeDuplicatesFound =
        episodeDuplicatesDeleted > 0 || candidates > 1 || (copies !== null && copies > 1);
    }

    // Keep ARR connectivity noise out of the top-level Issues list.
    if (Array.isArray(duplicates.warnings)) {
      const duplicateWarnings = duplicates.warnings
        .map((w) => String(w ?? '').trim())
        .filter(Boolean)
        .filter((w) => {
          const lower = w.toLowerCase();
          return !lower.startsWith('radarr:') && !lower.startsWith('sonarr:');
        });
      issues.push(...issuesFromWarnings(duplicateWarnings));
    }
  }

  // Watchlist summary:
  // - For reconciliation mode: includes both movies + shows
  // - For single-item mode: infer which bucket to attribute to based on mediaType
  let watchlistMovieRemoved = 0;
  let watchlistShowRemoved = 0;
  let watchlistChecked = false;
  let watchlistAttempted: number | null = null;
  let watchlistRemoved: number | null = null;
  let watchlistMatchedBy: string | null = null;
  let watchlistError: string | null = null;

  if (watchlist) {
    const mode = typeof watchlist.mode === 'string' ? watchlist.mode.trim() : null;
    if (mode === 'reconcile') {
      watchlistChecked = true;
      const wlMovies = isPlainObject(watchlist.movies)
        ? (watchlist.movies as Record<string, unknown>)
        : null;
      const wlShows = isPlainObject(watchlist.shows)
        ? (watchlist.shows as Record<string, unknown>)
        : null;
      watchlistMovieRemoved =
        wlMovies && (ctx.dryRun ? num(wlMovies.wouldRemove) : num(wlMovies.removed))
          ? ((ctx.dryRun ? num(wlMovies.wouldRemove) : num(wlMovies.removed)) ?? 0)
          : 0;
      watchlistShowRemoved =
        wlShows && (ctx.dryRun ? num(wlShows.wouldRemove) : num(wlShows.removed))
          ? ((ctx.dryRun ? num(wlShows.wouldRemove) : num(wlShows.removed)) ?? 0)
          : 0;
      // Note: warnings are already surfaced via rawRec.warnings (and filtered above) to avoid
      // duplicating/noising up the Issues list.
    } else {
      // Per-item watchlist removal result shape.
      if ('baseUrlTried' in watchlist || 'error' in watchlist) {
        watchlistChecked = true;
      }

      watchlistAttempted = num(watchlist.attempted);
      watchlistRemoved = num(watchlist.removed);
      watchlistMatchedBy =
        typeof watchlist.matchedBy === 'string' ? watchlist.matchedBy : null;
      watchlistError = typeof watchlist.error === 'string' ? watchlist.error : null;

      const removed = watchlistRemoved ?? 0;
      if (mediaType === 'movie') watchlistMovieRemoved = removed;
      else if (mediaType === 'show' || mediaType === 'season')
        watchlistShowRemoved = removed;
    }
  }

  // Unmonitor counts (summary wants only: Radarr(movie) + Sonarr(episode))
  const radarrMovieUnmonitored = (() => {
    if (!radarr) return 0;
    if (ctx.dryRun) {
      const n = num(radarr.moviesWouldUnmonitor);
      if (n !== null) return n;
      return asBool(radarr.wouldUnmonitor) ? 1 : 0;
    }
    const n = num(radarr.moviesUnmonitored);
    if (n !== null) return n;
    return asBool(radarr.unmonitored) ? 1 : 0;
  })();

  const sonarrEpisodeUnmonitored = (() => {
    if (!sonarr) return 0;
    if (ctx.dryRun) {
      const n = num(sonarr.episodesWouldUnmonitor);
      if (n !== null) return n;
      return asBool(sonarr.wouldUnmonitor) ? 1 : 0;
    }
    const n = num(sonarr.episodesUnmonitored);
    if (n !== null) return n;
    return asBool(sonarr.episodeUnmonitored) ? 1 : 0;
  })();

  const sonarrSeasonUnmonitored = (() => {
    if (!sonarr) return null;
    const n = ctx.dryRun
      ? num((sonarr as Record<string, unknown>).seasonsWouldUnmonitor)
      : num((sonarr as Record<string, unknown>).seasonsUnmonitored);
    return n;
  })();

  // Step-by-step tasks
  const pad2 = (n: number | null) =>
    typeof n === 'number' && Number.isFinite(n) ? String(n).padStart(2, '0') : '??';

  const addedLabel = (() => {
    if (mediaType === 'movie') {
      return `${title || 'Movie'}${year ? ` (${year})` : ''}`;
    }
    if (mediaType === 'episode') {
      const ep = `S${pad2(seasonNumber)}E${pad2(episodeNumber)}`;
      const show = showTitle || 'Show';
      return `${show} ${ep}${title ? ` — ${title}` : ''}`;
    }
    if (mediaType === 'season') {
      const show = showTitle || title || 'Show';
      return `${show} — Season ${seasonNumber ?? '??'}`;
    }
    if (mediaType === 'show') return title || 'Show';
    return title || mediaType || 'Unknown';
  })();

  const duplicatesApplicable =
    features.deleteDuplicates &&
    (mediaType === 'movie' ||
      mediaType === 'episode' ||
      mediaType === 'season' ||
      mediaType === 'show');
  const duplicatesFound =
    mediaType === 'movie'
      ? movieDuplicatesFound ?? movieDuplicatesDeleted > 0
      : mediaType === 'episode' || mediaType === 'season' || mediaType === 'show'
        ? episodeDuplicatesFound ?? episodeDuplicatesDeleted > 0
        : null;
  const duplicatesDeleted =
    mediaType === 'movie'
      ? movieDuplicatesDeleted
      : mediaType === 'episode' || mediaType === 'season' || mediaType === 'show'
        ? episodeDuplicatesDeleted
        : 0;

  const watchlistApplicable =
    features.removeFromWatchlist &&
    (mediaType === 'movie' || mediaType === 'show' || mediaType === 'season');
  const runSkipped = asBool(rawRec.skipped) === true;
  const watchlistSkippedByFlow =
    features.removeFromWatchlist && runSkipped && !watchlistChecked;

  const isFullSweep =
    duplicates && typeof (duplicates as Record<string, unknown>).mode === 'string'
      ? String((duplicates as Record<string, unknown>).mode).trim() === 'fullSweep'
      : false;

  const radarrApplicable =
    features.unmonitorInArr && (isFullSweep || mediaType === 'movie');
  const sonarrApplicable =
    features.unmonitorInArr &&
    (isFullSweep ||
      mediaType === 'episode' ||
      mediaType === 'show' ||
      mediaType === 'season');

  const buildArrMonitoringTask = (
    service: 'radarr' | 'sonarr',
    applicable: boolean,
  ) => {
    const rec = service === 'radarr' ? radarr : sonarr;
    const configured = rec ? asBool(rec.configured) : null;
    const connected = rec ? asBool(rec.connected) : null;
    const serviceName = service === 'radarr' ? 'Radarr' : 'Sonarr';

    const status =
      !applicable ||
      configured === false ||
      (configured === true && connected === false)
        ? ('skipped' as const)
        : ('success' as const);

    const result =
      !features.unmonitorInArr
        ? 'Disabled in task settings.'
        : !applicable
        ? 'Not applicable for this media type.'
        : configured === false
          ? 'Skipped: not configured.'
          : configured === true && connected === false
            ? 'Skipped: unavailable during this run.'
            : 'Processed.';

    const facts: Array<{ label: string; value: JsonValue }> = [
      { label: 'Configured', value: configured },
      { label: 'Connected', value: connected },
      { label: 'Result', value: result },
    ];

    if (service === 'radarr') {
      facts.push({
        label: ctx.dryRun ? 'Movies would unmonitor' : 'Movies unmonitored',
        value: radarrMovieUnmonitored,
      });
    } else {
      facts.push({
        label: ctx.dryRun ? 'Episodes would unmonitor' : 'Episodes unmonitored',
        value: sonarrEpisodeUnmonitored,
      });
      if (sonarrSeasonUnmonitored !== null) {
        facts.push({
          label: ctx.dryRun ? 'Seasons would unmonitor' : 'Seasons unmonitored',
          value: sonarrSeasonUnmonitored,
        });
      }
    }

    return {
      id: `arr_${service}`,
      title: `Updated ${serviceName} monitoring`,
      status,
      facts,
      issues: [],
    };
  };

  const tasks: JobReportV1['tasks'] = isFullSweep
    ? [
        {
          id: 'duplicates',
          title: 'Full sweep: cleaned Plex duplicates',
          status: features.deleteDuplicates ? 'success' : 'skipped',
          facts: features.deleteDuplicates
            ? [
                { label: ctx.dryRun ? 'Would delete (movie)' : 'Deleted (movie)', value: movieDuplicatesDeleted },
                { label: ctx.dryRun ? 'Would delete (episode)' : 'Deleted (episode)', value: episodeDuplicatesDeleted },
                ...(duplicates && isPlainObject(duplicates.movie)
              ? [
                  { label: 'Movie groups (dup)', value: num((duplicates.movie as Record<string, unknown>).groupsWithDuplicates) ?? 0 },
                  {
                    label: ctx.dryRun ? 'Radarr would unmonitor' : 'Radarr unmonitored',
                    value:
                      (ctx.dryRun
                        ? num((duplicates.movie as Record<string, unknown>).radarrWouldUnmonitor)
                        : num((duplicates.movie as Record<string, unknown>).radarrUnmonitored)) ?? 0,
                  },
                  ...(Array.isArray((duplicates.movie as Record<string, unknown>).deletedMetadataItems)
                    ? [
                        {
                          label: 'Deleted movie metadata (items)',
                          value: {
                            count: ctx.dryRun
                              ? num((duplicates.movie as Record<string, unknown>).metadataWouldDelete) ?? 0
                              : num((duplicates.movie as Record<string, unknown>).metadataDeleted) ?? 0,
                            unit: 'items',
                            items: (duplicates.movie as Record<string, unknown>).deletedMetadataItems as string[],
                          },
                        },
                      ]
                    : []),
                  ...(Array.isArray((duplicates.movie as Record<string, unknown>).deletedVersionItems)
                    ? [
                        {
                          label: 'Deleted movie versions (items)',
                          value: {
                            count: ctx.dryRun
                              ? num((duplicates.movie as Record<string, unknown>).partsWouldDelete) ?? 0
                              : num((duplicates.movie as Record<string, unknown>).partsDeleted) ?? 0,
                            unit: 'versions',
                            items: (duplicates.movie as Record<string, unknown>).deletedVersionItems as string[],
                          },
                        },
                      ]
                    : []),
                  ...(Array.isArray((duplicates.movie as Record<string, unknown>).radarrUnmonitoredItems)
                    ? [
                        {
                          label: ctx.dryRun ? 'Radarr would unmonitor (items)' : 'Radarr unmonitored (items)',
                          value: {
                            count: ctx.dryRun
                              ? num((duplicates.movie as Record<string, unknown>).radarrWouldUnmonitor) ?? 0
                              : num((duplicates.movie as Record<string, unknown>).radarrUnmonitored) ?? 0,
                            unit: 'movies',
                            items: (duplicates.movie as Record<string, unknown>).radarrUnmonitoredItems as string[],
                          },
                        },
                      ]
                    : []),
                ]
              : []),
                ...(duplicates && isPlainObject(duplicates.episode)
              ? [
                  { label: 'Episode groups (dup)', value: num((duplicates.episode as Record<string, unknown>).groupsWithDuplicates) ?? 0 },
                  {
                    label: ctx.dryRun ? 'Sonarr would unmonitor (ep)' : 'Sonarr unmonitored (ep)',
                    value:
                      (ctx.dryRun
                        ? num((duplicates.episode as Record<string, unknown>).sonarrWouldUnmonitor)
                        : num((duplicates.episode as Record<string, unknown>).sonarrUnmonitored)) ?? 0,
                  },
                  ...(Array.isArray((duplicates.episode as Record<string, unknown>).deletedMetadataItems)
                    ? [
                        {
                          label: 'Deleted episode metadata (items)',
                          value: {
                            count: ctx.dryRun
                              ? num((duplicates.episode as Record<string, unknown>).metadataWouldDelete) ?? 0
                              : num((duplicates.episode as Record<string, unknown>).metadataDeleted) ?? 0,
                            unit: 'items',
                            items: (duplicates.episode as Record<string, unknown>).deletedMetadataItems as string[],
                          },
                        },
                      ]
                    : []),
                  ...(Array.isArray((duplicates.episode as Record<string, unknown>).deletedVersionItems)
                    ? [
                        {
                          label: 'Deleted episode versions (items)',
                          value: {
                            count: ctx.dryRun
                              ? num((duplicates.episode as Record<string, unknown>).partsWouldDelete) ?? 0
                              : num((duplicates.episode as Record<string, unknown>).partsDeleted) ?? 0,
                            unit: 'versions',
                            items: (duplicates.episode as Record<string, unknown>).deletedVersionItems as string[],
                          },
                        },
                      ]
                    : []),
                  ...(Array.isArray((duplicates.episode as Record<string, unknown>).sonarrUnmonitoredItems)
                    ? [
                        {
                          label: ctx.dryRun
                            ? 'Sonarr would unmonitor (items)'
                            : 'Sonarr unmonitored (items)',
                          value: {
                            count: ctx.dryRun
                              ? num((duplicates.episode as Record<string, unknown>).sonarrWouldUnmonitor) ?? 0
                              : num((duplicates.episode as Record<string, unknown>).sonarrUnmonitored) ?? 0,
                            unit: 'episodes',
                            items: (duplicates.episode as Record<string, unknown>).sonarrUnmonitoredItems as string[],
                          },
                        },
                      ]
                    : []),
                ]
              : []),
              ]
            : [{ label: 'Result', value: 'Disabled in task settings.' }],
          issues: [],
        },
        {
          id: 'watchlist',
          title: 'Full sweep: reconciled Plex watchlist',
          status: features.removeFromWatchlist
            ? watchlistSkippedByFlow
              ? 'skipped'
              : watchlistChecked
              ? 'success'
              : 'failed'
            : 'skipped',
          facts: features.removeFromWatchlist
            ? watchlistSkippedByFlow
              ? [{ label: 'Note', value: 'Skipped before watchlist check.' }]
              : [
                { label: ctx.dryRun ? 'Would remove (movies)' : 'Removed (movies)', value: watchlistMovieRemoved },
                { label: ctx.dryRun ? 'Would remove (shows)' : 'Removed (shows)', value: watchlistShowRemoved },
                ...(watchlist && isPlainObject(watchlist.movies)
              ? [
                  {
                    label: ctx.dryRun ? 'Radarr would unmonitor' : 'Radarr unmonitored',
                    value:
                      (ctx.dryRun
                        ? num((watchlist.movies as Record<string, unknown>).radarrWouldUnmonitor)
                        : num((watchlist.movies as Record<string, unknown>).radarrUnmonitored)) ?? 0,
                  },
                  ...(Array.isArray((watchlist.movies as Record<string, unknown>).removedItems)
                    ? [
                        {
                          label: ctx.dryRun ? 'Would remove (movie items)' : 'Removed (movie items)',
                          value: {
                            count: ctx.dryRun
                              ? num((watchlist.movies as Record<string, unknown>).wouldRemove) ?? 0
                              : num((watchlist.movies as Record<string, unknown>).removed) ?? 0,
                            unit: 'movies',
                            items: (watchlist.movies as Record<string, unknown>).removedItems as string[],
                          },
                        },
                      ]
                    : []),
                  ...(Array.isArray((watchlist.movies as Record<string, unknown>).radarrUnmonitoredItems)
                    ? [
                        {
                          label: ctx.dryRun
                            ? 'Radarr would unmonitor (movie items)'
                            : 'Radarr unmonitored (movie items)',
                          value: {
                            count: ctx.dryRun
                              ? num((watchlist.movies as Record<string, unknown>).radarrWouldUnmonitor) ?? 0
                              : num((watchlist.movies as Record<string, unknown>).radarrUnmonitored) ?? 0,
                            unit: 'movies',
                            items: (watchlist.movies as Record<string, unknown>).radarrUnmonitoredItems as string[],
                          },
                        },
                      ]
                    : []),
                ]
              : []),
                ...(watchlist && isPlainObject(watchlist.shows)
              ? [
                  {
                    label: ctx.dryRun ? 'Sonarr would unmonitor (series)' : 'Sonarr unmonitored (series)',
                    value:
                      (ctx.dryRun
                        ? num((watchlist.shows as Record<string, unknown>).sonarrWouldUnmonitor)
                        : num((watchlist.shows as Record<string, unknown>).sonarrUnmonitored)) ?? 0,
                  },
                  ...(Array.isArray((watchlist.shows as Record<string, unknown>).removedItems)
                    ? [
                        {
                          label: ctx.dryRun ? 'Would remove (show items)' : 'Removed (show items)',
                          value: {
                            count: ctx.dryRun
                              ? num((watchlist.shows as Record<string, unknown>).wouldRemove) ?? 0
                              : num((watchlist.shows as Record<string, unknown>).removed) ?? 0,
                            unit: 'shows',
                            items: (watchlist.shows as Record<string, unknown>).removedItems as string[],
                          },
                        },
                      ]
                    : []),
                  ...(Array.isArray((watchlist.shows as Record<string, unknown>).sonarrUnmonitoredItems)
                    ? [
                        {
                          label: ctx.dryRun
                            ? 'Sonarr would unmonitor (show items)'
                            : 'Sonarr unmonitored (show items)',
                          value: {
                            count: ctx.dryRun
                              ? num((watchlist.shows as Record<string, unknown>).sonarrWouldUnmonitor) ?? 0
                              : num((watchlist.shows as Record<string, unknown>).sonarrUnmonitored) ?? 0,
                            unit: 'shows',
                            items: (watchlist.shows as Record<string, unknown>).sonarrUnmonitoredItems as string[],
                          },
                        },
                      ]
                    : []),
                ]
              : []),
              ]
            : [{ label: 'Result', value: 'Disabled in task settings.' }],
          issues:
            features.removeFromWatchlist &&
            !watchlistChecked &&
            !watchlistSkippedByFlow
              ? [issue('error', 'Plex watchlist reconciliation was not executed.')]
              : [],
        },
        buildArrMonitoringTask('radarr', true),
        buildArrMonitoringTask('sonarr', true),
      ]
    : [
        {
          id: 'added',
          title: 'Added content',
          status: 'success',
          facts: [
            ...(plexEvent ? [{ label: 'Plex event', value: plexEvent }] : []),
            { label: 'Media', value: addedLabel },
            ...(ratingKey ? [{ label: 'Plex ratingKey', value: ratingKey }] : []),
          ],
          issues: [],
        },
        {
          id: 'duplicates',
          title: 'Scanned for duplicates',
          status: duplicatesApplicable ? 'success' : 'skipped',
          facts: duplicatesApplicable
            ? [
                { label: 'Found', value: duplicatesFound ? 'found' : 'not found' },
                { label: ctx.dryRun ? 'Would delete' : 'Deleted', value: duplicatesDeleted },
                ...(duplicates && typeof duplicates.librarySectionTitle === 'string'
                  ? [{ label: 'Library', value: duplicates.librarySectionTitle }]
                  : []),
                ...(mediaType === 'episode' &&
                duplicates &&
                typeof duplicates.showRatingKey === 'string'
                  ? [{ label: 'Show ratingKey', value: duplicates.showRatingKey }]
                  : []),
              ]
            : [
                {
                  label: 'Note',
                  value: features.deleteDuplicates
                    ? 'Not scanned for this media type.'
                    : 'Disabled in task settings.',
                },
              ],
          issues: [],
        },
        {
          id: 'watchlist',
          title: 'Checked Plex watchlist',
          status: watchlistApplicable
            ? watchlistSkippedByFlow
              ? 'skipped'
              : watchlistChecked
                ? 'success'
                : 'failed'
            : 'skipped',
          facts: watchlistApplicable && !watchlistSkippedByFlow
            ? [
                { label: 'Found', value: (watchlistAttempted ?? 0) > 0 ? 'found' : 'not found' },
                { label: ctx.dryRun ? 'Would remove' : 'Removed', value: watchlistRemoved ?? 0 },
                ...(watchlistMatchedBy ? [{ label: 'Matched by', value: watchlistMatchedBy }] : []),
                ...(watchlistError ? [{ label: 'Error', value: watchlistError }] : []),
              ]
            : [
                {
                  label: 'Note',
                  value: watchlistSkippedByFlow
                    ? 'Skipped before watchlist check.'
                    : features.removeFromWatchlist
                    ? 'Not checked for episodes.'
                    : 'Disabled in task settings.',
                },
              ],
          issues:
            watchlistApplicable &&
            !watchlistChecked &&
            !watchlistSkippedByFlow
              ? [issue('error', 'Plex watchlist check was not executed.')]
              : [],
        },
        buildArrMonitoringTask('radarr', radarrApplicable),
        buildArrMonitoringTask('sonarr', sonarrApplicable),
      ];

  // Summary sections (requested)
  const sections: JobReportV1['sections'] = [
    {
      id: 'unmonitored',
      title: 'Unmonitored',
      rows: [
        metricRow({
          label: 'Radarr (movie)',
          end: radarrMovieUnmonitored,
          unit: 'items',
          note: !features.unmonitorInArr
            ? 'disabled in task settings'
            : ctx.dryRun
              ? 'dry-run (would unmonitor)'
              : null,
        }),
        metricRow({
          label: 'Sonarr (episode)',
          end: sonarrEpisodeUnmonitored,
          unit: 'items',
          note: !features.unmonitorInArr
            ? 'disabled in task settings'
            : ctx.dryRun
              ? 'dry-run (would unmonitor)'
              : null,
        }),
        ...(sonarrSeasonUnmonitored !== null && sonarrSeasonUnmonitored > 0
          ? [
              metricRow({
                label: 'Sonarr (season)',
                end: sonarrSeasonUnmonitored,
                unit: 'items',
                note: !features.unmonitorInArr
                  ? 'disabled in task settings'
                  : ctx.dryRun
                    ? 'dry-run (would unmonitor)'
                    : null,
              }),
            ]
          : []),
      ],
    },
    {
      id: 'duplicates',
      title: 'Duplicates',
      rows: [
        metricRow({
          label: 'Movie deleted',
          end: movieDuplicatesDeleted,
          unit: 'copies',
          note: !features.deleteDuplicates
            ? 'disabled in task settings'
            : ctx.dryRun
              ? 'dry-run (would delete)'
              : null,
        }),
        metricRow({
          label: 'Episode deleted',
          end: episodeDuplicatesDeleted,
          unit: 'copies',
          note: !features.deleteDuplicates
            ? 'disabled in task settings'
            : ctx.dryRun
              ? 'dry-run (would delete)'
              : null,
        }),
      ],
    },
    {
      id: 'watchlist',
      title: 'Watchlist',
      rows: [
        metricRow({
          label: 'Movie removed',
          end: watchlistMovieRemoved,
          unit: 'items',
          note: !features.removeFromWatchlist
            ? 'disabled in task settings'
            : ctx.dryRun
              ? 'dry-run (would remove)'
              : null,
        }),
        metricRow({
          label: 'Show removed',
          end: watchlistShowRemoved,
          unit: 'items',
          note: !features.removeFromWatchlist
            ? 'disabled in task settings'
            : ctx.dryRun
              ? 'dry-run (would remove)'
              : null,
        }),
      ],
    },
  ];

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: ctx.jobId,
    dryRun: ctx.dryRun,
    trigger: ctx.trigger,
    // Hide the redundant headline card in the UI by using an empty string.
    headline: '',
    sections,
    tasks,
    issues,
    raw,
  };
}
