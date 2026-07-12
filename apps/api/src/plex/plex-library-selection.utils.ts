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

export type ExcludedLibraryRef = {
  key: string;
  title: string;
  type: 'movie' | 'show';
};

function normalizeTitleForMatch(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * Excluded libraries remembered as {key, title, type} triples. Plex assigns a
 * NEW key when a library is deleted and re-created, which silently orphaned
 * key-only exclusions; the title+type pair lets an exclusion follow the
 * library across re-creation.
 */
export function readConfiguredExcludedLibraries(
  settings: Record<string, unknown>,
): ExcludedLibraryRef[] {
  const raw = pick(settings, 'plex.librarySelection.excludedLibraries');
  if (!Array.isArray(raw)) return [];
  const out: ExcludedLibraryRef[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const key = normalizeSectionKey(entry['key']);
    const title =
      typeof entry['title'] === 'string' ? entry['title'].trim() : '';
    const type = entry['type'] === 'show' ? 'show' : 'movie';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, title, type });
  }
  return out;
}

export function buildExcludedLibrariesFromSelected(params: {
  eligibleLibraries: PlexEligibleLibrary[];
  selectedSectionKeys: unknown;
}): ExcludedLibraryRef[] {
  const selected = new Set(sanitizeSectionKeys(params.selectedSectionKeys));
  return params.eligibleLibraries
    .filter((lib) => !selected.has(lib.key))
    .map((lib) => ({ key: lib.key, title: lib.title, type: lib.type }));
}

export function toEligiblePlexLibraries(
  sections: PlexSectionLike[],
): PlexEligibleLibrary[] {
  const out: PlexEligibleLibrary[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const key = String(section.key ?? '').trim();
    const title = String(section.title ?? '').trim();
    const rawType = String(section.type ?? '')
      .trim()
      .toLowerCase();
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
  const excludedSet = new Set(
    readConfiguredExcludedSectionKeys(params.settings).filter((key) =>
      eligibleSet.has(key),
    ),
  );
  // Follow exclusions across Plex re-keying: an entry whose key vanished
  // still excludes the eligible library with the same title and type.
  for (const ref of readConfiguredExcludedLibraries(params.settings)) {
    if (eligibleSet.has(ref.key)) {
      excludedSet.add(ref.key);
      continue;
    }
    if (!ref.title) continue;
    const match = eligibleLibraries.find(
      (lib) =>
        lib.type === ref.type &&
        normalizeTitleForMatch(lib.title) === normalizeTitleForMatch(ref.title),
    );
    if (match) excludedSet.add(match.key);
  }
  const excludedSectionKeys = eligibleLibraries
    .map((lib) => lib.key)
    .filter((key) => excludedSet.has(key));
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
