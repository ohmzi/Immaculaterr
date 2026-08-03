import { useEffect, useState } from 'react';

const RELATIVE_UNITS: Array<{ limitMs: number; divisorMs: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limitMs: 60_000, divisorMs: 1_000, unit: 'second' },
  { limitMs: 3_600_000, divisorMs: 60_000, unit: 'minute' },
  { limitMs: 86_400_000, divisorMs: 3_600_000, unit: 'hour' },
  { limitMs: 604_800_000, divisorMs: 86_400_000, unit: 'day' },
  { limitMs: 2_629_800_000, divisorMs: 604_800_000, unit: 'week' },
  { limitMs: 31_557_600_000, divisorMs: 2_629_800_000, unit: 'month' },
  { limitMs: Number.POSITIVE_INFINITY, divisorMs: 31_557_600_000, unit: 'year' },
];

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: 'auto',
});

/**
 * "3 minutes ago" / "in 2 hours". Handles past and future instants; returns
 * null for unparseable input so callers can fall back to raw text.
 */
export function formatRelativeTime(
  value: string | number | Date,
  nowMs: number,
): string | null {
  const ts = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  const deltaMs = ts - nowMs;
  const magnitude = Math.abs(deltaMs);
  if (magnitude < 10_000) return 'just now';
  for (const { limitMs, divisorMs, unit } of RELATIVE_UNITS) {
    if (magnitude < limitMs) {
      return relativeFormatter.format(Math.trunc(deltaMs / divisorMs), unit);
    }
  }
  return null;
}

/** Re-renders on an interval so relative labels stay fresh. */
export function useNowMs(intervalMs = 30_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return nowMs;
}
