import { useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';

const TRIGGER_PX = 70;
const MAX_PULL_PX = 110;

/**
 * Touch-only pull-to-refresh wrapper. Pull works when the page is scrolled
 * to the very top; releasing past the threshold runs `onRefresh`.
 * Mouse/desktop interaction passes straight through.
 */
export function PullToRefresh(props: {
  onRefresh: () => Promise<unknown>;
  children: ReactNode;
}) {
  const { onRefresh, children } = props;
  const startYRef = useRef<number | null>(null);
  const [pullPx, setPullPx] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const reset = () => {
    startYRef.current = null;
    setPullPx(0);
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (refreshing) return;
    if (window.scrollY > 4) return;
    startYRef.current = event.touches[0]?.clientY ?? null;
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (refreshing || startYRef.current === null) return;
    const deltaY = (event.touches[0]?.clientY ?? 0) - startYRef.current;
    if (deltaY <= 0 || window.scrollY > 4) {
      setPullPx(0);
      return;
    }
    // Rubber-band the pull so it feels physical.
    setPullPx(Math.min(MAX_PULL_PX, deltaY * 0.5));
  };

  const handleTouchEnd = () => {
    if (refreshing) return;
    const shouldRefresh = pullPx >= TRIGGER_PX * 0.5;
    if (!shouldRefresh) {
      reset();
      return;
    }
    setRefreshing(true);
    setPullPx(TRIGGER_PX * 0.5);
    void onRefresh().finally(() => {
      setRefreshing(false);
      reset();
    });
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={reset}
    >
      <div
        className="pointer-events-none flex items-center justify-center overflow-hidden transition-[height] duration-150"
        style={{ height: refreshing || pullPx > 0 ? Math.max(pullPx, refreshing ? 40 : 0) : 0 }}
        aria-hidden={!refreshing && pullPx === 0}
      >
        {refreshing ? (
          <Loader2 className="h-5 w-5 animate-spin text-white/70" />
        ) : (
          <ArrowDown
            className={`h-5 w-5 text-white/50 transition-transform ${
              pullPx >= TRIGGER_PX * 0.5 ? 'rotate-180' : ''
            }`}
          />
        )}
      </div>
      {children}
    </div>
  );
}
