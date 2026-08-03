import { Injectable } from '@nestjs/common';
import {
  PlexServerService,
  type PlexPartPlayableProbeResult,
  type PlexVerifiedEpisodeAvailability,
} from '../plex/plex-server.service';
import { RadarrService, type RadarrMovie } from '../radarr/radarr.service';
import { SeerrService } from '../seerr/seerr.service';
import {
  SonarrService,
  type SonarrEpisode,
  type SonarrSeries,
} from '../sonarr/sonarr.service';
import { SettingsService } from '../settings/settings.service';
import { TmdbService } from '../tmdb/tmdb.service';
import {
  decodeHtmlEntities,
  normalizeTitleForMatching,
} from '../lib/title-normalize';
import { truncateErrorMessage } from '../log.utils';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import type { JobReportTaskStatus, JobReportV1 } from './job-report-v1';
import { issue, metricRow } from './job-report-v1';

type ManualCategory = 'movies' | 'shows';

type RottenTomatoesUpcomingSettings = {
  routeViaSeerr: boolean;
  includeMovies: boolean;
  includeShows: boolean;
  movieLimit: number;
  showLimit: number;
};

type ScrapedMovie = {
  title: string;
  year: string;
  href: string;
  startDate: string;
  sourceUrl: string;
};

type ScrapedShow = {
  title: string;
  year: string | null;
  href: string;
  slugKey: string;
  startDate: string;
  criticsScore: number | null;
  audienceScore: number | null;
  sourceUrl: string;
};

type MovieSourceScrapeStats = {
  url: string;
  discoveredEntries: number;
  parseableEntries: number;
  skippedNoYear: number;
  failed: boolean;
  error: string | null;
};

type ShowSourceScrapeStats = {
  url: string;
  discoveredEntries: number;
  parseableEntries: number;
  scoreFilteredOut: number;
  failed: boolean;
  error: string | null;
};

type DestinationStats = {
  attempted: number;
  requested: number;
  added: number;
  exists: number;
  failed: number;
  skipped: number;
};

type DestinationTitleBuckets = {
  attemptedTitles: string[];
  sentTitles: string[];
  existsTitles: string[];
  failedTitles: string[];
  skippedTitles: string[];
};

type LookupSelection = {
  movie: RadarrMovie;
  usedTitleOnlyFallback: boolean;
};

type ResolvedShowIds = {
  title: string;
  tmdbId: number;
  tvdbId: number;
  year: string | null;
};

type ShowReconciliationStats = {
  reconciledSeries: number;
  episodesMonitored: number;
  episodesLeftUnmonitored: number;
  seasonsMonitored: number;
  seasonsUnmonitored: number;
  seriesMonitored: number;
  seriesUnmonitored: number;
  failures: number;
};

type MovieBranchResult = {
  sourceStats: MovieSourceScrapeStats[];
  dedupedMovies: ScrapedMovie[];
  destinationStats: DestinationStats;
  destinationTitles: DestinationTitleBuckets;
  discoveryStatus: JobReportTaskStatus;
  routeStatus: JobReportTaskStatus;
  safeMatchSkipCount: number;
};

type ShowBranchResult = {
  sourceStats: ShowSourceScrapeStats[];
  dedupedShows: ScrapedShow[];
  destinationStats: DestinationStats;
  destinationTitles: DestinationTitleBuckets;
  discoveryStatus: JobReportTaskStatus;
  routeStatus: JobReportTaskStatus;
  unresolvedIds: number;
  scoreFilteredOut: number;
  reconciliation: ShowReconciliationStats;
};

type RadarrMovieIndex = {
  titleYearKeys: Set<string>;
  tmdbIds: Set<number>;
};

type RadarrConfig = {
  baseUrl: string;
  apiKey: string;
};

type SonarrConfig = {
  baseUrl: string;
  apiKey: string;
};

type SeerrConfig = {
  baseUrl: string;
  apiKey: string;
};

type PlexConfig = {
  baseUrl: string;
  token: string;
};

type ShowBranchCaches = {
  sonarrIndexByTvdb: Map<number, SonarrSeries> | null;
  plexTvdbRatingKeys: Map<number, string[]> | null | undefined;
  showEpisodeAvailability: Map<string, PlexVerifiedEpisodeAvailability>;
  partProbeCache: Map<string, PlexPartPlayableProbeResult>;
  warnedMissingPlexConfig: boolean;
};

const ROTTEN_TOMATOES_UPCOMING_JOB_HEADLINE =
  'Rotten Tomatoes Upcoming Movies + TV Shows';
const ROTTEN_TOMATOES_MOVIE_SOURCE_URLS = [
  'https://www.rottentomatoes.com/browse/movies_in_theaters/sort:newest',
  'https://www.rottentomatoes.com/browse/movies_at_home/affiliates:fandango-at-home~sort:newest',
  'https://www.rottentomatoes.com/browse/movies_at_home/affiliates:apple-tv-plus~sort:newest',
  'https://www.rottentomatoes.com/browse/movies_at_home/affiliates:netflix~sort:newest',
  'https://www.rottentomatoes.com/browse/movies_at_home/affiliates:prime-video~sort:newest',
  'https://www.rottentomatoes.com/browse/movies_at_home/affiliates:disney-plus~sort:newest',
  'https://www.rottentomatoes.com/browse/movies_at_home/affiliates:max~sort:newest',
  'https://www.rottentomatoes.com/browse/movies_at_home/affiliates:peacock~sort:newest',
  'https://www.rottentomatoes.com/browse/movies_at_home/affiliates:hulu~sort:newest',
  'https://www.rottentomatoes.com/browse/movies_at_home/affiliates:paramount-plus~sort:newest',
  'https://www.rottentomatoes.com/browse/movies_at_home/affiliates:amc-plus~sort:newest',
  'https://www.rottentomatoes.com/browse/movies_at_home/affiliates:acorn-tv~sort:newest',
] as const;
const ROTTEN_TOMATOES_SHOW_SOURCE_URLS = [
  'https://www.rottentomatoes.com/browse/tv_series_browse/sort:newest?hl=en_US',
  'https://www.rottentomatoes.com/browse/tv_series_browse/affiliates:netflix~sort:newest?hl=en_US',
  'https://www.rottentomatoes.com/browse/tv_series_browse/affiliates:hulu~sort:newest?hl=en_US',
  'https://www.rottentomatoes.com/browse/tv_series_browse/affiliates:apple-tv~sort:newest?hl=en_US',
  'https://www.rottentomatoes.com/browse/tv_series_browse/affiliates:amazon_prime~sort:newest?hl=en_US',
  'https://www.rottentomatoes.com/browse/tv_series_browse/affiliates:disney-plus~sort:newest?hl=en_US',
  'https://www.rottentomatoes.com/browse/tv_series_browse/affiliates:max~sort:newest?hl=en_US',
  'https://www.rottentomatoes.com/browse/tv_series_browse/affiliates:peacock~sort:newest?hl=en_US',
  'https://www.rottentomatoes.com/browse/tv_series_browse/affiliates:paramount-plus~sort:newest?hl=en_US',
  'https://www.rottentomatoes.com/browse/tv_series_browse/affiliates:amc-plus~sort:newest?hl=en_US',
  'https://www.rottentomatoes.com/browse/tv_series_browse/affiliates:acorn-tv~sort:newest?hl=en_US',
] as const;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REPORT_TITLE_ITEMS = 100;
const CLOSE_YEAR_MATCH_DELTA = 1;
const DEFAULT_MOVIE_LIMIT = 20;
const DEFAULT_SHOW_LIMIT = 10;
const MIN_SHOW_LIMIT = 1;
const MAX_SHOW_LIMIT = 100;
const MINIMUM_RT_SCORE = 60;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

function pickString(obj: Record<string, unknown>, path: string): string {
  const value = pick(obj, path);
  return typeof value === 'string' ? value.trim() : '';
}

function pickBool(obj: Record<string, unknown>, path: string): boolean | null {
  const value = pick(obj, path);
  return typeof value === 'boolean' ? value : null;
}

function pickNumber(obj: Record<string, unknown>, path: string): number | null {
  const value = pick(obj, path);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampInt(
  value: number | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === null || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizeTitleList(titles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const rawTitle of titles) {
    const title = normalizeTitleForMatching(String(rawTitle ?? '').trim());
    if (!title) continue;
    const key = normalizeTitleKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length >= MAX_REPORT_TITLE_ITEMS) break;
  }

  return out;
}

function buildTitleYearKey(title: string, year: string | number): string {
  return `${normalizeTitleKey(title)}|${String(year ?? '').trim()}`;
}

function buildTitleVariantKey(title: string, variant: string): string {
  return `${normalizeTitleKey(title)}|${String(variant ?? '')
    .trim()
    .toLowerCase()}`;
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDataQaText(cardHtml: string, dataQa: string): string {
  const safeDataQa = dataQa.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cardHtml.match(
    new RegExp(
      `<([a-z0-9-]+)\\b[^>]*data-qa="${safeDataQa}"[^>]*>([\\s\\S]*?)<\\/\\1>`,
      'i',
    ),
  );

  return normalizeTitleForMatching(
    stripTags(decodeHtmlEntities(match?.[2] ?? '')),
  );
}

function extractSlotPercentage(
  cardHtml: string,
  slotName: string,
): number | null {
  const safeSlot = slotName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cardHtml.match(
    new RegExp(
      `<([a-z0-9-]+)\\b[^>]*slot="${safeSlot}"[^>]*>([\\s\\S]*?)<\\/\\1>`,
      'i',
    ),
  );
  const text = stripTags(decodeHtmlEntities(match?.[2] ?? ''))
    .replace(/%/g, '')
    .trim();
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function parseMaybeYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    return normalized > 0 ? normalized : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function normalizeHrefKey(href: string): string {
  const raw = decodeHtmlEntities(String(href ?? '').trim());
  if (!raw) return '';
  try {
    const url = new URL(raw, 'https://www.rottentomatoes.com');
    return `${url.pathname}${url.search}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function episodeKey(season: number, episode: number): string {
  return `${season}:${episode}`;
}

export function normalizeTitleKey(title: string): string {
  return normalizeTitleForMatching(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractYearFromText(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const source = String(value ?? '').trim();
    if (!source) continue;
    const match = source.match(/((?:19|20)\d{2})/);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function parseRottenTomatoesMoviesFromHtml(params: {
  html: string;
  sourceUrl: string;
}): {
  movies: ScrapedMovie[];
  discoveredEntries: number;
  skippedNoYear: number;
} {
  const html = String(params.html ?? '');
  const sourceUrl = String(params.sourceUrl ?? '').trim();
  const movies: ScrapedMovie[] = [];
  let discoveredEntries = 0;
  let skippedNoYear = 0;

  const cardRegex =
    /<a\b[^>]*data-qa="discovery-media-list-item-caption"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(cardRegex)) {
    const href = decodeHtmlEntities(match[1] ?? '').trim();
    const cardHtml = match[2] ?? '';
    const title = extractDataQaText(
      cardHtml,
      'discovery-media-list-item-title',
    );
    if (!title) continue;

    discoveredEntries += 1;
    const startDate = extractDataQaText(
      cardHtml,
      'discovery-media-list-item-start-date',
    );
    const year = extractYearFromText(href, startDate);
    if (!year) {
      skippedNoYear += 1;
      continue;
    }

    movies.push({
      title,
      year,
      href,
      startDate,
      sourceUrl,
    });
  }

  return { movies, discoveredEntries, skippedNoYear };
}

export function parseRottenTomatoesShowsFromHtml(params: {
  html: string;
  sourceUrl: string;
}): {
  shows: ScrapedShow[];
  discoveredEntries: number;
} {
  const html = String(params.html ?? '');
  const sourceUrl = String(params.sourceUrl ?? '').trim();
  const shows: ScrapedShow[] = [];
  let discoveredEntries = 0;

  const cardRegex =
    /<a\b[^>]*data-qa="discovery-media-list-item-caption"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(cardRegex)) {
    const href = decodeHtmlEntities(match[1] ?? '').trim();
    const cardHtml = match[2] ?? '';
    const title = extractDataQaText(
      cardHtml,
      'discovery-media-list-item-title',
    );
    if (!title) continue;

    discoveredEntries += 1;
    const startDate = extractDataQaText(
      cardHtml,
      'discovery-media-list-item-start-date',
    );
    const year = extractYearFromText(href, startDate);
    const slugKey = normalizeHrefKey(href);

    shows.push({
      title,
      year,
      href,
      slugKey,
      startDate,
      criticsScore: extractSlotPercentage(cardHtml, 'criticsScore'),
      audienceScore: extractSlotPercentage(cardHtml, 'audienceScore'),
      sourceUrl,
    });
  }

  return { shows, discoveredEntries };
}

export function dedupeScrapedMovies(movies: ScrapedMovie[]): ScrapedMovie[] {
  const seen = new Set<string>();
  const out: ScrapedMovie[] = [];

  for (const movie of movies) {
    const key = buildTitleYearKey(movie.title, movie.year);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(movie);
  }

  return out;
}

export function dedupeScrapedShows(shows: ScrapedShow[]): ScrapedShow[] {
  const seen = new Set<string>();
  const out: ScrapedShow[] = [];

  for (const show of shows) {
    const key = show.year
      ? buildTitleYearKey(show.title, show.year)
      : buildTitleVariantKey(
          show.title,
          show.slugKey || show.href || show.title,
        );
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(show);
  }

  return out;
}

export function buildRadarrMovieIndex(movies: RadarrMovie[]): RadarrMovieIndex {
  const titleYearKeys = new Set<string>();
  const tmdbIds = new Set<number>();

  for (const movie of movies) {
    const title =
      typeof movie?.title === 'string'
        ? normalizeTitleForMatching(movie.title)
        : '';
    const year = parseMaybeYear(movie?.year);
    const tmdbId = parsePositiveInt(movie?.tmdbId);

    if (title && year) {
      titleYearKeys.add(buildTitleYearKey(title, year));
    }
    if (tmdbId) {
      tmdbIds.add(tmdbId);
    }
  }

  return { titleYearKeys, tmdbIds };
}

function buildSonarrSeriesIndex(
  series: SonarrSeries[],
): Map<number, SonarrSeries> {
  const index = new Map<number, SonarrSeries>();
  for (const row of series) {
    const tvdbId = parsePositiveInt(row?.tvdbId);
    if (!tvdbId) continue;
    index.set(tvdbId, row);
  }
  return index;
}

export function selectLookupMovie(
  results: RadarrMovie[],
  requestedTitle: string,
  requestedYear: string,
): RadarrMovie | null {
  const requestedKey = normalizeTitleKey(requestedTitle);
  const requestedYearInt = parseMaybeYear(requestedYear);
  if (!requestedKey) return null;

  let best: { movie: RadarrMovie; score: number } | null = null;

  for (const movie of results) {
    const title =
      typeof movie?.title === 'string'
        ? normalizeTitleForMatching(movie.title)
        : '';
    if (!title) continue;
    if (normalizeTitleKey(title) !== requestedKey) continue;

    const year = parseMaybeYear(movie?.year);
    let score: number | null = null;
    if (requestedYearInt !== null && year === requestedYearInt) {
      score = 0;
    } else if (year === null) {
      score = 1;
    } else if (
      requestedYearInt !== null &&
      Math.abs(year - requestedYearInt) <= CLOSE_YEAR_MATCH_DELTA
    ) {
      score = 2;
    }

    if (score === null) continue;
    if (!best || score < best.score) {
      best = { movie, score };
    }
  }

  return best?.movie ?? null;
}

export function selectTmdbTvMatch(
  results: Array<{ id: number; name?: string; first_air_date?: string }>,
  requestedTitle: string,
  requestedYear?: string | null,
): { id: number; name: string; first_air_date?: string } | null {
  const requestedKey = normalizeTitleKey(requestedTitle);
  const requestedYearInt = parseMaybeYear(requestedYear ?? null);
  if (!requestedKey) return null;

  const exactMatches = results.filter((result) => {
    const title =
      typeof result?.name === 'string'
        ? normalizeTitleForMatching(result.name)
        : '';
    return title ? normalizeTitleKey(title) === requestedKey : false;
  });

  if (!exactMatches.length) return null;

  if (requestedYearInt === null) {
    return exactMatches.length === 1
      ? {
          id: exactMatches[0].id,
          name: exactMatches[0].name ?? requestedTitle,
          first_air_date: exactMatches[0].first_air_date,
        }
      : null;
  }

  let best: {
    result: { id: number; name?: string; first_air_date?: string };
    score: number;
  } | null = null;

  for (const result of exactMatches) {
    const year = extractYearFromText(result.first_air_date);
    const yearInt = parseMaybeYear(year);
    let score: number | null = null;
    if (yearInt === requestedYearInt) {
      score = 0;
    } else if (yearInt === null) {
      score = 1;
    } else if (Math.abs(yearInt - requestedYearInt) <= CLOSE_YEAR_MATCH_DELTA) {
      score = 2;
    }

    if (score === null) continue;
    if (!best || score < best.score) {
      best = { result, score };
    }
  }

  return best
    ? {
        id: best.result.id,
        name: best.result.name ?? requestedTitle,
        first_air_date: best.result.first_air_date,
      }
    : null;
}

function movieSourceStatsFacts(
  stats: MovieSourceScrapeStats[],
): Array<{ label: string; value: JsonObject }> {
  return stats.map((source) => ({
    label: source.url,
    value: {
      discoveredEntries: source.discoveredEntries,
      parseableEntries: source.parseableEntries,
      skippedNoYear: source.skippedNoYear,
      failed: source.failed,
      ...(source.error ? { error: source.error } : {}),
    },
  }));
}

function showSourceStatsFacts(
  stats: ShowSourceScrapeStats[],
): Array<{ label: string; value: JsonObject }> {
  return stats.map((source) => ({
    label: source.url,
    value: {
      discoveredEntries: source.discoveredEntries,
      parseableEntries: source.parseableEntries,
      scoreFilteredOut: source.scoreFilteredOut,
      failed: source.failed,
      ...(source.error ? { error: source.error } : {}),
    },
  }));
}

function createEmptyDestinationStats(): DestinationStats {
  return {
    attempted: 0,
    requested: 0,
    added: 0,
    exists: 0,
    failed: 0,
    skipped: 0,
  };
}

function createEmptyDestinationTitles(): DestinationTitleBuckets {
  return {
    attemptedTitles: [],
    sentTitles: [],
    existsTitles: [],
    failedTitles: [],
    skippedTitles: [],
  };
}

function createEmptyShowReconciliation(): ShowReconciliationStats {
  return {
    reconciledSeries: 0,
    episodesMonitored: 0,
    episodesLeftUnmonitored: 0,
    seasonsMonitored: 0,
    seasonsUnmonitored: 0,
    seriesMonitored: 0,
    seriesUnmonitored: 0,
    failures: 0,
  };
}

function addShowReconciliation(
  target: ShowReconciliationStats,
  next: ShowReconciliationStats,
) {
  target.reconciledSeries += next.reconciledSeries;
  target.episodesMonitored += next.episodesMonitored;
  target.episodesLeftUnmonitored += next.episodesLeftUnmonitored;
  target.seasonsMonitored += next.seasonsMonitored;
  target.seasonsUnmonitored += next.seasonsUnmonitored;
  target.seriesMonitored += next.seriesMonitored;
  target.seriesUnmonitored += next.seriesUnmonitored;
  target.failures += next.failures;
}

function normalizeRottenTomatoesUpcomingSettings(
  settings: Record<string, unknown>,
): RottenTomatoesUpcomingSettings {
  return {
    routeViaSeerr:
      pickBool(settings, 'jobs.rottenTomatoesUpcomingMovies.routeViaSeerr') ??
      false,
    includeMovies:
      pickBool(settings, 'jobs.rottenTomatoesUpcomingMovies.includeMovies') ??
      false,
    includeShows:
      pickBool(settings, 'jobs.rottenTomatoesUpcomingMovies.includeShows') ??
      false,
    movieLimit: clampInt(
      pickNumber(settings, 'jobs.rottenTomatoesUpcomingMovies.movieLimit'),
      MIN_SHOW_LIMIT,
      MAX_SHOW_LIMIT,
      DEFAULT_MOVIE_LIMIT,
    ),
    showLimit: clampInt(
      pickNumber(settings, 'jobs.rottenTomatoesUpcomingMovies.showLimit'),
      MIN_SHOW_LIMIT,
      MAX_SHOW_LIMIT,
      DEFAULT_SHOW_LIMIT,
    ),
  };
}

@Injectable()
export class RottenTomatoesUpcomingMoviesJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
    private readonly seerr: SeerrService,
    private readonly tmdb: TmdbService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const setProgress = async (
      step: string,
      message: string,
      context?: JsonObject,
    ) => {
      await ctx.patchSummary({
        phase: step === 'failed' ? 'failed' : 'running',
        progress: {
          step,
          message,
          updatedAt: new Date().toISOString(),
          ...(context ?? {}),
        },
      });
    };

    await ctx.info('rottenTomatoesUpcomingMovies: start', {
      trigger: ctx.trigger,
      dryRun: ctx.dryRun,
      input: ctx.input ?? null,
    });

    await setProgress('load_settings', 'Loading settings…');
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);
    const normalizedSettings =
      normalizeRottenTomatoesUpcomingSettings(settings);
    const manualCategory = this.readManualCategory(ctx.input ?? null);
    const manualRouteViaSeerr = this.readManualRouteViaSeerr(ctx.input ?? null);
    const manualTopCount = this.readManualTopCount(ctx.input ?? null);
    if (
      ctx.input &&
      Object.prototype.hasOwnProperty.call(ctx.input, 'category') &&
      manualCategory === null
    ) {
      const message =
        'Rotten Tomatoes Upcoming category must be either "movies" or "shows".';
      await setProgress('failed', 'Invalid manual category.', {
        manualCategory: ctx.input['category'] ?? null,
      });
      throw new Error(message);
    }

    const effectiveIncludeMovies =
      manualCategory === 'movies'
        ? true
        : manualCategory === 'shows'
          ? false
          : normalizedSettings.includeMovies;
    const effectiveIncludeShows =
      manualCategory === 'shows'
        ? true
        : manualCategory === 'movies'
          ? false
          : normalizedSettings.includeShows;
    const effectiveRouteViaSeerr =
      manualRouteViaSeerr ?? normalizedSettings.routeViaSeerr;
    const effectiveMovieLimit =
      manualCategory === 'movies' && manualTopCount !== null
        ? manualTopCount
        : normalizedSettings.movieLimit;
    const effectiveShowLimit =
      manualCategory === 'shows' && manualTopCount !== null
        ? manualTopCount
        : normalizedSettings.showLimit;

    const reportIssues: JobReportV1['issues'] = [];
    if (!effectiveIncludeMovies && !effectiveIncludeShows) {
      reportIssues.push(
        issue(
          'warn',
          'Movies and TV Shows are both disabled for Rotten Tomatoes Upcoming, so this run had nothing to do.',
        ),
      );
    }

    const movieBranch = effectiveIncludeMovies
      ? await this.runMovieBranch({
          ctx,
          settings,
          secrets,
          routeViaSeerr: effectiveRouteViaSeerr,
          movieLimit: effectiveMovieLimit,
          setProgress,
          reportIssues,
        })
      : {
          sourceStats: [],
          dedupedMovies: [],
          destinationStats: createEmptyDestinationStats(),
          destinationTitles: createEmptyDestinationTitles(),
          discoveryStatus: 'skipped' as JobReportTaskStatus,
          routeStatus: 'skipped' as JobReportTaskStatus,
          safeMatchSkipCount: 0,
        };

    const showBranch = effectiveIncludeShows
      ? await this.runShowBranch({
          ctx,
          settings,
          secrets,
          routeViaSeerr: effectiveRouteViaSeerr,
          showLimit: effectiveShowLimit,
          setProgress,
          reportIssues,
        })
      : {
          sourceStats: [],
          dedupedShows: [],
          destinationStats: createEmptyDestinationStats(),
          destinationTitles: createEmptyDestinationTitles(),
          discoveryStatus: 'skipped' as JobReportTaskStatus,
          routeStatus: 'skipped' as JobReportTaskStatus,
          unresolvedIds: 0,
          scoreFilteredOut: 0,
          reconciliation: createEmptyShowReconciliation(),
        };

    if (movieBranch.destinationStats.failed > 0) {
      reportIssues.push(
        issue(
          'warn',
          `Movie destination reported ${movieBranch.destinationStats.failed} failed operation(s); the run continued.`,
        ),
      );
    }
    if (movieBranch.safeMatchSkipCount > 0 && !ctx.dryRun) {
      reportIssues.push(
        issue(
          'warn',
          `Some Rotten Tomatoes movies were skipped because Radarr lookup did not find a safe match (${movieBranch.safeMatchSkipCount}).`,
        ),
      );
    }
    if (showBranch.destinationStats.failed > 0) {
      reportIssues.push(
        issue(
          'warn',
          `TV destination reported ${showBranch.destinationStats.failed} failed operation(s); the run continued.`,
        ),
      );
    }
    if (showBranch.unresolvedIds > 0 && !ctx.dryRun) {
      reportIssues.push(
        issue(
          'warn',
          `Some Rotten Tomatoes TV shows were skipped because TMDB/TVDB ids could not be resolved safely (${showBranch.unresolvedIds}).`,
        ),
      );
    }
    if (showBranch.reconciliation.failures > 0) {
      reportIssues.push(
        issue(
          'warn',
          `Existing Sonarr show reconciliation reported ${showBranch.reconciliation.failures} failed operation(s); the run continued.`,
        ),
      );
    }

    const enabledBranchCount =
      (effectiveIncludeMovies ? 1 : 0) + (effectiveIncludeShows ? 1 : 0);
    const successfulDiscoveryCount =
      (movieBranch.discoveryStatus === 'success' ? 1 : 0) +
      (showBranch.discoveryStatus === 'success' ? 1 : 0);
    const overallFailed =
      enabledBranchCount > 0 && successfulDiscoveryCount === 0;

    const report = this.buildReport({
      ctx,
      manualCategory,
      effectiveIncludeMovies,
      effectiveIncludeShows,
      effectiveMovieLimit,
      effectiveShowLimit,
      routeViaSeerr: effectiveRouteViaSeerr,
      movieBranch,
      showBranch,
      reportIssues,
    });

    if (overallFailed) {
      await setProgress(
        'failed',
        'No usable Rotten Tomatoes candidates were found for the selected branches.',
        {
          manualCategory,
          effectiveIncludeMovies,
          effectiveIncludeShows,
          effectiveMovieLimit,
          effectiveShowLimit,
          routeViaSeerr: effectiveRouteViaSeerr,
        },
      );
      await ctx.info('rottenTomatoesUpcomingMovies: failed', {
        manualCategory,
        effectiveIncludeMovies,
        effectiveIncludeShows,
        effectiveMovieLimit,
        effectiveShowLimit,
        routeViaSeerr: effectiveRouteViaSeerr,
      });
      return {
        summary: report as unknown as JsonObject,
      };
    }

    await setProgress('done', 'Done.', {
      manualCategory,
      effectiveIncludeMovies,
      effectiveIncludeShows,
      effectiveMovieLimit,
      effectiveShowLimit,
      routeViaSeerr: effectiveRouteViaSeerr,
      movieCandidates: movieBranch.dedupedMovies.length,
      showCandidates: showBranch.dedupedShows.length,
    });
    await ctx.info('rottenTomatoesUpcomingMovies: done', {
      manualCategory,
      effectiveIncludeMovies,
      effectiveIncludeShows,
      effectiveMovieLimit,
      effectiveShowLimit,
      routeViaSeerr: effectiveRouteViaSeerr,
      movieDestinationStats: movieBranch.destinationStats,
      showDestinationStats: showBranch.destinationStats,
      showReconciliation: showBranch.reconciliation,
    });

    return {
      summary: report as unknown as JsonObject,
    };
  }

  private readManualCategory(input: JsonObject | null): ManualCategory | null {
    const raw = input?.['category'];
    if (typeof raw !== 'string') return null;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'movies') return 'movies';
    if (normalized === 'shows') return 'shows';
    return null;
  }

  private readManualRouteViaSeerr(input: JsonObject | null): boolean | null {
    const raw = input?.['routeViaSeerr'];
    return typeof raw === 'boolean' ? raw : null;
  }

  private readManualTopCount(input: JsonObject | null): number | null {
    const raw = input?.['topCount'];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return clampInt(raw, MIN_SHOW_LIMIT, MAX_SHOW_LIMIT, DEFAULT_SHOW_LIMIT);
    }
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = Number.parseFloat(raw.trim());
      if (Number.isFinite(parsed)) {
        return clampInt(
          parsed,
          MIN_SHOW_LIMIT,
          MAX_SHOW_LIMIT,
          DEFAULT_SHOW_LIMIT,
        );
      }
    }
    return null;
  }

  private async runMovieBranch(params: {
    ctx: JobContext;
    settings: Record<string, unknown>;
    secrets: Record<string, unknown>;
    routeViaSeerr: boolean;
    movieLimit: number;
    setProgress: (
      step: string,
      message: string,
      context?: JsonObject,
    ) => Promise<void>;
    reportIssues: JobReportV1['issues'];
  }): Promise<MovieBranchResult> {
    const {
      ctx,
      settings,
      secrets,
      routeViaSeerr,
      movieLimit,
      setProgress,
      reportIssues,
    } = params;

    await setProgress(
      'scrape_movies',
      'Scraping Rotten Tomatoes movie sources…',
      {
        totalSources: ROTTEN_TOMATOES_MOVIE_SOURCE_URLS.length,
        movieLimit,
      },
    );

    const scrapedMovies: ScrapedMovie[] = [];
    const sourceStats: MovieSourceScrapeStats[] = [];
    let sourceFailureCount = 0;

    for (const sourceUrl of ROTTEN_TOMATOES_MOVIE_SOURCE_URLS) {
      try {
        const html = await this.fetchSourceHtml(sourceUrl);
        const parsed = parseRottenTomatoesMoviesFromHtml({
          html,
          sourceUrl,
        });
        scrapedMovies.push(...parsed.movies);
        sourceStats.push({
          url: sourceUrl,
          discoveredEntries: parsed.discoveredEntries,
          parseableEntries: parsed.movies.length,
          skippedNoYear: parsed.skippedNoYear,
          failed: false,
          error: null,
        });
        if (dedupeScrapedMovies(scrapedMovies).length >= movieLimit) {
          break;
        }
      } catch (err) {
        const error = truncateErrorMessage(err);
        sourceFailureCount += 1;
        sourceStats.push({
          url: sourceUrl,
          discoveredEntries: 0,
          parseableEntries: 0,
          skippedNoYear: 0,
          failed: true,
          error,
        });
        reportIssues.push(
          issue(
            'warn',
            `Rotten Tomatoes movie source failed and was skipped: ${sourceUrl} (${error})`,
          ),
        );
        await ctx.warn(
          'rottenTomatoesUpcomingMovies: movie source scrape failed (continuing)',
          {
            sourceUrl,
            error,
          },
        );
      }
    }

    const dedupedMovies = dedupeScrapedMovies(scrapedMovies).slice(
      0,
      movieLimit,
    );
    if (
      sourceFailureCount === ROTTEN_TOMATOES_MOVIE_SOURCE_URLS.length ||
      dedupedMovies.length === 0
    ) {
      reportIssues.push(
        issue(
          'error',
          'Rotten Tomatoes movie discovery failed: all movie sources failed or no usable movie cards were parsed.',
        ),
      );
      // One structured, secret-free diagnostic line users can paste into a
      // bug report: which source URLs failed, how, and what parsed.
      await ctx.error('rottenTomatoesUpcomingMovies: movie discovery failed', {
        sources: sourceStats.map((stat) => ({
          url: stat.url,
          failed: stat.failed,
          error: stat.error,
          discoveredEntries: stat.discoveredEntries,
          parseableEntries: stat.parseableEntries,
        })),
        parsedTotal: scrapedMovies.length,
        dedupedTotal: dedupedMovies.length,
      });
      return {
        sourceStats,
        dedupedMovies,
        destinationStats: createEmptyDestinationStats(),
        destinationTitles: createEmptyDestinationTitles(),
        discoveryStatus: 'failed',
        routeStatus: 'skipped',
        safeMatchSkipCount: 0,
      };
    }

    const destinationStats = createEmptyDestinationStats();
    const destinationTitles = createEmptyDestinationTitles();
    let routeStatus: JobReportTaskStatus = ctx.dryRun ? 'skipped' : 'success';
    let safeMatchSkipCount = 0;
    let radarrIndex: RadarrMovieIndex = {
      titleYearKeys: new Set(),
      tmdbIds: new Set(),
    };

    if (ctx.dryRun) {
      destinationStats.skipped = dedupedMovies.length;
      destinationTitles.skippedTitles = normalizeTitleList(
        dedupedMovies.map((movie) => movie.title),
      );
      return {
        sourceStats,
        dedupedMovies,
        destinationStats,
        destinationTitles,
        discoveryStatus: 'success',
        routeStatus,
        safeMatchSkipCount,
      };
    }

    await setProgress(
      'route_movies',
      routeViaSeerr ? 'Sending movies to Seerr…' : 'Sending movies to Radarr…',
      {
        candidates: dedupedMovies.length,
        routeViaSeerr,
        movieLimit,
      },
    );

    const radarrConfig = this.resolveRadarrConfig(settings, secrets);
    if (!radarrConfig) {
      destinationStats.skipped = dedupedMovies.length;
      destinationTitles.skippedTitles = normalizeTitleList(
        dedupedMovies.map((movie) => movie.title),
      );
      routeStatus = 'skipped';
      reportIssues.push(
        issue(
          'warn',
          routeViaSeerr
            ? 'Radarr lookup is required for Rotten Tomatoes movie Seerr routing, but Radarr is not configured; all movies were skipped.'
            : 'Radarr is not configured; Rotten Tomatoes movie discovery completed but all movies were skipped.',
        ),
      );
      return {
        sourceStats,
        dedupedMovies,
        destinationStats,
        destinationTitles,
        discoveryStatus: 'success',
        routeStatus,
        safeMatchSkipCount,
      };
    }

    try {
      const existingMovies = await this.radarr.listMovies(radarrConfig);
      radarrIndex = buildRadarrMovieIndex(existingMovies);
    } catch (err) {
      const error = truncateErrorMessage(err);
      reportIssues.push(
        issue(
          'warn',
          `Radarr movie library snapshot failed; continuing with lookup/add safeguards only. (${error})`,
        ),
      );
      await ctx.warn(
        'rottenTomatoesUpcomingMovies: Radarr list movies failed (continuing)',
        { error },
      );
    }

    const seerrConfig = routeViaSeerr
      ? this.resolveSeerrConfig(settings, secrets)
      : null;
    const radarrDefaults = routeViaSeerr
      ? null
      : await this.pickRadarrDefaults({
          settings,
          radarrConfig,
        }).catch((err) => ({ error: truncateErrorMessage(err) }));

    if (routeViaSeerr && !seerrConfig) {
      destinationStats.skipped = dedupedMovies.length;
      destinationTitles.skippedTitles = normalizeTitleList(
        dedupedMovies.map((movie) => movie.title),
      );
      routeStatus = 'skipped';
      reportIssues.push(
        issue(
          'warn',
          'Seerr route selected for Rotten Tomatoes movies but Seerr is not configured; all movies were skipped.',
        ),
      );
      return {
        sourceStats,
        dedupedMovies,
        destinationStats,
        destinationTitles,
        discoveryStatus: 'success',
        routeStatus,
        safeMatchSkipCount,
      };
    }

    if (radarrDefaults && 'error' in radarrDefaults) {
      destinationStats.skipped = dedupedMovies.length;
      destinationTitles.skippedTitles = normalizeTitleList(
        dedupedMovies.map((movie) => movie.title),
      );
      routeStatus = 'skipped';
      reportIssues.push(
        issue(
          'warn',
          `Radarr defaults could not be resolved for Rotten Tomatoes movies; all movies were skipped. (${radarrDefaults.error})`,
        ),
      );
      return {
        sourceStats,
        dedupedMovies,
        destinationStats,
        destinationTitles,
        discoveryStatus: 'success',
        routeStatus,
        safeMatchSkipCount,
      };
    }

    for (const movie of dedupedMovies) {
      const sourceKey = buildTitleYearKey(movie.title, movie.year);
      if (radarrIndex.titleYearKeys.has(sourceKey)) {
        destinationStats.exists += 1;
        destinationTitles.existsTitles.push(movie.title);
        continue;
      }

      const lookup = await this.lookupMovieWithFallback({
        radarrConfig,
        title: movie.title,
        year: movie.year,
      }).catch(async (err) => {
        const error = truncateErrorMessage(err);
        destinationStats.failed += 1;
        destinationTitles.failedTitles.push(movie.title);
        await ctx.warn(
          'rottenTomatoesUpcomingMovies: Radarr movie lookup failed (continuing)',
          {
            title: movie.title,
            year: movie.year,
            error,
          },
        );
        return null;
      });

      if (!lookup) {
        if (!destinationTitles.failedTitles.includes(movie.title)) {
          safeMatchSkipCount += 1;
          destinationStats.skipped += 1;
          destinationTitles.skippedTitles.push(movie.title);
          await ctx.warn(
            'rottenTomatoesUpcomingMovies: no Radarr movie lookup match found',
            {
              title: movie.title,
              year: movie.year,
            },
          );
        }
        continue;
      }

      const lookupTitle =
        typeof lookup.movie.title === 'string'
          ? normalizeTitleForMatching(lookup.movie.title)
          : movie.title;
      const lookupYear = parseMaybeYear(lookup.movie.year);
      const lookupTmdbId = parsePositiveInt(lookup.movie.tmdbId);
      const lookupKey =
        lookupYear !== null ? buildTitleYearKey(lookupTitle, lookupYear) : '';

      if (lookupTmdbId === null) {
        safeMatchSkipCount += 1;
        destinationStats.skipped += 1;
        destinationTitles.skippedTitles.push(lookupTitle);
        await ctx.warn(
          'rottenTomatoesUpcomingMovies: Radarr movie lookup returned no TMDB id',
          {
            title: lookupTitle,
            year: lookupYear,
          },
        );
        continue;
      }

      if (
        radarrIndex.tmdbIds.has(lookupTmdbId) ||
        (lookupKey && radarrIndex.titleYearKeys.has(lookupKey))
      ) {
        destinationStats.exists += 1;
        destinationTitles.existsTitles.push(lookupTitle);
        radarrIndex.tmdbIds.add(lookupTmdbId);
        if (lookupKey) {
          radarrIndex.titleYearKeys.add(lookupKey);
        }
        continue;
      }

      destinationStats.attempted += 1;
      destinationTitles.attemptedTitles.push(lookupTitle);

      if (routeViaSeerr) {
        const result = await this.seerr.requestMovie({
          baseUrl: seerrConfig!.baseUrl,
          apiKey: seerrConfig!.apiKey,
          tmdbId: lookupTmdbId,
        });
        if (result.status === 'requested') {
          destinationStats.requested += 1;
          destinationTitles.sentTitles.push(lookupTitle);
          radarrIndex.tmdbIds.add(lookupTmdbId);
          if (lookupKey) {
            radarrIndex.titleYearKeys.add(lookupKey);
          }
        } else if (result.status === 'exists') {
          destinationStats.exists += 1;
          destinationTitles.existsTitles.push(lookupTitle);
          radarrIndex.tmdbIds.add(lookupTmdbId);
          if (lookupKey) {
            radarrIndex.titleYearKeys.add(lookupKey);
          }
        } else {
          destinationStats.failed += 1;
          destinationTitles.failedTitles.push(lookupTitle);
          await ctx.warn(
            'rottenTomatoesUpcomingMovies: Seerr movie request failed (continuing)',
            {
              title: lookupTitle,
              tmdbId: lookupTmdbId,
              error: result.error ?? 'unknown',
            },
          );
        }
        continue;
      }

      try {
        const result = await this.radarr.addMovie({
          baseUrl: radarrConfig.baseUrl,
          apiKey: radarrConfig.apiKey,
          title: lookupTitle,
          tmdbId: lookupTmdbId,
          year: lookupYear,
          qualityProfileId: radarrDefaults!.qualityProfileId,
          rootFolderPath: radarrDefaults!.rootFolderPath,
          tags: radarrDefaults!.tagIds,
          monitored: true,
          searchForMovie: true,
        });
        if (result.status === 'added') {
          destinationStats.added += 1;
          destinationTitles.sentTitles.push(lookupTitle);
        } else {
          destinationStats.exists += 1;
          destinationTitles.existsTitles.push(lookupTitle);
        }
        radarrIndex.tmdbIds.add(lookupTmdbId);
        if (lookupYear !== null) {
          radarrIndex.titleYearKeys.add(
            buildTitleYearKey(lookupTitle, lookupYear),
          );
        }
      } catch (err) {
        destinationStats.failed += 1;
        destinationTitles.failedTitles.push(lookupTitle);
        await ctx.warn(
          'rottenTomatoesUpcomingMovies: Radarr movie add failed (continuing)',
          {
            title: lookupTitle,
            year: lookupYear,
            error: truncateErrorMessage(err),
          },
        );
      }
    }

    return {
      sourceStats,
      dedupedMovies,
      destinationStats,
      destinationTitles,
      discoveryStatus: 'success',
      routeStatus,
      safeMatchSkipCount,
    };
  }

  private async runShowBranch(params: {
    ctx: JobContext;
    settings: Record<string, unknown>;
    secrets: Record<string, unknown>;
    routeViaSeerr: boolean;
    showLimit: number;
    setProgress: (
      step: string,
      message: string,
      context?: JsonObject,
    ) => Promise<void>;
    reportIssues: JobReportV1['issues'];
  }): Promise<ShowBranchResult> {
    const {
      ctx,
      settings,
      secrets,
      routeViaSeerr,
      showLimit,
      setProgress,
      reportIssues,
    } = params;

    await setProgress('scrape_shows', 'Scraping Rotten Tomatoes TV sources…', {
      totalSources: ROTTEN_TOMATOES_SHOW_SOURCE_URLS.length,
      showLimit,
    });

    const scrapedShows: ScrapedShow[] = [];
    const sourceStats: ShowSourceScrapeStats[] = [];
    let sourceFailureCount = 0;
    let scoreFilteredOut = 0;

    for (const sourceUrl of ROTTEN_TOMATOES_SHOW_SOURCE_URLS) {
      try {
        const html = await this.fetchSourceHtml(sourceUrl);
        const parsed = parseRottenTomatoesShowsFromHtml({
          html,
          sourceUrl,
        });
        const qualifiedShows = parsed.shows.filter((show) => {
          const criticsScore = show.criticsScore;
          const audienceScore = show.audienceScore;
          return (
            criticsScore !== null &&
            audienceScore !== null &&
            criticsScore >= MINIMUM_RT_SCORE &&
            audienceScore >= MINIMUM_RT_SCORE
          );
        });
        const filteredOut = parsed.shows.length - qualifiedShows.length;
        scoreFilteredOut += filteredOut;
        scrapedShows.push(...qualifiedShows);
        sourceStats.push({
          url: sourceUrl,
          discoveredEntries: parsed.discoveredEntries,
          parseableEntries: parsed.shows.length,
          scoreFilteredOut: filteredOut,
          failed: false,
          error: null,
        });

        if (dedupeScrapedShows(scrapedShows).length >= showLimit) {
          break;
        }
      } catch (err) {
        const error = truncateErrorMessage(err);
        sourceFailureCount += 1;
        sourceStats.push({
          url: sourceUrl,
          discoveredEntries: 0,
          parseableEntries: 0,
          scoreFilteredOut: 0,
          failed: true,
          error,
        });
        reportIssues.push(
          issue(
            'warn',
            `Rotten Tomatoes TV source failed and was skipped: ${sourceUrl} (${error})`,
          ),
        );
        await ctx.warn(
          'rottenTomatoesUpcomingMovies: TV source scrape failed (continuing)',
          {
            sourceUrl,
            error,
          },
        );
      }
    }

    const dedupedShows = dedupeScrapedShows(scrapedShows).slice(0, showLimit);
    if (
      sourceFailureCount === ROTTEN_TOMATOES_SHOW_SOURCE_URLS.length ||
      dedupedShows.length === 0
    ) {
      reportIssues.push(
        issue(
          'error',
          'Rotten Tomatoes TV discovery failed: all TV sources failed or no score-qualified TV cards were parsed.',
        ),
      );
      await ctx.error('rottenTomatoesUpcomingMovies: TV discovery failed', {
        sources: sourceStats.map((stat) => ({
          url: stat.url,
          failed: stat.failed,
          error: stat.error,
          discoveredEntries: stat.discoveredEntries,
          parseableEntries: stat.parseableEntries,
        })),
        parsedTotal: scrapedShows.length,
        dedupedTotal: dedupedShows.length,
        scoreFilteredOut,
      });
      return {
        sourceStats,
        dedupedShows,
        destinationStats: createEmptyDestinationStats(),
        destinationTitles: createEmptyDestinationTitles(),
        discoveryStatus: 'failed',
        routeStatus: 'skipped',
        unresolvedIds: 0,
        scoreFilteredOut,
        reconciliation: createEmptyShowReconciliation(),
      };
    }

    const destinationStats = createEmptyDestinationStats();
    const destinationTitles = createEmptyDestinationTitles();
    const reconciliation = createEmptyShowReconciliation();
    let routeStatus: JobReportTaskStatus = ctx.dryRun ? 'skipped' : 'success';
    let unresolvedIds = 0;

    if (ctx.dryRun) {
      destinationStats.skipped = dedupedShows.length;
      destinationTitles.skippedTitles = normalizeTitleList(
        dedupedShows.map((show) => show.title),
      );
      return {
        sourceStats,
        dedupedShows,
        destinationStats,
        destinationTitles,
        discoveryStatus: 'success',
        routeStatus,
        unresolvedIds,
        scoreFilteredOut,
        reconciliation,
      };
    }

    await setProgress(
      'route_shows',
      routeViaSeerr
        ? 'Requesting TV shows in Seerr and reconciling existing Sonarr series…'
        : 'Sending TV shows to Sonarr and reconciling existing series…',
      {
        candidates: dedupedShows.length,
        routeViaSeerr,
        showLimit,
      },
    );

    const tmdbApiKey = this.settingsService.readServiceSecret('tmdb', secrets);
    if (!tmdbApiKey) {
      destinationStats.skipped = dedupedShows.length;
      destinationTitles.skippedTitles = normalizeTitleList(
        dedupedShows.map((show) => show.title),
      );
      routeStatus = 'skipped';
      reportIssues.push(
        issue(
          'warn',
          'TMDB is not configured; Rotten Tomatoes TV discovery completed but all TV shows were skipped.',
        ),
      );
      return {
        sourceStats,
        dedupedShows,
        destinationStats,
        destinationTitles,
        discoveryStatus: 'success',
        routeStatus,
        unresolvedIds,
        scoreFilteredOut,
        reconciliation,
      };
    }

    const sonarrConfig = this.resolveSonarrConfig(settings, secrets);
    const seerrConfig = routeViaSeerr
      ? this.resolveSeerrConfig(settings, secrets)
      : null;
    const sonarrDefaults =
      !routeViaSeerr && sonarrConfig
        ? await this.pickSonarrDefaults({
            settings,
            sonarrConfig,
          }).catch((err) => ({ error: truncateErrorMessage(err) }))
        : null;
    const plexConfig = this.resolvePlexConfig(settings, secrets);
    const caches: ShowBranchCaches = {
      sonarrIndexByTvdb: null,
      plexTvdbRatingKeys: undefined,
      showEpisodeAvailability: new Map(),
      partProbeCache: new Map(),
      warnedMissingPlexConfig: false,
    };

    if (routeViaSeerr && !seerrConfig && !sonarrConfig) {
      destinationStats.skipped = dedupedShows.length;
      destinationTitles.skippedTitles = normalizeTitleList(
        dedupedShows.map((show) => show.title),
      );
      routeStatus = 'skipped';
      reportIssues.push(
        issue(
          'warn',
          'Seerr route selected for Rotten Tomatoes TV but neither Seerr nor Sonarr is configured; all TV shows were skipped.',
        ),
      );
      return {
        sourceStats,
        dedupedShows,
        destinationStats,
        destinationTitles,
        discoveryStatus: 'success',
        routeStatus,
        unresolvedIds,
        scoreFilteredOut,
        reconciliation,
      };
    }

    if (!routeViaSeerr && !sonarrConfig) {
      destinationStats.skipped = dedupedShows.length;
      destinationTitles.skippedTitles = normalizeTitleList(
        dedupedShows.map((show) => show.title),
      );
      routeStatus = 'skipped';
      reportIssues.push(
        issue(
          'warn',
          'Sonarr is not configured; Rotten Tomatoes TV discovery completed but all TV shows were skipped.',
        ),
      );
      return {
        sourceStats,
        dedupedShows,
        destinationStats,
        destinationTitles,
        discoveryStatus: 'success',
        routeStatus,
        unresolvedIds,
        scoreFilteredOut,
        reconciliation,
      };
    }

    if (!routeViaSeerr && sonarrDefaults && 'error' in sonarrDefaults) {
      reportIssues.push(
        issue(
          'warn',
          `Sonarr defaults could not be resolved for Rotten Tomatoes TV; new-show adds will be skipped. (${sonarrDefaults.error})`,
        ),
      );
    }

    if (routeViaSeerr && !seerrConfig) {
      reportIssues.push(
        issue(
          'warn',
          'Seerr route selected for Rotten Tomatoes TV but Seerr is not configured; only existing Sonarr series reconciliation can continue.',
        ),
      );
    }

    if (sonarrConfig) {
      try {
        const existingSeries = await this.sonarr.listSeries(sonarrConfig);
        caches.sonarrIndexByTvdb = buildSonarrSeriesIndex(existingSeries);
      } catch (err) {
        const error = truncateErrorMessage(err);
        reportIssues.push(
          issue(
            'warn',
            `Sonarr series index failed for Rotten Tomatoes TV; existing-series reconciliation may be limited. (${error})`,
          ),
        );
        await ctx.warn(
          'rottenTomatoesUpcomingMovies: Sonarr series index failed (continuing)',
          { error },
        );
      }
    }

    for (const show of dedupedShows) {
      const resolved = await this.resolveShowIds({
        ctx,
        tmdbApiKey,
        title: show.title,
        year: show.year,
      }).catch(async (err) => {
        await ctx.warn(
          'rottenTomatoesUpcomingMovies: TMDB TV resolution failed (continuing)',
          {
            title: show.title,
            year: show.year,
            error: truncateErrorMessage(err),
          },
        );
        return null;
      });

      if (!resolved) {
        unresolvedIds += 1;
        destinationStats.skipped += 1;
        destinationTitles.skippedTitles.push(show.title);
        await ctx.warn(
          'rottenTomatoesUpcomingMovies: unresolved TMDB/TVDB ids for TV show',
          {
            title: show.title,
            year: show.year,
            href: show.href,
          },
        );
        continue;
      }

      const existingSeries =
        caches.sonarrIndexByTvdb?.get(resolved.tvdbId) ?? null;
      if (existingSeries) {
        destinationStats.exists += 1;
        destinationTitles.existsTitles.push(resolved.title);
        if (sonarrConfig) {
          const stats = await this.reconcileExistingSonarrSeries({
            ctx,
            sonarrConfig,
            plexConfig,
            series: existingSeries,
            caches,
          });
          addShowReconciliation(reconciliation, stats);
        }
        continue;
      }

      if (routeViaSeerr) {
        if (!seerrConfig) {
          destinationStats.skipped += 1;
          destinationTitles.skippedTitles.push(resolved.title);
          continue;
        }

        destinationStats.attempted += 1;
        destinationTitles.attemptedTitles.push(resolved.title);
        const result = await this.seerr.requestTvAllSeasons({
          baseUrl: seerrConfig.baseUrl,
          apiKey: seerrConfig.apiKey,
          tmdbId: resolved.tmdbId,
          tvdbId: resolved.tvdbId,
        });
        if (result.status === 'requested') {
          destinationStats.requested += 1;
          destinationTitles.sentTitles.push(resolved.title);
        } else if (result.status === 'exists') {
          destinationStats.exists += 1;
          destinationTitles.existsTitles.push(resolved.title);
        } else {
          destinationStats.failed += 1;
          destinationTitles.failedTitles.push(resolved.title);
          await ctx.warn(
            'rottenTomatoesUpcomingMovies: Seerr TV request failed (continuing)',
            {
              title: resolved.title,
              tmdbId: resolved.tmdbId,
              tvdbId: resolved.tvdbId,
              error: result.error ?? 'unknown',
            },
          );
        }
        continue;
      }

      if (!sonarrConfig || !sonarrDefaults || 'error' in sonarrDefaults) {
        destinationStats.skipped += 1;
        destinationTitles.skippedTitles.push(resolved.title);
        continue;
      }

      destinationStats.attempted += 1;
      destinationTitles.attemptedTitles.push(resolved.title);
      try {
        const result = await this.sonarr.addSeries({
          baseUrl: sonarrConfig.baseUrl,
          apiKey: sonarrConfig.apiKey,
          title: resolved.title,
          tvdbId: resolved.tvdbId,
          qualityProfileId: sonarrDefaults.qualityProfileId,
          rootFolderPath: sonarrDefaults.rootFolderPath,
          tags: sonarrDefaults.tagIds,
          monitored: true,
          searchForMissingEpisodes: true,
          searchForCutoffUnmetEpisodes: true,
        });
        if (result.status === 'added') {
          destinationStats.added += 1;
          destinationTitles.sentTitles.push(resolved.title);
        } else {
          destinationStats.exists += 1;
          destinationTitles.existsTitles.push(resolved.title);
          if (caches.sonarrIndexByTvdb === null) {
            try {
              caches.sonarrIndexByTvdb = buildSonarrSeriesIndex(
                await this.sonarr.listSeries(sonarrConfig),
              );
            } catch {
              caches.sonarrIndexByTvdb = null;
            }
          }
          const refreshedExisting =
            caches.sonarrIndexByTvdb?.get(resolved.tvdbId) ?? null;
          if (refreshedExisting) {
            const stats = await this.reconcileExistingSonarrSeries({
              ctx,
              sonarrConfig,
              plexConfig,
              series: refreshedExisting,
              caches,
            });
            addShowReconciliation(reconciliation, stats);
          }
        }
      } catch (err) {
        destinationStats.failed += 1;
        destinationTitles.failedTitles.push(resolved.title);
        await ctx.warn(
          'rottenTomatoesUpcomingMovies: Sonarr TV add failed (continuing)',
          {
            title: resolved.title,
            tvdbId: resolved.tvdbId,
            error: truncateErrorMessage(err),
          },
        );
      }
    }

    if (
      destinationStats.attempted === 0 &&
      destinationStats.exists === 0 &&
      reconciliation.reconciledSeries === 0 &&
      destinationStats.failed === 0
    ) {
      routeStatus = 'skipped';
    }

    return {
      sourceStats,
      dedupedShows,
      destinationStats,
      destinationTitles,
      discoveryStatus: 'success',
      routeStatus,
      unresolvedIds,
      scoreFilteredOut,
      reconciliation,
    };
  }

  private async fetchSourceHtml(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          // A browser-like UA avoids the bot-blocking some CDNs apply to
          // default runtime user agents.
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `HTTP ${response.status}${body ? ` ${body.slice(0, 200)}` : ''}`.trim(),
        );
      }
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveRadarrConfig(
    settings: Record<string, unknown>,
    secrets: Record<string, unknown>,
  ): RadarrConfig | null {
    const baseUrl =
      pickString(settings, 'radarr.baseUrl') ||
      pickString(settings, 'radarr.url');
    const apiKey = this.settingsService.readServiceSecret('radarr', secrets);
    const enabledSetting = pickBool(settings, 'radarr.enabled');
    const enabled = (enabledSetting ?? Boolean(apiKey)) === true;

    if (!enabled || !baseUrl || !apiKey) {
      return null;
    }

    return { baseUrl, apiKey };
  }

  private resolveSonarrConfig(
    settings: Record<string, unknown>,
    secrets: Record<string, unknown>,
  ): SonarrConfig | null {
    const baseUrl =
      pickString(settings, 'sonarr.baseUrl') ||
      pickString(settings, 'sonarr.url');
    const apiKey = this.settingsService.readServiceSecret('sonarr', secrets);
    const enabledSetting = pickBool(settings, 'sonarr.enabled');
    const enabled = (enabledSetting ?? Boolean(apiKey)) === true;

    if (!enabled || !baseUrl || !apiKey) {
      return null;
    }

    return { baseUrl, apiKey };
  }

  private resolveSeerrConfig(
    settings: Record<string, unknown>,
    secrets: Record<string, unknown>,
  ): SeerrConfig | null {
    const baseUrl =
      pickString(settings, 'seerr.baseUrl') ||
      pickString(settings, 'seerr.url');
    const apiKey = this.settingsService.readServiceSecret('seerr', secrets);
    const enabledSetting = pickBool(settings, 'seerr.enabled');
    const enabled = (enabledSetting ?? Boolean(apiKey)) === true;

    if (!enabled || !baseUrl || !apiKey) {
      return null;
    }

    return { baseUrl, apiKey };
  }

  private resolvePlexConfig(
    settings: Record<string, unknown>,
    secrets: Record<string, unknown>,
  ): PlexConfig | null {
    const baseUrl =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const token = this.settingsService.readServiceSecret('plex', secrets);
    if (!baseUrl || !token) return null;
    return { baseUrl, token };
  }

  private async pickRadarrDefaults(params: {
    settings: Record<string, unknown>;
    radarrConfig: RadarrConfig;
  }): Promise<{
    rootFolderPath: string;
    qualityProfileId: number;
    tagIds: number[];
  }> {
    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.radarr.listRootFolders(params.radarrConfig),
      this.radarr.listQualityProfiles(params.radarrConfig),
      this.radarr.listTags(params.radarrConfig),
    ]);

    if (!rootFolders.length) {
      throw new Error('Radarr has no root folders configured');
    }
    if (!qualityProfiles.length) {
      throw new Error('Radarr has no quality profiles configured');
    }

    const preferredRootFolderPath =
      pickString(params.settings, 'radarr.defaultRootFolderPath') ||
      pickString(params.settings, 'radarr.rootFolderPath');
    const preferredQualityProfileId =
      pickNumber(params.settings, 'radarr.defaultQualityProfileId') ??
      pickNumber(params.settings, 'radarr.qualityProfileId') ??
      1;
    const preferredTagId =
      pickNumber(params.settings, 'radarr.defaultTagId') ??
      pickNumber(params.settings, 'radarr.tagId');

    const rootFolder = preferredRootFolderPath
      ? (rootFolders.find((row) => row.path === preferredRootFolderPath) ??
        rootFolders[0])
      : rootFolders[0];
    const qualityProfile =
      qualityProfiles.find(
        (row) => row.id === Math.max(1, Math.trunc(preferredQualityProfileId)),
      ) ?? qualityProfiles[0];
    const tag =
      preferredTagId !== null
        ? tags.find((row) => row.id === Math.max(1, Math.trunc(preferredTagId)))
        : null;

    return {
      rootFolderPath: rootFolder.path,
      qualityProfileId: qualityProfile.id,
      tagIds: tag ? [tag.id] : [],
    };
  }

  private async pickSonarrDefaults(params: {
    settings: Record<string, unknown>;
    sonarrConfig: SonarrConfig;
  }): Promise<{
    rootFolderPath: string;
    qualityProfileId: number;
    tagIds: number[];
  }> {
    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.sonarr.listRootFolders(params.sonarrConfig),
      this.sonarr.listQualityProfiles(params.sonarrConfig),
      this.sonarr.listTags(params.sonarrConfig),
    ]);

    if (!rootFolders.length) {
      throw new Error('Sonarr has no root folders configured');
    }
    if (!qualityProfiles.length) {
      throw new Error('Sonarr has no quality profiles configured');
    }

    const preferredRootFolderPath =
      pickString(params.settings, 'sonarr.defaultRootFolderPath') ||
      pickString(params.settings, 'sonarr.rootFolderPath');
    const preferredQualityProfileId =
      pickNumber(params.settings, 'sonarr.defaultQualityProfileId') ??
      pickNumber(params.settings, 'sonarr.qualityProfileId') ??
      1;
    const preferredTagId =
      pickNumber(params.settings, 'sonarr.defaultTagId') ??
      pickNumber(params.settings, 'sonarr.tagId');

    const rootFolder = preferredRootFolderPath
      ? (rootFolders.find((row) => row.path === preferredRootFolderPath) ??
        rootFolders[0])
      : rootFolders[0];
    const qualityProfile =
      qualityProfiles.find(
        (row) => row.id === Math.max(1, Math.trunc(preferredQualityProfileId)),
      ) ?? qualityProfiles[0];
    const tag =
      preferredTagId !== null
        ? tags.find((row) => row.id === Math.max(1, Math.trunc(preferredTagId)))
        : null;

    return {
      rootFolderPath: rootFolder.path,
      qualityProfileId: qualityProfile.id,
      tagIds: tag ? [tag.id] : [],
    };
  }

  private async lookupMovieWithFallback(params: {
    radarrConfig: RadarrConfig;
    title: string;
    year: string;
  }): Promise<LookupSelection | null> {
    const strictResults = await this.radarr.lookupMovies({
      baseUrl: params.radarrConfig.baseUrl,
      apiKey: params.radarrConfig.apiKey,
      term: `${params.title} ${params.year}`,
    });
    const strictMatch = selectLookupMovie(
      strictResults,
      params.title,
      params.year,
    );
    if (strictMatch) {
      return { movie: strictMatch, usedTitleOnlyFallback: false };
    }

    const fallbackResults = await this.radarr.lookupMovies({
      baseUrl: params.radarrConfig.baseUrl,
      apiKey: params.radarrConfig.apiKey,
      term: params.title,
    });
    const fallbackMatch = selectLookupMovie(
      fallbackResults,
      params.title,
      params.year,
    );
    if (!fallbackMatch) return null;

    return { movie: fallbackMatch, usedTitleOnlyFallback: true };
  }

  private async resolveShowIds(params: {
    ctx: JobContext;
    tmdbApiKey: string;
    title: string;
    year: string | null;
  }): Promise<ResolvedShowIds | null> {
    const requestedYear = parseMaybeYear(params.year);
    const strictResults = await this.tmdb.searchTv({
      apiKey: params.tmdbApiKey,
      query: params.title,
      includeAdult: false,
      firstAirDateYear: requestedYear,
    });
    let match = selectTmdbTvMatch(strictResults, params.title, params.year);

    if (!match && requestedYear !== null) {
      const fallbackResults = await this.tmdb.searchTv({
        apiKey: params.tmdbApiKey,
        query: params.title,
        includeAdult: false,
        firstAirDateYear: null,
      });
      match = selectTmdbTvMatch(fallbackResults, params.title, params.year);
    }

    if (!match) return null;

    const externalIds = await this.tmdb.getTvExternalIds({
      apiKey: params.tmdbApiKey,
      tmdbId: match.id,
    });
    const tvdbId = parsePositiveInt(externalIds?.tvdb_id);
    if (!tvdbId) return null;

    return {
      title: normalizeTitleForMatching(match.name),
      tmdbId: Math.trunc(match.id),
      tvdbId,
      year: extractYearFromText(match.first_air_date),
    };
  }

  private async ensurePlexTvdbRatingKeys(params: {
    ctx: JobContext;
    plexConfig: PlexConfig | null;
    caches: ShowBranchCaches;
  }): Promise<Map<number, string[]> | null> {
    if (params.caches.plexTvdbRatingKeys !== undefined) {
      return params.caches.plexTvdbRatingKeys ?? null;
    }
    if (!params.plexConfig) {
      params.caches.plexTvdbRatingKeys = null;
      return null;
    }

    const sections = await this.plexServer.getSections({
      baseUrl: params.plexConfig.baseUrl,
      token: params.plexConfig.token,
    });
    const tvSections = sections.filter(
      (section) => (section.type ?? '').toLowerCase() === 'show',
    );

    const out = new Map<number, string[]>();
    for (const section of tvSections) {
      const map = await this.plexServer.getTvdbShowRatingKeysMapForSectionKey({
        baseUrl: params.plexConfig.baseUrl,
        token: params.plexConfig.token,
        librarySectionKey: section.key,
        sectionTitle: section.title,
      });
      for (const [tvdbId, ratingKeys] of map.entries()) {
        const previous = out.get(tvdbId) ?? [];
        for (const ratingKey of ratingKeys) {
          if (!previous.includes(ratingKey)) previous.push(ratingKey);
        }
        out.set(tvdbId, previous);
      }
    }

    params.caches.plexTvdbRatingKeys = out;
    await params.ctx.info(
      'rottenTomatoesUpcomingMovies: built Plex TVDB show map for TV reconciliation',
      {
        tvLibraries: tvSections.map((section) => section.title),
        tvdbShows: out.size,
      },
    );
    return out;
  }

  private async getVerifiedEpisodesForShow(params: {
    ctx: JobContext;
    plexConfig: PlexConfig;
    showRatingKey: string;
    caches: ShowBranchCaches;
  }): Promise<PlexVerifiedEpisodeAvailability> {
    const cached = params.caches.showEpisodeAvailability.get(
      params.showRatingKey,
    );
    if (cached) return cached;

    try {
      const availability =
        await this.plexServer.getVerifiedEpisodeAvailabilityForShowRatingKey({
          baseUrl: params.plexConfig.baseUrl,
          token: params.plexConfig.token,
          showRatingKey: params.showRatingKey,
          partProbeCache: params.caches.partProbeCache,
        });
      params.caches.showEpisodeAvailability.set(
        params.showRatingKey,
        availability,
      );
      return availability;
    } catch (err) {
      const fallback = {
        verifiedEpisodes: new Set<string>(),
        metadataEpisodes: new Set<string>(),
        probeFailureCount: 1,
      };
      params.caches.showEpisodeAvailability.set(params.showRatingKey, fallback);
      await params.ctx.warn(
        'rottenTomatoesUpcomingMovies: failed verifying Plex show episode availability',
        {
          showRatingKey: params.showRatingKey,
          error: truncateErrorMessage(err),
        },
      );
      return fallback;
    }
  }

  private async reconcileExistingSonarrSeries(params: {
    ctx: JobContext;
    sonarrConfig: SonarrConfig;
    plexConfig: PlexConfig | null;
    series: SonarrSeries;
    caches: ShowBranchCaches;
  }): Promise<ShowReconciliationStats> {
    const out = createEmptyShowReconciliation();
    out.reconciledSeries = 1;

    if (!params.plexConfig) {
      if (!params.caches.warnedMissingPlexConfig) {
        params.caches.warnedMissingPlexConfig = true;
        await params.ctx.warn(
          'rottenTomatoesUpcomingMovies: Plex is not configured; existing Sonarr series reconciliation was skipped',
        );
      }
      return out;
    }

    const tvdbId = parsePositiveInt(params.series.tvdbId);
    if (!tvdbId) {
      out.failures += 1;
      await params.ctx.warn(
        'rottenTomatoesUpcomingMovies: existing Sonarr series missing tvdbId; skipping reconciliation',
        {
          seriesId: params.series.id,
          title:
            typeof params.series.title === 'string'
              ? params.series.title
              : null,
        },
      );
      return out;
    }

    const plexTvdbRatingKeys = await this.ensurePlexTvdbRatingKeys({
      ctx: params.ctx,
      plexConfig: params.plexConfig,
      caches: params.caches,
    }).catch(async (err) => {
      out.failures += 1;
      await params.ctx.warn(
        'rottenTomatoesUpcomingMovies: failed building Plex TVDB index for reconciliation',
        {
          tvdbId,
          error: truncateErrorMessage(err),
        },
      );
      return null;
    });
    if (!plexTvdbRatingKeys) {
      return out;
    }

    const showRatingKeys = plexTvdbRatingKeys.get(tvdbId) ?? [];
    const verifiedEpisodes = new Set<string>();
    for (const ratingKey of showRatingKeys) {
      const availability = await this.getVerifiedEpisodesForShow({
        ctx: params.ctx,
        plexConfig: params.plexConfig,
        showRatingKey: ratingKey,
        caches: params.caches,
      });
      for (const key of availability.verifiedEpisodes) {
        verifiedEpisodes.add(key);
      }
    }

    const episodes = await this.sonarr
      .getEpisodesBySeries({
        baseUrl: params.sonarrConfig.baseUrl,
        apiKey: params.sonarrConfig.apiKey,
        seriesId: params.series.id,
      })
      .catch(async (err) => {
        out.failures += 1;
        await params.ctx.warn(
          'rottenTomatoesUpcomingMovies: failed loading Sonarr episodes for reconciliation',
          {
            tvdbId,
            seriesId: params.series.id,
            error: truncateErrorMessage(err),
          },
        );
        return null;
      });
    if (!episodes) {
      return out;
    }

    const positiveSeasonNumbers = new Set<number>();
    const seasonState = new Map<
      number,
      { hasEpisodes: boolean; hasMissingEpisodes: boolean }
    >();

    let seriesHasMissingEpisodes = false;

    for (const episode of episodes) {
      const season = parsePositiveInt(episode.seasonNumber);
      const episodeNumber = parsePositiveInt(episode.episodeNumber);
      if (!season || !episodeNumber) continue;

      positiveSeasonNumbers.add(season);
      const key = episodeKey(season, episodeNumber);
      const inPlex = verifiedEpisodes.has(key);
      const targetMonitored = !inPlex;
      const currentMonitored = Boolean(episode.monitored);
      let finalMonitored = currentMonitored;

      const currentSeasonState = seasonState.get(season) ?? {
        hasEpisodes: false,
        hasMissingEpisodes: false,
      };
      currentSeasonState.hasEpisodes = true;
      currentSeasonState.hasMissingEpisodes ||= !inPlex;
      seasonState.set(season, currentSeasonState);
      seriesHasMissingEpisodes ||= !inPlex;

      if (currentMonitored !== targetMonitored) {
        if (params.ctx.dryRun) {
          finalMonitored = targetMonitored;
        } else {
          const updated = await this.updateEpisodeMonitoring({
            ctx: params.ctx,
            sonarrConfig: params.sonarrConfig,
            episode,
            monitored: targetMonitored,
            series: params.series,
            tvdbId,
          });
          if (updated) {
            finalMonitored = targetMonitored;
          } else {
            out.failures += 1;
          }
        }
      } else {
        finalMonitored = targetMonitored;
      }

      if (finalMonitored) {
        out.episodesMonitored += 1;
      } else {
        out.episodesLeftUnmonitored += 1;
      }
    }

    if (!positiveSeasonNumbers.size) {
      return out;
    }

    const nextSeries: SonarrSeries = {
      ...params.series,
      seasons: Array.isArray(params.series.seasons)
        ? params.series.seasons.map((seasonEntry) => {
            const seasonNumber = parsePositiveInt(seasonEntry.seasonNumber);
            if (!seasonNumber || !positiveSeasonNumbers.has(seasonNumber)) {
              return { ...seasonEntry };
            }
            const state = seasonState.get(seasonNumber);
            const targetMonitored = Boolean(state?.hasMissingEpisodes);
            return { ...seasonEntry, monitored: targetMonitored };
          })
        : params.series.seasons,
      monitored: seriesHasMissingEpisodes,
    };

    const seasonsChanged = Array.isArray(params.series.seasons)
      ? params.series.seasons.some((seasonEntry, index) => {
          const seasonNumber = parsePositiveInt(seasonEntry.seasonNumber);
          if (!seasonNumber || !positiveSeasonNumbers.has(seasonNumber)) {
            return false;
          }
          const nextSeason = Array.isArray(nextSeries.seasons)
            ? nextSeries.seasons[index]
            : null;
          return (
            Boolean(seasonEntry.monitored) !== Boolean(nextSeason?.monitored)
          );
        })
      : false;
    const seriesChanged =
      Boolean(params.series.monitored) !== Boolean(nextSeries.monitored);

    let seriesUpdateApplied = !seasonsChanged && !seriesChanged;
    if ((seasonsChanged || seriesChanged) && !params.ctx.dryRun) {
      seriesUpdateApplied = await this.sonarr
        .updateSeries({
          baseUrl: params.sonarrConfig.baseUrl,
          apiKey: params.sonarrConfig.apiKey,
          series: nextSeries,
        })
        .then(() => true)
        .catch(async (err) => {
          out.failures += 1;
          await params.ctx.warn(
            'rottenTomatoesUpcomingMovies: failed updating Sonarr series during reconciliation',
            {
              tvdbId,
              seriesId: params.series.id,
              error: truncateErrorMessage(err),
            },
          );
          return false;
        });
    } else if (params.ctx.dryRun && (seasonsChanged || seriesChanged)) {
      seriesUpdateApplied = true;
    }

    const finalSeries = seriesUpdateApplied ? nextSeries : params.series;
    const finalSeasons = Array.isArray(finalSeries.seasons)
      ? finalSeries.seasons
      : [];

    for (const seasonNumber of positiveSeasonNumbers) {
      const seasonEntry = finalSeasons.find(
        (row) => parsePositiveInt(row.seasonNumber) === seasonNumber,
      );
      if (seasonEntry?.monitored) {
        out.seasonsMonitored += 1;
      } else {
        out.seasonsUnmonitored += 1;
      }
    }

    if (finalSeries.monitored) {
      out.seriesMonitored += 1;
    } else {
      out.seriesUnmonitored += 1;
    }

    return out;
  }

  private async updateEpisodeMonitoring(params: {
    ctx: JobContext;
    sonarrConfig: SonarrConfig;
    episode: SonarrEpisode;
    monitored: boolean;
    series: SonarrSeries;
    tvdbId: number;
  }): Promise<boolean> {
    return this.sonarr
      .setEpisodeMonitored({
        baseUrl: params.sonarrConfig.baseUrl,
        apiKey: params.sonarrConfig.apiKey,
        episode: params.episode,
        monitored: params.monitored,
      })
      .then(() => true)
      .catch(async (err) => {
        await params.ctx.warn(
          'rottenTomatoesUpcomingMovies: failed updating Sonarr episode monitoring during reconciliation',
          {
            tvdbId: params.tvdbId,
            seriesId: params.series.id,
            season: parsePositiveInt(params.episode.seasonNumber),
            episode: parsePositiveInt(params.episode.episodeNumber),
            monitored: params.monitored,
            error: truncateErrorMessage(err),
          },
        );
        return false;
      });
  }

  private buildReport(params: {
    ctx: JobContext;
    manualCategory: ManualCategory | null;
    effectiveIncludeMovies: boolean;
    effectiveIncludeShows: boolean;
    effectiveMovieLimit: number;
    effectiveShowLimit: number;
    routeViaSeerr: boolean;
    movieBranch: MovieBranchResult;
    showBranch: ShowBranchResult;
    reportIssues: JobReportV1['issues'];
  }): JobReportV1 {
    const movieSourceFailures = params.movieBranch.sourceStats.filter(
      (source) => source.failed,
    ).length;
    const movieDiscoveredEntries = params.movieBranch.sourceStats.reduce(
      (sum, source) => sum + source.discoveredEntries,
      0,
    );
    const movieParseableEntries = params.movieBranch.sourceStats.reduce(
      (sum, source) => sum + source.parseableEntries,
      0,
    );
    const movieSkippedNoYear = params.movieBranch.sourceStats.reduce(
      (sum, source) => sum + source.skippedNoYear,
      0,
    );

    const showSourceFailures = params.showBranch.sourceStats.filter(
      (source) => source.failed,
    ).length;
    const showDiscoveredEntries = params.showBranch.sourceStats.reduce(
      (sum, source) => sum + source.discoveredEntries,
      0,
    );
    const showParseableEntries = params.showBranch.sourceStats.reduce(
      (sum, source) => sum + source.parseableEntries,
      0,
    );

    const movieDestinationSuccessLabel = params.routeViaSeerr
      ? 'Requested'
      : 'Added';
    const movieDestinationSuccessCount = params.routeViaSeerr
      ? params.movieBranch.destinationStats.requested
      : params.movieBranch.destinationStats.added;
    const showDestinationSuccessLabel = params.routeViaSeerr
      ? 'Requested'
      : 'Added';
    const showDestinationSuccessCount = params.routeViaSeerr
      ? params.showBranch.destinationStats.requested
      : params.showBranch.destinationStats.added;

    return {
      template: 'jobReportV1',
      version: 1,
      jobId: params.ctx.jobId,
      dryRun: params.ctx.dryRun,
      trigger: params.ctx.trigger,
      headline: ROTTEN_TOMATOES_UPCOMING_JOB_HEADLINE,
      sections: [
        {
          id: 'movies',
          title: 'Movies',
          rows: [
            metricRow({
              label: 'Source pages',
              start: 0,
              changed: params.movieBranch.sourceStats.length,
              end: params.movieBranch.sourceStats.length,
              unit: 'pages',
              note: `Failures: ${movieSourceFailures}`,
            }),
            metricRow({
              label: 'Discovered entries',
              start: 0,
              changed: movieDiscoveredEntries,
              end: movieDiscoveredEntries,
              unit: 'movies',
            }),
            metricRow({
              label: 'Parseable entries',
              start: 0,
              changed: movieParseableEntries,
              end: movieParseableEntries,
              unit: 'movies',
              note: `Skipped without usable year: ${movieSkippedNoYear}`,
            }),
            metricRow({
              label: 'Merged and deduped',
              start: 0,
              changed: params.movieBranch.dedupedMovies.length,
              end: params.movieBranch.dedupedMovies.length,
              unit: 'movies',
              note: `Limit: ${params.effectiveMovieLimit}`,
            }),
            metricRow({
              label: 'Attempted',
              start: 0,
              changed: params.movieBranch.destinationStats.attempted,
              end: params.movieBranch.destinationStats.attempted,
              unit: 'movies',
            }),
            metricRow({
              label: movieDestinationSuccessLabel,
              start: 0,
              changed: movieDestinationSuccessCount,
              end: movieDestinationSuccessCount,
              unit: 'movies',
            }),
            metricRow({
              label: 'Already exists',
              start: 0,
              changed: params.movieBranch.destinationStats.exists,
              end: params.movieBranch.destinationStats.exists,
              unit: 'movies',
            }),
            metricRow({
              label: 'Failed',
              start: 0,
              changed: params.movieBranch.destinationStats.failed,
              end: params.movieBranch.destinationStats.failed,
              unit: 'movies',
            }),
            metricRow({
              label: 'Skipped',
              start: 0,
              changed: params.movieBranch.destinationStats.skipped,
              end: params.movieBranch.destinationStats.skipped,
              unit: 'movies',
            }),
          ],
        },
        {
          id: 'shows',
          title: 'TV Shows',
          rows: [
            metricRow({
              label: 'Source pages',
              start: 0,
              changed: params.showBranch.sourceStats.length,
              end: params.showBranch.sourceStats.length,
              unit: 'pages',
              note: `Failures: ${showSourceFailures}`,
            }),
            metricRow({
              label: 'Discovered entries',
              start: 0,
              changed: showDiscoveredEntries,
              end: showDiscoveredEntries,
              unit: 'shows',
            }),
            metricRow({
              label: 'Parsed entries',
              start: 0,
              changed: showParseableEntries,
              end: showParseableEntries,
              unit: 'shows',
            }),
            metricRow({
              label: 'Score-filtered out',
              start: 0,
              changed: params.showBranch.scoreFilteredOut,
              end: params.showBranch.scoreFilteredOut,
              unit: 'shows',
            }),
            metricRow({
              label: 'Merged and deduped',
              start: 0,
              changed: params.showBranch.dedupedShows.length,
              end: params.showBranch.dedupedShows.length,
              unit: 'shows',
              note: `Limit: ${params.effectiveShowLimit}`,
            }),
            metricRow({
              label: 'Attempted',
              start: 0,
              changed: params.showBranch.destinationStats.attempted,
              end: params.showBranch.destinationStats.attempted,
              unit: 'shows',
            }),
            metricRow({
              label: showDestinationSuccessLabel,
              start: 0,
              changed: showDestinationSuccessCount,
              end: showDestinationSuccessCount,
              unit: 'shows',
            }),
            metricRow({
              label: 'Already exists',
              start: 0,
              changed: params.showBranch.destinationStats.exists,
              end: params.showBranch.destinationStats.exists,
              unit: 'shows',
            }),
            metricRow({
              label: 'Unresolved IDs',
              start: 0,
              changed: params.showBranch.unresolvedIds,
              end: params.showBranch.unresolvedIds,
              unit: 'shows',
            }),
            metricRow({
              label: 'Failed',
              start: 0,
              changed: params.showBranch.destinationStats.failed,
              end: params.showBranch.destinationStats.failed,
              unit: 'shows',
            }),
            metricRow({
              label: 'Skipped',
              start: 0,
              changed: params.showBranch.destinationStats.skipped,
              end: params.showBranch.destinationStats.skipped,
              unit: 'shows',
            }),
            metricRow({
              label: 'Reconciled existing series',
              start: 0,
              changed: params.showBranch.reconciliation.reconciledSeries,
              end: params.showBranch.reconciliation.reconciledSeries,
              unit: 'series',
            }),
            metricRow({
              label: 'Episodes monitored',
              start: 0,
              changed: params.showBranch.reconciliation.episodesMonitored,
              end: params.showBranch.reconciliation.episodesMonitored,
              unit: 'episodes',
            }),
            metricRow({
              label: 'Episodes left unmonitored',
              start: 0,
              changed: params.showBranch.reconciliation.episodesLeftUnmonitored,
              end: params.showBranch.reconciliation.episodesLeftUnmonitored,
              unit: 'episodes',
            }),
            metricRow({
              label: 'Seasons monitored',
              start: 0,
              changed: params.showBranch.reconciliation.seasonsMonitored,
              end: params.showBranch.reconciliation.seasonsMonitored,
              unit: 'seasons',
            }),
            metricRow({
              label: 'Seasons unmonitored',
              start: 0,
              changed: params.showBranch.reconciliation.seasonsUnmonitored,
              end: params.showBranch.reconciliation.seasonsUnmonitored,
              unit: 'seasons',
            }),
            metricRow({
              label: 'Series monitored',
              start: 0,
              changed: params.showBranch.reconciliation.seriesMonitored,
              end: params.showBranch.reconciliation.seriesMonitored,
              unit: 'series',
            }),
            metricRow({
              label: 'Series unmonitored',
              start: 0,
              changed: params.showBranch.reconciliation.seriesUnmonitored,
              end: params.showBranch.reconciliation.seriesUnmonitored,
              unit: 'series',
            }),
          ],
        },
      ],
      tasks: [
        {
          id: 'load_settings',
          title: 'Load settings',
          status: 'success',
          facts: [
            {
              label: 'Manual category',
              value: params.manualCategory ?? 'scheduled/default',
            },
            {
              label: 'Movies enabled',
              value: params.effectiveIncludeMovies,
            },
            {
              label: 'TV enabled',
              value: params.effectiveIncludeShows,
            },
            {
              label: 'Movie limit',
              value: params.effectiveMovieLimit,
            },
            {
              label: 'TV limit',
              value: params.effectiveShowLimit,
            },
            {
              label: 'Route via Seerr',
              value: params.routeViaSeerr,
            },
          ],
        },
        {
          id: 'scrape_movies',
          title: 'Scrape Rotten Tomatoes movie sources',
          status: params.movieBranch.discoveryStatus,
          facts: movieSourceStatsFacts(params.movieBranch.sourceStats),
        },
        {
          id: 'route_movies',
          title: params.routeViaSeerr
            ? 'Send movies to Seerr'
            : 'Send movies to Radarr',
          status: params.movieBranch.routeStatus,
          facts: [
            {
              label: params.routeViaSeerr
                ? 'Attempted requests'
                : 'Attempted adds',
              value: {
                count: params.movieBranch.destinationStats.attempted,
                unit: 'movies',
                items: normalizeTitleList(
                  params.movieBranch.destinationTitles.attemptedTitles,
                ),
              },
            },
            {
              label: params.routeViaSeerr
                ? 'Requested in Seerr'
                : 'Added in Radarr',
              value: {
                count: movieDestinationSuccessCount,
                unit: 'movies',
                items: normalizeTitleList(
                  params.movieBranch.destinationTitles.sentTitles,
                ),
              },
            },
            {
              label: 'Already exists',
              value: {
                count: params.movieBranch.destinationStats.exists,
                unit: 'movies',
                items: normalizeTitleList(
                  params.movieBranch.destinationTitles.existsTitles,
                ),
              },
            },
            {
              label: 'Failed sends',
              value: {
                count: params.movieBranch.destinationStats.failed,
                unit: 'movies',
                items: normalizeTitleList(
                  params.movieBranch.destinationTitles.failedTitles,
                ),
              },
            },
            {
              label: 'Skipped sends',
              value: {
                count: params.movieBranch.destinationStats.skipped,
                unit: 'movies',
                items: normalizeTitleList(
                  params.movieBranch.destinationTitles.skippedTitles,
                ),
              },
            },
          ],
        },
        {
          id: 'scrape_shows',
          title: 'Scrape Rotten Tomatoes TV sources',
          status: params.showBranch.discoveryStatus,
          facts: showSourceStatsFacts(params.showBranch.sourceStats),
        },
        {
          id: 'route_shows',
          title: params.routeViaSeerr
            ? 'Request TV shows in Seerr + reconcile existing Sonarr series'
            : 'Send TV shows to Sonarr + reconcile existing series',
          status: params.showBranch.routeStatus,
          facts: [
            {
              label: params.routeViaSeerr
                ? 'Attempted requests'
                : 'Attempted adds',
              value: {
                count: params.showBranch.destinationStats.attempted,
                unit: 'shows',
                items: normalizeTitleList(
                  params.showBranch.destinationTitles.attemptedTitles,
                ),
              },
            },
            {
              label: params.routeViaSeerr
                ? 'Requested in Seerr'
                : 'Added in Sonarr',
              value: {
                count: showDestinationSuccessCount,
                unit: 'shows',
                items: normalizeTitleList(
                  params.showBranch.destinationTitles.sentTitles,
                ),
              },
            },
            {
              label: 'Already exists',
              value: {
                count: params.showBranch.destinationStats.exists,
                unit: 'shows',
                items: normalizeTitleList(
                  params.showBranch.destinationTitles.existsTitles,
                ),
              },
            },
            {
              label: 'Unresolved IDs',
              value: {
                count: params.showBranch.unresolvedIds,
                unit: 'shows',
                items: [],
              },
            },
            {
              label: 'Failed sends',
              value: {
                count: params.showBranch.destinationStats.failed,
                unit: 'shows',
                items: normalizeTitleList(
                  params.showBranch.destinationTitles.failedTitles,
                ),
              },
            },
            {
              label: 'Skipped sends',
              value: {
                count: params.showBranch.destinationStats.skipped,
                unit: 'shows',
                items: normalizeTitleList(
                  params.showBranch.destinationTitles.skippedTitles,
                ),
              },
            },
            {
              label: 'Reconciled series',
              value: {
                count: params.showBranch.reconciliation.reconciledSeries,
                unit: 'series',
                items: [],
              },
            },
            {
              label: 'Episodes monitored',
              value: {
                count: params.showBranch.reconciliation.episodesMonitored,
                unit: 'episodes',
                items: [],
              },
            },
            {
              label: 'Episodes left unmonitored',
              value: {
                count: params.showBranch.reconciliation.episodesLeftUnmonitored,
                unit: 'episodes',
                items: [],
              },
            },
          ],
        },
      ],
      issues: params.reportIssues,
      raw: {
        manualCategory: params.manualCategory,
        effectiveIncludeMovies: params.effectiveIncludeMovies,
        effectiveIncludeShows: params.effectiveIncludeShows,
        effectiveMovieLimit: params.effectiveMovieLimit,
        effectiveShowLimit: params.effectiveShowLimit,
        routeViaSeerr: params.routeViaSeerr,
        movies: {
          sourceStats: params.movieBranch.sourceStats.map((source) => ({
            url: source.url,
            discoveredEntries: source.discoveredEntries,
            parseableEntries: source.parseableEntries,
            skippedNoYear: source.skippedNoYear,
            failed: source.failed,
            error: source.error,
          })),
          sampleCandidates: params.movieBranch.dedupedMovies
            .slice(0, 25)
            .map((movie) => ({
              title: movie.title,
              year: movie.year,
              href: movie.href,
              sourceUrl: movie.sourceUrl,
            })),
          destinationStats: params.movieBranch.destinationStats,
          destinationTitleBuckets: {
            attempted: normalizeTitleList(
              params.movieBranch.destinationTitles.attemptedTitles,
            ),
            sent: normalizeTitleList(
              params.movieBranch.destinationTitles.sentTitles,
            ),
            exists: normalizeTitleList(
              params.movieBranch.destinationTitles.existsTitles,
            ),
            failed: normalizeTitleList(
              params.movieBranch.destinationTitles.failedTitles,
            ),
            skipped: normalizeTitleList(
              params.movieBranch.destinationTitles.skippedTitles,
            ),
          },
          safeMatchSkips: params.movieBranch.safeMatchSkipCount,
        },
        shows: {
          sourceStats: params.showBranch.sourceStats.map((source) => ({
            url: source.url,
            discoveredEntries: source.discoveredEntries,
            parseableEntries: source.parseableEntries,
            scoreFilteredOut: source.scoreFilteredOut,
            failed: source.failed,
            error: source.error,
          })),
          sampleCandidates: params.showBranch.dedupedShows
            .slice(0, 25)
            .map((show) => ({
              title: show.title,
              year: show.year,
              href: show.href,
              criticsScore: show.criticsScore,
              audienceScore: show.audienceScore,
              sourceUrl: show.sourceUrl,
            })),
          destinationStats: params.showBranch.destinationStats,
          destinationTitleBuckets: {
            attempted: normalizeTitleList(
              params.showBranch.destinationTitles.attemptedTitles,
            ),
            sent: normalizeTitleList(
              params.showBranch.destinationTitles.sentTitles,
            ),
            exists: normalizeTitleList(
              params.showBranch.destinationTitles.existsTitles,
            ),
            failed: normalizeTitleList(
              params.showBranch.destinationTitles.failedTitles,
            ),
            skipped: normalizeTitleList(
              params.showBranch.destinationTitles.skippedTitles,
            ),
          },
          unresolvedIds: params.showBranch.unresolvedIds,
          scoreFilteredOut: params.showBranch.scoreFilteredOut,
          reconciliation: params.showBranch.reconciliation,
        },
      },
    };
  }
}
