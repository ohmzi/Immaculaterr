import { formatRelativeTime, useNowMs } from '@/lib/time';

/**
 * Relative time ("3 minutes ago") with the absolute timestamp on hover.
 * Falls back to the absolute string when the value cannot be parsed.
 */
export function RelativeTime(props: {
  value: string | number | Date;
  className?: string;
}) {
  const nowMs = useNowMs();
  const date = new Date(props.value);
  const absolute = Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : String(props.value);
  const relative = formatRelativeTime(props.value, nowMs);
  return (
    <span title={absolute} className={props.className}>
      {relative ?? absolute}
    </span>
  );
}
