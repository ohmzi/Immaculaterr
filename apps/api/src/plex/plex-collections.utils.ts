
export function normalizeCollectionTitle(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const normalized =
    typeof raw.normalize === 'function' ? raw.normalize('NFKD') : raw;
  return normalized
    .replace(/[\u2010-\u2015\u2212-]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export const CURATED_MOVIE_COLLECTION_HUB_ORDER = [
  'Based on your recently watched movie',
  'Change of Taste',
  'Inspired by your Immaculate Taste',
] as const;

export const CURATED_TV_COLLECTION_HUB_ORDER = [
  'Based on your recently watched show',
  'Change of Taste',
  'Inspired by your Immaculate Taste',
] as const;

type CuratedMediaType = 'movie' | 'tv';

const CURATED_BASE_HINTS = {
  recentlyWatchedMovie: 'based on your recently watched movie',
  recentlyWatchedShow: 'based on your recently watched show',
  recentlyWatchedGeneric: 'based on your recently watched',
  changeOfTaste: 'change of taste',
  immaculateTaste: 'inspired by your immaculate taste',
} as const;

const CURATED_ORDER_LOOKUP = {
  movie: new Map(
    CURATED_MOVIE_COLLECTION_HUB_ORDER.map((name, index) => [
      normalizeCollectionTitle(name),
      index,
    ]),
  ),
  tv: new Map(
    CURATED_TV_COLLECTION_HUB_ORDER.map((name, index) => [
      normalizeCollectionTitle(name),
      index,
    ]),
  ),
} satisfies Record<CuratedMediaType, Map<string, number>>;

export function buildUserCollectionName(
  baseName: string,
  plexUserTitle?: string | null,
): string {
  const base = String(baseName ?? '').trim();
  const title = String(plexUserTitle ?? '').trim();
  if (!base) return title;
  if (!title) return base;
  // New format: "Collection Name (username)"
  return `${base} (${title})`;
}

export function stripUserCollectionSuffix(collectionName: string): string {
  const raw = String(collectionName ?? '').trim();
  if (!raw) return raw;

  // Format: "Collection Name (username)"
  const parenMatch = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const before = parenMatch[1]?.trim() || '';
    const after = parenMatch[2]?.trim() || '';
    const baseHints = [
      'based on your',
      'change of taste',
      'inspired by your immaculate taste',
    ];
    const looksLikeBase = (value: string) => {
      const lower = value.toLowerCase();
      return baseHints.some((hint) => lower.includes(hint));
    };
    if (before && after) {
      const beforeIsBase = looksLikeBase(before);
      const afterIsBase = looksLikeBase(after);
      if (beforeIsBase && !afterIsBase) return before;
      if (afterIsBase && !beforeIsBase) return after;
    }
    return before || after || raw;
  }

  // If no parentheses format found, return as-is
  return raw;
}

// Backwards-compat alias.
export const stripUserCollectionPrefix = stripUserCollectionSuffix;

function normalizeCuratedBaseName(params: {
  collectionName: string;
  mediaType: CuratedMediaType;
}): string | null {
  const candidates = [
    normalizeCollectionTitle(params.collectionName),
    normalizeCollectionTitle(stripUserCollectionSuffix(params.collectionName)),
  ].filter(Boolean);

  for (const value of candidates) {
    if (value.includes(CURATED_BASE_HINTS.changeOfTaste)) {
      return 'Change of Taste';
    }
    if (value.includes(CURATED_BASE_HINTS.immaculateTaste)) {
      return 'Inspired by your Immaculate Taste';
    }
    if (value.includes(CURATED_BASE_HINTS.recentlyWatchedMovie)) {
      return 'Based on your recently watched movie';
    }
    if (value.includes(CURATED_BASE_HINTS.recentlyWatchedShow)) {
      return 'Based on your recently watched show';
    }
    if (value.includes(CURATED_BASE_HINTS.recentlyWatchedGeneric)) {
      return params.mediaType === 'tv'
        ? 'Based on your recently watched show'
        : 'Based on your recently watched movie';
    }
  }

  return null;
}

export function resolveCuratedCollectionBaseName(params: {
  collectionName: string;
  mediaType: CuratedMediaType;
}): string | null {
  return normalizeCuratedBaseName(params);
}

export function curatedCollectionOrderIndex(params: {
  collectionName: string;
  mediaType: CuratedMediaType;
}): number {
  const base = normalizeCuratedBaseName(params);
  if (!base) return Number.MAX_SAFE_INTEGER;
  return (
    CURATED_ORDER_LOOKUP[params.mediaType].get(normalizeCollectionTitle(base)) ??
    Number.MAX_SAFE_INTEGER
  );
}

export function hasSameCuratedCollectionBase(params: {
  left: string;
  right: string;
  mediaType: CuratedMediaType;
}): boolean {
  const a = normalizeCuratedBaseName({
    collectionName: params.left,
    mediaType: params.mediaType,
  });
  const b = normalizeCuratedBaseName({
    collectionName: params.right,
    mediaType: params.mediaType,
  });
  return Boolean(a) && a === b;
}

export function sortCollectionNamesByCuratedBaseOrder(params: {
  collectionNames: string[];
  mediaType: CuratedMediaType;
}): string[] {
  return params.collectionNames.slice().sort((a, b) => {
    const ai = curatedCollectionOrderIndex({
      collectionName: a,
      mediaType: params.mediaType,
    });
    const bi = curatedCollectionOrderIndex({
      collectionName: b,
      mediaType: params.mediaType,
    });
    if (ai !== bi) return ai - bi;
    return normalizeCollectionTitle(a).localeCompare(normalizeCollectionTitle(b));
  });
}

export function buildUserCollectionHubOrder(
  baseNames: readonly string[],
  plexUserTitle?: string | null,
): string[] {
  return baseNames.map((name) => buildUserCollectionName(name, plexUserTitle));
}
