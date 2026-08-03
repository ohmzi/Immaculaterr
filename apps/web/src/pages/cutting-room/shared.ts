import type { LargeFileItem } from '@/api/cutting-room';
import { useRef } from 'react';

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 GB';
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : '—';
}

export const CARD_CLASS =
  'relative rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl overflow-hidden';

/**
 * Chip-style multi-tag input: type a tag and press Enter (or comma) to commit
 * it as a pill with a tiny ✕; Backspace on an empty input removes the last
 * pill. Values are trimmed, lowercased, and deduped.
 */
export const TIER_LABELS: Record<number, { label: string; hint: string; chip: string }> = {
  1: {
    label: 'Tier 1',
    hint: 'never watched · long in library · strong signals',
    chip: 'bg-emerald-500/15 text-emerald-100 border-emerald-500/25',
  },
  2: {
    label: 'Tier 2',
    hint: 'never watched · 6+ months',
    chip: 'bg-sky-500/15 text-sky-100 border-sky-500/25',
  },
  3: {
    label: 'Tier 3',
    hint: 'abandoned or recently added',
    chip: 'bg-amber-500/15 text-amber-100 border-amber-500/25',
  },
  4: {
    label: 'Tier 4',
    hint: 'watched long ago (rewatch risk)',
    chip: 'bg-rose-500/15 text-rose-100 border-rose-500/25',
  },
};

export const BAR_LABELS: Record<number, string> = {
  1: 'Strictest — only Tier 1: never watched by anyone, 18+ months in your library, low rated or unmonitored.',
  2: 'Balanced — Tiers 1–2: everything never watched that has been around 6+ months.',
  3: 'Loose — Tiers 1–3: adds abandoned shows/movies and younger never-watched items.',
  4: 'Everything — Tiers 1–4: also items watched once, long ago. Highest regret risk.',
};

export function lfItemKey(item: LargeFileItem): string {
  return `${item.kind}|${item.path ?? item.plexRatingKey ?? `${item.title}:${item.sizeBytes}`}`;
}

/**
 * Shift-click range selection. Remembers the last row clicked (the anchor);
 * a shift-click returns the whole [anchor..index] span — in either direction —
 * so the caller can apply the clicked row's new state to everything between.
 * The anchor resets whenever the backing list changes.
 */
export function useShiftRangeSelect(items: readonly unknown[]) {
  const stateRef = useRef<{
    items: readonly unknown[];
    anchor: number | null;
  }>({ items, anchor: null });
  return (index: number, shiftKey: boolean): [number, number] => {
    if (stateRef.current.items !== items) {
      stateRef.current = { items, anchor: null };
    }
    const anchor = shiftKey ? stateRef.current.anchor : null;
    stateRef.current.anchor = index;
    if (anchor === null) return [index, index];
    return anchor <= index ? [anchor, index] : [index, anchor];
  };
}

export const SHIFT_RANGE_HINT = 'Tip: click one row, then shift-click another to select everything in between.';

