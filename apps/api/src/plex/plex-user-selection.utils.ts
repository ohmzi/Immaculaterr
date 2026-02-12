type PlexUserLike = {
  id: string;
};

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

function normalizePlexUserId(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return '';
}

export function sanitizePlexUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const id = normalizePlexUserId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function readConfiguredExcludedPlexUserIds(
  settings: Record<string, unknown>,
): string[] {
  return sanitizePlexUserIds(
    pick(settings, 'plex.userMonitoring.excludedPlexUserIds'),
  );
}

export function resolvePlexUserMonitoringSelection(params: {
  settings: Record<string, unknown>;
  users: PlexUserLike[];
}) {
  const knownIds = new Set(
    params.users
      .map((u) => String(u.id ?? '').trim())
      .filter(Boolean),
  );
  const excludedPlexUserIds = readConfiguredExcludedPlexUserIds(
    params.settings,
  ).filter((id) => knownIds.has(id));
  const excludedSet = new Set(excludedPlexUserIds);
  const selectedPlexUserIds = params.users
    .map((u) => String(u.id ?? '').trim())
    .filter((id) => id && !excludedSet.has(id));

  return {
    excludedPlexUserIds,
    selectedPlexUserIds,
  };
}

export function buildExcludedPlexUserIdsFromSelected(params: {
  users: PlexUserLike[];
  selectedPlexUserIds: unknown;
}) {
  const selected = new Set(sanitizePlexUserIds(params.selectedPlexUserIds));
  return params.users
    .map((u) => String(u.id ?? '').trim())
    .filter((id) => id && !selected.has(id));
}

export function isPlexUserExcludedFromMonitoring(params: {
  settings: Record<string, unknown>;
  plexUserId: unknown;
}): boolean {
  const plexUserId = normalizePlexUserId(params.plexUserId);
  if (!plexUserId) return false;
  return readConfiguredExcludedPlexUserIds(params.settings).includes(plexUserId);
}
