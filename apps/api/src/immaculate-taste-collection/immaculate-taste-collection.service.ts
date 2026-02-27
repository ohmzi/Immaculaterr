import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import type { JobContext, JsonObject } from '../jobs/jobs.types';
import { TmdbService } from '../tmdb/tmdb.service';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { immaculateTasteResetMarkerKey } from './immaculate-taste-reset';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const asInt = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export function resolveLegacyPointsPath(fileName: string): string | null {
  // Prefer APP_DATA_DIR (same place tcp.sqlite lives)
  const appDataDir = process.env['APP_DATA_DIR'];
  if (appDataDir) {
    const candidate = path.resolve(appDataDir, fileName);
    if (existsSync(candidate)) return candidate;
  }

  // Fallback: common layouts relative to current working directory
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, 'data', fileName),
    path.resolve(cwd, '..', 'data', fileName),
    path.resolve(cwd, '..', '..', 'data', fileName),
    path.resolve(cwd, '..', '..', '..', 'data', fileName),
    path.resolve(cwd, '..', '..', '..', '..', 'data', fileName),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

@Injectable()
export class ImmaculateTasteCollectionService {
  static readonly DEFAULT_MAX_POINTS = 50;
  static readonly LEGACY_POINTS_FILE = 'recommendation_points.json';

  constructor(
    private readonly prisma: PrismaService,
    private readonly tmdb: TmdbService,
  ) {}

  async ensureLegacyImported(params: {
    ctx: JobContext;
    plexUserId: string;
    librarySectionKey: string;
    maxPoints?: number;
  }): Promise<{
    imported: boolean;
    sourcePath: string | null;
    importedCount: number;
  }> {
    const { ctx } = params;
    const plexUserId = params.plexUserId.trim();
    if (!plexUserId) {
      throw new Error('plexUserId is required');
    }
    const librarySectionKey = params.librarySectionKey.trim();
    if (!librarySectionKey) {
      throw new Error('librarySectionKey is required');
    }
    const maxPoints = clampMaxPoints(params.maxPoints);

    const resetMarkerKey = immaculateTasteResetMarkerKey({
      mediaType: 'movie',
      librarySectionKey,
    });
    const resetMarker = await this.prisma.setting
      .findUnique({ where: { key: resetMarkerKey } })
      .catch(() => null);
    if (resetMarker) {
      await ctx.info(
        'immaculateTaste: legacy import blocked (library was reset)',
        { librarySectionKey, resetMarkerKey },
      );
      return { imported: false, sourcePath: null, importedCount: 0 };
    }

    const existingCount = await this.prisma.immaculateTasteMovieLibrary.count({
      where: { plexUserId, librarySectionKey },
    });
    if (existingCount > 0) {
      await ctx.debug(
        'immaculateTaste: legacy import not needed (library dataset already has rows)',
        {
          librarySectionKey,
          existingCount,
        },
      );
      return { imported: false, sourcePath: null, importedCount: 0 };
    }

    const sourcePath = resolveLegacyPointsPath(
      ImmaculateTasteCollectionService.LEGACY_POINTS_FILE,
    );
    if (!sourcePath) {
      await ctx.info(
        'immaculateTaste: no legacy points file found (starting fresh)',
        {
          expectedFile: ImmaculateTasteCollectionService.LEGACY_POINTS_FILE,
        },
      );
      return { imported: false, sourcePath: null, importedCount: 0 };
    }

    await ctx.info('immaculateTaste: importing legacy points file', {
      sourcePath,
      maxPoints,
    });

    const raw = await readFile(sourcePath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (err) {
      await ctx.warn(
        'immaculateTaste: legacy points JSON is invalid (skipping import)',
        {
          sourcePath,
          error: (err as Error)?.message ?? String(err),
        },
      );
      return { imported: false, sourcePath, importedCount: 0 };
    }

    if (!isPlainObject(parsed)) {
      await ctx.warn(
        'immaculateTaste: legacy points JSON has unexpected shape (skipping import)',
        {
          sourcePath,
          type: Array.isArray(parsed) ? 'array' : typeof parsed,
        },
      );
      return { imported: false, sourcePath, importedCount: 0 };
    }

    const byTmdbId = new Map<
      number,
      Prisma.ImmaculateTasteMovieLibraryCreateManyInput
    >();
    for (const [k, v] of Object.entries(parsed)) {
      // Legacy file was keyed by Plex ratingKey; ignore it and import by tmdbId only.
      const legacyKey = String(k).trim();
      if (!legacyKey) continue;

      let points: number | null = null;
      let title: string | null = null;
      let tmdbId: number | null = null;

      if (typeof v === 'number' || typeof v === 'string') {
        points = asInt(v);
      } else if (isPlainObject(v)) {
        points = asInt(v.points ?? v.score ?? v.value ?? null);
        const titleRaw = v.title;
        title = typeof titleRaw === 'string' ? titleRaw.trim() : null;
        tmdbId = asInt(v.tmdb_id ?? v.tmdbId ?? null);
      }

      if (!tmdbId || tmdbId <= 0) continue;
      if (!points || points <= 0) continue;
      if (points > maxPoints) points = maxPoints;

      const existing = byTmdbId.get(tmdbId);
      const existingPoints =
        existing &&
        typeof existing.points === 'number' &&
        Number.isFinite(existing.points)
          ? Math.trunc(existing.points)
          : 0;
      if (!existing || points > existingPoints) {
        byTmdbId.set(tmdbId, {
          plexUserId,
          librarySectionKey,
          tmdbId,
          title: title || undefined,
          status: 'active',
          points,
        });
      }
    }

    const rows = Array.from(byTmdbId.values());

    if (!rows.length) {
      await ctx.warn(
        'immaculateTaste: legacy points file had no importable rows',
        {
          sourcePath,
        },
      );
      return { imported: false, sourcePath, importedCount: 0 };
    }

    // Avoid SQLite variable limits: batch createMany.
    const batches = chunk(rows, 200);
    for (const batch of batches) {
      await this.prisma.immaculateTasteMovieLibrary.createMany({ data: batch });
    }

    await ctx.info('immaculateTaste: legacy import complete', {
      sourcePath,
      importedCount: rows.length,
    });

    return { imported: true, sourcePath, importedCount: rows.length };
  }

  async applyPointsUpdate(params: {
    ctx: JobContext;
    plexUserId: string;
    librarySectionKey: string;
    suggested: Array<{
      tmdbId: number;
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

    const suggestedByTmdbId = new Map<
      number,
      {
        tmdbId: number;
        title: string;
        tmdbVoteAvg: number | null;
        tmdbVoteCount: number | null;
        inPlex: boolean;
      }
    >();

    for (const s of params.suggested ?? []) {
      const tmdbId =
        typeof s?.tmdbId === 'number' && Number.isFinite(s.tmdbId)
          ? Math.trunc(s.tmdbId)
          : null;
      if (!tmdbId || tmdbId <= 0) continue;

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

      const existing = suggestedByTmdbId.get(tmdbId);
      if (!existing) {
        suggestedByTmdbId.set(tmdbId, {
          tmdbId,
          title,
          tmdbVoteAvg,
          tmdbVoteCount,
          inPlex,
        });
        continue;
      }

      // Merge duplicates (prefer inPlex=true and keep best-known metadata)
      suggestedByTmdbId.set(tmdbId, {
        tmdbId,
        title: existing.title || title,
        tmdbVoteAvg: existing.tmdbVoteAvg ?? tmdbVoteAvg,
        tmdbVoteCount: existing.tmdbVoteCount ?? tmdbVoteCount,
        inPlex: existing.inPlex || inPlex,
      });
    }

    const suggestedTmdbIds = Array.from(suggestedByTmdbId.keys());

    await ctx.info('immaculateTaste: points update start', {
      librarySectionKey,
      maxPoints,
      suggestedNow: suggestedTmdbIds.length,
      sampleSuggested: suggestedTmdbIds.slice(0, 10),
    });

    const [totalBefore, totalActiveBefore, totalPendingBefore] = await Promise.all(
      [
        this.prisma.immaculateTasteMovieLibrary.count({
          where: { plexUserId, librarySectionKey },
        }),
        this.prisma.immaculateTasteMovieLibrary.count({
          where: { plexUserId, librarySectionKey, status: 'active' },
        }),
        this.prisma.immaculateTasteMovieLibrary.count({
          where: { plexUserId, librarySectionKey, status: 'pending' },
        }),
      ],
    );

    const existing = suggestedTmdbIds.length
      ? await this.prisma.immaculateTasteMovieLibrary.findMany({
          where: {
            plexUserId,
            librarySectionKey,
            tmdbId: { in: suggestedTmdbIds },
          },
          select: { tmdbId: true, status: true },
        })
      : [];
    const existingStatus = new Map(existing.map((e) => [e.tmdbId, e.status]));

    // 1) Upsert suggested items (active items are set to maxPoints; pending items are tracked for later activation)
    let createdActive = 0;
    let createdPending = 0;
    let refreshedActive = 0;
    let activatedFromPending = 0;
    let updatedPending = 0;

    for (const s of suggestedByTmdbId.values()) {
      const prev = existingStatus.get(s.tmdbId) ?? null;

      const title = s.title || null;
      const tmdbVoteAvg = s.tmdbVoteAvg;
      const tmdbVoteCount = s.tmdbVoteCount;

      if (!prev) {
        const status = s.inPlex ? 'active' : 'pending';
        await this.prisma.immaculateTasteMovieLibrary.create({
          data: {
            plexUserId,
            librarySectionKey,
            tmdbId: s.tmdbId,
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
        await this.prisma.immaculateTasteMovieLibrary.update({
          where: {
            plexUserId_librarySectionKey_tmdbId: {
              plexUserId,
              librarySectionKey,
              tmdbId: s.tmdbId,
            },
          },
          data: {
            points: maxPoints,
            ...(title ? { title } : {}),
            ...(tmdbVoteAvg !== null ? { tmdbVoteAvg } : {}),
            ...(tmdbVoteCount !== null ? { tmdbVoteCount } : {}),
          },
        });
        refreshedActive += 1;
        continue;
      }

      // prev === 'pending'
      if (s.inPlex) {
        await this.prisma.immaculateTasteMovieLibrary.update({
          where: {
            plexUserId_librarySectionKey_tmdbId: {
              plexUserId,
              librarySectionKey,
              tmdbId: s.tmdbId,
            },
          },
          data: {
            status: 'active',
            points: maxPoints,
            ...(title ? { title } : {}),
            ...(tmdbVoteAvg !== null ? { tmdbVoteAvg } : {}),
            ...(tmdbVoteCount !== null ? { tmdbVoteCount } : {}),
          },
        });
        activatedFromPending += 1;
      } else {
        await this.prisma.immaculateTasteMovieLibrary.update({
          where: {
            plexUserId_librarySectionKey_tmdbId: {
              plexUserId,
              librarySectionKey,
              tmdbId: s.tmdbId,
            },
          },
          data: {
            ...(title ? { title } : {}),
            ...(tmdbVoteAvg !== null ? { tmdbVoteAvg } : {}),
            ...(tmdbVoteCount !== null ? { tmdbVoteCount } : {}),
          },
        });
        updatedPending += 1;
      }
    }

    // 2) Decay active non-suggested items by 1 (points > 0 only)
    const decayed = await this.prisma.immaculateTasteMovieLibrary.updateMany({
      where: {
        plexUserId,
        librarySectionKey,
        status: 'active',
        points: { gt: 0 },
        ...(suggestedTmdbIds.length
          ? { tmdbId: { notIn: suggestedTmdbIds } }
          : {}),
      },
      data: { points: { decrement: 1 } },
    });

    // 3) Remove active items that hit 0 or below. Pending items are preserved.
    const removed = await this.prisma.immaculateTasteMovieLibrary.deleteMany({
      where: { plexUserId, librarySectionKey, status: 'active', points: { lte: 0 } },
    });

    const [totalAfter, totalActiveAfter, totalPendingAfter] = await Promise.all(
      [
        this.prisma.immaculateTasteMovieLibrary.count({
          where: { plexUserId, librarySectionKey },
        }),
        this.prisma.immaculateTasteMovieLibrary.count({
          where: { plexUserId, librarySectionKey, status: 'active' },
        }),
        this.prisma.immaculateTasteMovieLibrary.count({
          where: { plexUserId, librarySectionKey, status: 'pending' },
        }),
      ],
    );

    const summary: JsonObject = {
      librarySectionKey,
      maxPoints,
      suggestedNow: suggestedTmdbIds.length,
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

    await ctx.info('immaculateTaste: points update done', summary);
    return summary;
  }

  async activatePendingNowInPlex(params: {
    ctx: JobContext;
    plexUserId: string;
    librarySectionKey: string;
    tmdbIds: number[];
    pointsOnActivation?: number;
    tmdbApiKey?: string | null;
  }): Promise<{ activated: number; tmdbRatingsUpdated: number }> {
    const { ctx } = params;
    const plexUserId = params.plexUserId.trim();
    if (!plexUserId) throw new Error('plexUserId is required');
    const librarySectionKey = params.librarySectionKey.trim();
    if (!librarySectionKey) throw new Error('librarySectionKey is required');
    const tmdbApiKey = (params.tmdbApiKey ?? '').trim();
    const tmdbIds = Array.from(
      new Set(
        (params.tmdbIds ?? [])
          .map((id) =>
            typeof id === 'number' && Number.isFinite(id)
              ? Math.trunc(id)
              : NaN,
          )
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    );
    const pointsOnActivation = clampMaxPoints(
      params.pointsOnActivation ??
        ImmaculateTasteCollectionService.DEFAULT_MAX_POINTS,
    );

    if (!tmdbIds.length) return { activated: 0, tmdbRatingsUpdated: 0 };

    // Only activate titles that are currently pending.
    const pendingRows = await this.prisma.immaculateTasteMovieLibrary.findMany({
      where: {
        plexUserId,
        librarySectionKey,
        status: 'pending',
        tmdbId: { in: tmdbIds },
      },
      select: { tmdbId: true },
    });
    const pendingIds = pendingRows.map((r) => r.tmdbId);
    if (!pendingIds.length) return { activated: 0, tmdbRatingsUpdated: 0 };

    const res = await this.prisma.immaculateTasteMovieLibrary.updateMany({
      where: {
        plexUserId,
        librarySectionKey,
        status: 'pending',
        tmdbId: { in: pendingIds },
      },
      data: { status: 'active', points: pointsOnActivation },
    });

    if (res.count) {
      await ctx.info('immaculateTaste: activated pending titles now in Plex', {
        activated: res.count,
        pointsOnActivation,
      });
    }

    // Fetch the latest TMDB rating at activation time (even if the row already had one).
    let tmdbRatingsUpdated = 0;
    if (res.count && tmdbApiKey) {
      const batches = chunk(pendingIds, 6);
      for (const batch of batches) {
        await Promise.all(
          batch.map(async (tmdbId) => {
            const stats = await this.tmdb
              .getMovieVoteStats({ apiKey: tmdbApiKey, tmdbId })
              .catch(() => null);
            const voteAvg = stats?.vote_average ?? null;
            const voteCount = stats?.vote_count ?? null;
            if (voteAvg === null && voteCount === null) return;

            await this.prisma.immaculateTasteMovieLibrary.update({
              where: {
                plexUserId_librarySectionKey_tmdbId: {
                  plexUserId,
                  librarySectionKey,
                  tmdbId,
                },
              },
              data: {
                tmdbVoteAvg: voteAvg,
                tmdbVoteCount: voteCount,
              },
            });
            tmdbRatingsUpdated += 1;
          }),
        );
      }
      if (tmdbRatingsUpdated) {
        await ctx.info('immaculateTaste: refreshed TMDB ratings on activation', {
          updated: tmdbRatingsUpdated,
          activated: res.count,
        });
      }
    } else if (res.count && !tmdbApiKey) {
      await ctx.warn('immaculateTaste: TMDB apiKey missing; skipping rating refresh on activation', {
        activated: res.count,
      });
    }

    return { activated: res.count, tmdbRatingsUpdated };
  }

  async getActiveMovies(params: {
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

    return await this.prisma.immaculateTasteMovieLibrary.findMany({
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

  static buildThreeTierTmdbRatingShuffleOrder(params: {
    movies: Array<{
      tmdbId: number;
      tmdbVoteAvg: number | null;
      tmdbVoteCount: number | null;
    }>;
  }): number[] {
    const uniq = new Map<
      number,
      {
        tmdbId: number;
        tmdbVoteAvg: number | null;
        tmdbVoteCount: number | null;
      }
    >();
    for (const m of params.movies ?? []) {
      const tmdbId = Number.isFinite(m.tmdbId) ? Math.trunc(m.tmdbId) : NaN;
      if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
      if (!uniq.has(tmdbId))
        uniq.set(tmdbId, {
          tmdbId,
          tmdbVoteAvg: m.tmdbVoteAvg ?? null,
          tmdbVoteCount: m.tmdbVoteCount ?? null,
        });
    }

    const sorted = Array.from(uniq.values()).sort((a, b) => {
      const ar = Number.isFinite(a.tmdbVoteAvg ?? NaN)
        ? Number(a.tmdbVoteAvg)
        : 0;
      const br = Number.isFinite(b.tmdbVoteAvg ?? NaN)
        ? Number(b.tmdbVoteAvg)
        : 0;
      if (br !== ar) return br - ar;
      const ac = Number.isFinite(a.tmdbVoteCount ?? NaN)
        ? Number(a.tmdbVoteCount)
        : 0;
      const bc = Number.isFinite(b.tmdbVoteCount ?? NaN)
        ? Number(b.tmdbVoteCount)
        : 0;
      if (bc !== ac) return bc - ac;
      return a.tmdbId - b.tmdbId;
    });

    const n = sorted.length;
    if (!n) return [];

    const base = Math.floor(n / 3);
    const rem = n % 3;
    const highSize = base + (rem > 0 ? 1 : 0);
    const midSize = base + (rem > 1 ? 1 : 0);

    const high = sorted.slice(0, highSize);
    const mid = sorted.slice(highSize, highSize + midSize);
    const low = sorted.slice(highSize + midSize);

    const pickOne = <T>(arr: T[]): T | null =>
      arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;

    const picks: number[] = [];
    const used = new Set<number>();
    const pickTier = (tier: typeof sorted) => {
      const pool = tier.filter((m) => !used.has(m.tmdbId));
      const p = pickOne(pool);
      if (!p) return;
      used.add(p.tmdbId);
      picks.push(p.tmdbId);
    };

    // Top 3: 1 random pick from each tier (high/mid/low), then shuffled.
    pickTier(high);
    pickTier(mid);
    pickTier(low);
    shuffleInPlace(picks);

    const remaining = sorted
      .filter((m) => !used.has(m.tmdbId))
      .map((m) => m.tmdbId);
    shuffleInPlace(remaining);

    return [...picks, ...remaining];
  }
}

(function() {
  function clampMaxPoints(v: unknown): number {
    const n =
      typeof v === 'number' && Number.isFinite(v)
        ? Math.trunc(v)
        : typeof v === 'string' && v.trim()
          ? Number.parseInt(v.trim(), 10)
          : ImmaculateTasteCollectionService.DEFAULT_MAX_POINTS;
    if (!Number.isFinite(n))
      return ImmaculateTasteCollectionService.DEFAULT_MAX_POINTS;
    return Math.max(1, Math.min(100, n));
  }
})();

export function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j] as T;
    arr[j] = tmp as T;
  }
  return arr;
}
