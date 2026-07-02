import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import {
  PlexServerService,
  type PlexPartPlayableProbeResult,
  type PlexVerifiedEpisodeAvailability,
} from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import {
  SonarrService,
  type SonarrEpisode,
  type SonarrEpisodeFile,
} from '../sonarr/sonarr.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import type { JobReportV1, JobReportTask } from './job-report-v1';
import { issue, metricRow } from './job-report-v1';

const MAX_REPORTED_ITEMS = 100;
const SCAN_SETTLE_INITIAL_MS = 5000;
const SCAN_SETTLE_POLL_MS = 3000;
const SCAN_SETTLE_MAX_MS = 90000;

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

function episodeKey(season: number, episode: number) {
  return `${season}:${episode}`;
}

function padNum(value: number): string {
  return String(value).padStart(2, '0');
}

function describeEpisode(
  title: string,
  season: number,
  episode: number,
): string {
  return `${title} - S${padNum(season)}E${padNum(episode)}`;
}

function pushCapped(list: string[], item: string) {
  if (list.length >= MAX_REPORTED_ITEMS) return;
  list.push(item);
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- Path mapping helpers (pure; unit-tested) -----------------------------

export type PathPrefixMapping = { from: string; to: string };

function splitSegments(p: string): string[] {
  let s = p.trim();
  if (s.length > 1 && s.endsWith('/')) s = s.replace(/\/+$/, '');
  return s.split('/');
}

function commonSuffixLength(a: string[], b: string[]): number {
  let i = a.length - 1;
  let j = b.length - 1;
  let count = 0;
  while (i >= 0 && j >= 0 && a[i] === b[j]) {
    count += 1;
    i -= 1;
    j -= 1;
  }
  return count;
}

/**
 * Derives *arr -> Plex path prefix mappings by matching each *arr root folder
 * to the Plex library location that shares the longest trailing path suffix
 * (e.g. `/data/x/Shows` <-> `/media/x/Shows` yields `/data` -> `/media`).
 */
export function derivePathMap(
  arrRoots: string[],
  plexLocations: string[],
): PathPrefixMapping[] {
  const seen = new Set<string>();
  const out: PathPrefixMapping[] = [];
  for (const root of arrRoots) {
    const rootSegs = splitSegments(root);
    let best: { loc: string; suffix: number } | null = null;
    for (const loc of plexLocations) {
      const suffix = commonSuffixLength(rootSegs, splitSegments(loc));
      if (suffix <= 0) continue;
      if (!best || suffix > best.suffix) best = { loc, suffix };
    }
    if (!best) continue;
    const locSegs = splitSegments(best.loc);
    const fromHead = rootSegs.slice(0, rootSegs.length - best.suffix).join('/');
    const toHead = locSegs.slice(0, locSegs.length - best.suffix).join('/');
    const key = `${fromHead}=>${toHead}`;
    if (fromHead === toHead) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: fromHead, to: toHead });
  }
  return out;
}

function segmentStartsWith(path: string, prefix: string): boolean {
  if (!prefix) return false;
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Translates an *arr path into the Plex namespace using the longest matching
 * prefix mapping. Returns the original path when no mapping applies.
 */
export function translatePath(
  path: string,
  mappings: PathPrefixMapping[],
): string {
  let match: PathPrefixMapping | null = null;
  for (const m of mappings) {
    if (!segmentStartsWith(path, m.from)) continue;
    if (!match || m.from.length > match.from.length) match = m;
  }
  if (!match) return path;
  return `${match.to}${path.slice(match.from.length)}`;
}

function dirnameOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx > 0 ? path.slice(0, idx) : path;
}

function readPathOverrides(
  settings: Record<string, unknown>,
  key: string,
): PathPrefixMapping[] {
  const raw = pick(settings, key);
  if (!Array.isArray(raw)) return [];
  const out: PathPrefixMapping[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const from = typeof entry['from'] === 'string' ? entry['from'].trim() : '';
    const to = typeof entry['to'] === 'string' ? entry['to'].trim() : '';
    if (from && to) out.push({ from, to });
  }
  return out;
}

// ---- Job -------------------------------------------------------------------

type PlexLocation = { sectionKey: string; path: string };

type EpisodeRepairCandidate = {
  seriesTitle: string;
  season: number;
  episode: number;
  episodeId: number;
  episodeFileId: number;
  episode_: SonarrEpisode;
  sonarrPath: string;
  sectionKey: string;
  showRatingKeys: string[];
};

type MovieRepairCandidate = {
  title: string;
  movieId: number;
  movieFileId: number;
  tmdbId: number;
  radarrPath: string;
  sectionKey: string;
};

type Progress = (params: {
  step: string;
  message: string;
  current?: number;
  total?: number;
  unit?: string;
}) => void;

@Injectable()
export class RepairMonitoredJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const setProgress: Progress = (params) => {
      const { step, message, current, total, unit } = params;
      void ctx
        .patchSummary({
          phase: 'repairMonitored',
          progress: {
            step,
            message,
            ...(typeof current === 'number' ? { current } : {}),
            ...(typeof total === 'number' ? { total } : {}),
            ...(unit ? { unit } : {}),
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);
    };

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

    const sonarrBaseUrl =
      pickString(settings, 'sonarr.baseUrl') ??
      pickString(settings, 'sonarr.url') ??
      null;
    const sonarrApiKey =
      pickString(secrets, 'sonarr.apiKey') ??
      pickString(secrets, 'sonarrApiKey') ??
      null;
    const sonarrEnabledSetting = pickBool(settings, 'sonarr.enabled');
    const sonarrIntegrationEnabled =
      (sonarrEnabledSetting ?? Boolean(sonarrApiKey)) === true;
    const sonarrConfigured =
      sonarrIntegrationEnabled && Boolean(sonarrBaseUrl && sonarrApiKey);

    if (!radarrConfigured && !sonarrConfigured) {
      throw new Error(
        'Repair Monitored requires at least one configured integration: Radarr or Sonarr (baseUrl + apiKey).',
      );
    }

    await ctx.info('repairMonitored: start', {
      dryRun: ctx.dryRun,
      plexBaseUrl,
      radarrConfigured,
      sonarrConfigured,
      ...(radarrConfigured ? { radarrBaseUrl } : {}),
      ...(sonarrConfigured ? { sonarrBaseUrl } : {}),
    });
    setProgress({ step: 'plex_discovery', message: 'Discovering Plex…' });

    // Shared Plex discovery.
    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const sectionLocations = await this.plexServer.getSectionLocations({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const showLocations: PlexLocation[] = [];
    const movieLocations: PlexLocation[] = [];
    for (const [sectionKey, info] of sectionLocations.entries()) {
      const bucket =
        (info.type ?? '').toLowerCase() === 'show'
          ? showLocations
          : (info.type ?? '').toLowerCase() === 'movie'
            ? movieLocations
            : null;
      if (!bucket) continue;
      for (const path of info.locations) bucket.push({ sectionKey, path });
    }

    const radarrResult = radarrConfigured
      ? await this.runRadarrPass({
          ctx,
          setProgress,
          settings,
          plexBaseUrl,
          plexToken,
          radarrBaseUrl: radarrBaseUrl as string,
          radarrApiKey: radarrApiKey as string,
          movieSections: sections.filter(
            (s) => (s.type ?? '').toLowerCase() === 'movie',
          ),
          movieLocations,
        })
      : disabledRadarrResult();

    const sonarrResult = sonarrConfigured
      ? await this.runSonarrPass({
          ctx,
          setProgress,
          settings,
          plexBaseUrl,
          plexToken,
          sonarrBaseUrl: sonarrBaseUrl as string,
          sonarrApiKey: sonarrApiKey as string,
          tvSections: sections.filter(
            (s) => (s.type ?? '').toLowerCase() === 'show',
          ),
          showLocations,
        })
      : disabledSonarrResult();

    await ctx.patchSummary({
      progress: {
        step: 'done',
        message: 'Completed.',
        updatedAt: new Date().toISOString(),
      },
    });
    const raw: JsonObject = {
      phase: 'repairMonitored',
      dryRun: ctx.dryRun,
      radarr: radarrResult,
      sonarr: sonarrResult,
    };
    await ctx.info('repairMonitored: done', raw);
    return {
      summary: buildReport({
        ctx,
        raw,
        radarr: radarrResult,
        sonarr: sonarrResult,
      }) as unknown as JsonObject,
    };
  }

  // ---- Radarr (movies) ----------------------------------------------------

  // skipcq: JS-R1005 - Coordinates Plex/Radarr reconcile + repair with explicit branch handling.
  private async runRadarrPass(params: {
    ctx: JobContext;
    setProgress: Progress;
    settings: Record<string, unknown>;
    plexBaseUrl: string;
    plexToken: string;
    radarrBaseUrl: string;
    radarrApiKey: string;
    movieSections: Array<{ key: string; title: string }>;
    movieLocations: PlexLocation[];
  }): Promise<RadarrResult> {
    const {
      ctx,
      setProgress,
      settings,
      plexBaseUrl,
      plexToken,
      radarrBaseUrl,
      radarrApiKey,
      movieSections,
      movieLocations,
    } = params;

    const result = disabledRadarrResult();
    result.configured = true;

    const roots = await this.radarr.listRootFolders({
      baseUrl: radarrBaseUrl,
      apiKey: radarrApiKey,
    });
    const pathMap = [
      ...readPathOverrides(settings, 'radarr.plexPathMappings'),
      ...derivePathMap(
        roots.map((r) => r.path),
        movieLocations.map((l) => l.path),
      ),
    ];
    await ctx.info('repairMonitored[radarr]: path map', {
      derived: pathMap,
      radarrRoots: roots.map((r) => r.path),
      plexMovieLocations: movieLocations.map((l) => l.path),
    });

    const buildTmdbMap = async () => {
      const map = new Map<number, string[]>();
      for (const sec of movieSections) {
        const m = await this.plexServer.getMovieTmdbRatingKeysMapForSectionKey({
          baseUrl: plexBaseUrl,
          token: plexToken,
          librarySectionKey: sec.key,
          sectionTitle: sec.title,
        });
        for (const [tmdbId, ratingKeys] of m.entries()) {
          const prev = map.get(tmdbId) ?? [];
          for (const rk of ratingKeys) if (!prev.includes(rk)) prev.push(rk);
          map.set(tmdbId, prev);
        }
      }
      return map;
    };

    setProgress({ step: 'radarr_index', message: 'Indexing Plex movies…' });
    const tmdbRatingKeys = await buildTmdbMap();

    const partProbeCache = new Map<string, PlexPartPlayableProbeResult>();
    const anyPlayable = async (ratingKeys: string[]) => {
      for (const rk of ratingKeys) {
        try {
          const v = await this.plexServer.verifyPlayableMetadataByRatingKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey: rk,
            partProbeCache,
          });
          if (v.playable) return true;
        } catch {
          // Treat probe errors as "not verified" — never triggers a delete.
        }
      }
      return false;
    };

    const movies = await this.radarr.listMonitoredMovies({
      baseUrl: radarrBaseUrl,
      apiKey: radarrApiKey,
    });
    result.totalMovies = movies.length;

    const candidates: MovieRepairCandidate[] = [];
    const scanTargets = new Map<
      string,
      { sectionKey: string; folder: string }
    >();

    let processed = 0;
    setProgress({
      step: 'radarr_scan',
      message: 'Scanning Radarr movies…',
      current: 0,
      total: movies.length,
      unit: 'movies',
    });
    for (const movie of movies) {
      processed += 1;
      result.moviesProcessed = processed;
      const title =
        typeof movie.title === 'string' ? movie.title : `movie#${movie.id}`;
      const tmdbId = toInt(movie.tmdbId);
      const ratingKeys = tmdbId ? (tmdbRatingKeys.get(tmdbId) ?? []) : [];
      const inPlex = ratingKeys.length > 0;
      const hasFile = movie.hasFile === true;

      if (inPlex) {
        if (await anyPlayable(ratingKeys)) {
          result.confirmedInPlex += 1;
          if (movie.monitored && hasFile) {
            if (ctx.dryRun) {
              result.unmonitored += 1;
              pushCapped(result.unmonitoredSamples, title);
            } else {
              const ok = await this.radarr.setMovieMonitored({
                baseUrl: radarrBaseUrl,
                apiKey: radarrApiKey,
                movie,
                monitored: false,
              });
              if (ok) {
                result.unmonitored += 1;
                pushCapped(result.unmonitoredSamples, title);
              } else {
                result.actionFailures += 1;
              }
            }
          }
        } else {
          result.inPlexUnverified += 1;
        }
        continue;
      }

      // Not in Plex metadata.
      if (!hasFile) {
        result.missingNoFile += 1;
        continue;
      }
      const filePath =
        typeof movie.movieFile?.path === 'string'
          ? movie.movieFile.path.trim()
          : '';
      const fileId = toInt(movie.movieFile?.id) ?? toInt(movie.movieFileId);
      if (!filePath || !fileId || !tmdbId) {
        result.unresolvedFiles += 1;
        continue;
      }

      const translated = translatePath(filePath, pathMap);
      const cover = movieLocations.find((loc) =>
        segmentStartsWith(translated, loc.path),
      );
      if (!cover) {
        result.uncoveredPaths += 1;
        pushCapped(result.uncoveredSamples, `${title}  (${filePath})`);
        continue;
      }

      candidates.push({
        title,
        movieId: movie.id,
        movieFileId: fileId,
        tmdbId,
        radarrPath: filePath,
        sectionKey: cover.sectionKey,
      });
      const folder = dirnameOf(translated);
      scanTargets.set(`${cover.sectionKey}:${folder}`, {
        sectionKey: cover.sectionKey,
        folder,
      });

      if (processed % 250 === 0 || processed === movies.length) {
        setProgress({
          step: 'radarr_scan',
          message: 'Scanning Radarr movies…',
          current: processed,
          total: movies.length,
          unit: 'movies',
        });
      }
    }
    result.repairCandidates = candidates.length;

    if (ctx.dryRun) {
      for (const c of candidates)
        pushCapped(result.wouldRepairSamples, c.title);
      return result;
    }

    if (scanTargets.size > 0) {
      setProgress({
        step: 'radarr_repair',
        message: `Scanning ${scanTargets.size} Plex movie folder(s)…`,
      });
      for (const { sectionKey, folder } of scanTargets.values()) {
        try {
          await this.plexServer.refreshLibraryPath({
            baseUrl: plexBaseUrl,
            token: plexToken,
            sectionKey,
            path: folder,
          });
          result.scannedFolders += 1;
        } catch (error) {
          await ctx.warn('plex: refresh movie path failed', {
            sectionKey,
            folder,
            error: (error as Error)?.message ?? String(error),
          });
        }
      }
      await this.waitForScansToSettle(ctx, plexBaseUrl, plexToken);
    }

    // Pass B: re-verify each candidate against a fresh index + a title fallback.
    const freshTmdb: Map<number, string[]> =
      candidates.length > 0
        ? await buildTmdbMap()
        : new Map<number, string[]>();
    let repaired = 0;
    for (const c of candidates) {
      repaired += 1;
      const stillAbsent =
        (freshTmdb.get(c.tmdbId) ?? []).length === 0 &&
        !(await this.movieFoundByTitle(
          plexBaseUrl,
          plexToken,
          movieSections,
          c.title,
        ));
      if (!stillAbsent) {
        // Plex has it after the scan (or under a non-tmdb match) — keep the file.
        result.recoveredByScan += 1;
        pushCapped(result.recoveredSamples, c.title);
        continue;
      }

      try {
        await this.radarr.deleteMovieFile({
          baseUrl: radarrBaseUrl,
          apiKey: radarrApiKey,
          movieFileId: c.movieFileId,
        });
        result.deletedFiles += 1;
        pushCapped(result.deletedSamples, `${c.title}  (${c.radarrPath})`);
      } catch (error) {
        result.actionFailures += 1;
        await ctx.warn('radarr: delete movie file failed', {
          title: c.title,
          movieFileId: c.movieFileId,
          error: (error as Error)?.message ?? String(error),
        });
        continue;
      }

      try {
        const history = await this.radarr.listMovieHistory({
          baseUrl: radarrBaseUrl,
          apiKey: radarrApiKey,
          movieId: c.movieId,
        });
        const grabbed = history
          .filter((h) => (h.eventType ?? '').toLowerCase() === 'grabbed')
          .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
        if (grabbed.length > 0) {
          await this.radarr.markHistoryFailed({
            baseUrl: radarrBaseUrl,
            apiKey: radarrApiKey,
            historyId: grabbed[0].id,
          });
          result.blocklisted += 1;
        } else {
          result.blocklistUnavailable += 1;
          pushCapped(result.blocklistUnavailableSamples, c.title);
        }
      } catch (error) {
        result.blocklistUnavailable += 1;
        pushCapped(result.blocklistUnavailableSamples, c.title);
        await ctx.warn('radarr: blocklist failed', {
          title: c.title,
          error: (error as Error)?.message ?? String(error),
        });
      }

      try {
        const ok = await this.radarr.searchMovies({
          baseUrl: radarrBaseUrl,
          apiKey: radarrApiKey,
          movieIds: [c.movieId],
        });
        if (ok) result.searchQueued += 1;
      } catch (error) {
        await ctx.warn('radarr: movie search failed', {
          title: c.title,
          error: (error as Error)?.message ?? String(error),
        });
      }

      if (repaired % 5 === 0 || repaired === candidates.length) {
        setProgress({
          step: 'radarr_repair',
          message: 'Repairing unfit movies…',
          current: repaired,
          total: candidates.length,
          unit: 'movies',
        });
      }
    }

    return result;
  }

  private async movieFoundByTitle(
    plexBaseUrl: string,
    plexToken: string,
    movieSections: Array<{ key: string }>,
    title: string,
  ): Promise<boolean> {
    for (const sec of movieSections) {
      try {
        const hit = await this.plexServer.findMovieRatingKeyByTitle({
          baseUrl: plexBaseUrl,
          token: plexToken,
          librarySectionKey: sec.key,
          title,
        });
        if (hit) return true;
      } catch {
        // ignore and try the next section
      }
    }
    return false;
  }

  // ---- Sonarr (episodes) --------------------------------------------------

  // skipcq: JS-R1005 - Coordinates Plex/Sonarr reconcile + repair with explicit branch handling.
  private async runSonarrPass(params: {
    ctx: JobContext;
    setProgress: Progress;
    settings: Record<string, unknown>;
    plexBaseUrl: string;
    plexToken: string;
    sonarrBaseUrl: string;
    sonarrApiKey: string;
    tvSections: Array<{ key: string; title: string }>;
    showLocations: PlexLocation[];
  }): Promise<SonarrResult> {
    const {
      ctx,
      setProgress,
      settings,
      plexBaseUrl,
      plexToken,
      sonarrBaseUrl,
      sonarrApiKey,
      tvSections,
      showLocations,
    } = params;

    const result = disabledSonarrResult();
    result.configured = true;

    const roots = await this.sonarr.listRootFolders({
      baseUrl: sonarrBaseUrl,
      apiKey: sonarrApiKey,
    });
    const pathMap = [
      ...readPathOverrides(settings, 'sonarr.plexPathMappings'),
      ...derivePathMap(
        roots.map((r) => r.path),
        showLocations.map((l) => l.path),
      ),
    ];
    await ctx.info('repairMonitored[sonarr]: path map', {
      derived: pathMap,
      sonarrRoots: roots.map((r) => r.path),
      plexShowLocations: showLocations.map((l) => l.path),
    });

    setProgress({ step: 'sonarr_index', message: 'Indexing Plex TV shows…' });
    const tvdbRatingKeys = new Map<number, string[]>();
    for (const sec of tvSections) {
      const map = await this.plexServer.getTvdbShowRatingKeysMapForSectionKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey: sec.key,
        sectionTitle: sec.title,
      });
      for (const [tvdbId, ratingKeys] of map.entries()) {
        const prev = tvdbRatingKeys.get(tvdbId) ?? [];
        for (const rk of ratingKeys) if (!prev.includes(rk)) prev.push(rk);
        tvdbRatingKeys.set(tvdbId, prev);
      }
    }

    const availabilityCache = new Map<
      string,
      PlexVerifiedEpisodeAvailability | null
    >();
    const getAvailability = async (
      ratingKey: string,
      cache: Map<string, PlexVerifiedEpisodeAvailability | null>,
    ) => {
      const cached = cache.get(ratingKey);
      if (cached !== undefined) return cached;
      try {
        const r =
          await this.plexServer.getVerifiedEpisodeAvailabilityForShowRatingKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            showRatingKey: ratingKey,
          });
        cache.set(ratingKey, r);
        return r;
      } catch (error) {
        cache.set(ratingKey, null);
        await ctx.warn('plex: availability fetch failed', {
          ratingKey,
          error: (error as Error)?.message ?? String(error),
        });
        return null;
      }
    };

    const monitoredSeries = await this.sonarr.listMonitoredSeries({
      baseUrl: sonarrBaseUrl,
      apiKey: sonarrApiKey,
    });
    result.totalSeries = monitoredSeries.length;
    setProgress({
      step: 'sonarr_scan',
      message: 'Scanning Sonarr series…',
      current: 0,
      total: monitoredSeries.length,
      unit: 'series',
    });

    const candidates: EpisodeRepairCandidate[] = [];
    const scanTargets = new Map<
      string,
      { sectionKey: string; folder: string }
    >();

    let processed = 0;
    for (const series of monitoredSeries) {
      processed += 1;
      result.seriesProcessed = processed;
      const title =
        typeof series.title === 'string' ? series.title : `series#${series.id}`;
      const tvdbId = toInt(series.tvdbId);
      const showRatingKeys = tvdbId ? (tvdbRatingKeys.get(tvdbId) ?? []) : [];
      const showFoundInPlex = showRatingKeys.length > 0;

      const verified = new Set<string>();
      const metadata = new Set<string>();
      let availabilityOk = showFoundInPlex;
      if (showFoundInPlex) {
        for (const rk of showRatingKeys) {
          const availability = await getAvailability(rk, availabilityCache);
          if (!availability) {
            availabilityOk = false;
            continue;
          }
          for (const k of availability.verifiedEpisodes) verified.add(k);
          for (const k of availability.metadataEpisodes) metadata.add(k);
        }
      }
      if (showFoundInPlex && !availabilityOk) result.availabilityFailures += 1;
      if (!showFoundInPlex) {
        result.showsNotInPlex += 1;
        pushCapped(result.showsNotInPlexSamples, title);
      }

      const episodes = await this.sonarr.getEpisodesBySeries({
        baseUrl: sonarrBaseUrl,
        apiKey: sonarrApiKey,
        seriesId: series.id,
      });
      const files = await this.sonarr.getEpisodeFiles({
        baseUrl: sonarrBaseUrl,
        apiKey: sonarrApiKey,
        seriesId: series.id,
      });
      const fileById = new Map<number, SonarrEpisodeFile>();
      for (const f of files) fileById.set(f.id, f);

      for (const ep of episodes) {
        const season = toInt(ep.seasonNumber);
        const epNum = toInt(ep.episodeNumber);
        if (!season || !epNum) continue;
        result.episodesChecked += 1;
        const key = episodeKey(season, epNum);
        const label = describeEpisode(title, season, epNum);

        if (!showFoundInPlex || !availabilityOk) continue;

        if (verified.has(key)) {
          result.confirmedInPlex += 1;
          if (ep.monitored) {
            if (ctx.dryRun) {
              result.unmonitored += 1;
              pushCapped(result.unmonitoredSamples, label);
            } else {
              try {
                await this.sonarr.setEpisodeMonitored({
                  baseUrl: sonarrBaseUrl,
                  apiKey: sonarrApiKey,
                  episode: ep,
                  monitored: false,
                });
                result.unmonitored += 1;
                pushCapped(result.unmonitoredSamples, label);
              } catch (error) {
                result.actionFailures += 1;
                await ctx.warn('sonarr: unmonitor failed', {
                  label,
                  error: (error as Error)?.message ?? String(error),
                });
              }
            }
          }
          continue;
        }

        if (metadata.has(key)) {
          result.inPlexUnverified += 1;
          continue;
        }

        const fileId = toInt(ep.episodeFileId);
        const file =
          ep.hasFile === true && fileId ? fileById.get(fileId) : undefined;
        if (!file) {
          result.missingNoFile += 1;
          continue;
        }

        const translated = translatePath(file.path, pathMap);
        const cover = showLocations.find((loc) =>
          segmentStartsWith(translated, loc.path),
        );
        if (!cover) {
          result.uncoveredPaths += 1;
          pushCapped(result.uncoveredSamples, `${label}  (${file.path})`);
          continue;
        }

        candidates.push({
          seriesTitle: title,
          season,
          episode: epNum,
          episodeId: ep.id,
          episodeFileId: file.id,
          episode_: ep,
          sonarrPath: file.path,
          sectionKey: cover.sectionKey,
          showRatingKeys,
        });
        const folder = dirnameOf(translated);
        scanTargets.set(`${cover.sectionKey}:${folder}`, {
          sectionKey: cover.sectionKey,
          folder,
        });
      }

      if (processed % 10 === 0 || processed === monitoredSeries.length) {
        setProgress({
          step: 'sonarr_scan',
          message: 'Scanning Sonarr series…',
          current: processed,
          total: monitoredSeries.length,
          unit: 'series',
        });
      }
    }
    result.repairCandidates = candidates.length;

    if (ctx.dryRun) {
      for (const c of candidates) {
        pushCapped(
          result.wouldRepairSamples,
          describeEpisode(c.seriesTitle, c.season, c.episode),
        );
      }
      return result;
    }

    if (scanTargets.size > 0) {
      setProgress({
        step: 'sonarr_repair',
        message: `Scanning ${scanTargets.size} Plex TV folder(s)…`,
      });
      for (const { sectionKey, folder } of scanTargets.values()) {
        try {
          await this.plexServer.refreshLibraryPath({
            baseUrl: plexBaseUrl,
            token: plexToken,
            sectionKey,
            path: folder,
          });
          result.scannedFolders += 1;
        } catch (error) {
          await ctx.warn('plex: refresh path failed', {
            sectionKey,
            folder,
            error: (error as Error)?.message ?? String(error),
          });
        }
      }
      await this.waitForScansToSettle(ctx, plexBaseUrl, plexToken);
    }

    const freshCache = new Map<
      string,
      PlexVerifiedEpisodeAvailability | null
    >();
    let repaired = 0;
    for (const c of candidates) {
      repaired += 1;
      const label = describeEpisode(c.seriesTitle, c.season, c.episode);
      const key = episodeKey(c.season, c.episode);

      const verified = new Set<string>();
      const metadata = new Set<string>();
      let ok = true;
      for (const rk of c.showRatingKeys) {
        const availability = await getAvailability(rk, freshCache);
        if (!availability) {
          ok = false;
          continue;
        }
        for (const k of availability.verifiedEpisodes) verified.add(k);
        for (const k of availability.metadataEpisodes) metadata.add(k);
      }

      if (!ok) {
        result.availabilityFailures += 1;
        pushCapped(result.stillMissingSamples, `${label} (re-verify failed)`);
        continue;
      }

      if (metadata.has(key)) {
        result.recoveredByScan += 1;
        pushCapped(result.recoveredSamples, label);
        if (verified.has(key) && c.episode_.monitored) {
          try {
            await this.sonarr.setEpisodeMonitored({
              baseUrl: sonarrBaseUrl,
              apiKey: sonarrApiKey,
              episode: c.episode_,
              monitored: false,
            });
            result.unmonitored += 1;
            pushCapped(result.unmonitoredSamples, label);
          } catch {
            result.actionFailures += 1;
          }
        }
        continue;
      }

      try {
        await this.sonarr.deleteEpisodeFile({
          baseUrl: sonarrBaseUrl,
          apiKey: sonarrApiKey,
          episodeFileId: c.episodeFileId,
        });
        result.deletedFiles += 1;
        pushCapped(result.deletedSamples, `${label}  (${c.sonarrPath})`);
      } catch (error) {
        result.actionFailures += 1;
        await ctx.warn('sonarr: delete episode file failed', {
          label,
          episodeFileId: c.episodeFileId,
          error: (error as Error)?.message ?? String(error),
        });
        continue;
      }

      try {
        const history = await this.sonarr.listEpisodeHistory({
          baseUrl: sonarrBaseUrl,
          apiKey: sonarrApiKey,
          episodeId: c.episodeId,
        });
        const grabbed = history
          .filter((h) => (h.eventType ?? '').toLowerCase() === 'grabbed')
          .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
        if (grabbed.length > 0) {
          await this.sonarr.markHistoryFailed({
            baseUrl: sonarrBaseUrl,
            apiKey: sonarrApiKey,
            historyId: grabbed[0].id,
          });
          result.blocklisted += 1;
        } else {
          result.blocklistUnavailable += 1;
          pushCapped(result.blocklistUnavailableSamples, label);
        }
      } catch (error) {
        result.blocklistUnavailable += 1;
        pushCapped(result.blocklistUnavailableSamples, label);
        await ctx.warn('sonarr: blocklist failed', {
          label,
          error: (error as Error)?.message ?? String(error),
        });
      }

      try {
        const ok2 = await this.sonarr.searchEpisodes({
          baseUrl: sonarrBaseUrl,
          apiKey: sonarrApiKey,
          episodeIds: [c.episodeId],
        });
        if (ok2) result.searchQueued += 1;
      } catch (error) {
        await ctx.warn('sonarr: episode search failed', {
          label,
          error: (error as Error)?.message ?? String(error),
        });
      }

      if (repaired % 5 === 0 || repaired === candidates.length) {
        setProgress({
          step: 'sonarr_repair',
          message: 'Repairing unfit files…',
          current: repaired,
          total: candidates.length,
          unit: 'episodes',
        });
      }
    }

    return result;
  }

  private async waitForScansToSettle(
    ctx: JobContext,
    plexBaseUrl: string,
    plexToken: string,
  ): Promise<void> {
    await sleep(SCAN_SETTLE_INITIAL_MS);
    const start = Date.now();
    while (Date.now() - start < SCAN_SETTLE_MAX_MS) {
      let scanning = false;
      try {
        const activities = await this.plexServer.listActivities({
          baseUrl: plexBaseUrl,
          token: plexToken,
        });
        scanning = activities.some((a) => {
          const type = (a.type ?? '').toLowerCase();
          const t = (a.title ?? '').toLowerCase();
          return type.includes('library.update') || t.includes('scan');
        });
      } catch {
        return;
      }
      if (!scanning) return;
      await sleep(SCAN_SETTLE_POLL_MS);
    }
    await ctx.info('plex: scan settle timed out; proceeding');
  }
}

// ---- Result shapes ---------------------------------------------------------

type RadarrResult = {
  configured: boolean;
  totalMovies: number;
  moviesProcessed: number;
  confirmedInPlex: number;
  unmonitored: number;
  inPlexUnverified: number;
  missingNoFile: number;
  unresolvedFiles: number;
  scannedFolders: number;
  recoveredByScan: number;
  repairCandidates: number;
  deletedFiles: number;
  blocklisted: number;
  blocklistUnavailable: number;
  searchQueued: number;
  uncoveredPaths: number;
  actionFailures: number;
  unmonitoredSamples: string[];
  wouldRepairSamples: string[];
  deletedSamples: string[];
  blocklistUnavailableSamples: string[];
  uncoveredSamples: string[];
  recoveredSamples: string[];
};

function disabledRadarrResult(): RadarrResult {
  return {
    configured: false,
    totalMovies: 0,
    moviesProcessed: 0,
    confirmedInPlex: 0,
    unmonitored: 0,
    inPlexUnverified: 0,
    missingNoFile: 0,
    unresolvedFiles: 0,
    scannedFolders: 0,
    recoveredByScan: 0,
    repairCandidates: 0,
    deletedFiles: 0,
    blocklisted: 0,
    blocklistUnavailable: 0,
    searchQueued: 0,
    uncoveredPaths: 0,
    actionFailures: 0,
    unmonitoredSamples: [],
    wouldRepairSamples: [],
    deletedSamples: [],
    blocklistUnavailableSamples: [],
    uncoveredSamples: [],
    recoveredSamples: [],
  };
}

type SonarrResult = {
  configured: boolean;
  totalSeries: number;
  seriesProcessed: number;
  episodesChecked: number;
  confirmedInPlex: number;
  unmonitored: number;
  inPlexUnverified: number;
  showsNotInPlex: number;
  missingNoFile: number;
  scannedFolders: number;
  recoveredByScan: number;
  repairCandidates: number;
  deletedFiles: number;
  blocklisted: number;
  blocklistUnavailable: number;
  searchQueued: number;
  uncoveredPaths: number;
  availabilityFailures: number;
  actionFailures: number;
  unmonitoredSamples: string[];
  wouldRepairSamples: string[];
  deletedSamples: string[];
  blocklistUnavailableSamples: string[];
  uncoveredSamples: string[];
  recoveredSamples: string[];
  stillMissingSamples: string[];
  showsNotInPlexSamples: string[];
};

function disabledSonarrResult(): SonarrResult {
  return {
    configured: false,
    totalSeries: 0,
    seriesProcessed: 0,
    episodesChecked: 0,
    confirmedInPlex: 0,
    unmonitored: 0,
    inPlexUnverified: 0,
    showsNotInPlex: 0,
    missingNoFile: 0,
    scannedFolders: 0,
    recoveredByScan: 0,
    repairCandidates: 0,
    deletedFiles: 0,
    blocklisted: 0,
    blocklistUnavailable: 0,
    searchQueued: 0,
    uncoveredPaths: 0,
    availabilityFailures: 0,
    actionFailures: 0,
    unmonitoredSamples: [],
    wouldRepairSamples: [],
    deletedSamples: [],
    blocklistUnavailableSamples: [],
    uncoveredSamples: [],
    recoveredSamples: [],
    stillMissingSamples: [],
    showsNotInPlexSamples: [],
  };
}

// ---- Report ----------------------------------------------------------------

function sampleFact(label: string, items: string[], unit: string) {
  return { label, value: { count: items.length, unit, items } };
}

function buildReport(params: {
  ctx: JobContext;
  raw: JsonObject;
  radarr: RadarrResult;
  sonarr: SonarrResult;
}): JobReportV1 {
  const { ctx, raw, radarr, sonarr } = params;
  const dry = ctx.dryRun;
  const radarrRepairValue = dry ? radarr.repairCandidates : radarr.deletedFiles;
  const sonarrRepairValue = dry ? sonarr.repairCandidates : sonarr.deletedFiles;

  const issues = [
    ...(radarr.uncoveredPaths || sonarr.uncoveredPaths
      ? [
          issue(
            'warn',
            `${radarr.uncoveredPaths + sonarr.uncoveredPaths} file(s) sit outside any Plex library location (reported, no action).`,
          ),
        ]
      : []),
    ...(radarr.blocklistUnavailable || sonarr.blocklistUnavailable
      ? [
          issue(
            'warn',
            `${radarr.blocklistUnavailable + sonarr.blocklistUnavailable} file(s) were deleted but could not be blocklisted (no grab history — e.g. wrong import).`,
          ),
        ]
      : []),
    ...(sonarr.showsNotInPlex
      ? [
          issue(
            'warn',
            `${sonarr.showsNotInPlex} monitored series were not found in Plex at all (skipped for safety).`,
          ),
        ]
      : []),
    ...(radarr.actionFailures || sonarr.actionFailures
      ? [
          issue(
            'warn',
            `${radarr.actionFailures + sonarr.actionFailures} *arr action(s) failed.`,
          ),
        ]
      : []),
  ];

  const tasks: JobReportTask[] = [];
  if (radarr.configured) {
    tasks.push({
      id: 'radarr',
      title: 'Radarr: repair movies',
      status: 'success',
      rows: [
        metricRow({
          label: 'Monitored movies',
          end: radarr.totalMovies,
          unit: 'movies',
        }),
        metricRow({
          label: 'Confirmed in Plex',
          end: radarr.confirmedInPlex,
          unit: 'movies',
        }),
        metricRow({
          label: dry ? 'Would unmonitor' : 'Unmonitored',
          end: radarr.unmonitored,
          unit: 'movies',
        }),
        metricRow({
          label: 'Repair candidates (missing from Plex, covered)',
          end: radarr.repairCandidates,
          unit: 'movies',
        }),
        metricRow({
          label: 'Recovered by scan (kept)',
          end: radarr.recoveredByScan,
          unit: 'movies',
        }),
        metricRow({
          label: dry ? 'Would delete' : 'Deleted files',
          end: radarrRepairValue,
          unit: 'movies',
        }),
        metricRow({
          label: 'Blocklisted releases',
          end: radarr.blocklisted,
          unit: 'releases',
        }),
        metricRow({
          label: 'Blocklist unavailable',
          end: radarr.blocklistUnavailable,
          unit: 'movies',
        }),
        metricRow({
          label: dry ? 'Would re-search' : 'Searches queued',
          end: radarr.searchQueued,
          unit: 'movies',
        }),
        metricRow({
          label: 'Uncovered paths (reported)',
          end: radarr.uncoveredPaths,
          unit: 'movies',
        }),
      ],
      facts: [
        dry
          ? sampleFact(
              'Would delete + blocklist',
              radarr.wouldRepairSamples,
              'movies',
            )
          : sampleFact('Deleted', radarr.deletedSamples, 'movies'),
        sampleFact('Recovered by scan', radarr.recoveredSamples, 'movies'),
        sampleFact(
          'Blocklist unavailable',
          radarr.blocklistUnavailableSamples,
          'movies',
        ),
        sampleFact('Uncovered paths', radarr.uncoveredSamples, 'movies'),
      ],
    });
  }
  if (sonarr.configured) {
    tasks.push({
      id: 'sonarr',
      title: 'Sonarr: repair episodes',
      status: 'success',
      rows: [
        metricRow({
          label: 'Monitored series',
          end: sonarr.totalSeries,
          unit: 'series',
        }),
        metricRow({
          label: 'Episodes checked',
          end: sonarr.episodesChecked,
          unit: 'episodes',
        }),
        metricRow({
          label: 'Confirmed in Plex',
          end: sonarr.confirmedInPlex,
          unit: 'episodes',
        }),
        metricRow({
          label: dry ? 'Would unmonitor' : 'Unmonitored',
          end: sonarr.unmonitored,
          unit: 'episodes',
        }),
        metricRow({
          label: 'Repair candidates (missing from Plex, covered)',
          end: sonarr.repairCandidates,
          unit: 'episodes',
        }),
        metricRow({
          label: 'Recovered by scan (kept)',
          end: sonarr.recoveredByScan,
          unit: 'episodes',
        }),
        metricRow({
          label: dry ? 'Would delete' : 'Deleted files',
          end: sonarrRepairValue,
          unit: 'episodes',
        }),
        metricRow({
          label: 'Blocklisted releases',
          end: sonarr.blocklisted,
          unit: 'releases',
        }),
        metricRow({
          label: 'Blocklist unavailable',
          end: sonarr.blocklistUnavailable,
          unit: 'episodes',
        }),
        metricRow({
          label: dry ? 'Would re-search' : 'Searches queued',
          end: sonarr.searchQueued,
          unit: 'episodes',
        }),
        metricRow({
          label: 'Uncovered paths (reported)',
          end: sonarr.uncoveredPaths,
          unit: 'episodes',
        }),
        metricRow({
          label: 'Shows not in Plex (skipped)',
          end: sonarr.showsNotInPlex,
          unit: 'series',
        }),
      ],
      facts: [
        dry
          ? sampleFact(
              'Would delete + blocklist',
              sonarr.wouldRepairSamples,
              'episodes',
            )
          : sampleFact('Deleted', sonarr.deletedSamples, 'episodes'),
        sampleFact('Recovered by scan', sonarr.recoveredSamples, 'episodes'),
        sampleFact(
          'Blocklist unavailable',
          sonarr.blocklistUnavailableSamples,
          'episodes',
        ),
        sampleFact('Uncovered paths', sonarr.uncoveredSamples, 'episodes'),
        sampleFact('Shows not in Plex', sonarr.showsNotInPlexSamples, 'series'),
      ],
    });
  }

  const totalDeleted = radarrRepairValue + sonarrRepairValue;

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: ctx.jobId,
    dryRun: ctx.dryRun,
    trigger: ctx.trigger,
    headline: dry
      ? 'Repair Monitored dry-run complete.'
      : 'Repair Monitored run complete.',
    sections: [
      {
        id: 'summary',
        title: 'Repair summary',
        rows: [
          metricRow({
            label: dry ? 'Would unmonitor' : 'Unmonitored',
            end: radarr.unmonitored + sonarr.unmonitored,
            unit: 'items',
          }),
          metricRow({
            label: dry ? 'Would delete + blocklist' : 'Deleted files',
            end: totalDeleted,
            unit: 'items',
          }),
          metricRow({
            label: dry ? 'Would re-search' : 'Searches queued',
            end: radarr.searchQueued + sonarr.searchQueued,
            unit: 'items',
          }),
        ],
      },
    ],
    tasks,
    issues,
    raw,
  };
}
