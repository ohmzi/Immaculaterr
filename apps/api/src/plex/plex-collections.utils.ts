
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

export function stripUserCollectionPrefix(collectionName: string): string {
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

export function buildUserCollectionHubOrder(
  baseNames: readonly string[],
  plexUserTitle?: string | null,
): string[] {
  return baseNames.map((name) => buildUserCollectionName(name, plexUserTitle));
}

