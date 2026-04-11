import { normalizeTitleForMatching } from '../lib/title-normalize';

const DURABLE_AUTO_RUN_JOB_IDS = [
  'immaculateTastePoints',
  'watchedMovieRecommendations',
] as const;

export const DURABLE_AUTO_RUN_JOB_ID_SET = new Set<string>(
  DURABLE_AUTO_RUN_JOB_IDS,
);

type AutoRunMediaInput = Record<string, unknown> | null | undefined;

export type AutoRunMediaHistoryPayload = {
  mediaFingerprint: string;
  plexUserId: string;
  mediaType: 'movie' | 'episode';
  librarySectionKey: string;
  seedRatingKey: string | null;
  showRatingKey: string | null;
  seedTitle: string | null;
  seedYear: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  source: string;
};

function pickString(input: AutoRunMediaInput, keys: string | string[]): string {
  if (!input) return '';
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    const value = input[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function pickInteger(
  input: AutoRunMediaInput,
  keys: string | string[],
): number | null {
  if (!input) return null;
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value.trim(), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function normalizeFingerprintTitle(title: string): string {
  return normalizeTitleForMatching(title).trim().toLowerCase();
}

function normalizeDebugTitle(title: string): string {
  return normalizeTitleForMatching(title).trim();
}

function pickLibrarySectionKey(input: AutoRunMediaInput): string {
  return (
    pickString(input, ['seedLibrarySectionKey', 'librarySectionKey']) ||
    (() => {
      const librarySectionId = pickInteger(input, 'seedLibrarySectionId');
      return librarySectionId === null ? '' : String(librarySectionId);
    })()
  );
}

export function buildAutoRunMediaFingerprint(
  input: AutoRunMediaInput,
): string | null {
  const plexUserId = pickString(input, 'plexUserId');
  const mediaType = pickString(input, 'mediaType').toLowerCase();
  const librarySectionKey = pickLibrarySectionKey(input);
  if (!plexUserId || !librarySectionKey) return null;

  if (mediaType === 'movie') {
    const seedRatingKey = pickString(input, ['seedRatingKey', 'ratingKey']);
    if (seedRatingKey) {
      return [
        'movie',
        `plexUser:${plexUserId}`,
        `library:${librarySectionKey}`,
        `ratingKey:${seedRatingKey}`,
      ].join('|');
    }

    const seedTitle = normalizeFingerprintTitle(
      pickString(input, ['seedTitle', 'title']),
    );
    const seedYear = pickInteger(input, 'seedYear');
    if (!seedTitle || seedYear === null) return null;

    return [
      'movie',
      `plexUser:${plexUserId}`,
      `library:${librarySectionKey}`,
      `title:${seedTitle}`,
      `year:${seedYear}`,
    ].join('|');
  }

  if (mediaType === 'episode') {
    const episodeRatingKey = pickString(input, ['seedRatingKey', 'ratingKey']);
    if (episodeRatingKey) {
      return [
        'episode',
        `plexUser:${plexUserId}`,
        `library:${librarySectionKey}`,
        `ratingKey:${episodeRatingKey}`,
      ].join('|');
    }

    const showRatingKey = pickString(input, 'showRatingKey');
    const seasonNumber = pickInteger(input, 'seasonNumber');
    const episodeNumber = pickInteger(input, 'episodeNumber');
    if (showRatingKey && seasonNumber !== null && episodeNumber !== null) {
      return [
        'episode',
        `plexUser:${plexUserId}`,
        `library:${librarySectionKey}`,
        `showRatingKey:${showRatingKey}`,
        `season:${seasonNumber}`,
        `episode:${episodeNumber}`,
      ].join('|');
    }

    const showTitle = normalizeFingerprintTitle(
      pickString(input, ['showTitle', 'grandparentTitle', 'seedTitle']),
    );
    if (!showTitle || seasonNumber === null || episodeNumber === null) {
      return null;
    }

    return [
      'episode',
      `plexUser:${plexUserId}`,
      `library:${librarySectionKey}`,
      `showTitle:${showTitle}`,
      `season:${seasonNumber}`,
      `episode:${episodeNumber}`,
    ].join('|');
  }

  return null;
}

export function buildAutoRunMediaHistoryPayload(
  input: AutoRunMediaInput,
): AutoRunMediaHistoryPayload | null {
  const mediaFingerprint = buildAutoRunMediaFingerprint(input);
  if (!mediaFingerprint) return null;

  const plexUserId = pickString(input, 'plexUserId');
  const mediaType = pickString(input, 'mediaType').toLowerCase();
  const librarySectionKey = pickLibrarySectionKey(input);
  if (
    !plexUserId ||
    !librarySectionKey ||
    (mediaType !== 'movie' && mediaType !== 'episode')
  ) {
    return null;
  }

  const seedTitle = normalizeDebugTitle(
    pickString(input, ['seedTitle', 'title', 'showTitle']),
  );

  return {
    mediaFingerprint,
    plexUserId,
    mediaType,
    librarySectionKey,
    seedRatingKey: pickString(input, ['seedRatingKey', 'ratingKey']) || null,
    showRatingKey: pickString(input, 'showRatingKey') || null,
    seedTitle: seedTitle || null,
    seedYear: pickInteger(input, 'seedYear'),
    seasonNumber: pickInteger(input, 'seasonNumber'),
    episodeNumber: pickInteger(input, 'episodeNumber'),
    source: pickString(input, 'source') || 'unknown',
  };
}
