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
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';

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
  return (2 * intersection) / ((s1.length - 1) + (s2.length - 1));
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
  if (!raw.includes(' - Season ')) return { seriesTitle: null, seasonNumber: null };
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

@Injectable()
export class MediaAddedCleanupJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexWatchlist: PlexWatchlistService,
    private readonly plexDuplicates: PlexDuplicatesService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') ??
      pickString(settings, 'plex.url') ??
      null;
    const plexToken = pickString(secrets, 'plex.token') ?? null;

    if (!plexBaseUrlRaw || !plexToken) {
      throw new Error('Missing Plex configuration (plex.baseUrl + secrets.plex.token)');
    }
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    const movieLibraryName =
      pickString(settings, 'plex.movieLibraryName') ??
      pickString(settings, 'plex.movie_library_name') ??
      'Movies';
    const tvLibraryName =
      pickString(settings, 'plex.tvLibraryName') ??
      pickString(settings, 'plex.tv_library_name') ??
      'TV Shows';

    const deletePreference = coerceDeletePreference(
      pickString(settings, 'plex.deletePreference') ??
        pickString(settings, 'plex.delete_preference') ??
        null,
    );
    const preserveQualityTerms = [
      ...pickStringArray(settings, 'plex.preserveQuality'),
      ...pickStringArray(settings, 'plex.preserve_quality'),
    ];

    const radarrBaseUrlRaw =
      pickString(settings, 'radarr.baseUrl') ??
      pickString(settings, 'radarr.url') ??
      null;
    const radarrApiKey = pickString(secrets, 'radarr.apiKey') ?? null;
    const radarrBaseUrl =
      radarrBaseUrlRaw && radarrApiKey ? normalizeHttpUrl(radarrBaseUrlRaw) : null;

    const sonarrBaseUrlRaw =
      pickString(settings, 'sonarr.baseUrl') ??
      pickString(settings, 'sonarr.url') ??
      null;
    const sonarrApiKey = pickString(secrets, 'sonarr.apiKey') ?? null;
    const sonarrBaseUrl =
      sonarrBaseUrlRaw && sonarrApiKey ? normalizeHttpUrl(sonarrBaseUrlRaw) : null;

    const input = ctx.input ?? {};
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
      deletePreference,
      preserveQualityTerms,
      radarrConfigured: Boolean(radarrBaseUrl && radarrApiKey),
      sonarrConfigured: Boolean(sonarrBaseUrl && sonarrApiKey),
    });

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
      radarr: { configured: Boolean(radarrBaseUrl && radarrApiKey) },
      sonarr: { configured: Boolean(sonarrBaseUrl && sonarrApiKey) },
      watchlist: { removed: 0, attempted: 0, matchedBy: 'none' as const },
      duplicates: null,
      skipped: false,
      warnings: [] as string[],
    };

    if (!mediaType) {
      await ctx.info(
        'mediaAddedCleanup: no mediaType provided; running full duplicates sweep',
        {
          trigger: ctx.trigger,
          dryRun: ctx.dryRun,
        },
      );

      const sweepWarnings: string[] = [];

      // --- Load Radarr index once (best-effort)
      let radarrMovies: RadarrMovie[] = [];
      const radarrByTmdb = new Map<number, RadarrMovie>();
      const radarrByNormTitle = new Map<string, RadarrMovie>();
      if (radarrBaseUrl && radarrApiKey) {
        try {
          radarrMovies = await this.radarr.listMovies({
            baseUrl: radarrBaseUrl,
            apiKey: radarrApiKey,
          });
          for (const m of radarrMovies) {
            const tmdb = toInt(m.tmdbId);
            if (tmdb) radarrByTmdb.set(tmdb, m);
            const t = typeof m.title === 'string' ? m.title : '';
            if (t) radarrByNormTitle.set(normTitle(t), m);
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          sweepWarnings.push(`radarr: failed to load movies (continuing): ${msg}`);
          await ctx.warn('radarr: failed to load movies (continuing)', { error: msg });
        }
      }

      // --- Load Sonarr series index once (best-effort)
      let sonarrSeriesList: SonarrSeries[] = [];
      const sonarrByTvdb = new Map<number, SonarrSeries>();
      const sonarrByNormTitle = new Map<string, SonarrSeries>();
      const sonarrEpisodesCache = new Map<number, Map<string, SonarrEpisode>>();
      if (sonarrBaseUrl && sonarrApiKey) {
        try {
          sonarrSeriesList = await this.sonarr.listSeries({
            baseUrl: sonarrBaseUrl,
            apiKey: sonarrApiKey,
          });
          for (const s of sonarrSeriesList) {
            const tvdb = toInt(s.tvdbId);
            if (tvdb) sonarrByTvdb.set(tvdb, s);
            const t = typeof s.title === 'string' ? s.title : '';
            if (t) sonarrByNormTitle.set(normTitle(t), s);
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          sweepWarnings.push(`sonarr: failed to load series (continuing): ${msg}`);
          await ctx.warn('sonarr: failed to load series (continuing)', { error: msg });
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
        if (!sonarrBaseUrl || !sonarrApiKey) return new Map<string, SonarrEpisode>();
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
        media: Array<{ videoResolution: string | null; parts: Array<{ file: string | null }> }>;
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

      const pickRadarrMovie = (tmdbId: number | null, title: string) => {
        if (tmdbId) {
          const byTmdb = radarrByTmdb.get(tmdbId);
          if (byTmdb) return byTmdb;
        }
        const byTitle = radarrByNormTitle.get(normTitle(title));
        return byTitle ?? null;
      };

      // --- Movie duplicates sweep
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
      };

      const deletedMovieRatingKeys = new Set<string>();

      try {
        await ctx.info('plex: loading movies (tmdb index)', { movieLibraryName });
        const movies = await this.plexServer.listMoviesWithTmdbIds({
          baseUrl: plexBaseUrl,
          token: plexToken,
          movieLibraryName,
        });
        movieStats.scanned = movies.length;

        const groups = new Map<number, Array<{ ratingKey: string; title: string; addedAt: number | null }>>();
        for (const m of movies) {
          if (!m.tmdbId) continue;
          const list = groups.get(m.tmdbId) ?? [];
          list.push({ ratingKey: m.ratingKey, title: m.title, addedAt: m.addedAt });
          groups.set(m.tmdbId, list);
        }
        movieStats.groups = groups.size;

        for (const [tmdbId, items] of groups.entries()) {
          if (items.length < 2) continue;
          movieStats.groupsWithDuplicates += 1;

          await ctx.info('plex: duplicate movie group found', {
            tmdbId,
            candidates: items.length,
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
              const sa = a.bestSize ?? (pref === 'smallest_file' ? Number.POSITIVE_INFINITY : 0);
              const sb = b.bestSize ?? (pref === 'smallest_file' ? Number.POSITIVE_INFINITY : 0);
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
          });

          // Unmonitor in Radarr once per TMDB group (best-effort).
          if (radarrBaseUrl && radarrApiKey) {
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
                title: typeof candidate.title === 'string' ? candidate.title : keep.title,
              });
            } else if (ctx.dryRun) {
              movieStats.radarrWouldUnmonitor += 1;
              await ctx.info('radarr: dry-run would unmonitor (duplicate group)', {
                tmdbId,
                title: typeof candidate.title === 'string' ? candidate.title : keep.title,
              });
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
              await ctx.info('radarr: unmonitor result (duplicate group)', {
                ok,
                tmdbId,
                title: typeof candidate.title === 'string' ? candidate.title : keep.title,
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
            } catch (err) {
              movieStats.failures += 1;
              await ctx.warn('plex: failed deleting duplicate movie metadata (continuing)', {
                ratingKey: rk,
                tmdbId,
                error: (err as Error)?.message ?? String(err),
              });
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
          } catch (err) {
            movieStats.failures += 1;
            await ctx.warn('plex: failed cleaning movie versions (continuing)', {
              ratingKey: keep.ratingKey,
              tmdbId,
              error: (err as Error)?.message ?? String(err),
            });
          }
        }

        // Additionally: movies with internal duplicates (multiple versions) might not
        // show up as TMDB groups. Ask Plex for duplicate-filtered movies and clean them.
        try {
          const dupKeys = await this.plexServer.listDuplicateMovieRatingKeys({
            baseUrl: plexBaseUrl,
            token: plexToken,
            movieLibraryName,
          });

          for (const { ratingKey: rk } of dupKeys) {
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

                const tmdbId = dup.metadata.tmdbIds[0] ?? null;
                const candidate = radarrBaseUrl && radarrApiKey
                  ? pickRadarrMovie(tmdbId, dup.title)
                  : null;

                if (radarrBaseUrl && radarrApiKey) {
                  if (!candidate) {
                    movieStats.radarrNotFound += 1;
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
                    }
                  }
                }
              }
            } catch (err) {
              movieStats.failures += 1;
              await ctx.warn('plex: failed cleaning duplicate movie (continuing)', {
                ratingKey: rk,
                error: (err as Error)?.message ?? String(err),
              });
            }
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          sweepWarnings.push(`plex: movie duplicate listing failed: ${msg}`);
          await ctx.warn('plex: movie duplicate listing failed (continuing)', { error: msg });
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        sweepWarnings.push(`plex: movie scan failed: ${msg}`);
        await ctx.warn('plex: movie scan failed (continuing)', { error: msg });
      }

      // --- Episode duplicates sweep
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
      };

      type EpisodeCandidate = {
        ratingKey: string;
        showTitle: string | null;
        season: number | null;
        episode: number | null;
        bestResolution: number;
        bestSize: number | null;
      };

      const episodeCandidates: EpisodeCandidate[] = [];

      const loadDuplicateEpisodeKeys = async (): Promise<string[]> => {
        try {
          const rows = await this.plexServer.listDuplicateEpisodeRatingKeys({
            baseUrl: plexBaseUrl,
            token: plexToken,
            tvLibraryName,
          });
          return rows.map((r) => r.ratingKey);
        } catch (err) {
          // Fallback: per-show duplicate leaves
          await ctx.warn('plex: duplicate episode listing failed; falling back to per-show scan', {
            error: (err as Error)?.message ?? String(err),
          });
          const out = new Set<string>();
          try {
            const shows = await this.plexServer.listTvShows({
              baseUrl: plexBaseUrl,
              token: plexToken,
              tvLibraryName,
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
          } catch {
            // ignore fallback errors
          }
          return Array.from(out);
        }
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
              bestRes = Math.max(bestRes, resolutionPriority(m.videoResolution));
              for (const p of m.parts ?? []) {
                if (typeof p.size === 'number' && Number.isFinite(p.size)) {
                  bestSize = bestSize === null ? p.size : Math.max(bestSize, p.size);
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
            await ctx.warn('plex: failed loading episode metadata (continuing)', {
              ratingKey: rk,
              error: (err as Error)?.message ?? String(err),
            });
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

        for (const [key, group] of byKey.entries()) {
          if (!key || group.length === 0) continue;

          const season = group[0]?.season ?? null;
          const epNum = group[0]?.episode ?? null;
          const showTitle = group[0]?.showTitle ?? null;

          // Pick keep candidate (best resolution, then size).
          const sorted = group.slice().sort((a, b) => {
            if (a.bestResolution !== b.bestResolution) return b.bestResolution - a.bestResolution;
            const sa = a.bestSize ?? 0;
            const sb = b.bestSize ?? 0;
            return sb - sa;
          });
          const keep = sorted[0];
          const deleteKeys = group.map((g) => g.ratingKey).filter((rk) => rk !== keep.ratingKey);

          if (group.length > 1) episodeStats.groupsWithDuplicates += 1;

          // Unmonitor in Sonarr once per logical episode key (best-effort)
          if (
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
                }
              } catch (err) {
                episodeStats.failures += 1;
                await ctx.warn('sonarr: failed unmonitoring episode (continuing)', {
                  title: showTitle,
                  season,
                  episode: epNum,
                  error: (err as Error)?.message ?? String(err),
                });
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
            } catch (err) {
              episodeStats.failures += 1;
              await ctx.warn('plex: failed deleting duplicate episode metadata (continuing)', {
                ratingKey: rk,
                error: (err as Error)?.message ?? String(err),
              });
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
          } catch (err) {
            episodeStats.failures += 1;
            await ctx.warn('plex: failed cleaning episode versions (continuing)', {
              ratingKey: keep.ratingKey,
              error: (err as Error)?.message ?? String(err),
            });
          }
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        sweepWarnings.push(`plex: episode scan failed: ${msg}`);
        await ctx.warn('plex: episode scan failed (continuing)', { error: msg });
      }

      summary.duplicates = {
        mode: 'fullSweep',
        movie: movieStats,
        episode: episodeStats,
        warnings: sweepWarnings,
      } as unknown as JsonObject;

      (summary.warnings as string[]).push(...sweepWarnings);
      await ctx.info('mediaAddedCleanup(duplicatesSweep): done', summary);
      return { summary };
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

    // --- Movie flow
    if (mediaType === 'movie') {
      if (!title && !ratingKey) {
        await ctx.warn('mediaAddedCleanup(movie): missing title and ratingKey (skipping)');
        summary.skipped = true;
        return { summary };
      }

      // 1) Duplicate cleanup (targeted to this movie ratingKey if possible)
      let movieRatingKey = ratingKey;
      if (!movieRatingKey && title) {
        const movieSectionKey = await this.plexServer.findSectionKeyByTitle({
          baseUrl: plexBaseUrl,
          token: plexToken,
          title: movieLibraryName,
        });
        const found = await this.plexServer.findMovieRatingKeyByTitle({
          baseUrl: plexBaseUrl,
          token: plexToken,
          librarySectionKey: movieSectionKey,
          title,
        });
        movieRatingKey = found?.ratingKey ?? null;
      }

      if (movieRatingKey) {
        try {
          await ctx.info('plex: checking movie duplicates', {
            ratingKey: movieRatingKey,
            deletePreference,
            preserveQualityTerms,
            dryRun: ctx.dryRun,
          });
          const dup = await this.plexDuplicates.cleanupMovieDuplicates({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey: movieRatingKey,
            dryRun: ctx.dryRun,
            deletePreference,
            preserveQualityTerms,
          });
          summary.duplicates = dup as unknown as JsonObject;
          await ctx.info('plex: movie duplicates result', {
            copies: dup.copies,
            deleted: dup.deleted,
            wouldDelete: dup.wouldDelete,
            failures: dup.failures,
            warnings: dup.warnings,
          });
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          (summary.warnings as string[]).push(
            `plex: duplicate cleanup failed (continuing): ${msg}`,
          );
          await ctx.warn('plex: duplicate cleanup failed (continuing)', {
            error: msg,
          });
          summary.duplicates = { ok: false, error: msg } as unknown as JsonObject;
        }
      } else {
        (summary.warnings as string[]).push(
          'plex: could not resolve movie ratingKey for duplicate cleanup',
        );
      }

      // 2) Unmonitor in Radarr (best-effort)
      if (radarrBaseUrl && radarrApiKey) {
        try {
          await ctx.info('radarr: attempting unmonitor for movie', { title });
          const movies = await this.radarr.listMovies({
            baseUrl: radarrBaseUrl,
            apiKey: radarrApiKey,
          });

          const tmdbId =
            tmdbIdInput ??
            (() => {
              const dupMeta = summary.duplicates as unknown as
                | { metadata?: { tmdbIds?: number[] } }
                | undefined;
              const fromDup = dupMeta?.metadata?.tmdbIds?.[0];
              return typeof fromDup === 'number' ? fromDup : null;
            })();

          const normalizedWanted = normTitle(title);
          const findByTitle = (m: RadarrMovie) => {
            const t = typeof m.title === 'string' ? m.title : '';
            return t && normTitle(t) === normalizedWanted;
          };

          const candidate =
            (tmdbId
              ? movies.find((m) => toInt(m.tmdbId) === tmdbId)
              : null) ?? movies.find(findByTitle) ?? null;

          if (!candidate) {
            await ctx.warn('radarr: movie not found (skipping unmonitor)', {
              title,
              tmdbId: tmdbId ?? null,
            });
          } else if (!candidate.monitored) {
            await ctx.info('radarr: already unmonitored', {
              title:
                typeof candidate.title === 'string' ? candidate.title : title,
              id: candidate.id,
            });
          } else if (ctx.dryRun) {
            await ctx.info('radarr: dry-run would unmonitor', {
              title:
                typeof candidate.title === 'string' ? candidate.title : title,
              id: candidate.id,
            });
          } else {
            const ok = await this.radarr.setMovieMonitored({
              baseUrl: radarrBaseUrl,
              apiKey: radarrApiKey,
              movie: candidate,
              monitored: false,
            });
            await ctx.info('radarr: unmonitor result', {
              ok,
              title:
                typeof candidate.title === 'string' ? candidate.title : title,
              id: candidate.id,
              tmdbId: candidate.tmdbId ?? tmdbId ?? null,
            });
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          (summary.warnings as string[]).push(
            `radarr: failed (continuing): ${msg}`,
          );
          await ctx.warn('radarr: failed (continuing)', { error: msg });
        }
      } else {
        await ctx.info('radarr: not configured (skipping)', {});
      }

      // 3) Remove from Plex watchlist (best-effort)
      if (title) {
        await ctx.info('plex: removing movie from watchlist (best-effort)', {
          title,
          year,
          dryRun: ctx.dryRun,
        });
        try {
          const wl = await this.plexWatchlist.removeMovieFromWatchlistByTitle({
            token: plexToken,
            title,
            year,
            dryRun: ctx.dryRun,
          });
          summary.watchlist = wl as unknown as JsonObject;
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          (summary.warnings as string[]).push(
            `plex: watchlist removal failed (non-critical): ${msg}`,
          );
          await ctx.warn('plex: watchlist removal failed (non-critical)', {
            error: msg,
          });
          summary.watchlist = { ok: false, error: msg } as unknown as JsonObject;
        }
      }

      await ctx.info('mediaAddedCleanup(movie): done', summary);
      return { summary };
    }

    // --- Show flow
    if (mediaType === 'show') {
      const seriesTitle = title;
      if (!seriesTitle && !ratingKey) {
        await ctx.warn('mediaAddedCleanup(show): missing title and ratingKey (skipping)');
        summary.skipped = true;
        return { summary };
      }

      // Determine TVDB id if possible (best-effort)
      let tvdbId: number | null = tvdbIdInput ?? null;
      if (!tvdbId && ratingKey) {
        try {
          const meta = await this.plexServer.getMetadataDetails({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey,
          });
          tvdbId = meta?.tvdbIds?.[0] ?? null;
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          (summary.warnings as string[]).push(
            `plex: failed to read show tvdbId from metadata (continuing): ${msg}`,
          );
          await ctx.warn('plex: failed to read show tvdbId from metadata', {
            ratingKey,
            error: msg,
          });
        }
      }

      if (sonarrBaseUrl && sonarrApiKey && seriesTitle) {
        try {
          const series = await findSonarrSeries({ tvdbId, title: seriesTitle });
          if (!series) {
            await ctx.warn('sonarr: series not found (skipping unmonitor)', {
              title: seriesTitle,
              tvdbId,
            });
          } else if (!series.monitored) {
            await ctx.info('sonarr: already unmonitored', {
              title:
                typeof series.title === 'string' ? series.title : seriesTitle,
              id: series.id,
            });
          } else if (ctx.dryRun) {
            await ctx.info('sonarr: dry-run would unmonitor series', {
              title:
                typeof series.title === 'string' ? series.title : seriesTitle,
              id: series.id,
            });
          } else {
            const updated: SonarrSeries = { ...series, monitored: false };
            await this.sonarr.updateSeries({
              baseUrl: sonarrBaseUrl,
              apiKey: sonarrApiKey,
              series: updated,
            });
            await ctx.info('sonarr: series unmonitored', {
              title:
                typeof series.title === 'string' ? series.title : seriesTitle,
              id: series.id,
            });
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          (summary.warnings as string[]).push(
            `sonarr: unmonitor show failed (continuing): ${msg}`,
          );
          await ctx.warn('sonarr: unmonitor show failed (continuing)', {
            error: msg,
          });
        }
      } else {
        await ctx.info('sonarr: not configured or missing title (skipping)', {});
      }

      if (seriesTitle) {
        await ctx.info('plex: removing show from watchlist (best-effort)', {
          title: seriesTitle,
          dryRun: ctx.dryRun,
        });
        try {
          const wl = await this.plexWatchlist.removeShowFromWatchlistByTitle({
            token: plexToken,
            title: seriesTitle,
            dryRun: ctx.dryRun,
          });
          summary.watchlist = wl as unknown as JsonObject;
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          (summary.warnings as string[]).push(
            `plex: watchlist removal failed (non-critical): ${msg}`,
          );
          await ctx.warn('plex: watchlist removal failed (non-critical)', {
            error: msg,
          });
          summary.watchlist = { ok: false, error: msg } as unknown as JsonObject;
        }
      }

      await ctx.info('mediaAddedCleanup(show): done', summary);
      return { summary };
    }

    // --- Season flow
    if (mediaType === 'season') {
      const parsed = parseSeasonTitleFallback(title);
      const seriesTitle = showTitle ?? parsed.seriesTitle ?? null;
      const seasonNum = seasonNumber ?? parsed.seasonNumber ?? null;

      if (!seriesTitle || !seasonNum) {
        await ctx.warn('mediaAddedCleanup(season): missing seriesTitle/seasonNumber (skipping)', {
          title,
          showTitle,
          seasonNumber,
        });
        summary.skipped = true;
        return { summary };
      }

      // Find series in Sonarr (required for safety check + unmonitor)
      if (!sonarrBaseUrl || !sonarrApiKey) {
        await ctx.warn('sonarr: not configured (skipping season flow)', {});
        summary.skipped = true;
        return { summary };
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
          return { summary };
        }

        // Resolve show ratingKey in Plex (required for safety check)
        let plexShowRatingKey = showRatingKey;
        if (!plexShowRatingKey) {
          const tvSectionKey = await this.plexServer.findSectionKeyByTitle({
            baseUrl: plexBaseUrl,
            token: plexToken,
            title: tvLibraryName,
          });
          const found = await this.plexServer.findShowRatingKeyByTitle({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: tvSectionKey,
            title: seriesTitle,
          });
          plexShowRatingKey = found?.ratingKey ?? null;
        }

        if (!plexShowRatingKey) {
          await ctx.warn(
            'plex: show not found (cannot verify season completeness; skipping)',
            {
              title: seriesTitle,
              season: seasonNum,
            },
          );
          summary.skipped = true;
          return { summary };
        }

        // Safety check: all episodes in season must be present in Plex.
        const plexEpisodes = await this.plexServer.getEpisodesSet({
          baseUrl: plexBaseUrl,
          token: plexToken,
          showRatingKey: plexShowRatingKey,
        });

        const episodes = await this.sonarr.getEpisodesBySeries({
          baseUrl: sonarrBaseUrl,
          apiKey: sonarrApiKey,
          seriesId: series.id,
        });

        const seasonEpisodes = episodes.filter(
          (ep) => toInt(ep.seasonNumber) === seasonNum,
        );
        const desired = new Set<string>();
        for (const ep of seasonEpisodes) {
          const epNum = toInt(ep.episodeNumber);
          if (!epNum) continue;
          desired.add(episodeKey(seasonNum, epNum));
        }

        const missing = Array.from(desired).filter((k) => !plexEpisodes.has(k));
        if (missing.length > 0) {
          await ctx.warn(
            'sonarr: season incomplete in Plex; skipping unmonitor + watchlist removal for safety',
            {
              title: seriesTitle,
              season: seasonNum,
              missingCount: missing.length,
              missing: missing.slice(0, 25),
            },
          );
          summary.skipped = true;
          return { summary };
        }

        // Unmonitor monitored episodes in this season.
        const monitoredEpisodes = seasonEpisodes.filter((ep) =>
          Boolean(ep.monitored),
        );
        await ctx.info('sonarr: season complete; unmonitoring episodes + season', {
          title: seriesTitle,
          season: seasonNum,
          monitoredEpisodes: monitoredEpisodes.length,
          dryRun: ctx.dryRun,
        });

        let episodeUnmonitored = 0;
        for (const ep of monitoredEpisodes) {
          if (ctx.dryRun) {
            episodeUnmonitored += 1;
            continue;
          }
          const ok = await this.sonarr
            .setEpisodeMonitored({
              baseUrl: sonarrBaseUrl,
              apiKey: sonarrApiKey,
              episode: ep,
              monitored: false,
            })
            .then(() => true)
            .catch(() => false);
          if (ok) episodeUnmonitored += 1;
        }

        // Unmonitor the season itself via series update.
        const updatedSeries: SonarrSeries = { ...series };
        const seasons = Array.isArray(series.seasons)
          ? series.seasons.map((s) => ({ ...s }))
          : [];
        const seasonObj = seasons.find(
          (s) => toInt(s.seasonNumber) === seasonNum,
        );
        const seasonWasMonitored = Boolean(seasonObj?.monitored);
        if (seasonObj) seasonObj.monitored = false;
        updatedSeries.seasons = seasons;

        if (!ctx.dryRun && seasonWasMonitored) {
          await this.sonarr.updateSeries({
            baseUrl: sonarrBaseUrl,
            apiKey: sonarrApiKey,
            series: updatedSeries,
          });
        }

        summary.sonarr = {
          configured: true,
          seriesId: series.id,
          season: seasonNum,
          episodesUnmonitored: episodeUnmonitored,
          seasonUnmonitored: seasonWasMonitored ? true : false,
        } as unknown as JsonObject;

        // Remove show from watchlist only after safety check passes.
        await ctx.info('plex: removing show from watchlist (season complete)', {
          title: seriesTitle,
          dryRun: ctx.dryRun,
        });
        try {
          const wl = await this.plexWatchlist.removeShowFromWatchlistByTitle({
            token: plexToken,
            title: seriesTitle,
            dryRun: ctx.dryRun,
          });
          summary.watchlist = wl as unknown as JsonObject;
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          (summary.warnings as string[]).push(
            `plex: watchlist removal failed (non-critical): ${msg}`,
          );
          await ctx.warn('plex: watchlist removal failed (non-critical)', {
            error: msg,
          });
          summary.watchlist = { ok: false, error: msg } as unknown as JsonObject;
        }

        await ctx.info('mediaAddedCleanup(season): done', summary);
        return { summary };
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        (summary.warnings as string[]).push(
          `season flow failed (continuing): ${msg}`,
        );
        await ctx.warn('mediaAddedCleanup(season): failed (continuing)', {
          error: msg,
        });
        summary.skipped = true;
        return { summary };
      }
    }

    // --- Episode flow
    if (mediaType === 'episode') {
      const seriesTitle = showTitle;
      const seasonNum = seasonNumber;
      const epNum = episodeNumber;

      if (!seriesTitle || !seasonNum || !epNum) {
        await ctx.warn('mediaAddedCleanup(episode): missing seriesTitle/season/episode (skipping)', {
          title,
          showTitle,
          seasonNumber,
          episodeNumber,
        });
        summary.skipped = true;
        return { summary };
      }

      if (sonarrBaseUrl && sonarrApiKey) {
        try {
          const series = await findSonarrSeries({
            tvdbId: tvdbIdInput ?? null,
            title: seriesTitle,
          });
          if (!series) {
            await ctx.warn(
              'sonarr: series not found (skipping episode unmonitor)',
              {
                title: seriesTitle,
                tvdbId: tvdbIdInput ?? null,
              },
            );
          } else {
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
              await ctx.warn('sonarr: episode not found (skipping)', {
                title: seriesTitle,
                season: seasonNum,
                episode: epNum,
              });
            } else if (!episode.monitored) {
              await ctx.info('sonarr: episode already unmonitored', {
                title: seriesTitle,
                season: seasonNum,
                episode: epNum,
              });
            } else if (ctx.dryRun) {
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
              await ctx.info('sonarr: episode unmonitored', {
                title: seriesTitle,
                season: seasonNum,
                episode: epNum,
              });
            }
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          (summary.warnings as string[]).push(
            `sonarr: episode unmonitor failed (continuing): ${msg}`,
          );
          await ctx.warn('sonarr: episode unmonitor failed (continuing)', {
            error: msg,
          });
        }
      } else {
        await ctx.info('sonarr: not configured (skipping episode unmonitor)', {});
      }

      // Duplicate cleanup on this episode (targeted) if we have a ratingKey.
      if (ratingKey) {
        await ctx.info('plex: checking episode duplicates', {
          ratingKey,
          dryRun: ctx.dryRun,
        });
        try {
          const dup = await this.plexDuplicates.cleanupEpisodeDuplicates({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey,
            dryRun: ctx.dryRun,
          });
          summary.duplicates = dup as unknown as JsonObject;
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          (summary.warnings as string[]).push(
            `plex: episode duplicate cleanup failed (continuing): ${msg}`,
          );
          await ctx.warn('plex: episode duplicate cleanup failed (continuing)', {
            error: msg,
          });
          summary.duplicates = { ok: false, error: msg } as unknown as JsonObject;
        }
      } else {
        (summary.warnings as string[]).push(
          'plex: missing ratingKey; cannot check episode duplicates',
        );
      }

      await ctx.info('mediaAddedCleanup(episode): done', summary);
      return { summary };
    }

    await ctx.warn('mediaAddedCleanup: unsupported mediaType (skipping)', {
      mediaType,
    });
    summary.skipped = true;
    return { summary };
  }
}


