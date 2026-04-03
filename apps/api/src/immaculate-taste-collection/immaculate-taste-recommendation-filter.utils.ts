type RecommendationItem = {
  genreNames: string[];
  originalLanguage: string | null;
  [key: string]: unknown;
};

type ProfileFilterRules = {
  genres: string[];
  excludedGenres: string[];
  audioLanguages: string[];
  excludedAudioLanguages: string[];
  isDefault: boolean;
};

function intersectsCaseInsensitive(left: string[], right: string[]): boolean {
  if (!left.length || !right.length) return false;
  const rightSet = new Set(
    right.map((v) => v.trim().toLowerCase()).filter(Boolean),
  );
  return left.some((v) => rightSet.has(v.trim().toLowerCase()));
}

function containsCaseInsensitive(list: string[], value: string): boolean {
  if (!list.length || !value) return false;
  const lower = value.trim().toLowerCase();
  if (!lower) return false;
  return list.some((v) => v.trim().toLowerCase() === lower);
}

/**
 * Filters a set of recommendations against a single profile's
 * genre/language include and exclude rules.
 *
 * - Genre includes (non-default profiles): keep if ANY genre matches
 * - Genre excludes: drop if ANY genre matches
 * - Language includes (non-default profiles): keep if original_language matches ANY
 * - Language excludes: drop if original_language matches ANY
 * - Default catch-all profile: excludes only (no include filtering)
 * - No includes configured: no include filtering (keep all that pass excludes)
 */
export function filterRecommendationsByProfile<
  T extends RecommendationItem,
>(params: {
  items: T[];
  profile: ProfileFilterRules;
  languageCodeToName: Map<string, string>;
}): { kept: T[]; dropped: number } {
  const { items, profile, languageCodeToName } = params;
  const {
    genres: includeGenres,
    excludedGenres,
    audioLanguages: includeLanguages,
    excludedAudioLanguages: excludeLanguages,
    isDefault,
  } = profile;

  const hasGenreIncludes = !isDefault && includeGenres.length > 0;
  const hasGenreExcludes = excludedGenres.length > 0;
  const hasLangIncludes = !isDefault && includeLanguages.length > 0;
  const hasLangExcludes = excludeLanguages.length > 0;

  if (
    !hasGenreIncludes &&
    !hasGenreExcludes &&
    !hasLangIncludes &&
    !hasLangExcludes
  ) {
    return { kept: items, dropped: 0 };
  }

  const kept: T[] = [];
  let dropped = 0;

  for (const item of items) {
    const genreNames = item.genreNames;
    const langCode = (item.originalLanguage ?? '').trim().toLowerCase();
    const langName = langCode ? (languageCodeToName.get(langCode) ?? '') : '';

    if (hasGenreExcludes && genreNames.length > 0) {
      if (intersectsCaseInsensitive(genreNames, excludedGenres)) {
        dropped += 1;
        continue;
      }
    }

    if (hasLangExcludes && langName) {
      if (containsCaseInsensitive(excludeLanguages, langName)) {
        dropped += 1;
        continue;
      }
    }

    if (hasGenreIncludes && genreNames.length > 0) {
      if (!intersectsCaseInsensitive(genreNames, includeGenres)) {
        dropped += 1;
        continue;
      }
    }

    if (hasLangIncludes && langName) {
      if (!containsCaseInsensitive(includeLanguages, langName)) {
        dropped += 1;
        continue;
      }
    }

    kept.push(item);
  }

  return { kept, dropped };
}

/**
 * Builds a Map<isoCode, englishName> from the TMDB languages list
 * for translating ISO 639-1 codes to the English names stored on profiles.
 */
export function buildLanguageCodeToNameMap(
  languages: Array<{ code: string; englishName: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const lang of languages) {
    const code = (lang.code ?? '').trim().toLowerCase();
    const name = (lang.englishName ?? '').trim();
    if (code && name) map.set(code, name);
  }
  return map;
}
