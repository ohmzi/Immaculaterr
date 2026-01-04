import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import type { JobContext, JsonObject } from '../jobs/jobs.types';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function resolveLegacyPointsPath(fileName: string): string | null {
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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

@Injectable()
export class ImmaculateTasteCollectionService {
  static readonly DEFAULT_MAX_POINTS = 50;
  static readonly LEGACY_POINTS_FILE = 'recommendation_points.json';

  constructor(private readonly prisma: PrismaService) {}

  async ensureLegacyImported(params: {
    ctx: JobContext;
    maxPoints?: number;
  }): Promise<{
    imported: boolean;
    sourcePath: string | null;
    importedCount: number;
  }> {
    const { ctx } = params;
    const maxPoints = clampMaxPoints(params.maxPoints);

    const existingCount = await this.prisma.immaculateTasteMovie.count();
    if (existingCount > 0) {
      await ctx.debug('immaculateTaste: legacy import not needed (table already has rows)', {
        existingCount,
      });
      return { imported: false, sourcePath: null, importedCount: 0 };
    }

    const sourcePath = resolveLegacyPointsPath(ImmaculateTasteCollectionService.LEGACY_POINTS_FILE);
    if (!sourcePath) {
      await ctx.info('immaculateTaste: no legacy points file found (starting fresh)', {
        expectedFile: ImmaculateTasteCollectionService.LEGACY_POINTS_FILE,
      });
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
      await ctx.warn('immaculateTaste: legacy points JSON is invalid (skipping import)', {
        sourcePath,
        error: (err as Error)?.message ?? String(err),
      });
      return { imported: false, sourcePath, importedCount: 0 };
    }

    if (!isPlainObject(parsed)) {
      await ctx.warn('immaculateTaste: legacy points JSON has unexpected shape (skipping import)', {
        sourcePath,
        type: Array.isArray(parsed) ? 'array' : typeof parsed,
      });
      return { imported: false, sourcePath, importedCount: 0 };
    }

    const rows: Prisma.ImmaculateTasteMovieCreateManyInput[] = [];
    for (const [k, v] of Object.entries(parsed)) {
      const ratingKey = String(k).trim();
      if (!ratingKey) continue;

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

      if (!points || points <= 0) continue;
      if (points > maxPoints) points = maxPoints;

      rows.push({
        ratingKey,
        title: title || undefined,
        points,
        tmdbId: tmdbId && tmdbId > 0 ? tmdbId : undefined,
      });
    }

    if (!rows.length) {
      await ctx.warn('immaculateTaste: legacy points file had no importable rows', {
        sourcePath,
      });
      return { imported: false, sourcePath, importedCount: 0 };
    }

    // Avoid SQLite variable limits: batch createMany.
    const batches = chunk(rows, 200);
    for (const batch of batches) {
      await this.prisma.immaculateTasteMovie.createMany({ data: batch });
    }

    await ctx.info('immaculateTaste: legacy import complete', {
      sourcePath,
      importedCount: rows.length,
    });

    return { imported: true, sourcePath, importedCount: rows.length };
  }

  async applyPointsUpdate(params: {
    ctx: JobContext;
    suggested: Array<{ ratingKey: string; title?: string | null }>;
    maxPoints?: number;
  }): Promise<JsonObject> {
    const { ctx } = params;
    const maxPoints = clampMaxPoints(params.maxPoints);

    const suggestedKeys = Array.from(
      new Set(
        (params.suggested ?? [])
          .map((s) => (s?.ratingKey ? String(s.ratingKey).trim() : ''))
          .filter(Boolean),
      ),
    );

    await ctx.info('immaculateTaste: points update start', {
      maxPoints,
      suggestedNow: suggestedKeys.length,
      sampleSuggested: suggestedKeys.slice(0, 10),
    });

    // 1) Upsert suggested items -> maxPoints
    let upserted = 0;
    for (const s of params.suggested ?? []) {
      const ratingKey = s?.ratingKey ? String(s.ratingKey).trim() : '';
      if (!ratingKey) continue;
      const title = s?.title ? String(s.title).trim() : '';

      await this.prisma.immaculateTasteMovie.upsert({
        where: { ratingKey },
        update: {
          points: maxPoints,
          ...(title ? { title } : {}),
        },
        create: {
          ratingKey,
          title: title || null,
          points: maxPoints,
        },
      });
      upserted += 1;
    }

    // 2) Decay all non-suggested items by 1 (points > 0 only)
    const decayed = await this.prisma.immaculateTasteMovie.updateMany({
      where: {
        points: { gt: 0 },
        ...(suggestedKeys.length ? { ratingKey: { notIn: suggestedKeys } } : {}),
      },
      data: { points: { decrement: 1 } },
    });

    // 3) Remove anything that hit 0 or below
    const removed = await this.prisma.immaculateTasteMovie.deleteMany({
      where: { points: { lte: 0 } },
    });

    const totalAfter = await this.prisma.immaculateTasteMovie.count();

    const summary: JsonObject = {
      maxPoints,
      suggestedNow: suggestedKeys.length,
      upserted,
      decayed: decayed.count,
      removed: removed.count,
      totalAfter,
    };

    await ctx.info('immaculateTaste: points update done', summary);
    return summary;
  }

  async getActiveMovies(params: { minPoints?: number; take?: number }) {
    const minPoints = Math.max(1, Math.trunc(params.minPoints ?? 1));
    const take = params.take ? Math.max(1, Math.trunc(params.take)) : undefined;

    return await this.prisma.immaculateTasteMovie.findMany({
      where: { points: { gte: minPoints } },
      orderBy: [{ points: 'desc' }, { updatedAt: 'desc' }],
      ...(take ? { take } : {}),
    });
  }

  buildTieredRandomOrder(params: {
    movies: Array<{ ratingKey: string; points: number }>;
    maxPoints?: number;
  }): string[] {
    const maxPoints = clampMaxPoints(params.maxPoints);
    const lowMax = Math.floor(maxPoints / 3);
    const midMax = Math.floor((2 * maxPoints) / 3);

    const tiers: Record<'high' | 'mid' | 'low', string[]> = {
      high: [],
      mid: [],
      low: [],
    };

    for (const m of params.movies ?? []) {
      const ratingKey = String(m.ratingKey ?? '').trim();
      if (!ratingKey) continue;
      const p = Number.isFinite(m.points) ? Math.trunc(m.points) : 0;
      if (p <= 0) continue;

      if (p > midMax) tiers.high.push(ratingKey);
      else if (p > lowMax) tiers.mid.push(ratingKey);
      else tiers.low.push(ratingKey);
    }

    const pickOne = (arr: string[]) =>
      arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;

    const topPicks: string[] = [];
    for (const tier of ['high', 'mid', 'low'] as const) {
      const p = pickOne(tiers[tier]);
      if (p) topPicks.push(p);
    }
    shuffleInPlace(topPicks);

    const used = new Set(topPicks);
    const remaining: string[] = [];
    for (const tier of ['high', 'mid', 'low'] as const) {
      for (const rk of tiers[tier]) {
        if (used.has(rk)) continue;
        remaining.push(rk);
      }
    }
    shuffleInPlace(remaining);

    return [...topPicks, ...remaining];
  }
}

function clampMaxPoints(v: unknown): number {
  const n =
    typeof v === 'number' && Number.isFinite(v)
      ? Math.trunc(v)
      : typeof v === 'string' && v.trim()
        ? Number.parseInt(v.trim(), 10)
        : ImmaculateTasteCollectionService.DEFAULT_MAX_POINTS;
  if (!Number.isFinite(n)) return ImmaculateTasteCollectionService.DEFAULT_MAX_POINTS;
  return Math.max(1, Math.min(100, n));
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j]!;
    arr[j] = tmp!;
  }
  return arr;
}


