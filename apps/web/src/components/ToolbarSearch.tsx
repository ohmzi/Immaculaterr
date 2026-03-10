import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, Search } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { cn } from '@/components/ui/utils';
import { useSafeNavigate } from '@/lib/navigation';
import {
  APP_CARD_ROW_CLASS,
  APP_PRESSABLE_CLASS,
} from '@/lib/ui-classes';
import {
  getToolbarSearchRank,
  normalizeToolbarSearchText,
  type ToolbarSearchArea,
  type ToolbarSearchTarget,
  useToolbarSearchTargets,
} from '@/lib/toolbar-search';

type ToolbarSearchProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  variant: 'desktop' | 'mobile';
};

function resultToneClass(area: ToolbarSearchArea): string {
  switch (area) {
    case 'Command Center':
      return 'border-violet-400/20 bg-violet-400/10 text-violet-100';
    case 'Task Manager':
      return 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100';
    case 'Vault':
      return 'border-amber-400/20 bg-amber-400/10 text-amber-100';
  }

  return 'border-white/10 bg-white/10 text-white';
}

export function ToolbarSearch({ open, onOpenChange, variant }: ToolbarSearchProps) {
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const location = useLocation();
  const locationKeyRef = useRef(`${location.pathname}${location.search}${location.hash}`);
  const navigate = useSafeNavigate();
  const { targets, jobsLoading } = useToolbarSearchTargets();
  const isDesktop = variant === 'desktop';
  const isMobile = variant === 'mobile';

  const normalizedQuery = useMemo(() => normalizeToolbarSearchText(query), [query]);

  const results = useMemo(() => {
    if (!normalizedQuery) return [] as ToolbarSearchTarget[];

    return targets
      .map((target, index) => {
        const rank = getToolbarSearchRank(target.normalizedTitle, normalizedQuery);
        if (rank === null) return null;
        return { target, index, rank };
      })
      .filter((entry): entry is { target: ToolbarSearchTarget; index: number; rank: number } =>
        entry !== null,
      )
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.index - b.index;
      })
      .slice(0, 8)
      .map((entry) => entry.target);
  }, [normalizedQuery, targets]);

  const closeSearch = useCallback(() => {
    setQuery('');
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;

    const rafId = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      if (isDesktop) inputRef.current?.select();
    });
    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, 40);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
  }, [isDesktop, open]);

  useEffect(() => {
    const nextLocationKey = `${location.pathname}${location.search}${location.hash}`;
    if (locationKeyRef.current === nextLocationKey) return;
    locationKeyRef.current = nextLocationKey;
    if (!open) return;
    const timeoutId = window.setTimeout(() => {
      closeSearch();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [closeSearch, location.hash, location.pathname, location.search, open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      closeSearch();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeSearch();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, { passive: false });

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeSearch, open]);

  const handleTriggerClick = useCallback(() => {
    if (open) {
      closeSearch();
      return;
    }
    setQuery('');
    onOpenChange(true);
  }, [closeSearch, onOpenChange, open]);

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (variant !== 'mobile' || event.key !== 'Enter') return;
      event.preventDefault();
      window.requestAnimationFrame(() => {
        event.currentTarget.blur();
      });
    },
    [variant],
  );

  const handleSelectTarget = useCallback(
    (target: ToolbarSearchTarget) => {
      const hash = `#${target.hash}`;
      const href = `${target.route}${hash}`;

      closeSearch();

      window.setTimeout(() => {
        if (location.pathname === target.route && location.hash === hash) {
          navigate(target.route, { replace: true });
          window.setTimeout(() => navigate(href), 16);
          return;
        }
        navigate(href);
      }, 0);
    },
    [closeSearch, location.hash, location.pathname, navigate],
  );

  const panelId = variant === 'desktop' ? 'toolbar-search-desktop' : 'toolbar-search-mobile';
  const showLoadingState = normalizedQuery.length > 0 && results.length === 0 && jobsLoading;
  const showNoResults = normalizedQuery.length > 0 && results.length === 0 && !jobsLoading;
  const showSearchBody = normalizedQuery.length > 0;
  const inputWidth = isDesktop ? 200 : 'calc(100% - 2.75rem)';

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-center overflow-visible',
        isMobile ? 'min-w-0 flex-1 justify-end' : '',
        isDesktop || open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
    >
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: inputWidth }}
            exit={{ width: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="mr-1 overflow-hidden"
          >
            <div className="rounded-full border border-white/20 bg-white/10 backdrop-blur-sm">
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search..."
                autoFocus
                className={cn(
                  'w-full bg-transparent text-white placeholder:text-white/60 focus:outline-none',
                  isDesktop ? 'px-4 py-2 text-sm' : 'px-3 py-2 text-sm',
                )}
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="search"
                enterKeyHint="search"
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={handleTriggerClick}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Close toolbar search' : 'Open toolbar search'}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          APP_PRESSABLE_CLASS,
          'pointer-events-auto relative z-10 inline-flex items-center justify-center rounded-full text-white/80 transition-colors duration-300 hover:bg-white/10 hover:text-white',
          isDesktop ? 'h-10 w-10' : 'h-9 w-9',
        )}
      >
        <Search className="h-5 w-5" />
      </motion.button>

      <AnimatePresence>
        {open && isMobile ? (
          <motion.button
            type="button"
            aria-label="Close toolbar search"
            className="fixed inset-0 z-[1003] lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeSearch}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showSearchBody ? (
          <motion.div
            id={panelId}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              isDesktop
                ? 'absolute right-0 top-full z-[70] mt-2 w-[22rem]'
                : 'fixed left-4 right-4 top-16 z-[1004] lg:hidden',
            )}
          >
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0c0f]/80 p-3 shadow-2xl backdrop-blur-2xl">
              <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                <span>Results</span>
                {jobsLoading ? (
                  <span className="inline-flex items-center gap-1 text-white/50">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Updating
                  </span>
                ) : (
                  <span>{results.length}</span>
                )}
              </div>

              <div className="max-h-[min(60vh,24rem)] space-y-2 overflow-y-auto pr-1">
                {results.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    onClick={() => handleSelectTarget(target)}
                    className={cn(
                      APP_CARD_ROW_CLASS,
                      APP_PRESSABLE_CLASS,
                      'w-full border border-white/10 px-4 py-3 text-left hover:border-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">
                          {target.title}
                        </div>
                        <div className="mt-1 text-xs text-white/55">
                          Jump to highlighted card
                        </div>
                      </div>
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]',
                          resultToneClass(target.area),
                        )}
                      >
                        {target.area}
                      </span>
                    </div>
                  </button>
                ))}

                {showLoadingState ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-5 text-sm text-white/55">
                    Loading task titles…
                  </div>
                ) : null}

                {showNoResults ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-5 text-sm text-white/55">
                    No card titles match "{query.trim()}".
                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
