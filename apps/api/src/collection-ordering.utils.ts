import { COLLECTION_RECENT_RELEASE_MONTHS } from './app.constants';

export type CollectionOrderableItem = {
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

const toFinitePositiveId = (value: number): number | null => {
  const normalizedId = Number.isFinite(value) ? Math.trunc(value) : NaN;
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
    return null;
  }
  return normalizedId;
};

const toComparableNumber = (value: number | null): number => {
  return Number.isFinite(value ?? NaN) ? Number(value) : 0;
};

const utcCalendarKeyFromDate = (date: Date): string => {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(date.getUTCDate()).padStart(2, '0');
  return [year, month, dayOfMonth].join('-');
};

const addCalendarMonthsUtc = (base: Date, deltaMonths: number): Date => {
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + deltaMonths;
  const dayOfMonth = base.getUTCDate();
  return new Date(Date.UTC(year, month, dayOfMonth));
};

const parseCalendarDateParts = (
  value: string,
): { year: number; month: number; dayOfMonth: number } | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const dayOfMonth = Number(value.slice(8, 10));
  if (![year, month, dayOfMonth].every(Number.isFinite)) {
    return null;
  }

  return {
    year,
    month,
    dayOfMonth,
  };
};

const parseStringReleaseCalendarKey = (value: string): string | null => {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  return utcCalendarKeyFromDate(parsed);
};

const toRatedForTier = (item: CollectionOrderableItem): RatedForTier | null => {
  const normalizedId = toFinitePositiveId(item.id);
  if (normalizedId === null) {
    return null;
  }

  return {
    id: normalizedId,
    tmdbVoteAvg: item.tmdbVoteAvg ?? null,
    tmdbVoteCount: item.tmdbVoteCount ?? null,
  };
};

const dedupeById = (
  items: CollectionOrderableItem[],
): CollectionOrderableItem[] => {
  const seenIds = new Set<number>();
  const dedupedItems: CollectionOrderableItem[] = [];
  for (const item of items) {
    const normalizedId = toFinitePositiveId(item.id);
    if (normalizedId === null || seenIds.has(normalizedId)) {
      continue;
    }
    seenIds.add(normalizedId);
    dedupedItems.push(item);
  }
  return dedupedItems;
};

const resolveRecentReleaseMonths = (
  recentReleaseMonths: number | undefined,
): number => {
  if (
    typeof recentReleaseMonths === 'number' &&
    Number.isFinite(recentReleaseMonths)
  ) {
    return Math.max(1, Math.trunc(recentReleaseMonths));
  }
  return COLLECTION_RECENT_RELEASE_MONTHS;
};

/** Fisher-Yates shuffle that preserves the input array reference. */
export const shuffleInPlace = <T>(items: T[]): T[] => {
  for (
    let currentIndex = items.length - 1;
    currentIndex > 0;
    currentIndex -= 1
  ) {
    const swapIndex = Math.floor(Math.random() * (currentIndex + 1));
    [items[currentIndex], items[swapIndex]] = [
      items[swapIndex],
      items[currentIndex],
    ];
  }
  return items;
};

/** Normalizes a Date or date-like string to `YYYY-MM-DD` when valid. */
export const toReleaseCalendarKey = (
  value: Date | string | null | undefined,
): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return utcCalendarKeyFromDate(value);
  }
  if (typeof value === 'string') {
    return parseStringReleaseCalendarKey(value);
  }
  return null;
};

type CollectionLeadPools = {
  currentYearUnwatchedPool: CollectionOrderableItem[];
  recentPool: CollectionOrderableItem[];
};

const collectLeadPools = (params: {
  items: CollectionOrderableItem[];
  todayKey: string;
  cutoffKey: string;
  yearStartKey: string;
  watchedIds?: Set<number>;
}): CollectionLeadPools => {
  const leadPools: CollectionLeadPools = {
    currentYearUnwatchedPool: [],
    recentPool: [],
  };

  for (const item of params.items) {
    const normalizedId = toFinitePositiveId(item.id);
    if (normalizedId === null) {
      continue;
    }

    const releaseCalendarKey = toReleaseCalendarKey(item.releaseDate);
    if (!releaseCalendarKey || releaseCalendarKey > params.todayKey) {
      continue;
    }

    if (releaseCalendarKey >= params.cutoffKey) {
      leadPools.recentPool.push(item);
    }
    if (
      releaseCalendarKey >= params.yearStartKey &&
      (!params.watchedIds || !params.watchedIds.has(normalizedId))
    ) {
      leadPools.currentYearUnwatchedPool.push(item);
    }
  }

  return leadPools;
};

/** TMDB `YYYY-MM-DD` → UTC noon Date for stable Prisma/sqlite storage. */
export const tmdbCalendarDateStringToDate = (
  value: string | null | undefined,
): Date | null => {
  if (typeof value !== 'string') return null;
  const dateParts = parseCalendarDateParts(value.trim());
  if (!dateParts) return null;

  const { year, month, dayOfMonth } = dateParts;
  const normalizedDate = new Date(
    Date.UTC(year, month - 1, dayOfMonth, 12, 0, 0),
  );
  return Number.isFinite(normalizedDate.getTime()) ? normalizedDate : null;
};

const toUniqueRated = (items: CollectionOrderableItem[]): RatedForTier[] => {
  const uniqueRatedItems = new Map<number, RatedForTier>();
  for (const item of items) {
    const ratedItem = toRatedForTier(item);
    if (!ratedItem || uniqueRatedItems.has(ratedItem.id)) {
      continue;
    }
    uniqueRatedItems.set(ratedItem.id, ratedItem);
  }
  return Array.from(uniqueRatedItems.values());
};

/** Sorts candidates by TMDB average rating, then vote count, then stable id. */
export const sortByTmdbRating = (items: RatedForTier[]): RatedForTier[] => {
  return [...items].sort((leftItem, rightItem) => {
    const ratingDifference =
      toComparableNumber(rightItem.tmdbVoteAvg) -
      toComparableNumber(leftItem.tmdbVoteAvg);
    if (ratingDifference !== 0) return ratingDifference;

    const voteCountDifference =
      toComparableNumber(rightItem.tmdbVoteCount) -
      toComparableNumber(leftItem.tmdbVoteCount);
    if (voteCountDifference !== 0) return voteCountDifference;

    return leftItem.id - rightItem.id;
  });
};

/** Splits a list into high/mid/low tiers with any remainder kept near the top. */
export const splitThreeTiers = <T>(items: T[]) => {
  const itemCount = items.length;
  const baseTierSize = Math.floor(itemCount / 3);
  const remainder = itemCount % 3;
  const highTierSize = baseTierSize + (remainder > 0 ? 1 : 0);
  const middleTierSize = baseTierSize + (remainder > 1 ? 1 : 0);
  return {
    high: items.slice(0, highTierSize),
    mid: items.slice(highTierSize, highTierSize + middleTierSize),
    low: items.slice(highTierSize + middleTierSize),
  };
};

/** Picks one unique id from each tier, then shuffles those lead ids. */
export const pickTopTierIds = (tiers: {
  high: RatedForTier[];
  mid: RatedForTier[];
  low: RatedForTier[];
}): number[] => {
  const picks: number[] = [];
  const usedIds = new Set<number>();
  const pickOne = (tier: RatedForTier[]): void => {
    const availableItems = tier.filter((row) => !usedIds.has(row.id));
    if (!availableItems.length) {
      return;
    }

    const pickedItem =
      availableItems[Math.floor(Math.random() * availableItems.length)];
    usedIds.add(pickedItem.id);
    picks.push(pickedItem.id);
    return;
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
export const buildThreeTierOrder = (params: {
  items: CollectionOrderableItem[];
}): number[] => {
  const sorted = sortByTmdbRating(toUniqueRated(params.items));
  if (!sorted.length) return [];
  const tiers = splitThreeTiers(sorted);
  const topTierIds = pickTopTierIds(tiers);
  const usedIds = new Set(topTierIds);
  const remaining = sorted
    .filter((row) => !usedIds.has(row.id))
    .map((row) => row.id);
  shuffleInPlace(remaining);
  return [...topTierIds, ...remaining];
};

/**
 * Universal collection ordering.
 *
 * Position 1: prefer a current-year title unwatched by the user.
 * Fallback: any item released within the last N months.
 * Remaining items: three-tier TMDB rating shuffle.
 */
export const buildCollectionOrder = (params: {
  items: CollectionOrderableItem[];
  watchedIds?: Set<number>;
  now?: Date;
  recentReleaseMonths?: number;
}): number[] => {
  if (!toUniqueRated(params.items).length) return [];

  const now = params.now ?? new Date();
  const recentMonths = resolveRecentReleaseMonths(params.recentReleaseMonths);

  const todayKey = utcCalendarKeyFromDate(now);
  const cutoffKey = utcCalendarKeyFromDate(
    addCalendarMonthsUtc(now, -recentMonths),
  );
  const currentYear = now.getUTCFullYear();
  const yearStartKey = [String(currentYear), '01', '01'].join('-');

  const leadPools = collectLeadPools({
    items: params.items,
    todayKey,
    cutoffKey,
    yearStartKey,
    watchedIds: params.watchedIds,
  });
  const currentYearDeduped = dedupeById(leadPools.currentYearUnwatchedPool);
  const recentDeduped = dedupeById(leadPools.recentPool);
  const pickPool = currentYearDeduped.length
    ? currentYearDeduped
    : recentDeduped;

  if (!pickPool.length) {
    return buildThreeTierOrder({ items: params.items });
  }

  const firstItem = pickPool[Math.floor(Math.random() * pickPool.length)];
  const firstId = Math.trunc(firstItem.id);
  const restItems = params.items.filter(
    (item) => Math.trunc(item.id) !== firstId,
  );

  return [firstId, ...buildThreeTierOrder({ items: restItems })];
};
