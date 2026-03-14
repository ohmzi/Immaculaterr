import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import { SeerrService } from '../seerr/seerr.service';
import { SettingsService } from '../settings/settings.service';
import {
  TmdbService,
  type TmdbUpcomingMovieDiscoverCandidate,
} from '../tmdb/tmdb.service';
import type { JobReportV1 } from './job-report-v1';
import { issue, metricRow } from './job-report-v1';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';

type TmdbUpcomingFilter = {
  id: string;
  name: string;
  enabled: boolean;
  genres: string[];
  languages: string[];
  watchProviders: string[];
  certifications: string[];
  scoreMin: number;
  scoreMax: number;
};

type TmdbUpcomingSettings = {
  routeViaSeerr: boolean;
  globalLimit: number;
  windowStart: string;
  windowEnd: string;
  filters: TmdbUpcomingFilter[];
};

type RoutedCandidate = TmdbUpcomingMovieDiscoverCandidate & {
  matchedFilters: string[];
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

const DEFAULT_GLOBAL_LIMIT = 100;
const DEFAULT_WINDOW_MONTHS = 2;
const DEFAULT_SCORE_MIN = 6;
const DEFAULT_SCORE_MAX = 10;
const MAX_GLOBAL_LIMIT = 100;
const RUNNING_JOB_POLL_MS = 5000;
const DEFAULT_CERTIFICATION_COUNTRY = 'US';
const MAX_REPORT_TITLE_ITEMS = 100;
const DISCOVER_PAGE_SIZE = 20;
const DISCOVER_MAX_ITEMS = 300;
const DISCOVER_MAX_PAGES = 10;
const DISCOVER_MIN_ITEMS_PER_FILTER = 40;
const DISCOVER_ITEMS_PER_ALLOCATION = 2;
const DISCOVER_ALLOCATION_BUFFER = 10;
const DISCOVER_CHUNK_PAGES = 2;

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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawEntry of value) {
    if (typeof rawEntry !== 'string') continue;
    const entry = rawEntry.trim();
    if (!entry) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
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
    const title = String(rawTitle ?? '').trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length >= MAX_REPORT_TITLE_ITEMS) break;
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, Math.trunc(ms)));
}

function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value: string): Date | null {
  const trimmed = String(value ?? '').trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function addMonthsClamped(date: Date, months: number): Date {
  const source = new Date(date.getTime());
  const monthIndex = source.getMonth() + Math.trunc(months);
  const year = source.getFullYear() + Math.floor(monthIndex / 12);
  const normalizedMonth = ((monthIndex % 12) + 12) % 12;
  const maxDay = new Date(year, normalizedMonth + 1, 0).getDate();
  const clampedDay = Math.min(source.getDate(), maxDay);
  return new Date(
    year,
    normalizedMonth,
    clampedDay,
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds(),
  );
}

function createDefaultFilter(): TmdbUpcomingFilter {
  return {
    id: 'default',
    name: 'Default baseline filter',
    enabled: true,
    genres: [],
    languages: [],
    watchProviders: [],
    certifications: [],
    scoreMin: DEFAULT_SCORE_MIN,
    scoreMax: DEFAULT_SCORE_MAX,
  };
}

function compareCandidatesByPriority(
  left: TmdbUpcomingMovieDiscoverCandidate,
  right: TmdbUpcomingMovieDiscoverCandidate,
): number {
  const leftPopularity = left.popularity ?? 0;
  const rightPopularity = right.popularity ?? 0;
  if (rightPopularity !== leftPopularity) {
    return rightPopularity - leftPopularity;
  }
  // Deterministic tie-break only; ranking remains popularity-first.
  return left.tmdbId - right.tmdbId;
}

function computeDiscoverFetchBudget(allocation: number): {
  maxItems: number;
  maxPages: number;
} {
  const safeAllocation = Math.max(1, Math.trunc(allocation));
  const requestedItems =
    safeAllocation * DISCOVER_ITEMS_PER_ALLOCATION + DISCOVER_ALLOCATION_BUFFER;
  const maxItems = Math.max(
    DISCOVER_MIN_ITEMS_PER_FILTER,
    Math.min(DISCOVER_MAX_ITEMS, requestedItems),
  );
  const maxPages = Math.max(
    1,
    Math.min(DISCOVER_MAX_PAGES, Math.ceil(maxItems / DISCOVER_PAGE_SIZE)),
  );
  return { maxItems, maxPages };
}

function normalizeFilter(value: unknown): TmdbUpcomingFilter | null {
  if (!isPlainObject(value)) return null;
  const id = pickString(value, 'id') || `filter_${Date.now()}`;
  const name = pickString(value, 'name') || id || 'Filter';
  const enabled = pickBool(value, 'enabled') ?? true;
  const genres = normalizeStringArray(value['genres']);
  const languages = normalizeStringArray(value['languages']);
  const watchProviders = normalizeStringArray(value['watchProviders']);
  const certifications = normalizeStringArray(value['certifications']);
  const scoreMin = clampInt(
    pickNumber(value, 'scoreMin'),
    0,
    10,
    DEFAULT_SCORE_MIN,
  );
  const scoreMax = clampInt(
    pickNumber(value, 'scoreMax'),
    0,
    10,
    DEFAULT_SCORE_MAX,
  );
  const lower = Math.min(scoreMin, scoreMax);
  const upper = Math.max(scoreMin, scoreMax);
  return {
    id,
    name,
    enabled,
    genres,
    languages,
    watchProviders,
    certifications,
    scoreMin: lower,
    scoreMax: upper,
  };
}

function normalizeSettings(
  settings: Record<string, unknown>,
): TmdbUpcomingSettings {
  const rawTask = pick(settings, 'jobs.tmdbUpcomingMovies');
  const task = isPlainObject(rawTask) ? rawTask : {};
  const routeViaSeerr = pickBool(task, 'routeViaSeerr') ?? false;
  const globalLimit = clampInt(
    pickNumber(task, 'globalLimit'),
    1,
    MAX_GLOBAL_LIMIT,
    DEFAULT_GLOBAL_LIMIT,
  );
  const legacyReleaseWindowMonths = clampInt(
    pickNumber(task, 'releaseWindowMonths'),
    1,
    12,
    DEFAULT_WINDOW_MONTHS,
  );
  const today = new Date();
  let windowStart = formatDateLocal(
    parseDateOnly(pickString(task, 'windowStart')) ?? today,
  );
  let windowEnd = formatDateLocal(
    parseDateOnly(pickString(task, 'windowEnd')) ??
      addMonthsClamped(
        parseDateOnly(windowStart) ?? today,
        legacyReleaseWindowMonths,
      ),
  );
  if (windowEnd < windowStart) {
    const previousWindowStart = windowStart;
    windowStart = windowEnd;
    windowEnd = previousWindowStart;
  }
  const rawFilters = Array.isArray(task['filters']) ? task['filters'] : [];
  const filters = rawFilters
    .map((row) => normalizeFilter(row))
    .filter((row): row is TmdbUpcomingFilter => row !== null);
  return {
    routeViaSeerr,
    globalLimit,
    windowStart,
    windowEnd,
    filters,
  };
}

@Injectable()
export class TmdbUpcomingMoviesJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly tmdb: TmdbService,
    private readonly plexServer: PlexServerService,
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
        phase: 'running',
        progress: {
          step,
          message,
          updatedAt: new Date().toISOString(),
          ...(context ?? {}),
        },
      });
    };

    await ctx.info('tmdbUpcomingMovies: start', {
      trigger: ctx.trigger,
      dryRun: ctx.dryRun,
    });
    await setProgress('load_settings', 'Loading settings…');

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);
    const normalized = normalizeSettings(settings);

    const tmdbApiKey = this.settingsService.readServiceSecret('tmdb', secrets);
    if (!tmdbApiKey) {
      throw new Error('TMDB apiKey is not set');
    }

    const windowStart = normalized.windowStart;
    const windowEnd = normalized.windowEnd;

    await this.waitUntilIdle(ctx, setProgress);

    const enabledFilters = normalized.filters.filter(
      (filter) => filter.enabled,
    );
    const hasCustomFilters = normalized.filters.length > 0;
    const usingDefaultBaseline =
      !hasCustomFilters || enabledFilters.length === 0;
    const usingFallbackBaselineForDisabledCustomFilters =
      hasCustomFilters && enabledFilters.length === 0;
    const activeFilters = usingDefaultBaseline
      ? [createDefaultFilter()]
      : enabledFilters;
    const mergedCandidates = new Map<number, RoutedCandidate>();
    const reportIssues: JobReportV1['issues'] = [];
    const perFilterStats: Array<{
      id: string;
      discovered: number;
      matchedAfterCertification: number;
      matchedAfterPlex: number;
      skippedInPlex: number;
      allocatedLimit: number;
      selectedUnique: number;
    }> = [];
    const certificationCache = new Map<number, string | null>();
    const rankedMatchedTmdbIdsByFilter = new Map<string, number[]>();
    const matchedTitlesByFilter = new Map<string, string[]>();
    const skippedPlexTitlesByFilter = new Map<string, string[]>();
    const cappedLimit = Math.max(
      1,
      Math.min(MAX_GLOBAL_LIMIT, normalized.globalLimit),
    );
    const perFilterAllocation = new Map<string, number>();
    if (activeFilters.length > 0) {
      const baseAllocation = Math.floor(cappedLimit / activeFilters.length);
      let remainder = cappedLimit % activeFilters.length;
      for (const filter of activeFilters) {
        const allocation = baseAllocation + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        perFilterAllocation.set(filter.id, allocation);
      }
    }

    const plexExistingTmdbIds = new Set<number>();
    let plexMovieLibrariesScanned = 0;
    let plexPrecheckEnabled = false;
    let plexPrecheckError: string | null = null;
    const plexBaseUrl =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    const plexEnabledSetting = pickBool(settings, 'plex.enabled');
    const plexEnabled = (plexEnabledSetting ?? Boolean(plexToken)) === true;
    const plexConfigured = plexEnabled && Boolean(plexBaseUrl && plexToken);
    if (plexConfigured) {
      plexPrecheckEnabled = true;
      await setProgress(
        'plex_precheck',
        'Indexing Plex movie libraries for existing TMDB ids…',
      );
      try {
        const sections = await this.plexServer.getSections({
          baseUrl: plexBaseUrl,
          token: plexToken,
        });
        const movieSections = sections.filter(
          (section) => (section.type ?? '').toLowerCase() === 'movie',
        );
        plexMovieLibrariesScanned = movieSections.length;
        for (const section of movieSections) {
          const ids = await this.plexServer.getMovieTmdbIdSetForSectionKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: section.key,
            sectionTitle: section.title,
          });
          for (const id of ids) {
            if (Number.isFinite(id) && id > 0) {
              plexExistingTmdbIds.add(Math.trunc(id));
            }
          }
        }
      } catch (err) {
        plexPrecheckError = (err as Error)?.message ?? String(err);
        reportIssues.push(
          issue(
            'warn',
            `Plex library pre-check failed; continuing without Plex exclusion. (${plexPrecheckError})`,
          ),
        );
        await ctx.warn(
          'tmdbUpcomingMovies: plex pre-check failed (continuing without Plex exclusion)',
          { error: plexPrecheckError },
        );
      }
    } else if (plexEnabled) {
      reportIssues.push(
        issue(
          'warn',
          'Plex is enabled but not fully configured (baseUrl/token missing); continuing without Plex exclusion.',
        ),
      );
    }

    await setProgress(
      'discover',
      usingFallbackBaselineForDisabledCustomFilters
        ? 'All custom filter sets are disabled; using hidden default baseline filter set.'
        : usingDefaultBaseline
          ? 'Using hidden default baseline filter set.'
          : 'Discovering upcoming movies…',
      {
        totalFilters: activeFilters.length,
        usingDefaultBaseline,
      },
    );

    let totalDiscovered = 0;
    let totalMatchedAfterCertification = 0;
    let totalMatchedAfterPlex = 0;
    let totalSkippedInPlex = 0;
    const applyCertificationFilter = async (
      candidates: TmdbUpcomingMovieDiscoverCandidate[],
      certificationSet: Set<string>,
    ): Promise<TmdbUpcomingMovieDiscoverCandidate[]> => {
      if (!certificationSet.size) return candidates;
      const matched: TmdbUpcomingMovieDiscoverCandidate[] = [];
      for (const candidate of candidates) {
        const cachedCertification = certificationCache.has(candidate.tmdbId)
          ? (certificationCache.get(candidate.tmdbId) ?? null)
          : null;
        const certification =
          cachedCertification ??
          (await this.tmdb.getMovieCertification({
            apiKey: tmdbApiKey,
            tmdbId: candidate.tmdbId,
            countryCode: DEFAULT_CERTIFICATION_COUNTRY,
          }));
        certificationCache.set(candidate.tmdbId, certification ?? null);
        if (!certification) continue;
        if (certificationSet.has(certification)) {
          matched.push(candidate);
        }
      }
      return matched;
    };

    for (let index = 0; index < activeFilters.length; index += 1) {
      const filter = activeFilters[index];
      await setProgress(
        'discover',
        `Processing filter set ${index + 1} of ${activeFilters.length}…`,
        {
          current: index + 1,
          total: activeFilters.length,
          usingDefaultBaseline,
        },
      );

      const genreIds = filter.genres
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.trunc(value));
      const watchProviderIds = Array.from(
        new Set(
          filter.watchProviders
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isFinite(value) && value > 0)
            .map((value) => Math.trunc(value)),
        ),
      );
      const allocationForFilter = perFilterAllocation.get(filter.id) ?? 0;
      if (allocationForFilter <= 0) {
        rankedMatchedTmdbIdsByFilter.set(filter.id, []);
        matchedTitlesByFilter.set(filter.id, []);
        skippedPlexTitlesByFilter.set(filter.id, []);
        perFilterStats.push({
          id: filter.id,
          discovered: 0,
          matchedAfterCertification: 0,
          matchedAfterPlex: 0,
          skippedInPlex: 0,
          allocatedLimit: 0,
          selectedUnique: 0,
        });
        continue;
      }
      const discoverBudget = computeDiscoverFetchBudget(allocationForFilter);
      const discoverRequestBase = {
        apiKey: tmdbApiKey,
        fromDate: windowStart,
        toDate: windowEnd,
        genreIds,
        languages: filter.languages,
        watchProviderIds,
        watchRegion: DEFAULT_CERTIFICATION_COUNTRY,
        minScore: filter.scoreMin,
        maxScore: filter.scoreMax,
      };
      const certificationSet = new Set(
        filter.certifications.map((entry) => entry.trim()).filter(Boolean),
      );
      const unseenMatchedByTmdbId = new Map<
        number,
        TmdbUpcomingMovieDiscoverCandidate
      >();
      const skippedPlexTitles: string[] = [];
      let discoveredCount = 0;
      let matchedAfterCertificationCount = 0;
      let skippedInPlexCount = 0;
      let pageCursor = 1;
      let pageLimit = discoverBudget.maxPages;
      let expandedToMax = false;

      while (pageCursor <= pageLimit) {
        const remainingPages = pageLimit - pageCursor + 1;
        const chunkPages = Math.max(
          1,
          Math.min(DISCOVER_CHUNK_PAGES, remainingPages),
        );
        const chunkMaxItems = Math.min(
          DISCOVER_MAX_ITEMS,
          chunkPages * DISCOVER_PAGE_SIZE,
        );
        const discoveredChunk = await this.tmdb.discoverUpcomingMovies({
          ...discoverRequestBase,
          maxItems: chunkMaxItems,
          maxPages: chunkPages,
          startPage: pageCursor,
        });
        if (!discoveredChunk.length) break;

        discoveredCount += discoveredChunk.length;
        const matchedChunk = await applyCertificationFilter(
          discoveredChunk,
          certificationSet,
        );
        matchedAfterCertificationCount += matchedChunk.length;
        for (const candidate of matchedChunk) {
          if (plexExistingTmdbIds.has(candidate.tmdbId)) {
            skippedInPlexCount += 1;
            skippedPlexTitles.push(candidate.title);
            continue;
          }
          if (!unseenMatchedByTmdbId.has(candidate.tmdbId)) {
            unseenMatchedByTmdbId.set(candidate.tmdbId, candidate);
          }
        }
        if (unseenMatchedByTmdbId.size >= allocationForFilter) {
          break;
        }

        pageCursor += chunkPages;
        if (
          pageCursor > pageLimit &&
          !expandedToMax &&
          pageLimit < DISCOVER_MAX_PAGES &&
          unseenMatchedByTmdbId.size < allocationForFilter
        ) {
          expandedToMax = true;
          pageLimit = DISCOVER_MAX_PAGES;
        }
      }

      totalDiscovered += discoveredCount;
      totalMatchedAfterCertification += matchedAfterCertificationCount;
      totalSkippedInPlex += skippedInPlexCount;

      const rankedMatched = Array.from(unseenMatchedByTmdbId.values()).sort(
        compareCandidatesByPriority,
      );
      totalMatchedAfterPlex += rankedMatched.length;
      rankedMatchedTmdbIdsByFilter.set(
        filter.id,
        rankedMatched.map((entry) => entry.tmdbId),
      );
      matchedTitlesByFilter.set(
        filter.id,
        normalizeTitleList(rankedMatched.map((entry) => entry.title)),
      );
      skippedPlexTitlesByFilter.set(
        filter.id,
        normalizeTitleList(skippedPlexTitles),
      );
      perFilterStats.push({
        id: filter.id,
        discovered: discoveredCount,
        matchedAfterCertification: matchedAfterCertificationCount,
        matchedAfterPlex: rankedMatched.length,
        skippedInPlex: skippedInPlexCount,
        allocatedLimit: allocationForFilter,
        selectedUnique: 0,
      });

      for (const candidate of rankedMatched) {
        const existing = mergedCandidates.get(candidate.tmdbId);
        if (!existing) {
          mergedCandidates.set(candidate.tmdbId, {
            ...candidate,
            matchedFilters: [filter.id],
          });
          continue;
        }
        if (!existing.matchedFilters.includes(filter.id)) {
          existing.matchedFilters.push(filter.id);
        }
        const existingPopularity = existing.popularity ?? 0;
        const candidatePopularity = candidate.popularity ?? 0;
        if (candidatePopularity > existingPopularity) {
          mergedCandidates.set(candidate.tmdbId, {
            ...candidate,
            matchedFilters: existing.matchedFilters,
          });
        }
      }
    }

    const rankedCandidates = Array.from(mergedCandidates.values()).sort(
      compareCandidatesByPriority,
    );

    const selectedByTmdbId = new Map<number, RoutedCandidate>();
    const perFilterSelectedCount = new Map<string, number>();
    const selectedTitlesByFilter = new Map<string, string[]>();
    for (const filter of activeFilters) {
      const allocation = perFilterAllocation.get(filter.id) ?? 0;
      const rankedTmdbIds = rankedMatchedTmdbIdsByFilter.get(filter.id) ?? [];
      let selectedForFilter = 0;
      const selectedTitles: string[] = [];
      if (allocation > 0) {
        for (const tmdbId of rankedTmdbIds) {
          if (selectedForFilter >= allocation) break;
          if (selectedByTmdbId.has(tmdbId)) continue;
          const mergedCandidate = mergedCandidates.get(tmdbId);
          if (!mergedCandidate) continue;
          selectedByTmdbId.set(tmdbId, mergedCandidate);
          selectedForFilter += 1;
          selectedTitles.push(mergedCandidate.title);
        }
      }
      perFilterSelectedCount.set(filter.id, selectedForFilter);
      selectedTitlesByFilter.set(filter.id, normalizeTitleList(selectedTitles));
    }

    const perFilterStatsWithAllocation = perFilterStats.map((row) => ({
      ...row,
      allocatedLimit: perFilterAllocation.get(row.id) ?? 0,
      selectedUnique: perFilterSelectedCount.get(row.id) ?? 0,
    }));
    const selected = Array.from(selectedByTmdbId.values())
      .sort(compareCandidatesByPriority)
      .slice(0, cappedLimit);
    const selectedTmdbIds = new Set(selected.map((entry) => entry.tmdbId));
    const reserveCandidates = rankedCandidates.filter(
      (entry) => !selectedTmdbIds.has(entry.tmdbId),
    );

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
    await setProgress(
      'destination',
      'Sending selected movies to destination…',
      {
        selected: selected.length,
        routeViaSeerr: normalized.routeViaSeerr,
      },
    );

    if (ctx.dryRun) {
      destinationStats.skipped = selected.length;
      destinationTitles.skippedTitles = normalizeTitleList(
        selected.map((entry) => entry.title),
      );
    } else if (normalized.routeViaSeerr) {
      await this.sendToSeerr({
        ctx,
        settings,
        secrets,
        selected,
        reserveCandidates,
        destinationStats,
        destinationTitles,
        reportIssues,
      });
    } else {
      await this.sendToRadarr({
        ctx,
        settings,
        secrets,
        selected,
        reserveCandidates,
        destinationStats,
        destinationTitles,
        reportIssues,
      });
    }

    const headline = (() => {
      if (ctx.dryRun)
        return `Dry run complete: ${selected.length} upcoming movie(s) selected.`;
      if (normalized.routeViaSeerr) {
        return `Seerr route complete: requested ${destinationStats.requested}, exists ${destinationStats.exists}, failed ${destinationStats.failed}.`;
      }
      return `Radarr route complete: added ${destinationStats.added}, exists ${destinationStats.exists}, failed ${destinationStats.failed}.`;
    })();

    if (destinationStats.failed > 0) {
      reportIssues.push(
        issue(
          'warn',
          `Destination reported ${destinationStats.failed} failed operation(s); run continued.`,
        ),
      );
    }

    const perFilterStatsById = new Map(
      perFilterStatsWithAllocation.map((row) => [row.id, row]),
    );
    const discoverFacts = [
      { label: 'Window start', value: windowStart },
      { label: 'Window end', value: windowEnd },
      ...activeFilters.flatMap((filter, index) => {
        const filterStats = perFilterStatsById.get(filter.id);
        const filterLabel = usingDefaultBaseline
          ? 'Default baseline filter'
          : `Filter #${index + 1}`;
        return [
          {
            label: `${filterLabel} found`,
            value: {
              count: filterStats?.matchedAfterPlex ?? 0,
              unit: 'movies',
              items: matchedTitlesByFilter.get(filter.id) ?? [],
            },
          },
          {
            label: `${filterLabel} skipped (already in Plex)`,
            value: {
              count: filterStats?.skippedInPlex ?? 0,
              unit: 'movies',
              items: skippedPlexTitlesByFilter.get(filter.id) ?? [],
            },
          },
          {
            label: `${filterLabel} selected for destination (allocation ${filterStats?.allocatedLimit ?? 0})`,
            value: {
              count: filterStats?.selectedUnique ?? 0,
              unit: 'movies',
              items: selectedTitlesByFilter.get(filter.id) ?? [],
            },
          },
        ];
      }),
    ];
    const destinationSuccessCount = normalized.routeViaSeerr
      ? destinationStats.requested
      : destinationStats.added;
    const destinationSuccessLabel = normalized.routeViaSeerr
      ? 'Requested in Seerr'
      : 'Added in Radarr';
    const destinationName = normalized.routeViaSeerr ? 'Seerr' : 'Radarr';
    const destinationFacts = [
      {
        label: 'Attempted sends',
        value: {
          count: destinationStats.attempted,
          unit: 'movies',
          items: normalizeTitleList(destinationTitles.attemptedTitles),
        },
      },
      {
        label: destinationSuccessLabel,
        value: {
          count: destinationSuccessCount,
          unit: 'movies',
          items: normalizeTitleList(destinationTitles.sentTitles),
        },
      },
      {
        label: `Already exists in ${destinationName}`,
        value: {
          count: destinationStats.exists,
          unit: 'movies',
          items: normalizeTitleList(destinationTitles.existsTitles),
        },
      },
      {
        label: 'Failed sends',
        value: {
          count: destinationStats.failed,
          unit: 'movies',
          items: normalizeTitleList(destinationTitles.failedTitles),
        },
      },
      {
        label: 'Skipped sends',
        value: {
          count: destinationStats.skipped,
          unit: 'movies',
          items: normalizeTitleList(destinationTitles.skippedTitles),
        },
      },
    ];

    const report: JobReportV1 = {
      template: 'jobReportV1',
      version: 1,
      jobId: ctx.jobId,
      dryRun: ctx.dryRun,
      trigger: ctx.trigger,
      headline,
      sections: [
        {
          id: 'discovery',
          title: 'Discovery',
          rows: [
            metricRow({
              label: 'Enabled filter sets',
              start: activeFilters.length,
              changed: 0,
              end: activeFilters.length,
              unit: 'sets',
              note: usingDefaultBaseline
                ? 'Using built-in default filter baseline.'
                : undefined,
            }),
            metricRow({
              label: 'Discovered (total)',
              start: 0,
              changed: totalDiscovered,
              end: totalDiscovered,
              unit: 'movies',
            }),
            metricRow({
              label: 'After certification filters',
              start: 0,
              changed: totalMatchedAfterCertification,
              end: totalMatchedAfterCertification,
              unit: 'movies',
            }),
            metricRow({
              label: 'After Plex library exclusion',
              start: 0,
              changed: totalMatchedAfterPlex,
              end: totalMatchedAfterPlex,
              unit: 'movies',
              note: `Skipped in Plex: ${totalSkippedInPlex} movie(s).`,
            }),
            metricRow({
              label: 'Merged and deduped',
              start: 0,
              changed: rankedCandidates.length,
              end: rankedCandidates.length,
              unit: 'movies',
            }),
            metricRow({
              label: 'Selected by global cap',
              start: 0,
              changed: selected.length,
              end: selected.length,
              unit: 'movies',
              note: activeFilters.length
                ? `Global cap=${cappedLimit} (hard max ${MAX_GLOBAL_LIMIT}); split across ${activeFilters.length} filter set(s).`
                : `Global cap=${cappedLimit} (hard max ${MAX_GLOBAL_LIMIT}); no enabled filter sets.`,
            }),
          ],
        },
        {
          id: 'destination',
          title: normalized.routeViaSeerr ? 'Seerr requests' : 'Radarr adds',
          rows: [
            metricRow({
              label: 'Attempted',
              start: 0,
              changed: destinationStats.attempted,
              end: destinationStats.attempted,
              unit: 'movies',
            }),
            metricRow({
              label: normalized.routeViaSeerr ? 'Requested' : 'Added',
              start: 0,
              changed: normalized.routeViaSeerr
                ? destinationStats.requested
                : destinationStats.added,
              end: normalized.routeViaSeerr
                ? destinationStats.requested
                : destinationStats.added,
              unit: 'movies',
            }),
            metricRow({
              label: 'Already exists',
              start: 0,
              changed: destinationStats.exists,
              end: destinationStats.exists,
              unit: 'movies',
            }),
            metricRow({
              label: 'Failed',
              start: 0,
              changed: destinationStats.failed,
              end: destinationStats.failed,
              unit: 'movies',
            }),
            metricRow({
              label: 'Skipped',
              start: 0,
              changed: destinationStats.skipped,
              end: destinationStats.skipped,
              unit: 'movies',
            }),
          ],
        },
      ],
      tasks: [
        {
          id: 'queue_wait',
          title: 'Queue wait',
          status: 'success',
        },
        {
          id: 'discover',
          title: 'Discover upcoming movies',
          status: activeFilters.length ? 'success' : 'skipped',
          facts: discoverFacts,
        },
        {
          id: 'destination',
          title: normalized.routeViaSeerr ? 'Send to Seerr' : 'Send to Radarr',
          status: selected.length ? 'success' : 'skipped',
          facts: destinationFacts,
        },
      ],
      issues: reportIssues,
      raw: {
        routeViaSeerr: normalized.routeViaSeerr,
        globalLimit: cappedLimit,
        windowStart,
        windowEnd,
        filters: normalized.filters,
        activeFilters,
        usingDefaultBaseline,
        plexPrecheck: {
          enabled: plexPrecheckEnabled,
          configured: plexConfigured,
          movieLibrariesScanned: plexMovieLibrariesScanned,
          existingTmdbIds: plexExistingTmdbIds.size,
          error: plexPrecheckError,
        },
        perFilterStats: perFilterStatsWithAllocation,
        filterAllocation: activeFilters.map((filter) => ({
          id: filter.id,
          allocatedLimit: perFilterAllocation.get(filter.id) ?? 0,
          selectedUnique: perFilterSelectedCount.get(filter.id) ?? 0,
        })),
        selectedSample: selected.slice(0, 15).map((entry) => ({
          tmdbId: entry.tmdbId,
          title: entry.title,
          popularity: entry.popularity,
          matchedFilters: entry.matchedFilters,
        })),
        destinationTitleBuckets: {
          attempted: normalizeTitleList(destinationTitles.attemptedTitles),
          sent: normalizeTitleList(destinationTitles.sentTitles),
          exists: normalizeTitleList(destinationTitles.existsTitles),
          failed: normalizeTitleList(destinationTitles.failedTitles),
          skipped: normalizeTitleList(destinationTitles.skippedTitles),
        },
        destinationStats,
      },
    };

    await setProgress('done', 'Done.', {
      selected: selected.length,
      destinationAttempted: destinationStats.attempted,
      destinationFailed: destinationStats.failed,
    });
    await ctx.info('tmdbUpcomingMovies: done', {
      selected: selected.length,
      destinationStats,
    });

    return {
      summary: report as unknown as JsonObject,
    };
  }

  private async waitUntilIdle(
    ctx: JobContext,
    setProgress: (
      step: string,
      message: string,
      context?: JsonObject,
    ) => Promise<void>,
  ) {
    let waitedMs = 0;
    for (;;) {
      const running = await this.prisma.jobRun.findMany({
        where: {
          status: 'RUNNING',
          id: { not: ctx.runId },
        },
        select: {
          id: true,
          jobId: true,
        },
      });
      if (!running.length) {
        return;
      }

      waitedMs += RUNNING_JOB_POLL_MS;
      await setProgress(
        'wait_for_idle',
        'Waiting for running jobs to finish…',
        {
          runningCount: running.length,
          waitedMs,
          runningJobIds: running.map((row) => row.jobId),
        },
      );
      await sleep(RUNNING_JOB_POLL_MS);
    }
  }

  private async sendToSeerr(params: {
    ctx: JobContext;
    settings: Record<string, unknown>;
    secrets: Record<string, unknown>;
    selected: RoutedCandidate[];
    reserveCandidates: RoutedCandidate[];
    destinationStats: DestinationStats;
    destinationTitles: DestinationTitleBuckets;
    reportIssues: JobReportV1['issues'];
  }) {
    const {
      ctx,
      settings,
      selected,
      reserveCandidates,
      destinationStats,
      destinationTitles,
      reportIssues,
    } = params;
    const seerrBaseUrl = pickString(settings, 'seerr.baseUrl');
    const seerrApiKey = this.settingsService.readServiceSecret(
      'seerr',
      params.secrets,
    );
    const seerrEnabledSetting = pickBool(settings, 'seerr.enabled');
    const seerrEnabled = (seerrEnabledSetting ?? Boolean(seerrApiKey)) === true;
    const seerrConfigured =
      seerrEnabled && Boolean(seerrBaseUrl && seerrApiKey);

    if (!seerrConfigured) {
      destinationStats.skipped = selected.length;
      destinationTitles.skippedTitles = normalizeTitleList(
        selected.map((entry) => entry.title),
      );
      reportIssues.push(
        issue(
          'warn',
          'Seerr route selected but Seerr is not configured; selected movies were skipped.',
        ),
      );
      return;
    }

    let reserveIndex = 0;
    const nextReserveCandidate = (): RoutedCandidate | null => {
      if (reserveIndex >= reserveCandidates.length) return null;
      const entry = reserveCandidates[reserveIndex];
      reserveIndex += 1;
      return entry;
    };

    for (const seedEntry of selected) {
      let entry: RoutedCandidate | null = seedEntry;
      while (entry) {
        destinationStats.attempted += 1;
        destinationTitles.attemptedTitles.push(entry.title);
        const result = await this.seerr.requestMovie({
          baseUrl: seerrBaseUrl,
          apiKey: seerrApiKey,
          tmdbId: entry.tmdbId,
        });
        if (result.status === 'requested') {
          destinationStats.requested += 1;
          destinationTitles.sentTitles.push(entry.title);
          break;
        }
        if (result.status === 'exists') {
          destinationStats.exists += 1;
          destinationTitles.existsTitles.push(entry.title);
          entry = nextReserveCandidate();
          continue;
        }
        destinationStats.failed += 1;
        destinationTitles.failedTitles.push(entry.title);
        await ctx.warn(
          'tmdbUpcomingMovies: Seerr request failed (continuing)',
          {
            tmdbId: entry.tmdbId,
            title: entry.title,
            error: result.error ?? 'unknown',
          },
        );
        break;
      }
    }
  }

  private async sendToRadarr(params: {
    ctx: JobContext;
    settings: Record<string, unknown>;
    secrets: Record<string, unknown>;
    selected: RoutedCandidate[];
    reserveCandidates: RoutedCandidate[];
    destinationStats: DestinationStats;
    destinationTitles: DestinationTitleBuckets;
    reportIssues: JobReportV1['issues'];
  }) {
    const {
      ctx,
      settings,
      selected,
      reserveCandidates,
      destinationStats,
      destinationTitles,
      reportIssues,
    } = params;
    const radarrBaseUrlRaw =
      pickString(settings, 'radarr.baseUrl') ||
      pickString(settings, 'radarr.url');
    const radarrApiKey = this.settingsService.readServiceSecret(
      'radarr',
      params.secrets,
    );
    const radarrEnabledSetting = pickBool(settings, 'radarr.enabled');
    const radarrEnabled =
      (radarrEnabledSetting ?? Boolean(radarrApiKey)) === true;
    const radarrConfigured =
      radarrEnabled && Boolean(radarrBaseUrlRaw && radarrApiKey);

    if (!radarrConfigured) {
      destinationStats.skipped = selected.length;
      destinationTitles.skippedTitles = normalizeTitleList(
        selected.map((entry) => entry.title),
      );
      reportIssues.push(
        issue(
          'warn',
          'Radarr route selected but Radarr is not configured; selected movies were skipped.',
        ),
      );
      return;
    }

    const defaults = await this.pickRadarrDefaults({
      baseUrl: radarrBaseUrlRaw,
      apiKey: radarrApiKey,
      preferredRootFolderPath:
        pickString(settings, 'radarr.defaultRootFolderPath') ||
        pickString(settings, 'radarr.rootFolderPath'),
      preferredQualityProfileId:
        pickNumber(settings, 'radarr.defaultQualityProfileId') ??
        pickNumber(settings, 'radarr.qualityProfileId') ??
        1,
      preferredTagId:
        pickNumber(settings, 'radarr.defaultTagId') ??
        pickNumber(settings, 'radarr.tagId'),
    }).catch((err) => ({
      error: (err as Error)?.message ?? String(err),
    }));

    if ('error' in defaults) {
      destinationStats.skipped = selected.length;
      destinationTitles.skippedTitles = normalizeTitleList(
        selected.map((entry) => entry.title),
      );
      reportIssues.push(
        issue(
          'warn',
          `Radarr defaults could not be resolved; selected movies were skipped. (${defaults.error})`,
        ),
      );
      return;
    }

    let reserveIndex = 0;
    const nextReserveCandidate = (): RoutedCandidate | null => {
      if (reserveIndex >= reserveCandidates.length) return null;
      const entry = reserveCandidates[reserveIndex];
      reserveIndex += 1;
      return entry;
    };

    for (const seedEntry of selected) {
      let entry: RoutedCandidate | null = seedEntry;
      while (entry) {
        const activeEntry = entry;
        destinationStats.attempted += 1;
        destinationTitles.attemptedTitles.push(activeEntry.title);
        const yearRaw = (activeEntry.releaseDate ?? '').slice(0, 4);
        const yearValue = yearRaw ? Number.parseInt(yearRaw, 10) : NaN;
        try {
          const result = await this.radarr.addMovie({
            baseUrl: radarrBaseUrlRaw,
            apiKey: radarrApiKey,
            title: activeEntry.title,
            tmdbId: activeEntry.tmdbId,
            year: Number.isFinite(yearValue) ? yearValue : null,
            qualityProfileId: defaults.qualityProfileId,
            rootFolderPath: defaults.rootFolderPath,
            tags: defaults.tagIds,
            monitored: true,
            minimumAvailability: 'announced',
            searchForMovie: false,
          });
          if (result.status === 'added') {
            destinationStats.added += 1;
            destinationTitles.sentTitles.push(activeEntry.title);
            break;
          }
          destinationStats.exists += 1;
          destinationTitles.existsTitles.push(activeEntry.title);
          entry = nextReserveCandidate();
        } catch (err) {
          destinationStats.failed += 1;
          destinationTitles.failedTitles.push(activeEntry.title);
          await ctx.warn('tmdbUpcomingMovies: Radarr add failed (continuing)', {
            tmdbId: activeEntry.tmdbId,
            title: activeEntry.title,
            error: (err as Error)?.message ?? String(err),
          });
          break;
        }
      }
    }
  }

  private async pickRadarrDefaults(params: {
    baseUrl: string;
    apiKey: string;
    preferredRootFolderPath?: string;
    preferredQualityProfileId?: number;
    preferredTagId?: number | null;
  }): Promise<{
    rootFolderPath: string;
    qualityProfileId: number;
    tagIds: number[];
  }> {
    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.radarr.listRootFolders({
        baseUrl: params.baseUrl,
        apiKey: params.apiKey,
      }),
      this.radarr.listQualityProfiles({
        baseUrl: params.baseUrl,
        apiKey: params.apiKey,
      }),
      this.radarr.listTags({
        baseUrl: params.baseUrl,
        apiKey: params.apiKey,
      }),
    ]);
    if (!rootFolders.length) {
      throw new Error('Radarr has no root folders configured');
    }
    if (!qualityProfiles.length) {
      throw new Error('Radarr has no quality profiles configured');
    }

    const preferredRootFolderPath = (
      params.preferredRootFolderPath ?? ''
    ).trim();
    const rootFolder = preferredRootFolderPath
      ? (rootFolders.find((row) => row.path === preferredRootFolderPath) ??
        rootFolders[0])
      : rootFolders[0];
    const desiredProfileId = Math.max(
      1,
      Math.trunc(params.preferredQualityProfileId ?? 1),
    );
    const qualityProfile =
      qualityProfiles.find((row) => row.id === desiredProfileId) ??
      qualityProfiles[0];

    const preferredTagId =
      typeof params.preferredTagId === 'number' &&
      Number.isFinite(params.preferredTagId)
        ? Math.trunc(params.preferredTagId)
        : null;
    const tag = preferredTagId
      ? tags.find((row) => row.id === preferredTagId)
      : null;

    return {
      rootFolderPath: rootFolder.path,
      qualityProfileId: qualityProfile.id,
      tagIds: tag ? [tag.id] : [],
    };
  }
}
