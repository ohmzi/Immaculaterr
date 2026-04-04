import { IMMACULATE_TASTE_RECENT_RELEASE_MONTHS } from '../app.constants';

export type ImmaculateOrderableItem = {
  id: number;
  tmdbVoteAvg: number | null;
  tmdbVoteCount: number | null;
  releaseDate: Date | string | null;
};

type RatedForTier = {
  id: number;
  tmdbVoteAvg: number | null;
  tmdbVoteCount: number | null;
};

export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function utcCalendarKeyFromDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addCalendarMonthsUtc(base: Date, deltaMonths: number): Date {
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + deltaMonths;
  const d = base.getUTCDate();
  return new Date(Date.UTC(y, m, d));
}

export function toReleaseCalendarKey(
  value: Date | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return utcCalendarKeyFromDate(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (!Number.isFinite(parsed.getTime())) return null;
    return utcCalendarKeyFromDate(parsed);
  }
  return null;
}

/** TMDB `YYYY-MM-DD` → UTC noon Date for stable Prisma/sqlite storage. */
export function tmdbCalendarDateStringToDate(
  value: string | null | undefined,
): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const y = Number(trimmed.slice(0, 4));
  const m = Number(trimmed.slice(5, 7));
  const d = Number(trimmed.slice(8, 10));
  if (![y, m, d].every((n) => Number.isFinite(n))) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

const toUniqueRated = (items: ImmaculateOrderableItem[]): RatedForTier[] => {
  const uniq = new Map<number, RatedForTier>();
  for (const item of items ?? []) {
    const id = Number.isFinite(item.id) ? Math.trunc(item.id) : NaN;
    if (!Number.isFinite(id) || id <= 0) continue;
    if (uniq.has(id)) continue;
    uniq.set(id, {
      id,
      tmdbVoteAvg: item.tmdbVoteAvg ?? null,
      tmdbVoteCount: item.tmdbVoteCount ?? null,
    });
  }
  return Array.from(uniq.values());
};

export const sortByTmdbRating = (items: RatedForTier[]): RatedForTier[] => {
  return [...items].sort((a, b) => {
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
    return a.id - b.id;
  });
};

export const splitThreeTiers = <T>(items: T[]) => {
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

export const pickTopTierIds = (tiers: {
  high: RatedForTier[];
  mid: RatedForTier[];
  low: RatedForTier[];
}): number[] => {
  const picks: number[] = [];
  const used = new Set<number>();
  const pickOne = (tier: RatedForTier[]) => {
    const pool = tier.filter((row) => !used.has(row.id));
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    used.add(pick.id);
    picks.push(pick.id);
  };
  pickOne(tiers.high);
  pickOne(tiers.mid);
  pickOne(tiers.low);
  shuffleInPlace(picks);
  return picks;
};

/**
 * Three-tier TMDB rating shuffle on `items` (deduped by `id`).
 * Preserves legacy behavior used by movie (`tmdbId`) and TV (`tvdbId`) callers.
 */
export function buildThreeTierOrder(params: {
  items: ImmaculateOrderableItem[];
}): number[] {
  const sorted = sortByTmdbRating(toUniqueRated(params.items));
  if (!sorted.length) return [];
  const tiers = splitThreeTiers(sorted);
  const topPicks = pickTopTierIds(tiers);
  const used = new Set(topPicks);
  const remaining = sorted
    .filter((row) => !used.has(row.id))
    .map((row) => row.id);
  shuffleInPlace(remaining);
  return [...topPicks, ...remaining];
}

/**
 * Picks one random item released within the last N months (inclusive, UTC calendar)
 * for position 1; remaining items pass through {@link buildThreeTierOrder}.
 */
export function buildImmaculateCollectionOrder(params: {
  items: ImmaculateOrderableItem[];
  now?: Date;
  recentReleaseMonths?: number;
}): number[] {
  if (!toUniqueRated(params.items).length) return [];

  const now = params.now ?? new Date();
  const recentMonths =
    typeof params.recentReleaseMonths === 'number' &&
    Number.isFinite(params.recentReleaseMonths)
      ? Math.max(1, Math.trunc(params.recentReleaseMonths))
      : IMMACULATE_TASTE_RECENT_RELEASE_MONTHS;

  const todayKey = utcCalendarKeyFromDate(now);
  const cutoffKey = utcCalendarKeyFromDate(
    addCalendarMonthsUtc(now, -recentMonths),
  );

  const recentPool: ImmaculateOrderableItem[] = [];
  for (const item of params.items ?? []) {
    const id = Number.isFinite(item.id) ? Math.trunc(item.id) : NaN;
    if (!Number.isFinite(id) || id <= 0) continue;
    const key = toReleaseCalendarKey(item.releaseDate);
    if (!key || key < cutoffKey || key > todayKey) continue;
    recentPool.push(item);
  }

  const recentUniqueIds = new Set<number>();
  const recentDeduped: ImmaculateOrderableItem[] = [];
  for (const item of recentPool) {
    const id = Math.trunc(item.id);
    if (recentUniqueIds.has(id)) continue;
    recentUniqueIds.add(id);
    recentDeduped.push(item);
  }

  if (!recentDeduped.length) {
    return buildThreeTierOrder({ items: params.items });
  }

  const first = recentDeduped[Math.floor(Math.random() * recentDeduped.length)];
  const firstId = Math.trunc(first.id);
  const restItems = (params.items ?? []).filter(
    (item) => Math.trunc(item.id) !== firstId,
  );

  return [firstId, ...buildThreeTierOrder({ items: restItems })];
}
