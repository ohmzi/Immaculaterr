import { useEffect, useMemo, useRef, useState } from 'react';
import {
  motion,
  useAnimation,
  useMotionValue,
  useTransform,
} from 'motion/react';
import { Telescope } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
} from '@/lib/ui-classes';
import { getImmaculateTasteCollections } from '@/api/immaculate';
import {
  applyImmaculateTasteObservatory,
  listImmaculateTasteMovieObservatory,
  listImmaculateTasteTvObservatory,
  recordImmaculateTasteDecisions,
  type ObservatoryItem,
} from '@/api/observatory';
import { cn } from '@/components/ui/utils';

type Tab = 'movie' | 'tv';
type Phase = 'pendingApprovals' | 'sentinel' | 'review';

type CardModel =
  | { kind: 'item'; item: ObservatoryItem }
  | { kind: 'sentinel' };

function buildDeck(items: ObservatoryItem[]): CardModel[] {
  return items.map((item) => ({ kind: 'item', item }));
}

function SwipeCard({
  card,
  disabled,
  onSwipeLeft,
  onSwipeRight,
}: {
  card: CardModel;
  disabled?: boolean;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-10, 0, 10]);
  const opacity = useTransform(x, [-240, -80, 0, 80, 240], [0, 1, 1, 1, 0]);
  const likeOpacity = useTransform(x, [40, 140], [0, 1]);
  const nopeOpacity = useTransform(x, [-140, -40], [1, 0]);
  const greenTintOpacity = useTransform(x, [0, 70, 180], [0, 0.14, 0.28]);
  const redTintOpacity = useTransform(x, [0, -70, -180], [0, 0.14, 0.28]);

  const controls = useAnimation();
  const leavingRef = useRef(false);

  const threshold = 120;
  const throwX = 520;
  const throwRotate = 18;
  const springBack = { type: 'spring' as const, stiffness: 420, damping: 28 };
  const springThrow = { type: 'spring' as const, stiffness: 320, damping: 26 };

  return (
    <motion.div
      animate={controls}
      drag={disabled ? false : 'x'}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.2}
      style={{ x, rotate, opacity, touchAction: 'pan-y' }}
      onDragEnd={(_, info) => {
        if (disabled) return;
        if (leavingRef.current) return;
        if (info.offset.x > threshold) {
          leavingRef.current = true;
          void controls
            .start({
              x: throwX,
              rotate: throwRotate,
              opacity: 0,
              transition: springThrow,
            })
            .then(() => onSwipeRight())
            .finally(() => {
              leavingRef.current = false;
              x.set(0);
              void controls.set({ x: 0, rotate: 0, opacity: 1 });
            });
          return;
        }
        if (info.offset.x < -threshold) {
          leavingRef.current = true;
          void controls
            .start({
              x: -throwX,
              rotate: -throwRotate,
              opacity: 0,
              transition: springThrow,
            })
            .then(() => onSwipeLeft())
            .finally(() => {
              leavingRef.current = false;
              x.set(0);
              void controls.set({ x: 0, rotate: 0, opacity: 1 });
            });
          return;
        }
        void controls.start({ x: 0, rotate: 0, transition: springBack });
      }}
      className="relative w-full"
    >
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/70 shadow-2xl backdrop-blur-2xl">
        {/* Swipe tint feedback */}
        <div className="pointer-events-none absolute inset-0 z-[1]">
          <motion.div
            style={{ opacity: greenTintOpacity }}
            className="absolute inset-0 bg-emerald-400/40"
          />
          <motion.div
            style={{ opacity: redTintOpacity }}
            className="absolute inset-0 bg-rose-400/40"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/15 via-transparent to-black/10" />
        </div>

        <div className="absolute inset-0 pointer-events-none">
          <motion.div
            style={{ opacity: likeOpacity }}
            className="absolute top-6 left-6 rounded-xl border border-emerald-400/40 bg-emerald-400/15 px-3 py-1 text-xs font-black uppercase tracking-wider text-emerald-100"
          >
            Keep
          </motion.div>
          <motion.div
            style={{ opacity: nopeOpacity }}
            className="absolute top-6 right-6 rounded-xl border border-rose-400/40 bg-rose-400/15 px-3 py-1 text-xs font-black uppercase tracking-wider text-rose-100"
          >
            Remove
          </motion.div>
        </div>

        {card.kind === 'sentinel' ? (
          <div className="p-10 md:p-12">
            <div className="text-white text-2xl font-black tracking-tight">
              End of download requests
            </div>
            <div className="mt-3 text-white/70 leading-relaxed">
              Swipe right to review suggestions. Swiping left won’t dismiss this card.
            </div>
            <div className="mt-6 text-sm text-white/60">
              Tip: this page batches changes and applies them after a short cooldown.
            </div>
          </div>
        ) : (
          <>
            {/* Mobile: full-bleed poster + small caption bar (no extra metadata) */}
            <div className="relative md:hidden h-[420px]">
              {card.item.posterUrl ? (
                <img
                  src={card.item.posterUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover object-center"
                  draggable={false}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-white/5 text-white/65 px-6 text-center font-semibold">
                  {card.item.title ||
                    (card.item.mediaType === 'movie'
                      ? `TMDB ${card.item.id}`
                      : `TVDB ${card.item.id}`)}
                </div>
              )}

              {/* Bottom caption (~10% height) */}
              <div className="absolute inset-x-0 bottom-0 h-[10%] min-h-[56px] bg-[#0b0c0f]/80 backdrop-blur-2xl border-t border-white/10 flex items-center px-5">
                <div className="text-white font-semibold text-sm leading-tight line-clamp-2">
                  {card.item.title ||
                    (card.item.mediaType === 'movie'
                      ? `TMDB ${card.item.id}`
                      : `TVDB ${card.item.id}`)}
                </div>
              </div>
            </div>

            {/* Desktop/tablet: poster + details */}
            <div className="hidden md:grid grid-cols-2">
              <div className="relative h-[420px] bg-white/5">
                {card.item.posterUrl ? (
                  <img
                    src={card.item.posterUrl}
                    alt=""
                    className="h-full w-full object-cover object-center"
                    draggable={false}
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-white/35 text-sm">
                    No poster
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/25" />
              </div>
              <div className="p-10">
                <div className="text-white text-2xl font-black tracking-tight">
                  {card.item.title ||
                    (card.item.mediaType === 'movie'
                      ? `TMDB ${card.item.id}`
                      : `TVDB ${card.item.id}`)}
                </div>
                <div className="mt-2 text-sm text-white/70">
                  Status:{' '}
                  <span className="text-white/90 font-semibold">
                    {card.item.status}
                  </span>
                </div>
                <div className="mt-1 text-sm text-white/70">
                  Approval:{' '}
                  <span className="text-white/90 font-semibold">
                    {card.item.downloadApproval}
                  </span>
                </div>
                <div className="mt-6 text-xs text-white/55 leading-relaxed">
                  Swipe right to keep. Swipe left to remove.
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

export function ObservatoryPage() {
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('movie');
  const [movieLibrary, setMovieLibrary] = useState<string>('');
  const [tvLibrary, setTvLibrary] = useState<string>('');

  const [phase, setPhase] = useState<Phase>('pendingApprovals');
  const [deck, setDeck] = useState<CardModel[]>([]);
  const [approvalRequired, setApprovalRequired] = useState(false);

  const pendingApplyRef = useRef(false);
  const applyTimerRef = useRef<number | null>(null);
  const deckKeyRef = useRef<string | null>(null);

  const collectionsQuery = useQuery({
    queryKey: ['immaculateTasteCollections'],
    queryFn: getImmaculateTasteCollections,
    staleTime: 10_000,
  });

  const movieLibraries = useMemo(() => {
    const cols = collectionsQuery.data?.collections ?? [];
    return cols
      .filter((c) => c.mediaType === 'movie')
      .map((c) => ({ key: c.librarySectionKey, title: c.libraryTitle }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [collectionsQuery.data?.collections]);

  const tvLibraries = useMemo(() => {
    const cols = collectionsQuery.data?.collections ?? [];
    return cols
      .filter((c) => c.mediaType === 'tv')
      .map((c) => ({ key: c.librarySectionKey, title: c.libraryTitle }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [collectionsQuery.data?.collections]);

  useEffect(() => {
    if (!movieLibrary && movieLibraries.length) setMovieLibrary(movieLibraries[0]!.key);
  }, [movieLibraries, movieLibrary]);
  useEffect(() => {
    if (!tvLibrary && tvLibraries.length) setTvLibrary(tvLibraries[0]!.key);
  }, [tvLibraries, tvLibrary]);

  const activeLibraryKey = tab === 'movie' ? movieLibrary : tvLibrary;

  const listPendingQuery = useQuery({
    queryKey: ['observatory', 'immaculateTaste', tab, activeLibraryKey, 'pendingApproval'],
    enabled: Boolean(activeLibraryKey),
    queryFn: async () => {
      return tab === 'movie'
        ? await listImmaculateTasteMovieObservatory({
            librarySectionKey: activeLibraryKey,
            mode: 'pendingApproval',
          })
        : await listImmaculateTasteTvObservatory({
            librarySectionKey: activeLibraryKey,
            mode: 'pendingApproval',
          });
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const listReviewQuery = useQuery({
    queryKey: ['observatory', 'immaculateTaste', tab, activeLibraryKey, 'review'],
    enabled: Boolean(activeLibraryKey),
    queryFn: async () => {
      return tab === 'movie'
        ? await listImmaculateTasteMovieObservatory({
            librarySectionKey: activeLibraryKey,
            mode: 'review',
          })
        : await listImmaculateTasteTvObservatory({
            librarySectionKey: activeLibraryKey,
            mode: 'review',
          });
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  // Initialize deck only when tab/library changes (avoid re-mounting the whole deck after each swipe/refetch).
  useEffect(() => {
    const key = `${tab}:${activeLibraryKey || 'none'}`;
    if (!activeLibraryKey) return;
    if (deckKeyRef.current === key) return;
    deckKeyRef.current = key;

    const approval = listPendingQuery.data?.approvalRequiredFromObservatory ?? false;
    setApprovalRequired(approval);

    if (!approval) {
      setPhase('review');
      setDeck(buildDeck(listReviewQuery.data?.items ?? []));
      return;
    }

    const pending = listPendingQuery.data?.items ?? [];
    if (pending.length) {
      setPhase('pendingApprovals');
      setDeck(buildDeck(pending));
      return;
    }

    setPhase('sentinel');
    setDeck([{ kind: 'sentinel' }]);
  }, [tab, activeLibraryKey, listPendingQuery.data, listReviewQuery.data]);

  const recordDecisionMutation = useMutation({
    mutationFn: async (params: {
      mediaType: 'movie' | 'tv';
      librarySectionKey: string;
      id: number;
      action: 'approve' | 'reject' | 'keep' | 'remove';
    }) => {
      return await recordImmaculateTasteDecisions({
        librarySectionKey: params.librarySectionKey,
        mediaType: params.mediaType,
        decisions: [{ id: params.id, action: params.action }],
      });
    },
    onSuccess: async () => {
      pendingApplyRef.current = true;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['observatory', 'immaculateTaste', tab, activeLibraryKey, 'pendingApproval'] }),
        queryClient.invalidateQueries({ queryKey: ['observatory', 'immaculateTaste', tab, activeLibraryKey, 'review'] }),
      ]);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save swipe decision',
      );
      // Best-effort: reload server truth.
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['observatory', 'immaculateTaste', tab, activeLibraryKey, 'pendingApproval'] }),
        queryClient.invalidateQueries({ queryKey: ['observatory', 'immaculateTaste', tab, activeLibraryKey, 'review'] }),
      ]);
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (params: { mediaType: 'movie' | 'tv'; librarySectionKey: string }) => {
      return await applyImmaculateTasteObservatory({
        librarySectionKey: params.librarySectionKey,
        mediaType: params.mediaType,
      });
    },
    onSuccess: async () => {
      pendingApplyRef.current = false;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['observatory', 'immaculateTaste'] }),
        queryClient.invalidateQueries({ queryKey: ['immaculateTasteCollections'] }),
      ]);
    },
  });

  const scheduleApply = () => {
    if (applyTimerRef.current) window.clearTimeout(applyTimerRef.current);
    applyTimerRef.current = window.setTimeout(() => {
      if (!pendingApplyRef.current) return;
      applyMutation.mutate({ mediaType: tab, librarySectionKey: activeLibraryKey });
    }, 120_000);
  };

  // Apply on page leave/unmount (best-effort).
  useEffect(() => {
    return () => {
      if (applyTimerRef.current) window.clearTimeout(applyTimerRef.current);
      if (!pendingApplyRef.current) return;
      // fire-and-forget apply
      applyMutation.mutate({ mediaType: tab, librarySectionKey: activeLibraryKey });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeLibraryKey]);

  const popTop = () => setDeck((prev) => prev.slice(1));

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
      {/* Background (landing-page style, teal-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src={APP_BG_IMAGE_URL}
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-teal-300/20 via-cyan-800/35 to-slate-950/75" />
        <div className={`absolute inset-0 ${APP_BG_HIGHLIGHT_CLASS}`} />
        <div className={`absolute inset-0 ${APP_BG_DARK_WASH_CLASS}`} />
      </div>

      <section className="relative z-10 min-h-screen overflow-hidden pt-10 lg:pt-16">
        <div className="container mx-auto px-4 pb-20 max-w-5xl">
          <div className="mb-12">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-5">
                <motion.button
                  type="button"
                  onClick={() => {
                    titleIconControls.stop();
                    titleIconGlowControls.stop();
                    void titleIconControls.start({
                      scale: [1, 1.06, 1],
                      transition: { duration: 0.55, ease: 'easeOut' },
                    });
                    void titleIconGlowControls.start({
                      opacity: [0, 0.7, 0, 0.55, 0, 0.4, 0],
                      transition: { duration: 1.4, ease: 'easeInOut' },
                    });
                  }}
                  animate={titleIconControls}
                  className="relative group focus:outline-none touch-manipulation"
                  aria-label="Animate Observatory icon"
                  title="Animate"
                >
                  <motion.div
                    aria-hidden="true"
                    animate={titleIconGlowControls}
                    className="pointer-events-none absolute inset-0 bg-[#2dd4bf] blur-xl opacity-0"
                  />
                  <div className="absolute inset-0 bg-[#2dd4bf] blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
                  <motion.div
                    initial={{ rotate: -10, scale: 0.94, y: 2 }}
                    animate={{ rotate: -6, scale: 1, y: 0 }}
                    whileHover={{ rotate: 0, scale: 1.04 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                    style={{ backfaceVisibility: 'hidden' }}
                    className="relative will-change-transform transform-gpu p-3 md:p-4 bg-[#2dd4bf] rounded-2xl shadow-[0_0_30px_rgba(45,212,191,0.25)] border border-white/20"
                  >
                    <Telescope
                      className="w-8 h-8 md:w-10 md:h-10 text-black"
                      strokeWidth={2.5}
                    />
                  </motion.div>
                </motion.button>

                <h1 className="text-5xl md:text-6xl font-black text-white tracking-tighter drop-shadow-2xl">
                  Observatory
                </h1>
              </div>

              <p className="text-teal-100/70 text-lg font-medium max-w-lg leading-relaxed ml-1">
                A place for visibility and diagnostics. We’ll build this out next.
              </p>
            </motion.div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-5 md:p-6 shadow-2xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTab('movie')}
                  className={cn(
                    'px-4 py-2 rounded-2xl border text-sm font-semibold transition-colors',
                    tab === 'movie'
                      ? 'bg-white/10 border-white/20 text-white'
                      : 'bg-white/5 border-white/10 text-white/70 hover:text-white/90 hover:bg-white/8',
                  )}
                >
                  Movies
                </button>
                <button
                  type="button"
                  onClick={() => setTab('tv')}
                  className={cn(
                    'px-4 py-2 rounded-2xl border text-sm font-semibold transition-colors',
                    tab === 'tv'
                      ? 'bg-white/10 border-white/20 text-white'
                      : 'bg-white/5 border-white/10 text-white/70 hover:text-white/90 hover:bg-white/8',
                  )}
                >
                  TV
                </button>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-xs text-white/60 font-semibold">
                  Library
                </div>
                <select
                  value={activeLibraryKey}
                  onChange={(e) => {
                    if (tab === 'movie') setMovieLibrary(e.target.value);
                    else setTvLibrary(e.target.value);
                  }}
                  className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 outline-none focus:ring-2 focus:ring-white/20"
                >
                  {(tab === 'movie' ? movieLibraries : tvLibraries).map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 text-xs text-white/55">
              {approvalRequired
                ? 'Approval is ON. Pending download requests show first.'
                : 'Approval is OFF. You’re reviewing suggestions (cleanup mode).'}
            </div>
          </div>

          <div className="mt-6">
            {/* Fixed frame prevents layout jitter while cards animate/throw off-screen */}
            <div className="relative mx-auto max-w-3xl h-[520px] md:h-[460px] overflow-hidden">
              {deck.length ? (
                <div className="relative h-full">
                  {/* Render a small stack: top 3 */}
                  {deck
                    .slice(0, 3)
                    .reverse()
                    .map((card, idx, arr) => {
                      const isTop = idx === arr.length - 1;
                      const depth = arr.length - 1 - idx;
                      // Make the waiting-deck feel obvious (without being distracting).
                      const scale = 1 - depth * 0.045;
                      const y = depth * 18;
                      const opacity = 1 - depth * 0.14;
                      const rotate =
                        depth === 0 ? 0 : depth % 2 === 0 ? 0.35 : -0.35;
                      return (
                        <motion.div
                          key={
                            card.kind === 'sentinel'
                              ? 'sentinel'
                              : `${card.item.mediaType}:${card.item.id}`
                          }
                          style={{
                            scale,
                            y,
                            opacity,
                            rotate,
                            zIndex: 50 - depth,
                          }}
                          className={cn(
                            'absolute inset-0',
                            !isTop && 'pointer-events-none',
                          )}
                        >
                          <SwipeCard
                            card={card}
                            disabled={
                              !isTop ||
                              recordDecisionMutation.isPending ||
                              applyMutation.isPending
                            }
                            onSwipeLeft={() => {
                              if (card.kind === 'sentinel') return;
                              const action =
                                phase === 'pendingApprovals' ? 'reject' : 'remove';
                              recordDecisionMutation.mutate({
                                mediaType: tab,
                                librarySectionKey: activeLibraryKey,
                                id: card.item.id,
                                action,
                              });
                              popTop();
                              scheduleApply();
                              if (
                                !deck.slice(1).length &&
                                approvalRequired &&
                                phase === 'pendingApprovals'
                              ) {
                                setPhase('sentinel');
                                setDeck([{ kind: 'sentinel' }]);
                              }
                            }}
                            onSwipeRight={() => {
                              if (card.kind === 'sentinel') {
                                setPhase('review');
                                setDeck(buildDeck(listReviewQuery.data?.items ?? []));
                                return;
                              }
                              const action =
                                phase === 'pendingApprovals' ? 'approve' : 'keep';
                              recordDecisionMutation.mutate({
                                mediaType: tab,
                                librarySectionKey: activeLibraryKey,
                                id: card.item.id,
                                action,
                              });
                              popTop();
                              scheduleApply();
                            }}
                          />
                        </motion.div>
                      );
                    })}
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-full rounded-3xl border border-white/10 bg-[#0b0c0f]/60 p-10 text-center text-white/70 backdrop-blur-2xl">
                    <div className="text-white font-semibold text-lg">
                      All suggestions have been reviewed
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

