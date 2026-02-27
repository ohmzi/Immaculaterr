import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import type { JobContext, JsonObject } from '../jobs/jobs.types';
import { TmdbService } from '../tmdb/tmdb.service';

const DEFAULT_MAX_POINTS = 50;

type ThreeTierShowShuffleParams = {
  shows: Array<{
    tvdbId: number;
    tmdbVoteAvg: number | null;
    tmdbVoteCount: number | null;
  }>;
};

type RatedShow = {
  tvdbId: number;
  tmdbVoteAvg: number | null;
  tmdbVoteCount: number | null;
};

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== 'number') return null;
  return Number.isFinite(value) ? value : null;
};

const parseIntegerString = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampMaxPoints = (value: unknown): number => {
  const parsed = asFiniteNumber(value) ?? parseIntegerString(value);
  if (parsed === null) return DEFAULT_MAX_POINTS;
  const n = Math.trunc(parsed);
  return Math.max(1, Math.min(100, n));
};

const shuffleInPlace = <T>(arr: T[]) => {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr;
};

const toUniqueRatedShows = (shows: ThreeTierShowShuffleParams['shows']): RatedShow[] => {
  const uniq = new Map<number, RatedShow>();
  for (const show of shows ?? []) {
    const tvdbId = Number.isFinite(show.tvdbId) ? Math.trunc(show.tvdbId) : NaN;
    if (!Number.isFinite(tvdbId) || tvdbId <= 0) continue;
    if (uniq.has(tvdbId)) continue;
    uniq.set(tvdbId, {
      tvdbId,
      tmdbVoteAvg: show.tmdbVoteAvg ?? null,
      tmdbVoteCount: show.tmdbVoteCount ?? null,
    });
  }
  return Array.from(uniq.values());
};

const sortByTmdbRating = (shows: RatedShow[]): RatedShow[] => {
  return [...shows].sort((a, b) => {
    const ar = Number.isFinite(a.tmdbVoteAvg ?? NaN) ? Number(a.tmdbVoteAvg) : 0;
    const br = Number.isFinite(b.tmdbVoteAvg ?? NaN) ? Number(b.tmdbVoteAvg) : 0;
    if (br !== ar) return br - ar;
    const ac = Number.isFinite(a.tmdbVoteCount ?? NaN) ? Number(a.tmdbVoteCount) : 0;
    const bc = Number.isFinite(b.tmdbVoteCount ?? NaN) ? Number(b.tmdbVoteCount) : 0;
    if (bc !== ac) return bc - ac;
    return a.tvdbId - b.tvdbId;
  });
};

const splitThreeTiers = <T>(items: T[]) => {
  const n = items.length;
  const base = Math.floor(n / 3);
  const rem = n % 3;
  const highSize = base + (rem > 0 ? 1 : 0);
  const midSize = base + (rem > 1 ? 1 : 0);
  return {
    high: items.slice(0, highSize),
    mid: items.slice(highSize, highSize + midSize),
    low: items.slice(highSize + midSize),
  };
};

const pickTopTierShowIds = (tiers: { high: RatedShow[]; mid: RatedShow[]; low: RatedShow[] }): number[] => {
  const picks: number[] = [];
  const used = new Set<number>();
  const pickOne = (tier: RatedShow[]) => {
    const pool = tier.filter((show) => !used.has(show.tvdbId));
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)] as RatedShow;
    used.add(pick.tvdbId);
    picks.push(pick.tvdbId);
  };
  pickOne(tiers.high);
  pickOne(tiers.mid);
  pickOne(tiers.low);
  shuffleInPlace(picks);
  return picks;
};

const buildThreeTierShowOrder = (params: ThreeTierShowShuffleParams): number[] => {
  const sorted = sortByTmdbRating(toUniqueRatedShows(params.shows));
  if (!sorted.length) return [];
  const tiers = splitThreeTiers(sorted);
  const topPicks = pickTopTierShowIds(tiers);
  const used = new Set(topPicks);
  const remaining = sorted
    .filter((show) => !used.has(show.tvdbId))
    .map((show) => show.tvdbId);
  shuffleInPlace(remaining);
  return [...topPicks, ...remaining];
};

@Injectable()
export class ImmaculateTasteShowCollectionService {
  static readonly DEFAULT_MAX_POINTS = DEFAULT_MAX_POINTS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tmdb: TmdbService,
  ) {}

  private readonly legacyImportImportedCount = 0;

  private readonly buildThreeTierTmdbRatingShuffleOrderImpl = buildThreeTierShowOrder;

  // TV has no legacy JSON import (movie-only historical artifact).
  ensureLegacyImported(params: {
    ctx: JobContext;
    plexUserId: string;
    maxPoints?: number;
  }): Promise<{ imported: boolean; sourcePath: string | null; importedCount: number }> {
    const importedCount = this.legacyImportImportedCount;
    return Promise.resolve({
      imported: false,
      sourcePath: null,
      importedCount: params.maxPoints ? importedCount : importedCount,
    });
  }

  async applyPointsUpdate(params: {
    ctx: JobContext;
    plexUserId: string;
    librarySectionKey: string;
    suggested: Array<{
      tvdbId: number;
      tmdbId?: number | null;
      title?: string | null;
      tmdbVoteAvg?: number | null;
      tmdbVoteCount?: number | null;
      inPlex?: boolean | null;
    }>;
    maxPoints?: number;
  }): Promise<JsonObject> {
    const { ctx } = params;
    const plexUserId = params.plexUserId.trim();
    if (!plexUserId) throw new Error('plexUserId is required');
    const librarySectionKey = params.librarySectionKey.trim();
    if (!librarySectionKey) throw new Error('librarySectionKey is required');
    const maxPoints = clampMaxPoints(params.maxPoints);

    const suggestedByTvdbId = new Map<
      number,
      {
        tvdbId: number;
        tmdbId: number | null;
        title: string;
        tmdbVoteAvg: number | null;
        tmdbVoteCount: number | null;
        inPlex: boolean;
      }
    >();

    for (const s of params.suggested ?? []) {
      const tvdbId =
        typeof s?.tvdbId === 'number' && Number.isFinite(s.tvdbId)
          ? Math.trunc(s.tvdbId)
          : null;
      if (!tvdbId || tvdbId <= 0) continue;

      const tmdbId =
        typeof s?.tmdbId === 'number' && Number.isFinite(s.tmdbId)
          ? Math.trunc(s.tmdbId)
          : null;
      const title = typeof s?.title === 'string' ? s.title.trim() : '';
      const tmdbVoteAvg =
        typeof s?.tmdbVoteAvg === 'number' && Number.isFinite(s.tmdbVoteAvg)
          ? Number(s.tmdbVoteAvg)
          : null;
      const tmdbVoteCount =
        typeof s?.tmdbVoteCount === 'number' && Number.isFinite(s.tmdbVoteCount)
          ? Math.max(0, Math.trunc(s.tmdbVoteCount))
          : null;
      const inPlex = Boolean(s?.inPlex);

      const existing = suggestedByTvdbId.get(tvdbId);
      if (!existing) {
        suggestedByTvdbId.set(tvdbId, {
          tvdbId,
          tmdbId,
          title,
          tmdbVoteAvg,
          tmdbVoteCount,
          inPlex,
        });
        continue;
      }

      suggestedByTvdbId.set(tvdbId, {
        tvdbId,
        tmdbId: existing.tmdbId ?? tmdbId,
        title: existing.title || title,
        tmdbVoteAvg: existing.tmdbVoteAvg ?? tmdbVoteAvg,
        tmdbVoteCount: existing.tmdbVoteCount ?? tmdbVoteCount,
        inPlex: existing.inPlex || inPlex,
      });
    }

    const suggestedTvdbIds = Array.from(suggestedByTvdbId.keys());

    await ctx.info('immaculateTaste(tv): points update start', {
      librarySectionKey,
      maxPoints,
      suggestedNow: suggestedTvdbIds.length,
      sampleSuggested: suggestedTvdbIds.slice(0, 10),
    });

    const [totalBefore, totalActiveBefore, totalPendingBefore] = await Promise.all([
      this.prisma.immaculateTasteShowLibrary.count({
        where: { plexUserId, librarySectionKey },
      }),
      this.prisma.immaculateTasteShowLibrary.count({
        where: { plexUserId, librarySectionKey, status: 'active' },
      }),
      this.prisma.immaculateTasteShowLibrary.count({
        where: { plexUserId, librarySectionKey, status: 'pending' },
      }),
    ]);

    const existing = suggestedTvdbIds.length
      ? await this.prisma.immaculateTasteShowLibrary.findMany({
          where: { plexUserId, librarySectionKey, tvdbId: { in: suggestedTvdbIds } },
          select: { tvdbId: true, status: true },
        })
      : [];
    const existingStatus = new Map(existing.map((e) => [e.tvdbId, e.status]));

    let createdActive = 0;
    let createdPending = 0;
    let refreshedActive = 0;
    let activatedFromPending = 0;
    let updatedPending = 0;

    for (const s of suggestedByTvdbId.values()) {
      const prev = existingStatus.get(s.tvdbId) ?? null;
      const title = s.title || null;
      const tmdbId = s.tmdbId;
      const tmdbVoteAvg = s.tmdbVoteAvg;
      const tmdbVoteCount = s.tmdbVoteCount;

      if (!prev) {
        const status = s.inPlex ? 'active' : 'pending';
        await this.prisma.immaculateTasteShowLibrary.create({
          data: {
            plexUserId,
            librarySectionKey,
            tvdbId: s.tvdbId,
            tmdbId: tmdbId ?? undefined,
            title,
            status,
            points: status === 'active' ? maxPoints : 0,
            tmdbVoteAvg,
            tmdbVoteCount,
          },
        });
        if (status === 'active') createdActive += 1;
        else createdPending += 1;
        continue;
      }

      if (prev === 'active') {
        await this.prisma.immaculateTasteShowLibrary.update({
          where: {
            plexUserId_librarySectionKey_tvdbId: {
              plexUserId,
              librarySectionKey,
              tvdbId: s.tvdbId,
            },
          },
          data: {
            points: maxPoints,
            ...(title ? { title } : {}),
            ...(tmdbId !== null ? { tmdbId } : {}),
            ...(tmdbVoteAvg !== null ? { tmdbVoteAvg } : {}),
            ...(tmdbVoteCount !== null ? { tmdbVoteCount } : {}),
          },
        });
        refreshedActive += 1;
        continue;
      }

      // prev === 'pending'
      if (s.inPlex) {
        await this.prisma.immaculateTasteShowLibrary.update({
          where: {
            plexUserId_librarySectionKey_tvdbId: {
              plexUserId,
              librarySectionKey,
              tvdbId: s.tvdbId,
            },
          },
          data: {
            status: 'active',
            points: maxPoints,
            ...(title ? { title } : {}),
            ...(tmdbId !== null ? { tmdbId } : {}),
            ...(tmdbVoteAvg !== null ? { tmdbVoteAvg } : {}),
            ...(tmdbVoteCount !== null ? { tmdbVoteCount } : {}),
          },
        });
        activatedFromPending += 1;
      } else {
        await this.prisma.immaculateTasteShowLibrary.update({
          where: {
            plexUserId_librarySectionKey_tvdbId: {
              plexUserId,
              librarySectionKey,
              tvdbId: s.tvdbId,
            },
          },
          data: {
            ...(title ? { title } : {}),
            ...(tmdbId !== null ? { tmdbId } : {}),
            ...(tmdbVoteAvg !== null ? { tmdbVoteAvg } : {}),
            ...(tmdbVoteCount !== null ? { tmdbVoteCount } : {}),
          },
        });
        updatedPending += 1;
      }
    }

    const decayed = await this.prisma.immaculateTasteShowLibrary.updateMany({
      where: {
        plexUserId,
        librarySectionKey,
        status: 'active',
        points: { gt: 0 },
        ...(suggestedTvdbIds.length ? { tvdbId: { notIn: suggestedTvdbIds } } : {}),
      },
      data: { points: { decrement: 1 } },
    });

    const removed = await this.prisma.immaculateTasteShowLibrary.deleteMany({
      where: { plexUserId, librarySectionKey, status: 'active', points: { lte: 0 } },
    });

    const [totalAfter, totalActiveAfter, totalPendingAfter] = await Promise.all([
      this.prisma.immaculateTasteShowLibrary.count({
        where: { plexUserId, librarySectionKey },
      }),
      this.prisma.immaculateTasteShowLibrary.count({
        where: { plexUserId, librarySectionKey, status: 'active' },
      }),
      this.prisma.immaculateTasteShowLibrary.count({
        where: { plexUserId, librarySectionKey, status: 'pending' },
      }),
    ]);

    const summary: JsonObject = {
      librarySectionKey,
      maxPoints,
      suggestedNow: suggestedTvdbIds.length,
      totalBefore,
      totalActiveBefore,
      totalPendingBefore,
      createdActive,
      createdPending,
      refreshedActive,
      activatedFromPending,
      updatedPending,
      decayed: decayed.count,
      removed: removed.count,
      totalAfter,
      totalActiveAfter,
      totalPendingAfter,
    };

    await ctx.info('immaculateTaste(tv): points update done', summary);
    return summary;
  }

  async activatePendingNowInPlex(params: {
    ctx: JobContext;
    plexUserId: string;
    librarySectionKey: string;
    tvdbIds: number[];
    pointsOnActivation?: number;
    tmdbApiKey?: string | null;
  }): Promise<{ activated: number; tmdbRatingsUpdated: number }> {
    const { ctx } = params;
    const plexUserId = params.plexUserId.trim();
    if (!plexUserId) throw new Error('plexUserId is required');
    const librarySectionKey = params.librarySectionKey.trim();
    if (!librarySectionKey) throw new Error('librarySectionKey is required');
    const tmdbApiKey = (params.tmdbApiKey ?? '').trim();
    const tvdbIds = Array.from(
      new Set(
        (params.tvdbIds ?? [])
          .map((id) =>
            typeof id === 'number' && Number.isFinite(id) ? Math.trunc(id) : NaN,
          )
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    );
    const pointsOnActivation = clampMaxPoints(
      params.pointsOnActivation ?? ImmaculateTasteShowCollectionService.DEFAULT_MAX_POINTS,
    );

    if (!tvdbIds.length) return { activated: 0, tmdbRatingsUpdated: 0 };

    const pendingRows = await this.prisma.immaculateTasteShowLibrary.findMany({
      where: { plexUserId, librarySectionKey, status: 'pending', tvdbId: { in: tvdbIds } },
      select: { tvdbId: true, tmdbId: true },
    });
    const pendingTvdbIds = pendingRows.map((r) => r.tvdbId);
    if (!pendingTvdbIds.length) return { activated: 0, tmdbRatingsUpdated: 0 };

    const res = await this.prisma.immaculateTasteShowLibrary.updateMany({
      where: {
        plexUserId,
        librarySectionKey,
        status: 'pending',
        tvdbId: { in: pendingTvdbIds },
      },
      data: { status: 'active', points: pointsOnActivation },
    });

    if (res.count) {
      await ctx.info('immaculateTaste(tv): activated pending shows now in Plex', {
        activated: res.count,
        pointsOnActivation,
      });
    }

    let tmdbRatingsUpdated = 0;
    if (res.count && tmdbApiKey) {
      const tmdbPairs = pendingRows
        .map((r) => ({
          tvdbId: r.tvdbId,
          tmdbId:
            typeof r.tmdbId === 'number' && Number.isFinite(r.tmdbId)
              ? Math.trunc(r.tmdbId)
              : null,
        }))
        .filter((p) => p.tmdbId && p.tmdbId > 0);

      const batches = chunk(tmdbPairs, 6);
      for (const batch of batches) {
        await Promise.all(
          batch.map(async (p) => {
            const stats = await this.tmdb
              .getTvVoteStats({ apiKey: tmdbApiKey, tmdbId: p.tmdbId as number })
              .catch(() => null);
            const voteAvg = stats?.vote_average ?? null;
            const voteCount = stats?.vote_count ?? null;
            if (voteAvg === null && voteCount === null) return;

            await this.prisma.immaculateTasteShowLibrary.update({
              where: {
                plexUserId_librarySectionKey_tvdbId: {
                  plexUserId,
                  librarySectionKey,
                  tvdbId: p.tvdbId,
                },
              },
              data: { tmdbVoteAvg: voteAvg, tmdbVoteCount: voteCount },
            });
            tmdbRatingsUpdated += 1;
          }),
        );
      }

      if (tmdbRatingsUpdated) {
        await ctx.info('immaculateTaste(tv): refreshed TMDB ratings on activation', {
          updated: tmdbRatingsUpdated,
          activated: res.count,
        });
      }
    } else if (res.count && !tmdbApiKey) {
      await ctx.warn(
        'immaculateTaste(tv): TMDB apiKey missing; skipping rating refresh on activation',
        { activated: res.count },
      );
    }

    return { activated: res.count, tmdbRatingsUpdated };
  }

  async getActiveShows(params: {
    plexUserId: string;
    librarySectionKey: string;
    minPoints?: number;
    take?: number;
  }) {
    const librarySectionKey = params.librarySectionKey.trim();
    if (!librarySectionKey) throw new Error('librarySectionKey is required');
    const plexUserId = params.plexUserId.trim();
    if (!plexUserId) throw new Error('plexUserId is required');
    const minPoints = Math.max(1, Math.trunc(params.minPoints ?? 1));
    const take = params.take ? Math.max(1, Math.trunc(params.take)) : undefined;

    return await this.prisma.immaculateTasteShowLibrary.findMany({
      where: {
        plexUserId,
        librarySectionKey,
        status: 'active',
        points: { gte: minPoints },
      },
      orderBy: [{ points: 'desc' }, { updatedAt: 'desc' }],
      ...(take ? { take } : {}),
    });
  }

  buildThreeTierTmdbRatingShuffleOrder(params: ThreeTierShowShuffleParams): number[] {
    return this.buildThreeTierTmdbRatingShuffleOrderImpl(params);
  }
}
