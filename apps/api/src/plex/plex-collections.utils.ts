const COLLECTION_NAME_SEPARATOR = ' — ';

export function buildUserCollectionName(
  baseName: string,
  plexUserTitle?: string | null,
): string {
  const base = String(baseName ?? '').trim();
  const title = String(plexUserTitle ?? '').trim();
  if (!base) return title;
  if (!title) return base;
  return `${title}${COLLECTION_NAME_SEPARATOR}${base}`;
}

export function stripUserCollectionPrefix(collectionName: string): string {
  const raw = String(collectionName ?? '').trim();
  if (!raw) return raw;
  const idx = raw.indexOf(COLLECTION_NAME_SEPARATOR);
  if (idx === -1) return raw;
  const base = raw.slice(idx + COLLECTION_NAME_SEPARATOR.length).trim();
  return base || raw;
}

export function buildUserCollectionHubOrder(
  baseNames: readonly string[],
  plexUserTitle?: string | null,
): string[] {
  return baseNames.map((name) => buildUserCollectionName(name, plexUserTitle));
}

