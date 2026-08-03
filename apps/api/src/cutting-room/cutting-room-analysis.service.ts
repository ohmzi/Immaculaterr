import { Injectable, Logger } from '@nestjs/common';
import { truncateErrorMessage } from '../log.utils';
import { PrismaService } from '../db/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ArrInstanceService } from '../arr-instances/arr-instance.service';
import {
  PlexServerService,
  type PlexCuttingRoomItem,
} from '../plex/plex-server.service';
import { PlexWatchlistService } from '../plex/plex-watchlist.service';
import { RadarrService, type RadarrMovie } from '../radarr/radarr.service';
import { SonarrService, type SonarrSeries } from '../sonarr/sonarr.service';
import { SeerrService } from '../seerr/seerr.service';
import { TautulliService } from '../tautulli/tautulli.service';
import {
  type CuttingRoomScoreInput,
  normalizeCuttingRoomRules,
  scoreCuttingRoomItem,
} from './cutting-room-scoring';

const DAY_MS = 86_400_000;
const CANDIDATE_INSERT_CHUNK = 500;
const INTERACTIVE_SNAPSHOTS_TO_KEEP = 5;

export type AnalysisProgress = (params: {
  step: string;
  message: string;
  current?: number;
  total?: number;
}) => void;

export type AnalysisLoggers = {
  info: (message: string, context?: Record<string, unknown>) => Promise<void>;
  warn: (message: string, context?: Record<string, unknown>) => Promise<void>;
};

export type AnalysisSummary = {
  mediaType: 'movie' | 'show';
  sectionsScanned: number;
  libraryCount: number;
  libraryBytes: number;
  candidateCount: number;
  candidateBytes: number;
  tierAgg: Record<string, { count: number; bytes: number }>;
  protectedAgg: Record<string, number>;
  plexOnlyCount: number;
  tautulliUsed: boolean;
  arrItemsSeen: number;
};

type ArrJoinInfo = {
  instanceId: string;
  arrId: number;
  monitored: boolean;
  tagLabels: string[];
  status: string;
  ended: boolean;
  path: string | null;
  rootFolderPath: string | null;
  sizeOnDisk: number;
  /** Rating values from the arr's sources (imdb/tmdb or sonarr). */
  ratingValues: number[];
  ratingVotes: number | null;
};

function meanOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function normTitle(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function titleYearKey(
  title: string | null | undefined,
  year: number | null | undefined,
): string {
  return `${normTitle(title)}|${year ?? ''}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickString(obj: Record<string, unknown>, path: string): string | null {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return null;
    cur = cur[part];
  }
  return typeof cur === 'string' && cur.trim() ? cur.trim() : null;
}

function pickBool(obj: Record<string, unknown>, path: string): boolean | null {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return null;
    cur = cur[part];
  }
  return typeof cur === 'boolean' ? cur : null;
}

@Injectable()
export class CuttingRoomAnalysisService {
  private readonly logger = new Logger(CuttingRoomAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly arrInstances: ArrInstanceService,
    private readonly plexServer: PlexServerService,
    private readonly plexWatchlist: PlexWatchlistService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
    private readonly seerr: SeerrService,
    private readonly tautulli: TautulliService,
  ) {}

  /** Whether Tautulli is configured+enabled for this user. */
  async tautulliConfigured(userId: string): Promise<{
    configured: boolean;
    baseUrl: string | null;
  }> {
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);
    const baseUrl = pickString(settings, 'tautulli.baseUrl');
    const apiKey = pickString(secrets, 'tautulli.apiKey');
    const enabled = pickBool(settings, 'tautulli.enabled') ?? Boolean(apiKey);
    return {
      configured: Boolean(enabled && baseUrl && apiKey),
      baseUrl,
    };
  }

  async runAnalysis(params: {
    userId: string;
    snapshotId: string;
    progress: AnalysisProgress;
    log: AnalysisLoggers;
  }): Promise<AnalysisSummary> {
    const { userId, snapshotId, progress, log } = params;
    const nowMs = Date.now();

    const snapshot = await this.prisma.cuttingRoomSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snapshot || snapshot.userId !== userId) {
      throw new Error(`Cutting Room snapshot not found: ${snapshotId}`);
    }
    const mediaType = snapshot.mediaType === 'show' ? 'show' : 'movie';
    const rules = normalizeCuttingRoomRules(snapshot.rulesJson);
    const scope = isPlainObject(snapshot.sectionKeys)
      ? (snapshot.sectionKeys as Record<string, unknown>)
      : {};
    const sectionKeys = (
      Array.isArray(scope['sections']) ? (scope['sections'] as unknown[]) : []
    )
      .map((s) => String(s))
      .filter((s) => s.length > 0);
    const instanceIds = (
      Array.isArray(scope['instances']) ? (scope['instances'] as unknown[]) : []
    )
      .map((s) => String(s))
      .filter((s) => s.length > 0);

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);
    const plexBaseUrl =
      pickString(settings, 'plex.baseUrl') ?? pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') ?? pickString(secrets, 'plexToken');
    if (!plexBaseUrl || !plexToken) {
      throw new Error(
        'CuttingRoom analysis requires a configured Plex server.',
      );
    }

    // ---- 1. Arr scan (per instance) --------------------------------------
    progress({ step: 'arr_scan', message: 'Reading Radarr/Sonarr library…' });
    const arrType = mediaType === 'movie' ? 'radarr' : 'sonarr';
    const idsToScan = instanceIds.length > 0 ? instanceIds : [''];
    const arrByTmdb = new Map<number, ArrJoinInfo>();
    const arrByTvdb = new Map<number, ArrJoinInfo>();
    const arrByTitleYear = new Map<string, ArrJoinInfo>();
    let arrItemsSeen = 0;

    for (const instanceIdRaw of idsToScan) {
      let resolved: { id: string; baseUrl: string; apiKey: string } | null =
        null;
      try {
        const inst = await this.arrInstances.resolveInstance(
          userId,
          arrType,
          instanceIdRaw || null,
          { requireConfigured: false },
        );
        if (inst?.baseUrl && inst?.apiKey) {
          resolved = {
            id: inst.id ?? (instanceIdRaw || `primary-${arrType}`),
            baseUrl: inst.baseUrl,
            apiKey: inst.apiKey,
          };
        }
      } catch (err) {
        await log.warn(
          `cutting room: could not resolve ${arrType} instance "${instanceIdRaw}": ${truncateErrorMessage(err)}`,
        );
      }
      if (!resolved) continue;

      const tagsById = new Map<number, string>();
      try {
        const client = mediaType === 'movie' ? this.radarr : this.sonarr;
        const tags = await client.listTags({
          baseUrl: resolved.baseUrl,
          apiKey: resolved.apiKey,
        });
        for (const tag of tags) {
          tagsById.set(tag.id, tag.label.toLowerCase());
        }
      } catch (err) {
        await log.warn(
          `cutting room: listing ${arrType} tags failed: ${truncateErrorMessage(err)}`,
        );
      }

      const register = (
        info: ArrJoinInfo,
        tmdbId?: number,
        tvdbId?: number,
        title?: string,
        year?: number,
      ) => {
        if (tmdbId && tmdbId > 0 && !arrByTmdb.has(tmdbId)) {
          arrByTmdb.set(tmdbId, info);
        }
        if (tvdbId && tvdbId > 0 && !arrByTvdb.has(tvdbId)) {
          arrByTvdb.set(tvdbId, info);
        }
        const key = titleYearKey(title ?? null, year ?? null);
        if (key !== '|' && !arrByTitleYear.has(key)) {
          arrByTitleYear.set(key, info);
        }
      };

      if (mediaType === 'movie') {
        const movies: RadarrMovie[] = await this.radarr.listMovies({
          baseUrl: resolved.baseUrl,
          apiKey: resolved.apiKey,
        });
        arrItemsSeen += movies.length;
        for (const movie of movies) {
          const ratings = movie.ratings ?? {};
          const ratingValues: number[] = [];
          let ratingVotes: number | null = null;
          for (const source of ['imdb', 'tmdb']) {
            const value = ratings[source]?.value;
            const votes = ratings[source]?.votes;
            if (
              typeof value === 'number' &&
              Number.isFinite(value) &&
              value > 0
            ) {
              ratingValues.push(value);
              if (
                ratingVotes === null &&
                typeof votes === 'number' &&
                votes > 0
              ) {
                ratingVotes = Math.trunc(votes);
              }
            }
          }
          const info: ArrJoinInfo = {
            instanceId: resolved.id,
            arrId: movie.id,
            monitored: Boolean(movie.monitored),
            tagLabels: (movie.tags ?? [])
              .map((t) => tagsById.get(t))
              .filter((t): t is string => Boolean(t)),
            status: movie.status ?? '',
            ended: false,
            path: movie.path ?? movie.folderName ?? null,
            rootFolderPath: movie.rootFolderPath ?? null,
            sizeOnDisk:
              (typeof movie.sizeOnDisk === 'number' ? movie.sizeOnDisk : 0) ||
              (typeof movie.movieFile?.size === 'number'
                ? movie.movieFile.size
                : 0),
            ratingValues,
            ratingVotes,
          };
          register(
            info,
            movie.tmdbId,
            undefined,
            movie.title,
            typeof movie.year === 'number' ? movie.year : undefined,
          );
        }
      } else {
        const series: SonarrSeries[] = await this.sonarr.listSeries({
          baseUrl: resolved.baseUrl,
          apiKey: resolved.apiKey,
        });
        arrItemsSeen += series.length;
        for (const show of series) {
          const ratingValue = show.ratings?.value;
          const ratingVotesRaw = show.ratings?.votes;
          const info: ArrJoinInfo = {
            instanceId: resolved.id,
            arrId: show.id,
            monitored: Boolean(show.monitored),
            tagLabels: (show.tags ?? [])
              .map((t) => tagsById.get(t))
              .filter((t): t is string => Boolean(t)),
            status: show.status ?? '',
            ended:
              show.ended === true ||
              (show.status ?? '').toLowerCase() === 'ended' ||
              (show.status ?? '').toLowerCase() === 'deleted',
            path: show.path ?? null,
            rootFolderPath: show.rootFolderPath ?? null,
            sizeOnDisk:
              typeof show.statistics?.sizeOnDisk === 'number'
                ? show.statistics.sizeOnDisk
                : 0,
            ratingValues:
              typeof ratingValue === 'number' &&
              Number.isFinite(ratingValue) &&
              ratingValue > 0
                ? [ratingValue]
                : [],
            ratingVotes:
              typeof ratingVotesRaw === 'number' && ratingVotesRaw > 0
                ? Math.trunc(ratingVotesRaw)
                : null,
          };
          register(
            info,
            undefined,
            show.tvdbId,
            show.title,
            typeof show.year === 'number' ? show.year : undefined,
          );
        }
      }
    }

    // ---- 2. Plex scan (selected sections) --------------------------------
    const plexItems: PlexCuttingRoomItem[] = [];
    for (let i = 0; i < sectionKeys.length; i += 1) {
      const sectionKey = sectionKeys[i];
      progress({
        step: 'plex_scan',
        message: `Scanning Plex library ${i + 1}/${sectionKeys.length}…`,
        current: i + 1,
        total: sectionKeys.length,
      });
      const items = await this.plexServer.listSectionItemsForCuttingRoom({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey: sectionKey,
        mediaType,
      });
      plexItems.push(...items);
    }

    // ---- 3. Watch-truth extras -------------------------------------------
    progress({ step: 'watch_truth', message: 'Collecting watch history…' });

    const watchedMovieKeys = new Set<string>();
    const watchedShowKeys = new Set<string>();
    const lastWatchedByKey = new Map<string, number>();
    const protectedUserWatchedKeys = new Set<string>();
    const protectedUserIds = new Set(rules.protectedPlexUserIds);

    const noteWatch = (
      key: string | null,
      type: 'movie' | 'show',
      viewedAtSec: number | null,
      byUserId: string | null,
    ) => {
      if (!key) return;
      (type === 'movie' ? watchedMovieKeys : watchedShowKeys).add(key);
      if (viewedAtSec !== null) {
        const ms = viewedAtSec * 1000;
        const prev = lastWatchedByKey.get(key) ?? 0;
        if (ms > prev) lastWatchedByKey.set(key, ms);
      }
      if (byUserId !== null && protectedUserIds.has(byUserId)) {
        protectedUserWatchedKeys.add(key);
      }
    };

    try {
      const history = await this.plexServer.getWatchHistory({
        baseUrl: plexBaseUrl,
        token: plexToken,
      });
      for (const entry of history) {
        const account =
          entry.accountId !== null ? String(entry.accountId) : null;
        if (entry.type === 'movie') {
          noteWatch(entry.ratingKey, 'movie', entry.viewedAt, account);
        } else if (entry.type === 'episode') {
          noteWatch(
            entry.grandparentRatingKey,
            'show',
            entry.viewedAt,
            account,
          );
        }
      }
    } catch (err) {
      await log.warn(
        `cutting room: Plex watch history unavailable: ${truncateErrorMessage(err)}`,
      );
    }

    const watchedTmdb = new Set<number>();
    const watchedTvdb = new Set<number>();
    try {
      const imported = await this.prisma.importedWatchEntry.findMany({
        where: { userId },
        select: { tmdbId: true, tvdbId: true },
      });
      for (const row of imported) {
        if (row.tmdbId) watchedTmdb.add(row.tmdbId);
        if (row.tvdbId) watchedTvdb.add(row.tvdbId);
      }
    } catch {
      // Imported history is optional.
    }

    // Tautulli (optional): all-user play counts + last played + sizes.
    let tautulliUsed = false;
    const tautulliByKey = new Map<
      string,
      { playCount: number; lastPlayed: number | null; fileSize: number }
    >();
    const tautulliBaseUrl = pickString(settings, 'tautulli.baseUrl');
    const tautulliApiKey = pickString(secrets, 'tautulli.apiKey');
    const tautulliEnabled =
      pickBool(settings, 'tautulli.enabled') ?? Boolean(tautulliApiKey);
    if (tautulliEnabled && tautulliBaseUrl && tautulliApiKey) {
      try {
        for (const sectionKey of sectionKeys) {
          const rows = await this.tautulli.getLibraryMediaInfo({
            baseUrl: tautulliBaseUrl,
            apiKey: tautulliApiKey,
            sectionId: sectionKey,
          });
          for (const row of rows) {
            if (!row.ratingKey) continue;
            tautulliByKey.set(row.ratingKey, {
              playCount: row.playCount,
              lastPlayed: row.lastPlayed,
              fileSize: row.fileSize,
            });
          }
        }
        const history = await this.tautulli.getHistory({
          baseUrl: tautulliBaseUrl,
          apiKey: tautulliApiKey,
        });
        for (const entry of history) {
          const account = entry.userId !== null ? String(entry.userId) : null;
          if (entry.mediaType === 'movie') {
            noteWatch(entry.ratingKey, 'movie', entry.date, account);
          } else if (entry.mediaType === 'episode') {
            noteWatch(entry.grandparentRatingKey, 'show', entry.date, account);
          }
        }
        tautulliUsed = true;
      } catch (err) {
        await log.warn(
          `cutting room: Tautulli unavailable, continuing with Plex data only: ${truncateErrorMessage(err)}`,
        );
      }
    }

    // ---- 4. Protection inputs --------------------------------------------
    progress({ step: 'protections', message: 'Collecting protections…' });

    const watchlistTitleYears = new Set<string>();
    if (rules.protectWatchlist) {
      try {
        const kind = mediaType;
        const { items } = await this.plexWatchlist.listWatchlist({
          token: plexToken,
          kind,
        });
        for (const item of items) {
          watchlistTitleYears.add(titleYearKey(item.title, item.year));
        }
      } catch (err) {
        await log.warn(
          `cutting room: watchlist unavailable: ${truncateErrorMessage(err)}`,
        );
      }
    }

    const onDeckKeys = new Set<string>();
    if (rules.protectOnDeck) {
      try {
        const entries = await this.plexServer.getOnDeck({
          baseUrl: plexBaseUrl,
          token: plexToken,
        });
        for (const entry of entries) {
          onDeckKeys.add(entry.ratingKey);
          if (entry.grandparentRatingKey) {
            onDeckKeys.add(entry.grandparentRatingKey);
          }
        }
      } catch (err) {
        await log.warn(
          `cutting room: on-deck unavailable: ${truncateErrorMessage(err)}`,
        );
      }
    }

    const requestedTmdb = new Set<number>();
    const requestedTvdb = new Set<number>();
    if (rules.protectSeerrRequests) {
      const seerrBaseUrl = pickString(settings, 'seerr.baseUrl');
      const seerrApiKey = pickString(secrets, 'seerr.apiKey');
      if (seerrBaseUrl && seerrApiKey) {
        try {
          const requests = await this.seerr.listRecentRequests({
            baseUrl: seerrBaseUrl,
            apiKey: seerrApiKey,
            sinceMs: nowMs - rules.seerrRequestWindowDays * DAY_MS,
          });
          for (const request of requests) {
            if (request.tmdbId) requestedTmdb.add(request.tmdbId);
            if (request.tvdbId) requestedTvdb.add(request.tvdbId);
          }
        } catch (err) {
          await log.warn(
            `cutting room: Seerr requests unavailable: ${truncateErrorMessage(err)}`,
          );
        }
      }
    }

    const managedCollectionKeys = new Set<string>();
    if (rules.protectManagedCollections) {
      try {
        const rows = await this.prisma.curatedCollectionItem.findMany({
          select: { ratingKey: true },
        });
        for (const row of rows) managedCollectionKeys.add(row.ratingKey);
      } catch {
        // Managed collections are optional.
      }
    }

    // ---- 5. Score every item ----------------------------------------------
    progress({
      step: 'scoring',
      message: `Scoring ${plexItems.length} items…`,
      current: 0,
      total: plexItems.length,
    });

    type CandidateRow = {
      mediaType: string;
      title: string;
      year: number | null;
      tier: number;
      score: number;
      sizeBytes: bigint;
      fileCount: number;
      watchStatus: string;
      confidence: string;
      plexRatingKey: string;
      librarySectionKey: string;
      tmdbId: number | null;
      tvdbId: number | null;
      arrInstanceId: string | null;
      arrId: number | null;
      monitored: boolean | null;
      rootFolderPath: string | null;
      path: string | null;
      addedAt: Date | null;
      lastWatchedAt: Date | null;
      rating: number | null;
      reasonsJson: unknown;
      snapshotId: string;
    };

    const candidates: CandidateRow[] = [];
    const tierAgg: Record<string, { count: number; bytes: number }> = {};
    const protectedAgg: Record<string, number> = {};
    let libraryBytes = 0;
    let candidateBytes = 0;
    let plexOnlyCount = 0;

    for (let i = 0; i < plexItems.length; i += 1) {
      const item = plexItems[i];
      if (i % 1000 === 0 && i > 0) {
        progress({
          step: 'scoring',
          message: `Scoring ${i}/${plexItems.length}…`,
          current: i,
          total: plexItems.length,
        });
      }

      const arr =
        (item.tmdbId ? arrByTmdb.get(item.tmdbId) : undefined) ??
        (item.tvdbId ? arrByTvdb.get(item.tvdbId) : undefined) ??
        arrByTitleYear.get(titleYearKey(item.title, item.year));

      const taut = tautulliByKey.get(item.ratingKey);
      const sizeBytes = Math.max(
        item.totalSizeBytes,
        arr?.sizeOnDisk ?? 0,
        taut?.fileSize ?? 0,
      );
      libraryBytes += sizeBytes;

      const watchedSet =
        mediaType === 'movie' ? watchedMovieKeys : watchedShowKeys;
      const everWatched =
        item.viewCount > 0 ||
        (item.lastViewedAt ?? 0) > 0 ||
        (item.viewedLeafCount ?? 0) > 0 ||
        watchedSet.has(item.ratingKey) ||
        (taut?.playCount ?? 0) > 0 ||
        (item.tmdbId !== null && watchedTmdb.has(item.tmdbId)) ||
        (item.tvdbId !== null && watchedTvdb.has(item.tvdbId));

      const lastWatchedMs = Math.max(
        (item.lastViewedAt ?? 0) * 1000,
        lastWatchedByKey.get(item.ratingKey) ?? 0,
        (taut?.lastPlayed ?? 0) * 1000,
      );

      let watchedFraction: number | null = null;
      if (mediaType === 'show') {
        if (item.leafCount && item.leafCount > 0) {
          watchedFraction = (item.viewedLeafCount ?? 0) / item.leafCount;
        }
      } else if (item.viewCount > 0) {
        watchedFraction = 1;
      } else if (item.viewOffset && item.durationMs && item.durationMs > 0) {
        watchedFraction = Math.min(1, item.viewOffset / item.durationMs);
      }

      const ratingSources = [
        ...(arr?.ratingValues ?? []),
        ...(item.audienceRating !== null &&
        Number.isFinite(item.audienceRating) &&
        item.audienceRating > 0
          ? [item.audienceRating]
          : []),
      ];
      const input: CuttingRoomScoreInput = {
        mediaType,
        addedAtMs: item.addedAt !== null ? item.addedAt * 1000 : null,
        everWatched,
        lastWatchedMs: lastWatchedMs > 0 ? lastWatchedMs : null,
        watchedFraction,
        // Blend every available aggregate source (arr imdb/tmdb or sonarr,
        // plus Plex audience rating); fall back to Plex critic rating.
        rating: meanOrNull(ratingSources) ?? item.rating,
        ratingVotes: arr?.ratingVotes ?? null,
        ratingMax: ratingSources.length > 0 ? Math.max(...ratingSources) : null,
        userRating: item.userRating,
        monitored: arr ? arr.monitored : null,
        inArr: Boolean(arr),
        showContinuing:
          mediaType === 'show' &&
          (arr ? (arr.status ?? '').toLowerCase() === 'continuing' : false),
        showEnded: mediaType === 'show' && Boolean(arr?.ended),
        tagLabels: arr?.tagLabels ?? [],
        librarySectionKey: item.librarySectionKey,
        onWatchlist: watchlistTitleYears.has(
          titleYearKey(item.title, item.year),
        ),
        onDeck: onDeckKeys.has(item.ratingKey),
        recentlyRequested:
          (item.tmdbId !== null && requestedTmdb.has(item.tmdbId)) ||
          (item.tvdbId !== null && requestedTvdb.has(item.tvdbId)),
        inManagedCollection: managedCollectionKeys.has(item.ratingKey),
        watchedByProtectedUser: protectedUserWatchedKeys.has(item.ratingKey),
      };

      const result = scoreCuttingRoomItem(input, rules, nowMs);
      if (result.excluded) {
        for (const code of result.protections) {
          protectedAgg[code] = (protectedAgg[code] ?? 0) + 1;
        }
        continue;
      }

      if (!arr) plexOnlyCount += 1;
      candidateBytes += sizeBytes;
      const tierKey = String(result.tier);
      tierAgg[tierKey] = tierAgg[tierKey] ?? { count: 0, bytes: 0 };
      tierAgg[tierKey].count += 1;
      tierAgg[tierKey].bytes += sizeBytes;

      candidates.push({
        snapshotId,
        mediaType,
        title: item.title ?? '(untitled)',
        year: item.year,
        tier: result.tier,
        score: Math.round(result.score),
        sizeBytes: BigInt(Math.round(sizeBytes)),
        fileCount:
          mediaType === 'show' ? (item.leafCount ?? 0) : item.fileCount,
        watchStatus: result.watchStatus,
        confidence: arr ? (tautulliUsed ? 'full' : 'plex_only') : 'plex_only',
        plexRatingKey: item.ratingKey,
        librarySectionKey: item.librarySectionKey,
        tmdbId: item.tmdbId,
        tvdbId: item.tvdbId,
        arrInstanceId: arr?.instanceId ?? null,
        arrId: arr?.arrId ?? null,
        monitored: arr ? arr.monitored : null,
        rootFolderPath: arr?.rootFolderPath ?? null,
        path:
          arr?.path ??
          (item.firstFilePath
            ? item.firstFilePath.replace(/\/[^/]+$/, '')
            : null),
        addedAt: item.addedAt !== null ? new Date(item.addedAt * 1000) : null,
        lastWatchedAt: lastWatchedMs > 0 ? new Date(lastWatchedMs) : null,
        rating: input.rating,
        reasonsJson: result.reasons,
      });
    }

    // ---- 6. Persist ---------------------------------------------------------
    progress({
      step: 'persisting',
      message: `Saving ${candidates.length} candidates…`,
    });

    await this.prisma.cuttingRoomCandidate.deleteMany({
      where: { snapshotId },
    });
    for (let i = 0; i < candidates.length; i += CANDIDATE_INSERT_CHUNK) {
      const chunk = candidates.slice(i, i + CANDIDATE_INSERT_CHUNK);
      await this.prisma.cuttingRoomCandidate.createMany({
        data: chunk as never[],
      });
    }

    await this.prisma.cuttingRoomSnapshot.update({
      where: { id: snapshotId },
      data: {
        status: 'READY',
        finishedAt: new Date(),
        libraryCount: plexItems.length,
        libraryBytes: BigInt(Math.round(libraryBytes)),
        candidateCount: candidates.length,
        candidateBytes: BigInt(Math.round(candidateBytes)),
        tierJson: tierAgg,
        protectedJson: protectedAgg,
      },
    });

    // Retention: keep the newest N interactive snapshots per user.
    const stale = await this.prisma.cuttingRoomSnapshot.findMany({
      where: { userId, kind: 'interactive' },
      orderBy: { createdAt: 'desc' },
      skip: INTERACTIVE_SNAPSHOTS_TO_KEEP,
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.prisma.cuttingRoomSnapshot.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
    }

    await log.info(
      `cutting room: analysis complete snapshot=${snapshotId} items=${plexItems.length} candidates=${candidates.length}`,
    );

    return {
      mediaType,
      sectionsScanned: sectionKeys.length,
      libraryCount: plexItems.length,
      libraryBytes,
      candidateCount: candidates.length,
      candidateBytes,
      tierAgg,
      protectedAgg,
      plexOnlyCount,
      tautulliUsed,
      arrItemsSeen,
    };
  }
}
