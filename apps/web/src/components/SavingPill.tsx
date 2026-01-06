import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

function useMinDurationFlag(active: boolean, minMs: number) {
  const [visible, setVisible] = useState(active);
  const startedAtRef = useRef<number | null>(active ? Date.now() : null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (active) {
      startedAtRef.current = Date.now();
      setVisible(true);
      return;
    }

    if (!visible) {
      startedAtRef.current = null;
      return;
    }

    const startedAt = startedAtRef.current ?? Date.now();
    const elapsed = Date.now() - startedAt;
    const remaining = minMs - elapsed;
    if (remaining <= 0) {
      setVisible(false);
      startedAtRef.current = null;
      return;
    }

    timeoutRef.current = window.setTimeout(() => {
      setVisible(false);
      startedAtRef.current = null;
      timeoutRef.current = null;
    }, remaining);

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [active, minMs, visible]);

  return visible;
}

export function SavingPill(props: {
  active: boolean;
  minMs?: number;
  label?: string;
  className?: string;
}) {
  const visible = useMinDurationFlag(props.active, props.minMs ?? 500);

  if (!visible) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-white/10 text-white/70 border border-white/10',
        props.className,
      )}
    >
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      {props.label ?? 'Saving…'}
    </span>
  );
}


