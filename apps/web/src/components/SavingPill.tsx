import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

function useMinDurationFlag(active: boolean, minMs: number) {
  const [visible, setVisible] = useState(active);
  const startedAtRef = useRef<number | null>(null);
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
        // Mobile: float in the top-right corner of the card (doesn't affect layout).
        // Desktop: keep as an inline pill next to the header.
        'pointer-events-none absolute right-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 text-white/70',
        'px-2 py-0.5 text-[10px] font-semibold sm:static sm:px-3 sm:py-1 sm:text-xs',
        props.className,
      )}
    >
      <Loader2 className="hidden h-3.5 w-3.5 animate-spin sm:block" />
      <span className="sm:hidden">Saving</span>
      <span className="hidden sm:inline">{props.label ?? 'Saving…'}</span>
    </span>
  );
}


