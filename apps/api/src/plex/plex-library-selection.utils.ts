type PlexSectionLike = {
  key: string;
  title: string;
  type?: string;
};

export type PlexEligibleLibrary = {
  key: string;
  title: string;
  type: 'movie' | 'show';
};

export const PLEX_LIBRARY_SELECTION_MIN_SELECTED = 1;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function normalizeSectionKey(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return '';
}

export function sanitizeSectionKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const key = normalizeSectionKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function readConfiguredExcludedSectionKeys(
  settings: Record<string, unknown>,
): string[] {
  return sanitizeSectionKeys(
    pick(settings, 'plex.librarySelection.excludedSectionKeys'),
  );
}

export function toEligiblePlexLibraries(
  sections: PlexSectionLike[],
): PlexEligibleLibrary[] {
  const out: PlexEligibleLibrary[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const key = String(section.key ?? '').trim();
    const title = String(section.title ?? '').trim();
    const rawType = String(section.type ?? '').trim().toLowerCase();
    if (!key || !title) continue;
    if (rawType !== 'movie' && rawType !== 'show') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, title, type: rawType });
  }
  out.sort(
    (a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key),
  );
  return out;
}

export function resolvePlexLibrarySelection(params: {
  settings: Record<string, unknown>;
  sections: PlexSectionLike[];
}) {
  const eligibleLibraries = toEligiblePlexLibraries(params.sections);
  const eligibleSet = new Set(eligibleLibraries.map((s) => s.key));
  const excludedSectionKeys = readConfiguredExcludedSectionKeys(
    params.settings,
  ).filter((key) => eligibleSet.has(key));
  const excludedSet = new Set(excludedSectionKeys);
  const selectedSectionKeys = eligibleLibraries
    .map((lib) => lib.key)
    .filter((key) => !excludedSet.has(key));

  return {
    eligibleLibraries,
    excludedSectionKeys,
    selectedSectionKeys,
  };
}

export function buildExcludedSectionKeysFromSelected(params: {
  eligibleLibraries: Array<{ key: string }>;
  selectedSectionKeys: unknown;
}) {
  const selected = sanitizeSectionKeys(params.selectedSectionKeys);
  const selectedSet = new Set(selected);
  return params.eligibleLibraries
    .map((lib) => String(lib.key ?? '').trim())
    .filter((key) => key && !selectedSet.has(key));
}

export function isPlexLibrarySectionExcluded(params: {
  settings: Record<string, unknown>;
  sectionKey: unknown;
}): boolean {
  const key = normalizeSectionKey(params.sectionKey);
  if (!key) return false;
  return readConfiguredExcludedSectionKeys(params.settings).includes(key);
}

