import type { JsonObject } from './jobs.types';

export const SWEEP_ORDER = 'non_admin_then_admin_last' as const;

type SweepSortableUser = {
  id: string;
  plexAccountTitle: string;
  isAdmin: boolean;
  lastSeenAt: Date | string | null;
};

function toTimestampOrNull(value: Date | string | null): number | null {
  if (value instanceof Date) {
    const n = value.getTime();
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = new Date(value).getTime();
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function hasMeaningfulScopeValue(value: unknown): boolean {
  if (typeof value === 'string') return Boolean(value.trim());
  if (typeof value === 'number') return Number.isFinite(value);
  return false;
}

export function hasExplicitRefresherScopeInput(
  input: JsonObject | null | undefined,
): boolean {
  if (!input) return false;
  const raw = input as Record<string, unknown>;
  const scopedKeys = [
    'plexUserId',
    'plexUserTitle',
    'plexAccountId',
    'plexAccountTitle',
    'movieSectionKey',
    'tvSectionKey',
    'seedLibrarySectionId',
  ] as const;
  return scopedKeys.some((key) => hasMeaningfulScopeValue(raw[key]));
}

export function sortSweepUsers<T extends SweepSortableUser>(users: readonly T[]): T[] {
  return users.slice().sort((a, b) => {
    if (a.isAdmin !== b.isAdmin) return a.isAdmin ? 1 : -1;

    const aSeen = toTimestampOrNull(a.lastSeenAt);
    const bSeen = toTimestampOrNull(b.lastSeenAt);
    if (aSeen === null && bSeen !== null) return -1;
    if (aSeen !== null && bSeen === null) return 1;
    if (aSeen !== null && bSeen !== null && aSeen !== bSeen) return aSeen - bSeen;

    const byTitle = a.plexAccountTitle.localeCompare(b.plexAccountTitle, undefined, {
      sensitivity: 'base',
    });
    if (byTitle !== 0) return byTitle;

    return a.id.localeCompare(b.id);
  });
}
