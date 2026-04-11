import { Injectable } from '@nestjs/common';
import { RadarrService, type RadarrMovie } from '../radarr/radarr.service';
import { SeerrService } from '../seerr/seerr.service';
import { SettingsService } from '../settings/settings.service';
import {
  decodeHtmlEntities,
  normalizeTitleForMatching,
} from '../lib/title-normalize';
import { errToMessage } from '../log.utils';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import type { JobReportTaskStatus, JobReportV1 } from './job-report-v1';
import { issue, metricRow } from './job-report-v1';

type ScrapedMovie = {
  title: string;
  year: string;
  href: string;
  startDate: string;
  sourceUrl: string;
};

type SourceScrapeStats = {
  url: string;
  discoveredEntries: number;
  parseableEntries: number;
  skippedNoYear: number;
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

type RadarrMovieIndex = {
  titleYearKeys: Set<string>;
  tmdbIds: Set<number>;
};

type RadarrConfig = {
  baseUrl: string;
  apiKey: string;
};

type SeerrConfig = {
  baseUrl: string;
  apiKey: string;
};

const ROTTEN_TOMATOES_UPCOMING_JOB_HEADLINE = 'Rotten Tomatoes Upcoming Movies';
const ROTTEN_TOMATOES_SOURCE_URLS = [
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
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REPORT_TITLE_ITEMS = 100;
const CLOSE_YEAR_MATCH_DELTA = 1;

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

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    const titleMatch = cardHtml.match(
      /data-qa="discovery-media-list-item-title"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const title = normalizeTitleForMatching(
      stripTags(decodeHtmlEntities(titleMatch?.[1] ?? '')),
    );
    if (!title) continue;

    discoveredEntries += 1;
    const startDateMatch = cardHtml.match(
      /data-qa="discovery-media-list-item-start-date"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const startDate = normalizeTitleForMatching(
      stripTags(decodeHtmlEntities(startDateMatch?.[1] ?? '')),
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

function sourceStatsFact(
  stats: SourceScrapeStats[],
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

@Injectable()
export class RottenTomatoesUpcomingMoviesJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly radarr: RadarrService,
    private readonly seerr: SeerrService,
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
    });

    await setProgress('load_settings', 'Loading settings…');
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);
    const routeViaSeerr =
      pickBool(settings, 'jobs.rottenTomatoesUpcomingMovies.routeViaSeerr') ??
      false;

    await setProgress('scrape_sources', 'Scraping Rotten Tomatoes sources…', {
      totalSources: ROTTEN_TOMATOES_SOURCE_URLS.length,
    });

    const scrapedMovies: ScrapedMovie[] = [];
    const sourceStats: SourceScrapeStats[] = [];
    const reportIssues: JobReportV1['issues'] = [];
    let sourceFailureCount = 0;

    for (const sourceUrl of ROTTEN_TOMATOES_SOURCE_URLS) {
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
      } catch (err) {
        const error = errToMessage(err);
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
            `Rotten Tomatoes source failed and was skipped: ${sourceUrl} (${error})`,
          ),
        );
        await ctx.warn(
          'rottenTomatoesUpcomingMovies: source scrape failed (continuing)',
          {
            sourceUrl,
            error,
          },
        );
      }
    }

    const dedupedMovies = dedupeScrapedMovies(scrapedMovies);
    const discoveryFailed =
      sourceFailureCount === ROTTEN_TOMATOES_SOURCE_URLS.length ||
      dedupedMovies.length === 0;

    const destinationStats: DestinationStats = {
      attempted: 0,
      requested: 0,
      added: 0,
      exists: 0,
      failed: 0,
      skipped: 0,
    };
    const destinationTitles: DestinationTitleBuckets = {
      attemptedTitles: [],
      sentTitles: [],
      existsTitles: [],
      failedTitles: [],
      skippedTitles: [],
    };

    if (discoveryFailed) {
      reportIssues.push(
        issue(
          'error',
          'Rotten Tomatoes discovery failed: all sources failed or no usable movie cards were parsed.',
        ),
      );

      const report = this.buildReport({
        ctx,
        sourceStats,
        reportIssues,
        dedupedMovies,
        destinationStats,
        destinationTitles,
        routeViaSeerr,
        discoveryTaskStatus: 'failed',
        prepareTaskStatus: 'skipped',
        routeTaskStatus: 'skipped',
      });

      await setProgress('failed', 'No usable Rotten Tomatoes movies found.', {
        sourceFailures: sourceFailureCount,
        dedupedCandidates: dedupedMovies.length,
      });

      return { summary: report as unknown as JsonObject };
    }

    let prepareTaskStatus: JobReportTaskStatus = ctx.dryRun
      ? 'skipped'
      : 'success';
    let routeTaskStatus: JobReportTaskStatus = ctx.dryRun
      ? 'skipped'
      : 'success';
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
    } else {
      await setProgress(
        'prepare_radarr',
        routeViaSeerr
          ? 'Preparing Radarr lookup + Seerr routing…'
          : 'Preparing Radarr routing…',
        {
          candidates: dedupedMovies.length,
          routeViaSeerr,
        },
      );

      const radarrConfig = this.resolveRadarrConfig(settings, secrets);

      if (!radarrConfig) {
        destinationStats.skipped = dedupedMovies.length;
        destinationTitles.skippedTitles = normalizeTitleList(
          dedupedMovies.map((movie) => movie.title),
        );
        prepareTaskStatus = 'skipped';
        routeTaskStatus = 'skipped';
        reportIssues.push(
          issue(
            'warn',
            routeViaSeerr
              ? 'Radarr lookup is required for Rotten Tomatoes Seerr routing, but Radarr is not configured; all movies were skipped.'
              : 'Radarr is not configured; Rotten Tomatoes discovery completed but all movies were skipped.',
          ),
        );
      } else {
        try {
          const existingMovies = await this.radarr.listMovies(radarrConfig);
          radarrIndex = buildRadarrMovieIndex(existingMovies);
        } catch (err) {
          const error = errToMessage(err);
          reportIssues.push(
            issue(
              'warn',
              `Radarr library snapshot failed; continuing with lookup/add safeguards only. (${error})`,
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
            }).catch((err) => ({ error: errToMessage(err) }));

        if (routeViaSeerr && !seerrConfig) {
          destinationStats.skipped = dedupedMovies.length;
          destinationTitles.skippedTitles = normalizeTitleList(
            dedupedMovies.map((movie) => movie.title),
          );
          prepareTaskStatus = 'skipped';
          routeTaskStatus = 'skipped';
          reportIssues.push(
            issue(
              'warn',
              'Seerr route selected but Seerr is not configured; all movies were skipped.',
            ),
          );
        } else if (radarrDefaults && 'error' in radarrDefaults) {
          destinationStats.skipped = dedupedMovies.length;
          destinationTitles.skippedTitles = normalizeTitleList(
            dedupedMovies.map((movie) => movie.title),
          );
          prepareTaskStatus = 'skipped';
          routeTaskStatus = 'skipped';
          reportIssues.push(
            issue(
              'warn',
              `Radarr defaults could not be resolved; all movies were skipped. (${radarrDefaults.error})`,
            ),
          );
        } else {
          await setProgress(
            'route_movies',
            routeViaSeerr
              ? 'Sending movies to Seerr…'
              : 'Sending movies to Radarr…',
            {
              candidates: dedupedMovies.length,
              routeViaSeerr,
            },
          );

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
              const error = errToMessage(err);
              destinationStats.failed += 1;
              destinationTitles.failedTitles.push(movie.title);
              await ctx.warn(
                'rottenTomatoesUpcomingMovies: Radarr lookup failed (continuing)',
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
                  'rottenTomatoesUpcomingMovies: no Radarr lookup match found',
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
              lookupYear !== null
                ? buildTitleYearKey(lookupTitle, lookupYear)
                : '';

            if (lookupTmdbId === null) {
              safeMatchSkipCount += 1;
              destinationStats.skipped += 1;
              destinationTitles.skippedTitles.push(lookupTitle);
              await ctx.warn(
                'rottenTomatoesUpcomingMovies: Radarr lookup returned no TMDB id',
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
                  'rottenTomatoesUpcomingMovies: Seerr request failed (continuing)',
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
                'rottenTomatoesUpcomingMovies: Radarr add failed (continuing)',
                {
                  title: lookupTitle,
                  year: lookupYear,
                  error: errToMessage(err),
                },
              );
            }
          }
        }
      }
    }

    if (destinationStats.failed > 0) {
      reportIssues.push(
        issue(
          'warn',
          `Destination reported ${destinationStats.failed} failed operation(s); the run continued.`,
        ),
      );
    }

    if (safeMatchSkipCount > 0 && !ctx.dryRun) {
      reportIssues.push(
        issue(
          'warn',
          `Some Rotten Tomatoes movies were skipped because Radarr lookup did not find a safe match (${safeMatchSkipCount}).`,
        ),
      );
    }

    const report = this.buildReport({
      ctx,
      sourceStats,
      reportIssues,
      dedupedMovies,
      destinationStats,
      destinationTitles,
      routeViaSeerr,
      discoveryTaskStatus: 'success',
      prepareTaskStatus,
      routeTaskStatus,
    });

    await setProgress('done', 'Done.', {
      dedupedCandidates: dedupedMovies.length,
      destinationAttempted: destinationStats.attempted,
      destinationAdded: destinationStats.added,
      destinationRequested: destinationStats.requested,
      destinationExists: destinationStats.exists,
      destinationFailed: destinationStats.failed,
      destinationSkipped: destinationStats.skipped,
    });
    await ctx.info('rottenTomatoesUpcomingMovies: done', {
      dedupedCandidates: dedupedMovies.length,
      destinationStats,
    });

    return {
      summary: report as unknown as JsonObject,
    };
  }

  private async fetchSourceHtml(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
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

  private buildReport(params: {
    ctx: JobContext;
    sourceStats: SourceScrapeStats[];
    reportIssues: JobReportV1['issues'];
    dedupedMovies: ScrapedMovie[];
    destinationStats: DestinationStats;
    destinationTitles: DestinationTitleBuckets;
    routeViaSeerr: boolean;
    discoveryTaskStatus: JobReportTaskStatus;
    prepareTaskStatus: JobReportTaskStatus;
    routeTaskStatus: JobReportTaskStatus;
  }): JobReportV1 {
    const totalDiscoveredEntries = params.sourceStats.reduce(
      (sum, source) => sum + source.discoveredEntries,
      0,
    );
    const totalParseableEntries = params.sourceStats.reduce(
      (sum, source) => sum + source.parseableEntries,
      0,
    );
    const totalSkippedNoYear = params.sourceStats.reduce(
      (sum, source) => sum + source.skippedNoYear,
      0,
    );
    const totalSourceFailures = params.sourceStats.filter(
      (source) => source.failed,
    ).length;
    const sourceFacts = sourceStatsFact(params.sourceStats);
    const destinationName = params.routeViaSeerr ? 'Seerr' : 'Radarr';
    const destinationSectionTitle = params.routeViaSeerr
      ? 'Seerr requests'
      : 'Radarr adds';
    const destinationSuccessLabel = params.routeViaSeerr
      ? 'Requested'
      : 'Added';
    const destinationSuccessCount = params.routeViaSeerr
      ? params.destinationStats.requested
      : params.destinationStats.added;

    return {
      template: 'jobReportV1',
      version: 1,
      jobId: params.ctx.jobId,
      dryRun: params.ctx.dryRun,
      trigger: params.ctx.trigger,
      headline: ROTTEN_TOMATOES_UPCOMING_JOB_HEADLINE,
      sections: [
        {
          id: 'discovery',
          title: 'Discovery',
          rows: [
            metricRow({
              label: 'Source pages',
              start: 0,
              changed: params.sourceStats.length,
              end: params.sourceStats.length,
              unit: 'pages',
              note: `Failures: ${totalSourceFailures}`,
            }),
            metricRow({
              label: 'Discovered entries',
              start: 0,
              changed: totalDiscoveredEntries,
              end: totalDiscoveredEntries,
              unit: 'movies',
            }),
            metricRow({
              label: 'Parseable entries',
              start: 0,
              changed: totalParseableEntries,
              end: totalParseableEntries,
              unit: 'movies',
              note: `Skipped without usable year: ${totalSkippedNoYear}`,
            }),
            metricRow({
              label: 'Merged and deduped',
              start: 0,
              changed: params.dedupedMovies.length,
              end: params.dedupedMovies.length,
              unit: 'movies',
            }),
          ],
        },
        {
          id: 'destination',
          title: destinationSectionTitle,
          rows: [
            metricRow({
              label: 'Attempted',
              start: 0,
              changed: params.destinationStats.attempted,
              end: params.destinationStats.attempted,
              unit: 'movies',
            }),
            metricRow({
              label: destinationSuccessLabel,
              start: 0,
              changed: destinationSuccessCount,
              end: destinationSuccessCount,
              unit: 'movies',
            }),
            metricRow({
              label: 'Already exists',
              start: 0,
              changed: params.destinationStats.exists,
              end: params.destinationStats.exists,
              unit: 'movies',
            }),
            metricRow({
              label: 'Failed',
              start: 0,
              changed: params.destinationStats.failed,
              end: params.destinationStats.failed,
              unit: 'movies',
            }),
            metricRow({
              label: 'Skipped',
              start: 0,
              changed: params.destinationStats.skipped,
              end: params.destinationStats.skipped,
              unit: 'movies',
            }),
          ],
        },
      ],
      tasks: [
        {
          id: 'load_settings',
          title: 'Load settings',
          status: 'success',
        },
        {
          id: 'scrape_sources',
          title: 'Scrape Rotten Tomatoes sources',
          status: params.discoveryTaskStatus,
          facts: sourceFacts,
        },
        {
          id: 'prepare_radarr',
          title: params.routeViaSeerr
            ? 'Prepare Radarr lookup + Seerr routing'
            : 'Prepare Radarr routing',
          status: params.prepareTaskStatus,
        },
        {
          id: 'route_movies',
          title: params.routeViaSeerr ? 'Send to Seerr' : 'Send to Radarr',
          status: params.routeTaskStatus,
          facts: [
            {
              label: params.routeViaSeerr
                ? 'Attempted requests'
                : 'Attempted adds',
              value: {
                count: params.destinationStats.attempted,
                unit: 'movies',
                items: normalizeTitleList(
                  params.destinationTitles.attemptedTitles,
                ),
              },
            },
            {
              label: params.routeViaSeerr
                ? 'Requested in Seerr'
                : 'Added in Radarr',
              value: {
                count: destinationSuccessCount,
                unit: 'movies',
                items: normalizeTitleList(params.destinationTitles.sentTitles),
              },
            },
            {
              label: 'Already exists',
              value: {
                count: params.destinationStats.exists,
                unit: 'movies',
                items: normalizeTitleList(
                  params.destinationTitles.existsTitles,
                ),
              },
            },
            {
              label: 'Failed adds',
              value: {
                count: params.destinationStats.failed,
                unit: 'movies',
                items: normalizeTitleList(
                  params.destinationTitles.failedTitles,
                ),
              },
            },
            {
              label: 'Skipped sends',
              value: {
                count: params.destinationStats.skipped,
                unit: 'movies',
                items: normalizeTitleList(
                  params.destinationTitles.skippedTitles,
                ),
              },
            },
          ],
        },
      ],
      issues: params.reportIssues,
      raw: {
        sourceStats: params.sourceStats.map((source) => ({
          url: source.url,
          discoveredEntries: source.discoveredEntries,
          parseableEntries: source.parseableEntries,
          skippedNoYear: source.skippedNoYear,
          failed: source.failed,
          error: source.error,
        })),
        sampleCandidates: params.dedupedMovies.slice(0, 25).map((movie) => ({
          title: movie.title,
          year: movie.year,
          href: movie.href,
          sourceUrl: movie.sourceUrl,
        })),
        routeViaSeerr: params.routeViaSeerr,
        destinationName,
        destinationStats: params.destinationStats,
        destinationTitleBuckets: {
          attempted: normalizeTitleList(
            params.destinationTitles.attemptedTitles,
          ),
          sent: normalizeTitleList(params.destinationTitles.sentTitles),
          exists: normalizeTitleList(params.destinationTitles.existsTitles),
          failed: normalizeTitleList(params.destinationTitles.failedTitles),
          skipped: normalizeTitleList(params.destinationTitles.skippedTitles),
        },
      },
    };
  }
}
