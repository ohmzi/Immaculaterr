import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { SettingsService } from '../settings/settings.service';
import { WatchedCollectionsRefresherService } from '../watched-movie-recommendations/watched-collections-refresher.service';
import { PlexServerService } from '../plex/plex-server.service';
import {
  buildUserCollectionName,
  RECENTLY_WATCHED_MOVIE_COLLECTION_BASE_NAME,
  CHANGE_OF_MOVIE_TASTE_COLLECTION_BASE_NAME,
  RECENTLY_WATCHED_SHOW_COLLECTION_BASE_NAME,
  CHANGE_OF_SHOW_TASTE_COLLECTION_BASE_NAME,
} from '../plex/plex-collections.utils';
import { ImmaculateTasteCollectionService } from '../immaculate-taste-collection/immaculate-taste-collection.service';
import { ImmaculateTasteShowCollectionService } from '../immaculate-taste-collection/immaculate-taste-show-collection.service';
import { resolvePlexLibrarySelection } from '../plex/plex-library-selection.utils';
import { parseNetflixCsv } from './netflix-csv.parser';
import type {
  JobContext,
  JsonObject,
  JsonValue,
  JobRunResult,
} from '../jobs/jobs.types';
import type { JobReportTaskStatus, JobReportV1 } from '../jobs/job-report-v1';
import { metricRow, issue } from '../jobs/job-report-v1';

const SEED_CAP = 50;
const TMDB_THROTTLE_MS = 200;
const TMDB_SEED_RETRY_DELAYS_MS = [0, 60_000, 180_000] as const;
const NETFLIX_IMPORT_DB_BATCH_SIZE = 200;
const NETFLIX_IMPORT_SIMILAR_BASE = 'Netflix Import Picks';
const NETFLIX_IMPORT_CONTRAST_BASE = 'Netflix Import: Change of Taste';
const PLEX_HISTORY_SIMILAR_BASE = 'Plex History Picks';
const PLEX_HISTORY_CONTRAST_BASE = 'Plex History: Change of Taste';

type ImportSource = 'netflix' | 'plex';

function importSourceLabel(source: ImportSource): string {
  if (source === 'plex') return 'Plex History';
  return 'Netflix Import';
}

function importSimilarBase(source: ImportSource): string {
  return source === 'plex'
    ? PLEX_HISTORY_SIMILAR_BASE
    : NETFLIX_IMPORT_SIMILAR_BASE;
}

function importContrastBase(source: ImportSource): string {
  return source === 'plex'
    ? PLEX_HISTORY_CONTRAST_BASE
    : NETFLIX_IMPORT_CONTRAST_BASE;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
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

function pickBool(obj: Record<string, unknown>, path: string): boolean | null {
  const v = pick(obj, path);
  return typeof v === 'boolean' ? v : null;
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
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseHttpStatus(message: string): number | null {
  const match = message.match(/\bHTTP\s+(\d{3})\b/);
  if (!match) return null;
  const status = Number.parseInt(match[1], 10);
  return Number.isFinite(status) ? status : null;
}

function isRetryableTmdbSeedError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  if (!message.includes('TMDB request failed')) return false;
  const status = parseHttpStatus(message);
  if (status !== null) return status >= 500;
  return true;
}

function formatRetryDelay(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function isUniqueConstraintError(error: unknown): boolean {
  const knownError = error as Prisma.PrismaClientKnownRequestError | undefined;
  const code = knownError?.code;
  return code === 'P2002';
}

export type ImportUploadResult = {
  totalRawRows: number;
  totalUnique: number;
  newlyInserted: number;
  alreadyImported: number;
  jobId: string | null;
  warnings: string[];
};

export type ImportStatusResult = {
  total: number;
  pending: number;
  matched: number;
  processed: number;
  unmatched: number;
};

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tmdb: TmdbService,
    private readonly recommendations: RecommendationsService,
    private readonly settingsService: SettingsService,
    private readonly watchedRefresher: WatchedCollectionsRefresherService,
    private readonly plexServer: PlexServerService,
    private readonly immaculateTaste: ImmaculateTasteCollectionService,
    private readonly immaculateTasteTv: ImmaculateTasteShowCollectionService,
  ) {}

  private async runSeedWithTransientTmdbRetries<T>(
    ctx: JobContext,
    seedTitle: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const totalAttempts = TMDB_SEED_RETRY_DELAYS_MS.length + 1;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!isRetryableTmdbSeedError(error) || attempt === totalAttempts) {
          throw error;
        }

        const delayMs = TMDB_SEED_RETRY_DELAYS_MS[attempt - 1] ?? 0;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        await ctx.warn(
          delayMs > 0
            ? `Seed transient TMDB failure: ${seedTitle} — retrying in ${formatRetryDelay(delayMs)}`
            : `Seed transient TMDB failure: ${seedTitle} — retrying immediately`,
          {
            attempt,
            totalAttempts,
            delayMs,
            error: errorMessage,
            seedTitle,
          },
        );

        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(
          typeof lastError === 'string' && lastError.trim()
            ? lastError
            : 'Unknown seed failure',
        );
  }

  async fetchAndStorePlexHistory(
    userId: string,
    ctx: JobContext,
  ): Promise<void> {
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const plexUseHistory = pickBool(settings, 'plex.useHistory') ?? false;
    if (!plexUseHistory && ctx.trigger !== 'manual') {
      await ctx.info(
        'Plex history import is disabled in settings. Enable it in the wizard or run manually.',
      );
      return;
    }

    const plexBaseUrl =
      pickString(settings, 'plex.baseUrl') ||
      pickString(settings, 'plex.url') ||
      '';
    const plexToken =
      pickString(secrets, 'plex.token') ||
      pickString(secrets, 'plexToken') ||
      '';

    if (!plexBaseUrl || !plexToken) {
      await ctx.warn('Plex server URL or token not configured — skipping.');
      return;
    }

    await ctx.patchSummary({
      progress: {
        step: 'phase0_fetch',
        message: 'Fetching Plex watch history...',
        updatedAt: new Date().toISOString(),
      },
    });

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const librarySelection = resolvePlexLibrarySelection({
      settings,
      sections,
    });
    const selectedSet = new Set(librarySelection.selectedSectionKeys);
    const movieLibKeys: string[] = [];
    const tvLibKeys: string[] = [];
    for (const lib of librarySelection.eligibleLibraries) {
      if (!selectedSet.has(lib.key)) continue;
      if (lib.type === 'movie') movieLibKeys.push(lib.key);
      else if (lib.type === 'show') tvLibKeys.push(lib.key);
    }

    if (movieLibKeys.length === 0 && tvLibKeys.length === 0) {
      await ctx.info('No selected Plex libraries found — nothing to scan.');
      return;
    }

    const existingTmdbIds = new Set<number>(
      (
        await this.prisma.importedWatchEntry.findMany({
          where: { userId, source: 'plex' },
          select: { tmdbId: true },
        })
      )
        .map((e) => e.tmdbId)
        .filter((id): id is number => id !== null),
    );

    let totalFound = 0;
    let newlyInserted = 0;
    let alreadyImported = 0;
    const skippedNoTmdb = 0;
    const failedSections: string[] = [];

    for (const key of movieLibKeys) {
      const lib = librarySelection.eligibleLibraries.find((l) => l.key === key);
      const libTitle = lib?.title ?? key;
      await ctx.patchSummary({
        progress: {
          step: 'phase0_fetch',
          message: `Scanning movie library '${libTitle}'...`,
          updatedAt: new Date().toISOString(),
        },
      });

      try {
        const watched =
          await this.plexServer.listWatchedMovieDetailsForSectionKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: key,
          });

        for (const item of watched) {
          totalFound++;
          if (existingTmdbIds.has(item.tmdbId)) {
            alreadyImported++;
            continue;
          }
          existingTmdbIds.add(item.tmdbId);
          try {
            await this.prisma.importedWatchEntry.create({
              data: {
                userId,
                source: 'plex',
                rawTitle: item.title,
                parsedTitle: item.title,
                tmdbId: item.tmdbId,
                mediaType: 'movie',
                status: 'matched',
                watchedAt: item.lastViewedAt
                  ? new Date(item.lastViewedAt * 1000)
                  : null,
              },
            });
            newlyInserted++;
          } catch {
            alreadyImported++;
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        failedSections.push(`${libTitle}: ${errMsg}`);
        this.logger.warn(
          `Failed to scan movie library '${libTitle}': ${errMsg}`,
        );
      }
    }

    for (const key of tvLibKeys) {
      const lib = librarySelection.eligibleLibraries.find((l) => l.key === key);
      const libTitle = lib?.title ?? key;
      await ctx.patchSummary({
        progress: {
          step: 'phase0_fetch',
          message: `Scanning TV library '${libTitle}'...`,
          updatedAt: new Date().toISOString(),
        },
      });

      try {
        const watched =
          await this.plexServer.listWatchedShowDetailsForSectionKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: key,
          });

        for (const item of watched) {
          totalFound++;
          if (existingTmdbIds.has(item.tmdbId)) {
            alreadyImported++;
            continue;
          }
          existingTmdbIds.add(item.tmdbId);
          try {
            await this.prisma.importedWatchEntry.create({
              data: {
                userId,
                source: 'plex',
                rawTitle: item.title,
                parsedTitle: item.title,
                tmdbId: item.tmdbId,
                tvdbId: item.tvdbId,
                mediaType: 'tv',
                status: 'matched',
                watchedAt: item.lastViewedAt
                  ? new Date(item.lastViewedAt * 1000)
                  : null,
              },
            });
            newlyInserted++;
          } catch {
            alreadyImported++;
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        failedSections.push(`${libTitle}: ${errMsg}`);
        this.logger.warn(`Failed to scan TV library '${libTitle}': ${errMsg}`);
      }
    }

    const parts: string[] = [
      `${totalFound} watched items found`,
      `${newlyInserted} newly imported`,
      `${alreadyImported} already imported`,
    ];
    if (skippedNoTmdb > 0)
      parts.push(`${skippedNoTmdb} skipped (no TMDB match)`);
    if (failedSections.length > 0) {
      for (const s of failedSections) {
        await ctx.warn(`Failed to scan: ${s}`);
      }
    }
    await ctx.info(parts.join(', '));

    if (totalFound === 0) {
      await ctx.info('No watched items found in your Plex libraries.');
    }
  }

  async parseAndStoreNetflixCsv(
    userId: string,
    buffer: Buffer,
  ): Promise<Omit<ImportUploadResult, 'jobId' | 'warnings'>> {
    const parsed = parseNetflixCsv(buffer);
    const entries = parsed.entries;
    const totalRawRows = parsed.totalRawRows;
    const totalUnique = entries.length;

    if (!totalUnique) {
      return {
        totalRawRows: 0,
        totalUnique: 0,
        newlyInserted: 0,
        alreadyImported: 0,
      };
    }

    const existingParsedTitles = new Set<string>();
    for (const batch of chunk(
      entries.map((entry) => entry.parsedTitle),
      NETFLIX_IMPORT_DB_BATCH_SIZE,
    )) {
      const existingEntries = await this.prisma.importedWatchEntry.findMany({
        where: {
          userId,
          source: 'netflix',
          parsedTitle: { in: batch },
        },
        select: { parsedTitle: true },
      });
      for (const entry of existingEntries) {
        existingParsedTitles.add(entry.parsedTitle);
      }
    }

    const rowsToInsert = entries
      .filter((entry) => !existingParsedTitles.has(entry.parsedTitle))
      .map((entry) => ({
        userId,
        source: 'netflix' as const,
        rawTitle: entry.rawTitle,
        parsedTitle: entry.parsedTitle,
        watchedAt: entry.watchedAt,
        status: 'pending' as const,
      }));

    let newlyInserted = 0;
    for (const batch of chunk(rowsToInsert, NETFLIX_IMPORT_DB_BATCH_SIZE)) {
      try {
        const result = await this.prisma.importedWatchEntry.createMany({
          data: batch,
        });
        newlyInserted += result.count;
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        for (const row of batch) {
          try {
            await this.prisma.importedWatchEntry.create({
              data: row,
            });
            newlyInserted++;
          } catch (createError) {
            if (!isUniqueConstraintError(createError)) {
              throw createError;
            }
          }
        }
      }
    }

    return {
      totalRawRows,
      totalUnique,
      newlyInserted,
      alreadyImported: totalUnique - newlyInserted,
    };
  }

  async getImportStatus(userId: string): Promise<ImportStatusResult> {
    const entries = await this.prisma.importedWatchEntry.groupBy({
      by: ['status'],
      where: { userId, source: 'netflix' },
      _count: true,
    });

    const counts: ImportStatusResult = {
      total: 0,
      pending: 0,
      matched: 0,
      processed: 0,
      unmatched: 0,
    };

    for (const row of entries) {
      const c = row._count;
      counts.total += c;
      if (row.status === 'pending') counts.pending = c;
      else if (row.status === 'matched') counts.matched = c;
      else if (row.status === 'processed') counts.processed = c;
      else if (row.status === 'unmatched') counts.unmatched = c;
    }

    return counts;
  }

  async hasPendingEntries(userId: string): Promise<boolean> {
    const count = await this.prisma.importedWatchEntry.count({
      where: { userId, source: 'netflix', status: 'pending' },
    });
    return count > 0;
  }

  async getEntryCounts(
    userId: string,
  ): Promise<{ pending: number; matched: number; processed: number }> {
    const [pending, matched, processed] = await Promise.all([
      this.prisma.importedWatchEntry.count({
        where: { userId, source: 'netflix', status: 'pending' },
      }),
      this.prisma.importedWatchEntry.count({
        where: { userId, source: 'netflix', status: 'matched' },
      }),
      this.prisma.importedWatchEntry.count({
        where: { userId, source: 'netflix', status: 'processed' },
      }),
    ]);
    return { pending, matched, processed };
  }

  async processImportedEntries(
    ctx: JobContext,
    source: ImportSource = 'netflix',
  ): Promise<JobRunResult> {
    const userId = ctx.userId;
    const summary: JsonObject = {
      phase1_classification: {},
      phase2_recommendations: {},
      phase3_aggregation: {},
      phase4_collections: {},
    };

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const tmdbApiKey =
      pickString(secrets, 'tmdb.apiKey') ||
      pickString(secrets, 'tmdbApiKey') ||
      pickString(secrets, 'tmdb.api_key');

    if (!tmdbApiKey) {
      await ctx.error('TMDB API key is required to classify imported titles');
      const report: JobReportV1 = {
        template: 'jobReportV1',
        version: 1,
        jobId: ctx.jobId,
        dryRun: ctx.dryRun,
        trigger: ctx.trigger,
        headline: `${importSourceLabel(source)} Watch History Import Report`,
        sections: [],
        tasks: [
          {
            id: 'classification',
            title: `${importSourceLabel(source)} — Classification`,
            status: 'failed',
            issues: [
              issue('error', 'TMDB API key is required to classify titles'),
            ],
          },
        ],
        issues: [issue('error', 'TMDB API key is required to classify titles')],
        raw: { skipped: 'TMDB key missing' },
      };
      await ctx.setSummary(report as unknown as JsonObject);
      return { summary: report as unknown as JsonObject };
    }

    // --- Phase 1: TMDB Classification ---
    await ctx.patchSummary({
      progress: {
        step: 'phase1_classification',
        message: 'Classifying titles via TMDB...',
        updatedAt: new Date().toISOString(),
      },
    });

    const pendingEntries = await this.prisma.importedWatchEntry.findMany({
      where: { userId, source, status: 'pending' },
      orderBy: { watchedAt: 'desc' },
    });

    let movieCount = 0;
    let tvCount = 0;
    let unmatchedCount = 0;
    const classifiedMovieTitles: string[] = [];
    const classifiedTvTitles: string[] = [];
    const unmatchedTitles: string[] = [];

    for (let i = 0; i < pendingEntries.length; i++) {
      const entry = pendingEntries[i];
      await ctx.patchSummary({
        progress: {
          step: 'phase1_classification',
          message: `Classifying ${i + 1}/${pendingEntries.length}: ${entry.parsedTitle}`,
          current: i + 1,
          total: pendingEntries.length,
          updatedAt: new Date().toISOString(),
        },
      });

      const result = await this.classifyTitle(
        entry.parsedTitle,
        tmdbApiKey,
        ctx,
      );

      if (result) {
        await this.prisma.importedWatchEntry.update({
          where: { id: entry.id },
          data: {
            mediaType: result.mediaType,
            tmdbId: result.tmdbId,
            tvdbId: result.tvdbId ?? null,
            matchedTitle: result.matchedTitle,
            status: 'matched',
          },
        });
        if (result.mediaType === 'movie') {
          movieCount++;
          classifiedMovieTitles.push(result.matchedTitle);
        } else {
          tvCount++;
          classifiedTvTitles.push(result.matchedTitle);
        }
      } else {
        await this.prisma.importedWatchEntry.update({
          where: { id: entry.id },
          data: { status: 'unmatched' },
        });
        unmatchedCount++;
        unmatchedTitles.push(entry.parsedTitle);
      }

      await sleep(TMDB_THROTTLE_MS);
    }

    await ctx.info(
      `Phase 1 complete: ${movieCount} movies, ${tvCount} TV shows, ${unmatchedCount} unmatched`,
    );

    summary.phase1_classification = {
      total: pendingEntries.length,
      movies: movieCount,
      tvShows: tvCount,
      unmatched: unmatchedCount,
      skipped: null,
    };

    // --- Check Plex prerequisites for Phase 2+ ---
    const plexBaseUrl = normalizeHttpUrl(
      pickString(settings, 'plex.baseUrl') ||
        pickString(settings, 'plexBaseUrl'),
    );
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');

    if (!plexBaseUrl || !plexToken) {
      await ctx.warn(
        'Plex not configured — recommendations skipped. Classified titles saved for future processing.',
      );
      const report: JobReportV1 = {
        template: 'jobReportV1',
        version: 1,
        jobId: ctx.jobId,
        dryRun: ctx.dryRun,
        trigger: ctx.trigger,
        headline: `${importSourceLabel(source)} Watch History Import Report`,
        sections: [],
        tasks: [
          {
            id: 'classification',
            title: `${importSourceLabel(source)} — Classification`,
            status: 'success',
            rows: [
              metricRow({ label: 'Movies', end: movieCount, unit: 'titles' }),
              metricRow({ label: 'TV shows', end: tvCount, unit: 'titles' }),
              metricRow({
                label: 'Unmatched',
                end: unmatchedCount,
                unit: 'titles',
              }),
            ],
            facts: [
              ...(classifiedMovieTitles.length
                ? [
                    {
                      label: 'Movies',
                      value: {
                        count: classifiedMovieTitles.length,
                        unit: 'titles',
                        items: classifiedMovieTitles.sort(),
                      } as JsonValue,
                    },
                  ]
                : []),
              ...(classifiedTvTitles.length
                ? [
                    {
                      label: 'TV Shows',
                      value: {
                        count: classifiedTvTitles.length,
                        unit: 'titles',
                        items: classifiedTvTitles.sort(),
                      } as JsonValue,
                    },
                  ]
                : []),
              ...(unmatchedTitles.length
                ? [
                    {
                      label: 'Unmatched',
                      value: {
                        count: unmatchedTitles.length,
                        unit: 'titles',
                        items: unmatchedTitles.sort(),
                      } as JsonValue,
                    },
                  ]
                : []),
            ],
          },
          {
            id: 'recommendations',
            title: `${importSourceLabel(source)} — Recommendations`,
            status: 'skipped',
            issues: [issue('warn', 'Plex not configured')],
          },
        ],
        issues: [
          issue('warn', 'Plex not configured — recommendations skipped'),
        ],
        raw: summary,
      };
      await ctx.setSummary(report as unknown as JsonObject);
      return { summary: report as unknown as JsonObject };
    }

    const plexUsers = await this.prisma.plexUser.findMany({
      where: { isAdmin: true },
      take: 1,
    });
    const adminPlexUser = plexUsers[0] ?? null;

    if (!adminPlexUser) {
      await ctx.warn(
        'No Plex user configured — recommendations require a Plex user.',
      );
      const report: JobReportV1 = {
        template: 'jobReportV1',
        version: 1,
        jobId: ctx.jobId,
        dryRun: ctx.dryRun,
        trigger: ctx.trigger,
        headline: `${importSourceLabel(source)} Watch History Import Report`,
        sections: [],
        tasks: [
          {
            id: 'classification',
            title: `${importSourceLabel(source)} — Classification`,
            status: 'success',
            rows: [
              metricRow({ label: 'Movies', end: movieCount, unit: 'titles' }),
              metricRow({ label: 'TV shows', end: tvCount, unit: 'titles' }),
              metricRow({
                label: 'Unmatched',
                end: unmatchedCount,
                unit: 'titles',
              }),
            ],
          },
          {
            id: 'recommendations',
            title: `${importSourceLabel(source)} — Recommendations`,
            status: 'skipped',
            issues: [issue('warn', 'No Plex user configured')],
          },
        ],
        issues: [issue('warn', 'No Plex user — recommendations skipped')],
        raw: summary,
      };
      await ctx.setSummary(report as unknown as JsonObject);
      return { summary: report as unknown as JsonObject };
    }

    const plexUserId = adminPlexUser.id;
    const plexUserTitle = adminPlexUser.plexAccountTitle;

    let machineIdentifier = '';
    try {
      machineIdentifier = await this.plexServer.getMachineIdentifier({
        baseUrl: plexBaseUrl,
        token: plexToken,
      });
    } catch {
      // Plex server not reachable — skip
    }

    // Resolve selected libraries from Plex (same pattern as existing jobs)
    const movieLibKeys: string[] = [];
    const tvLibKeys: string[] = [];
    try {
      const sections = await this.plexServer.getSections({
        baseUrl: plexBaseUrl,
        token: plexToken,
      });
      const librarySelection = resolvePlexLibrarySelection({
        settings,
        sections,
      });
      const selectedSet = new Set(librarySelection.selectedSectionKeys);
      for (const lib of librarySelection.eligibleLibraries) {
        if (!selectedSet.has(lib.key)) continue;
        if (lib.type === 'movie') movieLibKeys.push(lib.key);
        else if (lib.type === 'show') tvLibKeys.push(lib.key);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await ctx.warn(`Failed to fetch Plex libraries: ${errMsg}`);
    }

    // --- Phase 2: Recommendation Generation ---
    await ctx.patchSummary({
      progress: {
        step: 'phase2_recommendations',
        message: 'Generating recommendations...',
        updatedAt: new Date().toISOString(),
      },
    });

    const allMatchedEntries = await this.prisma.importedWatchEntry.findMany({
      where: { userId, source, status: 'matched' },
      orderBy: { watchedAt: 'desc' },
    });

    const allUniqueTmdbIds = new Set<number>();
    for (const entry of allMatchedEntries) {
      if (entry.tmdbId) allUniqueTmdbIds.add(entry.tmdbId);
    }
    const totalUniqueMatched = allUniqueTmdbIds.size;

    const crossSourceProcessed = new Set<number>(
      (
        await this.prisma.importedWatchEntry.findMany({
          where: {
            userId,
            source: { not: source },
            status: 'processed',
            tmdbId: { not: null },
          },
          select: { tmdbId: true },
        })
      )
        .map((e) => e.tmdbId)
        .filter((id): id is number => id !== null),
    );

    const seenTmdbIds = new Set<number>();
    const matchedEntries: Array<
      (typeof allMatchedEntries)[number] & { tmdbId: number }
    > = [];
    for (const entry of allMatchedEntries) {
      const tmdbId = entry.tmdbId;
      if (!tmdbId || seenTmdbIds.has(tmdbId)) continue;
      if (crossSourceProcessed.has(tmdbId)) continue;
      seenTmdbIds.add(tmdbId);
      matchedEntries.push({ ...entry, tmdbId });
      if (matchedEntries.length >= SEED_CAP) break;
    }
    const remainingAfterThisRun = Math.max(
      0,
      totalUniqueMatched - matchedEntries.length,
    );

    if (totalUniqueMatched > SEED_CAP) {
      await ctx.info(
        `Processing ${matchedEntries.length} of ${totalUniqueMatched} unique seeds (most recent by watch date). Re-run to process the remaining ${remainingAfterThisRun}.`,
      );
    }

    const openAiEnabledFlag = pickBool(settings, 'openai.enabled') ?? false;
    const openAiApiKey = pickString(secrets, 'openai.apiKey');
    const openAiModel = pickString(settings, 'openai.model') || null;
    const openAiEnabled = openAiEnabledFlag && !!openAiApiKey;

    const googleEnabled = pickBool(settings, 'google.enabled') ?? false;
    const googleApiKey = pickString(secrets, 'google.apiKey');
    const googleSearchEngineId = pickString(secrets, 'google.searchEngineId');

    const recCount = pickNumber(settings, 'recommendations.count') ?? 50;
    const upcomingPercent =
      pickNumber(settings, 'recommendations.upcomingPercent') ?? 25;
    const collectionLimit =
      pickNumber(settings, 'recommendations.collectionLimit') ?? 100;
    const webContextFraction =
      pickNumber(settings, 'recommendations.webContextFraction') ?? 0.3;

    type SeedResult = {
      title: string;
      tmdbId: number;
      similarTitles: string[];
      changeOfTasteTitles: string[];
    };

    const movieSeeds: SeedResult[] = [];
    const tvSeeds: SeedResult[] = [];
    const failedSeeds: Array<{ title: string; error: string }> = [];

    type RecItem = {
      title: string;
      tmdbId?: number;
      tvdbId?: number;
      seedTitle: string;
    };

    const movieSimilarPool: RecItem[] = [];
    const movieContrastPool: RecItem[] = [];
    const tvSimilarPool: RecItem[] = [];
    const tvContrastPool: RecItem[] = [];

    for (let i = 0; i < matchedEntries.length; i++) {
      const entry = matchedEntries[i];
      const seedTitle = entry.matchedTitle || entry.parsedTitle;
      const isMovie = entry.mediaType === 'movie';

      await ctx.patchSummary({
        progress: {
          step: 'phase2_recommendations',
          message: `Seed ${i + 1}/${matchedEntries.length}: ${seedTitle}`,
          current: i + 1,
          total: matchedEntries.length,
          updatedAt: new Date().toISOString(),
        },
      });

      try {
        await this.runSeedWithTransientTmdbRetries(ctx, seedTitle, async () => {
          if (isMovie && movieLibKeys.length > 0) {
            const similar = await this.recommendations.buildSimilarMovieTitles({
              ctx,
              seedTitle,
              tmdbApiKey,
              count: recCount,
              webContextFraction,
              upcomingPercent,
              openai: openAiEnabled
                ? { apiKey: openAiApiKey, model: openAiModel }
                : null,
              google:
                googleEnabled && googleApiKey && googleSearchEngineId
                  ? {
                      apiKey: googleApiKey,
                      searchEngineId: googleSearchEngineId,
                    }
                  : null,
            });

            const contrast =
              await this.recommendations.buildChangeOfTasteMovieTitles({
                ctx,
                seedTitle,
                tmdbApiKey,
                count: recCount,
                upcomingPercent,
                openai: openAiEnabled
                  ? { apiKey: openAiApiKey, model: openAiModel }
                  : null,
              });

            for (const t of similar.titles) {
              movieSimilarPool.push({ title: t, seedTitle });
            }
            for (const t of contrast.titles) {
              movieContrastPool.push({ title: t, seedTitle });
            }

            movieSeeds.push({
              title: seedTitle,
              tmdbId: entry.tmdbId,
              similarTitles: [...similar.titles].sort(),
              changeOfTasteTitles: [...contrast.titles].sort(),
            });
          } else if (!isMovie && tvLibKeys.length > 0) {
            const similar = await this.recommendations.buildSimilarTvTitles({
              ctx,
              seedTitle,
              tmdbApiKey,
              count: recCount,
              webContextFraction,
              upcomingPercent,
              openai: openAiEnabled
                ? { apiKey: openAiApiKey, model: openAiModel }
                : null,
              google:
                googleEnabled && googleApiKey && googleSearchEngineId
                  ? {
                      apiKey: googleApiKey,
                      searchEngineId: googleSearchEngineId,
                    }
                  : null,
            });

            const contrast =
              await this.recommendations.buildChangeOfTasteTvTitles({
                ctx,
                seedTitle,
                tmdbApiKey,
                count: recCount,
                upcomingPercent,
                openai: openAiEnabled
                  ? { apiKey: openAiApiKey, model: openAiModel }
                  : null,
              });

            for (const t of similar.titles) {
              tvSimilarPool.push({ title: t, seedTitle });
            }
            for (const t of contrast.titles) {
              tvContrastPool.push({ title: t, seedTitle });
            }

            tvSeeds.push({
              title: seedTitle,
              tmdbId: entry.tmdbId,
              similarTitles: [...similar.titles].sort(),
              changeOfTasteTitles: [...contrast.titles].sort(),
            });
          }

          await this.prisma.importedWatchEntry.updateMany({
            where: {
              userId,
              source,
              tmdbId: entry.tmdbId,
              status: 'matched',
            },
            data: { status: 'processed' },
          });
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await ctx.warn(`Seed failed: ${seedTitle} — ${errMsg}`);
        failedSeeds.push({ title: seedTitle, error: errMsg });
      }
    }

    summary.phase2_recommendations = {
      movieSeeds: movieSeeds.map((s) => ({
        title: s.title,
        tmdbId: s.tmdbId,
        similarCount: s.similarTitles.length,
        changeOfTasteCount: s.changeOfTasteTitles.length,
      })) as unknown as JsonObject[],
      tvSeeds: tvSeeds.map((s) => ({
        title: s.title,
        tmdbId: s.tmdbId,
        similarCount: s.similarTitles.length,
        changeOfTasteCount: s.changeOfTasteTitles.length,
      })) as unknown as JsonObject[],
      failedSeeds: failedSeeds as unknown as JsonObject[],
      skipped: null,
    };

    // --- Phase 3: Aggregation + Dedup ---
    await ctx.patchSummary({
      progress: {
        step: 'phase3_aggregation',
        message: 'Aggregating recommendations...',
        updatedAt: new Date().toISOString(),
      },
    });

    const movieSimilarResolved = await this.resolveAndDedup(
      movieSimilarPool,
      tmdbApiKey,
      'movie',
      collectionLimit,
    );
    const movieContrastResolved = await this.resolveAndDedup(
      movieContrastPool,
      tmdbApiKey,
      'movie',
      collectionLimit,
    );
    const tvSimilarResolved = await this.resolveAndDedup(
      tvSimilarPool,
      tmdbApiKey,
      'tv',
      collectionLimit,
    );
    const tvContrastResolved = await this.resolveAndDedup(
      tvContrastPool,
      tmdbApiKey,
      'tv',
      collectionLimit,
    );

    summary.phase3_aggregation = {
      movieSimilarTotal: movieSimilarPool.length,
      movieSimilarUnique: movieSimilarResolved.length,
      movieChangeOfTasteTotal: movieContrastPool.length,
      movieChangeOfTasteUnique: movieContrastResolved.length,
      tvSimilarTotal: tvSimilarPool.length,
      tvSimilarUnique: tvSimilarResolved.length,
      tvChangeOfTasteTotal: tvContrastPool.length,
      tvChangeOfTasteUnique: tvContrastResolved.length,
    };

    // Write consolidated snapshots
    const similarMovieCollectionName = buildUserCollectionName(
      importSimilarBase(source),
      plexUserTitle,
    );
    const contrastMovieCollectionName = buildUserCollectionName(
      importContrastBase(source),
      plexUserTitle,
    );
    const similarTvCollectionName = buildUserCollectionName(
      importSimilarBase(source),
      plexUserTitle,
    );
    const contrastTvCollectionName = buildUserCollectionName(
      importContrastBase(source),
      plexUserTitle,
    );

    const createdCollections: string[] = [];

    for (const libKey of movieLibKeys) {
      if (movieSimilarResolved.length) {
        await this.writeMovieSnapshot(
          plexUserId,
          similarMovieCollectionName,
          libKey,
          movieSimilarResolved,
        );
        createdCollections.push(similarMovieCollectionName);
      }
      if (movieContrastResolved.length) {
        await this.writeMovieSnapshot(
          plexUserId,
          contrastMovieCollectionName,
          libKey,
          movieContrastResolved,
        );
        createdCollections.push(contrastMovieCollectionName);
      }
    }

    for (const libKey of tvLibKeys) {
      if (tvSimilarResolved.length) {
        await this.writeTvSnapshot(
          plexUserId,
          similarTvCollectionName,
          libKey,
          tvSimilarResolved,
        );
        createdCollections.push(similarTvCollectionName);
      }
      if (tvContrastResolved.length) {
        await this.writeTvSnapshot(
          plexUserId,
          contrastTvCollectionName,
          libKey,
          tvContrastResolved,
        );
        createdCollections.push(contrastTvCollectionName);
      }
    }

    // --- Recently Watched cross-collection writes (additive, preserves organic rows) ---
    const rwMovieTitlesInjected: string[] = [];
    const rwTvTitlesInjected: string[] = [];

    for (const libKey of movieLibKeys) {
      if (movieSimilarResolved.length) {
        const colName = buildUserCollectionName(
          RECENTLY_WATCHED_MOVIE_COLLECTION_BASE_NAME,
          plexUserTitle,
        );
        await this.writeMovieSnapshotAdditive(
          plexUserId,
          colName,
          libKey,
          movieSimilarResolved,
        );
        for (const r of movieSimilarResolved)
          rwMovieTitlesInjected.push(r.title);
      }
      if (movieContrastResolved.length) {
        const colName = buildUserCollectionName(
          CHANGE_OF_MOVIE_TASTE_COLLECTION_BASE_NAME,
          plexUserTitle,
        );
        await this.writeMovieSnapshotAdditive(
          plexUserId,
          colName,
          libKey,
          movieContrastResolved,
        );
        for (const r of movieContrastResolved)
          rwMovieTitlesInjected.push(r.title);
      }
    }

    for (const libKey of tvLibKeys) {
      if (tvSimilarResolved.length) {
        const colName = buildUserCollectionName(
          RECENTLY_WATCHED_SHOW_COLLECTION_BASE_NAME,
          plexUserTitle,
        );
        await this.writeTvSnapshotAdditive(
          plexUserId,
          colName,
          libKey,
          tvSimilarResolved,
        );
        for (const r of tvSimilarResolved) rwTvTitlesInjected.push(r.title);
      }
      if (tvContrastResolved.length) {
        const colName = buildUserCollectionName(
          CHANGE_OF_SHOW_TASTE_COLLECTION_BASE_NAME,
          plexUserTitle,
        );
        await this.writeTvSnapshotAdditive(
          plexUserId,
          colName,
          libKey,
          tvContrastResolved,
        );
        for (const r of tvContrastResolved) rwTvTitlesInjected.push(r.title);
      }
    }

    const uniqueRwMovieTitles = [...new Set(rwMovieTitlesInjected)].sort();
    const uniqueRwTvTitles = [...new Set(rwTvTitlesInjected)].sort();

    // --- Immaculate Taste points update ---
    const itMovieSuggested = [
      ...movieSimilarResolved,
      ...movieContrastResolved,
    ];
    const itTvSuggested = [...tvSimilarResolved, ...tvContrastResolved].filter(
      (
        recommendation,
      ): recommendation is (typeof tvSimilarResolved)[number] & {
        tvdbId: number;
      } =>
        typeof recommendation.tvdbId === 'number' &&
        Number.isFinite(recommendation.tvdbId) &&
        recommendation.tvdbId > 0,
    );

    const existingItMovieTmdbIds = new Set<number>();
    const existingItTvTvdbIds = new Set<number>();

    for (const libKey of movieLibKeys) {
      const existing = await this.prisma.immaculateTasteMovieLibrary.findMany({
        where: { plexUserId, librarySectionKey: libKey, profileId: 'default' },
        select: { tmdbId: true },
      });
      for (const e of existing) existingItMovieTmdbIds.add(e.tmdbId);
    }
    for (const libKey of tvLibKeys) {
      const existing = await this.prisma.immaculateTasteShowLibrary.findMany({
        where: { plexUserId, librarySectionKey: libKey, profileId: 'default' },
        select: { tvdbId: true },
      });
      for (const e of existing) existingItTvTvdbIds.add(e.tvdbId);
    }

    for (const libKey of movieLibKeys) {
      if (itMovieSuggested.length) {
        await this.immaculateTaste.applyPointsUpdate({
          ctx,
          plexUserId,
          librarySectionKey: libKey,
          profileId: 'default',
          suggested: itMovieSuggested.map((r) => ({
            tmdbId: r.tmdbId,
            title: r.title,
            tmdbVoteAvg: r.voteAvg,
          })),
        });
      }
    }
    for (const libKey of tvLibKeys) {
      if (itTvSuggested.length) {
        await this.immaculateTasteTv.applyPointsUpdate({
          ctx,
          plexUserId,
          librarySectionKey: libKey,
          profileId: 'default',
          suggested: itTvSuggested.map((r) => ({
            tvdbId: r.tvdbId,
            tmdbId: r.tmdbId,
            title: r.title,
            tmdbVoteAvg: r.voteAvg,
          })),
        });
      }
    }

    const finalItMovieTitlesSet = new Set<string>();
    const finalItTvTitlesSet = new Set<string>();
    for (const libKey of movieLibKeys) {
      const rows = await this.prisma.immaculateTasteMovieLibrary.findMany({
        where: { plexUserId, librarySectionKey: libKey, profileId: 'default' },
        select: { tmdbId: true, title: true },
      });
      for (const r of rows) if (r.title) finalItMovieTitlesSet.add(r.title);
    }
    for (const libKey of tvLibKeys) {
      const rows = await this.prisma.immaculateTasteShowLibrary.findMany({
        where: { plexUserId, librarySectionKey: libKey, profileId: 'default' },
        select: { tvdbId: true, title: true },
      });
      for (const r of rows) if (r.title) finalItTvTitlesSet.add(r.title);
    }

    const itMovieAdded = itMovieSuggested
      .filter((r) => !existingItMovieTmdbIds.has(r.tmdbId))
      .map((r) => r.title);
    const itMovieExisted = itMovieSuggested
      .filter((r) => existingItMovieTmdbIds.has(r.tmdbId))
      .map((r) => r.title);
    const itTvAdded = itTvSuggested
      .filter((r) => !existingItTvTvdbIds.has(r.tvdbId))
      .map((r) => r.title);
    const itTvExisted = itTvSuggested
      .filter((r) => existingItTvTvdbIds.has(r.tvdbId))
      .map((r) => r.title);
    const itMovieFinal = [...finalItMovieTitlesSet].sort();
    const itTvFinal = [...finalItTvTitlesSet].sort();

    // --- Phase 4: Plex Collection Creation ---
    await ctx.patchSummary({
      progress: {
        step: 'phase4_collections',
        message: 'Creating Plex collections...',
        updatedAt: new Date().toISOString(),
      },
    });

    const collectionErrors: string[] = [];
    let movieCollectionSize = 0;
    let tvCollectionSize = 0;

    try {
      const movieSections = movieLibKeys.map((key) => ({
        key,
        title: key,
      }));
      const tvSections = tvLibKeys.map((key) => ({
        key,
        title: key,
      }));

      if (
        machineIdentifier &&
        (movieSections.length > 0 || tvSections.length > 0)
      ) {
        await this.watchedRefresher.refresh({
          ctx,
          plexBaseUrl,
          plexToken,
          machineIdentifier,
          plexUserId,
          plexUserTitle,
          pinCollections: true,
          movieSections,
          tvSections,
          limit: collectionLimit,
          movieCollectionBaseNames: [
            importSimilarBase(source),
            importContrastBase(source),
            RECENTLY_WATCHED_MOVIE_COLLECTION_BASE_NAME,
            CHANGE_OF_MOVIE_TASTE_COLLECTION_BASE_NAME,
          ],
          tvCollectionBaseNames: [
            importSimilarBase(source),
            importContrastBase(source),
            RECENTLY_WATCHED_SHOW_COLLECTION_BASE_NAME,
            CHANGE_OF_SHOW_TASTE_COLLECTION_BASE_NAME,
          ],
        });

        movieCollectionSize =
          movieSimilarResolved.length + movieContrastResolved.length;
        tvCollectionSize = tvSimilarResolved.length + tvContrastResolved.length;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      collectionErrors.push(errMsg);
      await ctx.warn(`Plex collection creation failed: ${errMsg}`);
    }

    summary.phase4_collections = {
      movieCollectionSize,
      tvCollectionSize,
      plexCollectionsCreated: [
        ...new Set(createdCollections),
      ] as unknown as JsonObject[],
      errors: collectionErrors as unknown as JsonObject[],
      skipped: null,
    };

    // --- Build jobReportV1 ---
    const report = this.buildReport({
      ctx,
      source,
      pendingCount: pendingEntries.length,
      movieCount,
      tvCount,
      unmatchedCount,
      classifiedMovieTitles,
      classifiedTvTitles,
      unmatchedTitles,
      movieSeeds,
      tvSeeds,
      failedSeeds,
      movieSimilarPool,
      movieContrastPool,
      tvSimilarPool,
      tvContrastPool,
      movieSimilarResolved,
      movieContrastResolved,
      tvSimilarResolved,
      tvContrastResolved,
      createdCollections,
      movieCollectionSize,
      tvCollectionSize,
      collectionErrors,
      raw: summary,
      rwMovieTitles: uniqueRwMovieTitles,
      rwTvTitles: uniqueRwTvTitles,
      itMovieAdded,
      itMovieExisted,
      itMovieFinal,
      itTvAdded,
      itTvExisted,
      itTvFinal,
    });

    await ctx.setSummary(report as unknown as JsonObject);
    await ctx.info('Import processing complete');
    return { summary: report as unknown as JsonObject };
  }

  private buildReport(params: {
    ctx: JobContext;
    source: ImportSource;
    pendingCount: number;
    movieCount: number;
    tvCount: number;
    unmatchedCount: number;
    classifiedMovieTitles: string[];
    classifiedTvTitles: string[];
    unmatchedTitles: string[];
    movieSeeds: Array<{
      title: string;
      tmdbId: number;
      similarTitles: string[];
      changeOfTasteTitles: string[];
    }>;
    tvSeeds: Array<{
      title: string;
      tmdbId: number;
      similarTitles: string[];
      changeOfTasteTitles: string[];
    }>;
    failedSeeds: Array<{ title: string; error: string }>;
    movieSimilarPool: Array<{ title: string }>;
    movieContrastPool: Array<{ title: string }>;
    tvSimilarPool: Array<{ title: string }>;
    tvContrastPool: Array<{ title: string }>;
    movieSimilarResolved: Array<{ title: string }>;
    movieContrastResolved: Array<{ title: string }>;
    tvSimilarResolved: Array<{ title: string }>;
    tvContrastResolved: Array<{ title: string }>;
    createdCollections: string[];
    movieCollectionSize: number;
    tvCollectionSize: number;
    collectionErrors: string[];
    raw: JsonObject;
    rwMovieTitles: string[];
    rwTvTitles: string[];
    itMovieAdded: string[];
    itMovieExisted: string[];
    itMovieFinal: string[];
    itTvAdded: string[];
    itTvExisted: string[];
    itTvFinal: string[];
  }): JobReportV1 {
    const {
      ctx,
      source,
      pendingCount,
      movieCount,
      tvCount,
      unmatchedCount,
      classifiedMovieTitles,
      classifiedTvTitles,
      unmatchedTitles,
      movieSeeds,
      tvSeeds,
      failedSeeds,
      movieSimilarPool,
      movieContrastPool,
      tvSimilarPool,
      tvContrastPool,
      movieSimilarResolved,
      movieContrastResolved,
      tvSimilarResolved,
      tvContrastResolved,
      createdCollections,
      movieCollectionSize,
      tvCollectionSize,
      collectionErrors,
      raw,
      rwMovieTitles,
      rwTvTitles,
      itMovieAdded,
      itMovieExisted,
      itMovieFinal,
      itTvAdded,
      itTvExisted,
      itTvFinal,
    } = params;

    const srcLabel = importSourceLabel(source);
    const tasks: JobReportV1['tasks'] = [];
    const allIssues: JobReportV1['issues'] = [];

    // Task 1: TMDB Classification
    const classificationFacts: Array<{ label: string; value: JsonValue }> = [];
    if (classifiedMovieTitles.length) {
      classificationFacts.push({
        label: 'Movies',
        value: {
          count: classifiedMovieTitles.length,
          unit: 'titles',
          items: classifiedMovieTitles.sort(),
        },
      });
    }
    if (classifiedTvTitles.length) {
      classificationFacts.push({
        label: 'TV Shows',
        value: {
          count: classifiedTvTitles.length,
          unit: 'titles',
          items: classifiedTvTitles.sort(),
        },
      });
    }
    if (unmatchedTitles.length) {
      classificationFacts.push({
        label: 'Unmatched',
        value: {
          count: unmatchedTitles.length,
          unit: 'titles',
          items: unmatchedTitles.sort(),
        },
      });
    }

    tasks.push({
      id: 'classification',
      title: `${srcLabel} — Classification`,
      status:
        pendingCount > 0 && unmatchedCount === pendingCount
          ? 'failed'
          : 'success',
      rows: [
        metricRow({
          label: `${srcLabel} titles classified`,
          end: pendingCount,
          unit: 'titles',
        }),
        metricRow({ label: 'Movies found', end: movieCount, unit: 'titles' }),
        metricRow({
          label: 'TV shows found',
          end: tvCount,
          unit: 'titles',
        }),
        metricRow({ label: 'Unmatched', end: unmatchedCount, unit: 'titles' }),
      ],
      facts: classificationFacts,
    });

    // Task 1b: Seed Titles Found in History
    const allSeedMovieTitles = movieSeeds.map((s) => s.title).sort();
    const allSeedTvTitles = tvSeeds.map((s) => s.title).sort();
    if (allSeedMovieTitles.length || allSeedTvTitles.length) {
      const seedFacts: Array<{ label: string; value: JsonValue }> = [];
      if (allSeedMovieTitles.length) {
        seedFacts.push({
          label: 'Movie Seeds',
          value: {
            count: allSeedMovieTitles.length,
            unit: 'movies',
            items: allSeedMovieTitles,
          },
        });
      }
      if (allSeedTvTitles.length) {
        seedFacts.push({
          label: 'TV Seeds',
          value: {
            count: allSeedTvTitles.length,
            unit: 'shows',
            items: allSeedTvTitles,
          },
        });
      }
      tasks.push({
        id: 'seed_titles',
        title: `${srcLabel} — Seed Titles (${allSeedMovieTitles.length + allSeedTvTitles.length})`,
        status: 'success',
        rows: [
          metricRow({
            label: 'Movie seeds used',
            end: allSeedMovieTitles.length,
            unit: 'titles',
          }),
          metricRow({
            label: 'TV seeds used',
            end: allSeedTvTitles.length,
            unit: 'titles',
          }),
        ],
        facts: seedFacts,
      });
    }

    // Task 2: Movie Seeds & Recommendations
    if (movieSeeds.length) {
      const movieFacts: Array<{ label: string; value: JsonValue }> = [];
      for (const seed of movieSeeds) {
        if (seed.similarTitles.length) {
          movieFacts.push({
            label: `${seed.title} — Similar`,
            value: {
              count: seed.similarTitles.length,
              unit: 'movies',
              items: seed.similarTitles,
            },
          });
        }
        if (seed.changeOfTasteTitles.length) {
          movieFacts.push({
            label: `${seed.title} — Change of Taste`,
            value: {
              count: seed.changeOfTasteTitles.length,
              unit: 'movies',
              items: seed.changeOfTasteTitles,
            },
          });
        }
      }
      tasks.push({
        id: 'movie_seeds',
        title: `${srcLabel} — Movie Recommendations (${movieSeeds.length})`,
        status: 'success',
        rows: [
          metricRow({
            label: `${srcLabel} titles processed`,
            end: movieSeeds.length,
            unit: 'titles',
          }),
          metricRow({
            label: 'Similar generated',
            end: movieSimilarPool.length,
            unit: 'movies',
          }),
          metricRow({
            label: 'Change of taste generated',
            end: movieContrastPool.length,
            unit: 'movies',
          }),
        ],
        facts: movieFacts,
      });
    }

    // Task 3: TV Seeds & Recommendations
    if (tvSeeds.length) {
      const tvFacts: Array<{ label: string; value: JsonValue }> = [];
      for (const seed of tvSeeds) {
        if (seed.similarTitles.length) {
          tvFacts.push({
            label: `${seed.title} — Similar`,
            value: {
              count: seed.similarTitles.length,
              unit: 'shows',
              items: seed.similarTitles,
            },
          });
        }
        if (seed.changeOfTasteTitles.length) {
          tvFacts.push({
            label: `${seed.title} — Change of Taste`,
            value: {
              count: seed.changeOfTasteTitles.length,
              unit: 'shows',
              items: seed.changeOfTasteTitles,
            },
          });
        }
      }
      tasks.push({
        id: 'tv_seeds',
        title: `${srcLabel} — TV Recommendations (${tvSeeds.length})`,
        status: 'success',
        rows: [
          metricRow({
            label: `${srcLabel} titles processed`,
            end: tvSeeds.length,
            unit: 'titles',
          }),
          metricRow({
            label: 'Similar generated',
            end: tvSimilarPool.length,
            unit: 'shows',
          }),
          metricRow({
            label: 'Change of taste generated',
            end: tvContrastPool.length,
            unit: 'shows',
          }),
        ],
        facts: tvFacts,
      });
    }

    // Task 3b: Failed seeds
    if (failedSeeds.length) {
      const failedSeedTaskStatus: JobReportTaskStatus =
        movieSeeds.length > 0 || tvSeeds.length > 0 ? 'success' : 'failed';
      tasks.push({
        id: 'failed_seeds',
        title: `${srcLabel} — Failed Titles (${failedSeeds.length})`,
        status: failedSeedTaskStatus,
        facts: failedSeeds.map((s) => ({
          label: s.title,
          value: s.error,
        })),
        issues: failedSeeds.map((s) => issue('warn', `${s.title}: ${s.error}`)),
      });
      for (const s of failedSeeds) {
        allIssues.push(issue('warn', `${srcLabel} title failed: ${s.title}`));
      }
    }

    // Task 4: Aggregation & Deduplication
    tasks.push({
      id: 'aggregation',
      title: `${srcLabel} — Aggregation & Dedup`,
      status: 'success',
      rows: [
        metricRow({
          label: 'Movie similar',
          start: movieSimilarPool.length,
          end: movieSimilarResolved.length,
          unit: 'movies',
          note: 'after dedup',
        }),
        metricRow({
          label: 'Movie change of taste',
          start: movieContrastPool.length,
          end: movieContrastResolved.length,
          unit: 'movies',
          note: 'after dedup',
        }),
        metricRow({
          label: 'TV similar',
          start: tvSimilarPool.length,
          end: tvSimilarResolved.length,
          unit: 'shows',
          note: 'after dedup',
        }),
        metricRow({
          label: 'TV change of taste',
          start: tvContrastPool.length,
          end: tvContrastResolved.length,
          unit: 'shows',
          note: 'after dedup',
        }),
      ],
      facts: [
        ...(movieSimilarResolved.length
          ? [
              {
                label: 'Movie — Similar',
                value: {
                  count: movieSimilarResolved.length,
                  unit: 'movies',
                  items: movieSimilarResolved.map((r) => r.title).sort(),
                } as JsonValue,
              },
            ]
          : []),
        ...(movieContrastResolved.length
          ? [
              {
                label: 'Movie — Change of Taste',
                value: {
                  count: movieContrastResolved.length,
                  unit: 'movies',
                  items: movieContrastResolved.map((r) => r.title).sort(),
                } as JsonValue,
              },
            ]
          : []),
        ...(tvSimilarResolved.length
          ? [
              {
                label: 'TV — Similar',
                value: {
                  count: tvSimilarResolved.length,
                  unit: 'shows',
                  items: tvSimilarResolved.map((r) => r.title).sort(),
                } as JsonValue,
              },
            ]
          : []),
        ...(tvContrastResolved.length
          ? [
              {
                label: 'TV — Change of Taste',
                value: {
                  count: tvContrastResolved.length,
                  unit: 'shows',
                  items: tvContrastResolved.map((r) => r.title).sort(),
                } as JsonValue,
              },
            ]
          : []),
      ],
    });

    // Task 5: Plex Collections
    const uniqueCollections = [...new Set(createdCollections)];
    const collectionFacts: Array<{ label: string; value: JsonValue }> = [];
    for (const name of uniqueCollections) {
      collectionFacts.push({ label: name, value: 'Created' as JsonValue });
    }
    if (movieSimilarResolved.length) {
      collectionFacts.push({
        label: 'Movie — Similar Picks',
        value: {
          count: movieSimilarResolved.length,
          unit: 'movies',
          items: movieSimilarResolved.map((r) => r.title).sort(),
        } as JsonValue,
      });
    }
    if (movieContrastResolved.length) {
      collectionFacts.push({
        label: 'Movie — Change of Taste',
        value: {
          count: movieContrastResolved.length,
          unit: 'movies',
          items: movieContrastResolved.map((r) => r.title).sort(),
        } as JsonValue,
      });
    }
    if (tvSimilarResolved.length) {
      collectionFacts.push({
        label: 'TV — Similar Picks',
        value: {
          count: tvSimilarResolved.length,
          unit: 'shows',
          items: tvSimilarResolved.map((r) => r.title).sort(),
        } as JsonValue,
      });
    }
    if (tvContrastResolved.length) {
      collectionFacts.push({
        label: 'TV — Change of Taste',
        value: {
          count: tvContrastResolved.length,
          unit: 'shows',
          items: tvContrastResolved.map((r) => r.title).sort(),
        } as JsonValue,
      });
    }
    tasks.push({
      id: 'plex_collections',
      title: `${srcLabel} — Plex Collections`,
      status: collectionErrors.length ? 'failed' : 'success',
      rows: [
        metricRow({
          label: 'Movie collection items',
          end: movieCollectionSize,
          unit: 'items',
        }),
        metricRow({
          label: 'TV collection items',
          end: tvCollectionSize,
          unit: 'items',
        }),
      ],
      facts: collectionFacts,
      ...(collectionErrors.length
        ? {
            issues: collectionErrors.map((e) => issue('error', e)),
          }
        : {}),
    });

    if (collectionErrors.length) {
      for (const e of collectionErrors) {
        allIssues.push(issue('error', e));
      }
    }

    // Task: Recently Watched Sync
    if (rwMovieTitles.length || rwTvTitles.length) {
      const rwFacts: Array<{ label: string; value: JsonValue }> = [];
      if (rwMovieTitles.length) {
        rwFacts.push({
          label: 'Movies Injected',
          value: {
            count: rwMovieTitles.length,
            unit: 'movies',
            items: rwMovieTitles,
          } as JsonValue,
        });
      }
      if (rwTvTitles.length) {
        rwFacts.push({
          label: 'TV Shows Injected',
          value: {
            count: rwTvTitles.length,
            unit: 'shows',
            items: rwTvTitles,
          } as JsonValue,
        });
      }
      tasks.push({
        id: 'recently_watched_sync',
        title: `${srcLabel} — Recently Watched Sync`,
        status: 'success',
        rows: [
          metricRow({
            label: 'Movies added',
            end: rwMovieTitles.length,
            unit: 'movies',
          }),
          metricRow({
            label: 'TV shows added',
            end: rwTvTitles.length,
            unit: 'shows',
          }),
        ],
        facts: rwFacts,
      });
    }

    // Task: Immaculate Taste Sync
    const itTotalAdded = itMovieAdded.length + itTvAdded.length;
    const itTotalExisted = itMovieExisted.length + itTvExisted.length;
    if (itTotalAdded > 0 || itTotalExisted > 0) {
      const itFacts: Array<{ label: string; value: JsonValue }> = [];
      if (itMovieAdded.length) {
        itFacts.push({
          label: 'Added — Movies',
          value: {
            count: itMovieAdded.length,
            unit: 'movies',
            items: [...itMovieAdded].sort(),
          } as JsonValue,
        });
      }
      if (itTvAdded.length) {
        itFacts.push({
          label: 'Added — TV Shows',
          value: {
            count: itTvAdded.length,
            unit: 'shows',
            items: [...itTvAdded].sort(),
          } as JsonValue,
        });
      }
      if (itMovieExisted.length) {
        itFacts.push({
          label: 'Already Existed — Movies',
          value: {
            count: itMovieExisted.length,
            unit: 'movies',
            items: [...itMovieExisted].sort(),
          } as JsonValue,
        });
      }
      if (itTvExisted.length) {
        itFacts.push({
          label: 'Already Existed — TV Shows',
          value: {
            count: itTvExisted.length,
            unit: 'shows',
            items: [...itTvExisted].sort(),
          } as JsonValue,
        });
      }
      if (itMovieFinal.length) {
        itFacts.push({
          label: 'Final View — Movies',
          value: {
            count: itMovieFinal.length,
            unit: 'movies',
            items: itMovieFinal,
          } as JsonValue,
        });
      }
      if (itTvFinal.length) {
        itFacts.push({
          label: 'Final View — TV Shows',
          value: {
            count: itTvFinal.length,
            unit: 'shows',
            items: itTvFinal,
          } as JsonValue,
        });
      }
      tasks.push({
        id: 'immaculate_taste_sync',
        title: `${srcLabel} — Immaculate Taste Sync`,
        status: 'success',
        rows: [
          metricRow({
            label: 'New titles added',
            end: itTotalAdded,
            unit: 'titles',
          }),
          metricRow({
            label: 'Already existed',
            end: itTotalExisted,
            unit: 'titles',
          }),
          metricRow({
            label: 'Final DB entries',
            end: itMovieFinal.length + itTvFinal.length,
            unit: 'titles',
          }),
        ],
        facts: itFacts,
      });
    }

    const headline = `${srcLabel} Watch History Import Report`;

    return {
      template: 'jobReportV1',
      version: 1,
      jobId: ctx.jobId,
      dryRun: ctx.dryRun,
      trigger: ctx.trigger,
      headline,
      sections: [],
      tasks,
      issues: allIssues,
      raw,
    };
  }

  private async classifyTitle(
    parsedTitle: string,
    tmdbApiKey: string,
    ctx: JobContext,
  ): Promise<{
    mediaType: 'movie' | 'tv';
    tmdbId: number;
    tvdbId: number | null;
    matchedTitle: string;
  } | null> {
    // Try movie search first
    try {
      const movieResults = await this.tmdb.searchMovie({
        apiKey: tmdbApiKey,
        query: parsedTitle,
      });
      if (movieResults.length > 0) {
        const best = movieResults[0];
        return {
          mediaType: 'movie',
          tmdbId: best.id,
          tvdbId: null,
          matchedTitle: best.title,
        };
      }
    } catch (err) {
      await ctx.debug(`TMDB movie search failed for "${parsedTitle}": ${err}`);
    }

    // Try TV search
    try {
      const tvResults = await this.tmdb.searchTv({
        apiKey: tmdbApiKey,
        query: parsedTitle,
      });
      if (tvResults.length > 0) {
        const best = tvResults[0];
        let tvdbId: number | null = null;
        try {
          const extIds = await this.tmdb.getTvExternalIds({
            apiKey: tmdbApiKey,
            tmdbId: best.id,
          });
          tvdbId = extIds?.tvdb_id ?? null;
        } catch {
          // Non-fatal
        }
        return {
          mediaType: 'tv',
          tmdbId: best.id,
          tvdbId,
          matchedTitle: best.name,
        };
      }
    } catch (err) {
      await ctx.debug(`TMDB TV search failed for "${parsedTitle}": ${err}`);
    }

    // Fallback: text-before-colon
    if (parsedTitle.includes(':')) {
      const fallbackTitle = parsedTitle.split(':')[0].trim();
      if (fallbackTitle && fallbackTitle !== parsedTitle) {
        return this.classifyTitle(fallbackTitle, tmdbApiKey, ctx);
      }
    }

    return null;
  }

  private async resolveAndDedup(
    pool: Array<{ title: string; seedTitle: string }>,
    tmdbApiKey: string,
    mediaType: 'movie' | 'tv',
    limit: number,
  ): Promise<
    Array<{
      tmdbId: number;
      tvdbId?: number | null;
      title: string;
      voteAvg: number | null;
      seedCount: number;
    }>
  > {
    const titleMap = new Map<
      string,
      {
        tmdbId: number;
        tvdbId?: number | null;
        title: string;
        voteAvg: number | null;
        seedCount: number;
      }
    >();

    for (const item of pool) {
      const key = item.title.toLowerCase();
      const existing = titleMap.get(key);
      if (existing) {
        existing.seedCount += 1;
        continue;
      }

      let tmdbId: number | undefined;
      let tvdbId: number | null = null;
      let voteAvg: number | null = null;

      try {
        if (mediaType === 'movie') {
          const results = await this.tmdb.searchMovie({
            apiKey: tmdbApiKey,
            query: item.title,
          });
          if (results.length > 0) {
            tmdbId = results[0].id;
            voteAvg =
              typeof results[0].vote_average === 'number'
                ? results[0].vote_average
                : null;
          }
        } else {
          const results = await this.tmdb.searchTv({
            apiKey: tmdbApiKey,
            query: item.title,
          });
          if (results.length > 0) {
            tmdbId = results[0].id;
            voteAvg =
              typeof results[0].vote_average === 'number'
                ? results[0].vote_average
                : null;
            try {
              const ext = await this.tmdb.getTvExternalIds({
                apiKey: tmdbApiKey,
                tmdbId: results[0].id,
              });
              tvdbId = ext?.tvdb_id ?? null;
            } catch {
              // Non-fatal
            }
          }
        }
      } catch {
        // Skip unresolvable titles
        continue;
      }

      if (tmdbId) {
        titleMap.set(key, {
          tmdbId,
          tvdbId,
          title: item.title,
          voteAvg,
          seedCount: 1,
        });
      }

      await sleep(TMDB_THROTTLE_MS);
    }

    const byTmdbId = new Map<
      number,
      typeof titleMap extends Map<string, infer V> ? V : never
    >();
    for (const entry of titleMap.values()) {
      const existing = byTmdbId.get(entry.tmdbId);
      if (existing) {
        existing.seedCount += entry.seedCount;
        if (
          (entry.voteAvg ?? 0) > (existing.voteAvg ?? 0) ||
          entry.title.length > existing.title.length
        ) {
          existing.title = entry.title;
          existing.voteAvg = entry.voteAvg;
        }
      } else {
        byTmdbId.set(entry.tmdbId, { ...entry });
      }
    }

    return Array.from(byTmdbId.values())
      .sort(
        (a, b) =>
          b.seedCount * 10 +
          (b.voteAvg ?? 0) * 2 -
          (a.seedCount * 10 + (a.voteAvg ?? 0) * 2),
      )
      .slice(0, limit);
  }

  private async writeMovieSnapshot(
    plexUserId: string,
    collectionName: string,
    librarySectionKey: string,
    items: Array<{
      tmdbId: number;
      title: string;
      voteAvg: number | null;
    }>,
  ) {
    await this.prisma.watchedMovieRecommendationLibrary.deleteMany({
      where: { plexUserId, collectionName, librarySectionKey },
    });

    if (!items.length) return;

    await this.prisma.watchedMovieRecommendationLibrary.createMany({
      data: items.map((item) => ({
        plexUserId,
        collectionName,
        librarySectionKey,
        tmdbId: item.tmdbId,
        title: item.title,
        status: 'pending' as const,
        tmdbVoteAvg: item.voteAvg,
      })),
    });
  }

  private async writeTvSnapshot(
    plexUserId: string,
    collectionName: string,
    librarySectionKey: string,
    items: Array<{
      tmdbId: number;
      tvdbId?: number | null;
      title: string;
      voteAvg: number | null;
    }>,
  ) {
    await this.prisma.watchedShowRecommendationLibrary.deleteMany({
      where: { plexUserId, collectionName, librarySectionKey },
    });

    const withTvdb = items.filter(
      (
        item,
      ): item is (typeof items)[number] & {
        tvdbId: number;
      } =>
        typeof item.tvdbId === 'number' &&
        Number.isFinite(item.tvdbId) &&
        item.tvdbId > 0,
    );
    if (!withTvdb.length) return;

    await this.prisma.watchedShowRecommendationLibrary.createMany({
      data: withTvdb.map((item) => ({
        plexUserId,
        collectionName,
        librarySectionKey,
        tvdbId: item.tvdbId,
        tmdbId: item.tmdbId,
        title: item.title,
        status: 'pending' as const,
        tmdbVoteAvg: item.voteAvg,
      })),
    });
  }

  private async writeMovieSnapshotAdditive(
    plexUserId: string,
    collectionName: string,
    librarySectionKey: string,
    items: Array<{
      tmdbId: number;
      title: string;
      voteAvg: number | null;
    }>,
  ) {
    if (!items.length) return;
    const existing =
      await this.prisma.watchedMovieRecommendationLibrary.findMany({
        where: { plexUserId, collectionName, librarySectionKey },
        select: { tmdbId: true },
      });
    const existingIds = new Set(existing.map((e) => e.tmdbId));
    const newItems = items.filter((i) => !existingIds.has(i.tmdbId));
    if (!newItems.length) return;
    await this.prisma.watchedMovieRecommendationLibrary.createMany({
      data: newItems.map((item) => ({
        plexUserId,
        collectionName,
        librarySectionKey,
        tmdbId: item.tmdbId,
        title: item.title,
        status: 'pending' as const,
        tmdbVoteAvg: item.voteAvg,
      })),
    });
  }

  private async writeTvSnapshotAdditive(
    plexUserId: string,
    collectionName: string,
    librarySectionKey: string,
    items: Array<{
      tmdbId: number;
      tvdbId?: number | null;
      title: string;
      voteAvg: number | null;
    }>,
  ) {
    const withTvdb = items.filter(
      (
        item,
      ): item is (typeof items)[number] & {
        tvdbId: number;
      } =>
        typeof item.tvdbId === 'number' &&
        Number.isFinite(item.tvdbId) &&
        item.tvdbId > 0,
    );
    if (!withTvdb.length) return;
    const existing =
      await this.prisma.watchedShowRecommendationLibrary.findMany({
        where: { plexUserId, collectionName, librarySectionKey },
        select: { tvdbId: true },
      });
    const existingIds = new Set(existing.map((e) => e.tvdbId));
    const newItems = withTvdb.filter((i) => !existingIds.has(i.tvdbId));
    if (!newItems.length) return;
    await this.prisma.watchedShowRecommendationLibrary.createMany({
      data: newItems.map((item) => ({
        plexUserId,
        collectionName,
        librarySectionKey,
        tvdbId: item.tvdbId,
        tmdbId: item.tmdbId,
        title: item.title,
        status: 'pending' as const,
        tmdbVoteAvg: item.voteAvg,
      })),
    });
  }
}
