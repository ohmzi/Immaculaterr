import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useAnimation,
  useMotionValue,
  useTransform,
} from 'motion/react';
import { Telescope, Undo2 } from 'lucide-react';
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
  applyWatchedObservatory,
  listImmaculateTasteMovieObservatory,
  listImmaculateTasteTvObservatory,
  listWatchedMovieObservatory,
  listWatchedTvObservatory,
  recordImmaculateTasteDecisions,
  recordWatchedDecisions,
  type ObservatoryItem,
  type WatchedCollectionKind,
} from '@/api/observatory';
import { cn } from '@/components/ui/utils';

type Tab = 'movie' | 'tv';
type Phase = 'pendingApprovals' | 'review';
type CollectionTab = 'immaculate' | 'latestWatched';

type CardModel =
  | { kind: 'item'; item: ObservatoryItem }
  | {
      kind: 'sentinel';
      sentinel: 'approvalsDone' | 'reviewDone' | 'noData';
      title?: string;
      subtitle?: string;
      ctaBar?: string;
      message?: string;
    };

type UndoState = {
  tab: Tab;
  librarySectionKey: string;
  phase: Phase;
  card: { kind: 'item'; item: ObservatoryItem };
  action: 'approve' | 'reject' | 'keep' | 'remove';
} | null;

type WatchedUndoState = {
  tab: Tab;
  librarySectionKey: string;
  collectionKind: WatchedCollectionKind;
  phase: Phase;
  card: { kind: 'item'; item: ObservatoryItem };
  action: 'approve' | 'reject' | 'keep' | 'remove';
} | null;

function buildDeck(items: ObservatoryItem[]): CardModel[] {
  return items.map((item) => ({ kind: 'item', item }));
}

function formatRating(v: unknown): string | null {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
  if (n === null) return null;
  // TMDB vote_average is /10; show 1 decimal.
  const rounded = Math.round(n * 10) / 10;
  if (!Number.isFinite(rounded) || rounded <= 0) return null;
  return `${rounded.toFixed(1)}/10`;
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
      dragElastic={0.2}
      dragMomentum={false}
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
      className="relative w-full h-full"
    >
      <div className="relative h-full overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/70 shadow-2xl backdrop-blur-2xl">
        {/* Swipe tint feedback */}
        <div className="pointer-events-none absolute inset-0 z-20">
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

        <div className="absolute inset-0 pointer-events-none z-30">
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
          // Sentinel cards are styled like movie cards so the deck never "ends".
          <div className="relative h-full">
            <img
              src={APP_BG_IMAGE_URL}
              alt=""
              className="absolute inset-0 h-full w-full object-cover object-center opacity-90"
              draggable={false}
            />
            <div className="absolute inset-0 bg-gradient-to-br from-black/35 via-black/40 to-black/65" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-black/25" />

            <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
              <div className="max-w-md">
                <div className="text-white text-2xl md:text-3xl font-black tracking-tight drop-shadow-2xl">
                  {card.title ??
                    (card.sentinel === 'approvalsDone'
                      ? 'All download approvals have been reviewed'
                      : card.sentinel === 'noData'
                        ? 'No suggestions yet for this library'
                        : 'All suggestions have been reviewed')}
                </div>
                {card.sentinel === 'noData' ? (
                  <div className="mt-3 text-white/75 leading-relaxed">
                    {card.message ??
                      'Please continue using Plex for this media type and let the suggestion list build up, or run Immaculate Taste Collection manually to generate suggestions.'}
                  </div>
                ) : (
                  <div className="mt-3 text-white/75 leading-relaxed">
                    {card.subtitle ??
                      `Swipe right to ${
                        card.sentinel === 'approvalsDone'
                          ? 'review suggestions'
                          : 'restart reviewing'
                      }.`}
                  </div>
                )}
              </div>
            </div>

            {(card.ctaBar ||
              (card.sentinel === 'approvalsDone'
                ? 'Swipe right to review suggestions'
                : null)) && (
              <div className="absolute inset-x-0 bottom-0 h-[10%] min-h-[56px] bg-[#0b0c0f]/80 backdrop-blur-2xl border-t border-white/10 flex items-center px-5">
                <div className="text-white font-semibold text-sm leading-tight">
                  {card.ctaBar ??
                    (card.sentinel === 'approvalsDone'
                      ? 'Swipe right to review suggestions'
                      : '')}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Mobile: full-bleed poster + small caption bar (no extra metadata) */}
            <div className="relative md:hidden h-full">
              {card.item.posterUrl ? (
                <img
                  src={card.item.posterUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-contain object-center bg-black/30"
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
                <div className="w-full flex items-center justify-between gap-3">
                  <div className="text-white font-semibold text-sm leading-tight line-clamp-1">
                    {card.item.title ||
                      (card.item.mediaType === 'movie'
                        ? `TMDB ${card.item.id}`
                        : `TVDB ${card.item.id}`)}
                  </div>
                  {formatRating(card.item.tmdbVoteAvg ?? null) && (
                    <div className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold text-white/90">
                      {formatRating(card.item.tmdbVoteAvg ?? null)}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Desktop/tablet: poster + details */}
            <div className="hidden md:grid grid-cols-2 h-full">
              <div className="relative h-full bg-black/20">
                {card.item.posterUrl ? (
                  <img
                    src={card.item.posterUrl}
                    alt=""
                    className="h-full w-full object-contain object-center"
                    draggable={false}
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-white/35 text-sm">
                    No poster
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/25" />
              </div>
              <div className="p-10 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div className="text-white text-3xl font-black tracking-tight leading-tight">
                      {card.item.title ||
                        (card.item.mediaType === 'movie'
                          ? `TMDB ${card.item.id}`
                          : `TVDB ${card.item.id}`)}
                    </div>
                    {formatRating(card.item.tmdbVoteAvg ?? null) && (
                      <div className="shrink-0 rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-black text-white/90">
                        {formatRating(card.item.tmdbVoteAvg ?? null)}
                      </div>
                    )}
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

  const [activeCollectionTab, setActiveCollectionTab] =
    useState<CollectionTab>('immaculate');
  const [mediaTab, setMediaTab] = useState<Tab>('movie');
  const [movieLibrary, setMovieLibrary] = useState<string>('');
  const [tvLibrary, setTvLibrary] = useState<string>('');

  const [phase, setPhase] = useState<Phase>('pendingApprovals');
  const [deck, setDeck] = useState<CardModel[]>([]);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [undoState, setUndoState] = useState<UndoState>(null);

  const [watchedCollectionKind, setWatchedCollectionKind] =
    useState<WatchedCollectionKind>('recentlyWatched');
  const [watchedPhase, setWatchedPhase] = useState<Phase>('pendingApprovals');
  const [watchedDeck, setWatchedDeck] = useState<CardModel[]>([]);
  const [watchedApprovalRequired, setWatchedApprovalRequired] = useState(false);
  const [watchedUndoState, setWatchedUndoState] = useState<WatchedUndoState>(null);

  const pendingApplyRef = useRef(false);
  const applyTimerRef = useRef<number | null>(null);
  const deckKeyRef = useRef<string | null>(null);
  const swipeTopCardRef = useRef<((dir: 'left' | 'right') => void) | null>(null);

  const watchedPendingApplyRef = useRef(false);
  const watchedApplyTimerRef = useRef<number | null>(null);
  const watchedDeckKeyRef = useRef<string | null>(null);

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

  const activeLibraryKey = mediaTab === 'movie' ? movieLibrary : tvLibrary;
  const activeLibraryTitle = useMemo(() => {
    const libs = mediaTab === 'movie' ? movieLibraries : tvLibraries;
    return libs.find((l) => l.key === activeLibraryKey)?.title ?? null;
  }, [activeLibraryKey, mediaTab, movieLibraries, tvLibraries]);

  const listPendingQuery = useQuery({
    queryKey: [
      'observatory',
      'immaculateTaste',
      mediaTab,
      activeLibraryKey,
      'pendingApproval',
    ],
    enabled: activeCollectionTab === 'immaculate' && Boolean(activeLibraryKey),
    queryFn: async () => {
      return mediaTab === 'movie'
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
    queryKey: ['observatory', 'immaculateTaste', mediaTab, activeLibraryKey, 'review'],
    enabled: activeCollectionTab === 'immaculate' && Boolean(activeLibraryKey),
    queryFn: async () => {
      return mediaTab === 'movie'
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

  const listWatchedPendingQuery = useQuery({
    queryKey: [
      'observatory',
      'watched',
      mediaTab,
      activeLibraryKey,
      watchedCollectionKind,
      'pendingApproval',
    ],
    enabled: activeCollectionTab === 'latestWatched' && Boolean(activeLibraryKey),
    queryFn: async () => {
      return mediaTab === 'movie'
        ? await listWatchedMovieObservatory({
            librarySectionKey: activeLibraryKey,
            mode: 'pendingApproval',
            collectionKind: watchedCollectionKind,
          })
        : await listWatchedTvObservatory({
            librarySectionKey: activeLibraryKey,
            mode: 'pendingApproval',
            collectionKind: watchedCollectionKind,
          });
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const listWatchedReviewQuery = useQuery({
    queryKey: [
      'observatory',
      'watched',
      mediaTab,
      activeLibraryKey,
      watchedCollectionKind,
      'review',
    ],
    enabled: activeCollectionTab === 'latestWatched' && Boolean(activeLibraryKey),
    queryFn: async () => {
      return mediaTab === 'movie'
        ? await listWatchedMovieObservatory({
            librarySectionKey: activeLibraryKey,
            mode: 'review',
            collectionKind: watchedCollectionKind,
          })
        : await listWatchedTvObservatory({
            librarySectionKey: activeLibraryKey,
            mode: 'review',
            collectionKind: watchedCollectionKind,
          });
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const approvalsDoneCard = useMemo<CardModel>(
    () => ({ kind: 'sentinel', sentinel: 'approvalsDone' }),
    [],
  );
  const reviewDoneCard = useMemo<CardModel>(
    () => ({ kind: 'sentinel', sentinel: 'reviewDone' }),
    [],
  );

  const makeNoDataCard = (): CardModel => {
    const mediaTypeLabel = mediaTab === 'movie' ? 'movie' : 'tv';
    const libraryKindLabel =
      mediaTab === 'movie' ? 'Movie Library' : 'TV Show Library';
    const libraryLabel = activeLibraryTitle ? ` in ${libraryKindLabel}: ${activeLibraryTitle}` : '';
    return {
      kind: 'sentinel',
      sentinel: 'noData',
      message: `Please continue using Plex for ${mediaTypeLabel}${libraryLabel} and let the suggestion list build up, or run Immaculate Taste Collection manually for ${mediaTypeLabel} to generate suggestions.`,
    };
  };

  const watchedApprovalsDoneCard = useMemo<CardModel>(
    () => ({
      kind: 'sentinel',
      sentinel: 'approvalsDone',
      ctaBar: 'Swipe right to review suggestions',
    }),
    [],
  );
  const watchedNextDeckCard = useMemo<CardModel>(
    () => ({
      kind: 'sentinel',
      sentinel: 'reviewDone',
      title: 'Recently watched suggestions have been reviewed',
      subtitle: 'Swipe right to review Change of Taste.',
    }),
    [],
  );
  const watchedRestartCard = useMemo<CardModel>(
    () => ({
      kind: 'sentinel',
      sentinel: 'reviewDone',
      title: 'All suggestions have been reviewed',
      subtitle: 'Swipe right to restart reviewing.',
    }),
    [],
  );

  const makeWatchedNoDataCard = (): CardModel => {
    const mediaTypeLabel = mediaTab === 'movie' ? 'movie' : 'tv';
    const libraryKindLabel =
      mediaTab === 'movie' ? 'Movie Library' : 'TV Show Library';
    const libraryLabel = activeLibraryTitle
      ? ` in ${libraryKindLabel}: ${activeLibraryTitle}`
      : '';
    const deckLabel =
      watchedCollectionKind === 'changeOfTaste'
        ? 'Change of Taste'
        : 'Based on your recently watched';
    return {
      kind: 'sentinel',
      sentinel: 'noData',
      title: `${deckLabel}: No suggestions yet`,
      message: `Please continue using Plex for ${mediaTypeLabel}${libraryLabel} and let the suggestion list build up, or run Based on Latest Watched Collection manually for ${mediaTypeLabel} to generate suggestions.`,
    };
  };

  const setWatchedDeckForApprovals = () => {
    const pending = listWatchedPendingQuery.data?.items ?? [];
    const review = listWatchedReviewQuery.data?.items ?? [];
    setWatchedPhase('pendingApprovals');
    setWatchedDeck(
      pending.length
        ? buildDeck(pending)
        : review.length
          ? [watchedApprovalsDoneCard]
          : [makeWatchedNoDataCard()],
    );
  };

  const setWatchedDeckForReview = () => {
    const items = listWatchedReviewQuery.data?.items ?? [];
    const pending = listWatchedPendingQuery.data?.items ?? [];
    setWatchedPhase('review');
    setWatchedDeck(
      items.length
        ? buildDeck(items)
        : pending.length
          ? [
              watchedCollectionKind === 'recentlyWatched'
                ? watchedNextDeckCard
                : watchedRestartCard,
            ]
          : [makeWatchedNoDataCard()],
    );
  };

  const advanceWatchedOneOrSentinel = (sentinel: CardModel) => {
    setWatchedDeck((prev) => {
      const next = prev.slice(1);
      return next.length ? next : [sentinel];
    });
  };

  const restartWatchedCycle = () => {
    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['observatory', 'watched', mediaTab, activeLibraryKey, 'recentlyWatched'],
      }),
      queryClient.invalidateQueries({
        queryKey: ['observatory', 'watched', mediaTab, activeLibraryKey, 'changeOfTaste'],
      }),
    ]).finally(() => {
      setWatchedCollectionKind('recentlyWatched');
      watchedDeckKeyRef.current = null;
    });
  };

  const setDeckForApprovals = () => {
    const pending = listPendingQuery.data?.items ?? [];
    const review = listReviewQuery.data?.items ?? [];
    setPhase('pendingApprovals');
    setDeck(
      pending.length
        ? buildDeck(pending)
        : review.length
          ? [approvalsDoneCard]
          : [makeNoDataCard()],
    );
  };

  const setDeckForReview = () => {
    const items = listReviewQuery.data?.items ?? [];
    const pending = listPendingQuery.data?.items ?? [];
    setPhase('review');
    setDeck(
      items.length ? buildDeck(items) : pending.length ? [reviewDoneCard] : [makeNoDataCard()],
    );
  };

  const advanceOneOrSentinel = (sentinel: CardModel) => {
    setDeck((prev) => {
      const next = prev.slice(1);
      return next.length ? next : [sentinel];
    });
  };

  const restartCycle = () => {
    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: [
          'observatory',
          'immaculateTaste',
          mediaTab,
          activeLibraryKey,
          'pendingApproval',
        ],
      }),
      queryClient.invalidateQueries({
        queryKey: [
          'observatory',
          'immaculateTaste',
          mediaTab,
          activeLibraryKey,
          'review',
        ],
      }),
    ]).finally(() => {
      if (approvalRequired) setDeckForApprovals();
      else setDeckForReview();
    });
  };

  // Initialize deck only when tab/library changes (avoid re-mounting the whole deck after each swipe/refetch).
  useEffect(() => {
    const key = `${activeCollectionTab}:${mediaTab}:${activeLibraryKey || 'none'}`;
    if (!activeLibraryKey) return;

    if (activeCollectionTab !== 'immaculate') {
      setApprovalRequired(false);
      setDeck([]);
      setUndoState(null);
      deckKeyRef.current = null;
      return;
    }

    // Wait until at least one query has data so we don't lock-in an empty deck.
    const hasData = Boolean(listPendingQuery.data) || Boolean(listReviewQuery.data);
    if (!hasData) return;

    const approval =
      listPendingQuery.data?.approvalRequiredFromObservatory ??
      listReviewQuery.data?.approvalRequiredFromObservatory ??
      false;

    const pendingLen = listPendingQuery.data?.items?.length ?? 0;
    const reviewLen = listReviewQuery.data?.items?.length ?? 0;
    const isNoDataDeck =
      deck.length === 1 &&
      deck[0]?.kind === 'sentinel' &&
      deck[0]?.sentinel === 'noData';

    // If we previously locked into the "no suggestions" sentinel due to cached/empty data,
    // allow the deck to self-heal once the queries fetch real items (without forcing a swipe).
    if (deckKeyRef.current === key) {
      if (isNoDataDeck && (pendingLen > 0 || reviewLen > 0)) {
        setApprovalRequired(approval);
        if (approval) setDeckForApprovals();
        else setDeckForReview();
      }
      return;
    }

    deckKeyRef.current = key;
    setUndoState(null);
    setApprovalRequired(approval);

    if (!approval) {
      setDeckForReview();
      return;
    }

    setDeckForApprovals();
  }, [
    activeCollectionTab,
    mediaTab,
    activeLibraryKey,
    deck,
    listPendingQuery.data,
    listReviewQuery.data,
  ]);

  // Watched: whenever library/media changes, start from the "recently watched" deck.
  useEffect(() => {
    if (activeCollectionTab !== 'latestWatched') return;
    setWatchedCollectionKind('recentlyWatched');
    watchedDeckKeyRef.current = null;
  }, [activeCollectionTab, mediaTab, activeLibraryKey]);

  // Watched: initialize deck when tab/library/kind changes (avoid re-mounting after each swipe/refetch).
  useEffect(() => {
    const key = `${activeCollectionTab}:${mediaTab}:${activeLibraryKey || 'none'}:${watchedCollectionKind}`;
    if (!activeLibraryKey) return;

    if (activeCollectionTab !== 'latestWatched') {
      setWatchedApprovalRequired(false);
      setWatchedDeck([]);
      setWatchedUndoState(null);
      watchedDeckKeyRef.current = null;
      return;
    }

    // Wait until at least one query has data so we don't lock-in an empty deck.
    const hasData =
      Boolean(listWatchedPendingQuery.data) || Boolean(listWatchedReviewQuery.data);
    if (!hasData) return;

    const approval =
      listWatchedPendingQuery.data?.approvalRequiredFromObservatory ??
      listWatchedReviewQuery.data?.approvalRequiredFromObservatory ??
      false;

    const pendingLen = listWatchedPendingQuery.data?.items?.length ?? 0;
    const reviewLen = listWatchedReviewQuery.data?.items?.length ?? 0;
    const isNoDataDeck =
      watchedDeck.length === 1 &&
      watchedDeck[0]?.kind === 'sentinel' &&
      watchedDeck[0]?.sentinel === 'noData';

    if (watchedDeckKeyRef.current === key) {
      if (isNoDataDeck && (pendingLen > 0 || reviewLen > 0)) {
        setWatchedApprovalRequired(approval);
        if (approval) setWatchedDeckForApprovals();
        else setWatchedDeckForReview();
      }
      return;
    }

    watchedDeckKeyRef.current = key;
    setWatchedUndoState(null);
    setWatchedApprovalRequired(approval);

    if (!approval) {
      setWatchedDeckForReview();
      return;
    }

    setWatchedDeckForApprovals();
  }, [
    activeCollectionTab,
    mediaTab,
    activeLibraryKey,
    watchedCollectionKind,
    watchedDeck,
    listWatchedPendingQuery.data,
    listWatchedReviewQuery.data,
  ]);

  const recordDecisionMutation = useMutation({
    mutationFn: async (params: {
      mediaType: 'movie' | 'tv';
      librarySectionKey: string;
      id: number;
      action: 'approve' | 'reject' | 'keep' | 'remove' | 'undo';
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
        queryClient.invalidateQueries({
          queryKey: [
            'observatory',
            'immaculateTaste',
            mediaTab,
            activeLibraryKey,
            'pendingApproval',
          ],
        }),
        queryClient.invalidateQueries({
          queryKey: [
            'observatory',
            'immaculateTaste',
            mediaTab,
            activeLibraryKey,
            'review',
          ],
        }),
      ]);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save swipe decision',
      );
      // Best-effort: reload server truth.
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: [
            'observatory',
            'immaculateTaste',
            mediaTab,
            activeLibraryKey,
            'pendingApproval',
          ],
        }),
        queryClient.invalidateQueries({
          queryKey: [
            'observatory',
            'immaculateTaste',
            mediaTab,
            activeLibraryKey,
            'review',
          ],
        }),
      ]);
    },
  });

  const recordWatchedDecisionMutation = useMutation({
    mutationFn: async (params: {
      mediaType: 'movie' | 'tv';
      librarySectionKey: string;
      collectionKind: WatchedCollectionKind;
      id: number;
      action: 'approve' | 'reject' | 'keep' | 'remove' | 'undo';
    }) => {
      return await recordWatchedDecisions({
        librarySectionKey: params.librarySectionKey,
        mediaType: params.mediaType,
        collectionKind: params.collectionKind,
        decisions: [{ id: params.id, action: params.action }],
      });
    },
    onSuccess: async () => {
      watchedPendingApplyRef.current = true;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [
            'observatory',
            'watched',
            mediaTab,
            activeLibraryKey,
            watchedCollectionKind,
            'pendingApproval',
          ],
        }),
        queryClient.invalidateQueries({
          queryKey: [
            'observatory',
            'watched',
            mediaTab,
            activeLibraryKey,
            watchedCollectionKind,
            'review',
          ],
        }),
      ]);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save swipe decision',
      );
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: [
            'observatory',
            'watched',
            mediaTab,
            activeLibraryKey,
            watchedCollectionKind,
            'pendingApproval',
          ],
        }),
        queryClient.invalidateQueries({
          queryKey: [
            'observatory',
            'watched',
            mediaTab,
            activeLibraryKey,
            watchedCollectionKind,
            'review',
          ],
        }),
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
      setUndoState(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['observatory', 'immaculateTaste'] }),
        queryClient.invalidateQueries({ queryKey: ['immaculateTasteCollections'] }),
      ]);
    },
  });

  const applyWatchedMutation = useMutation({
    mutationFn: async (params: { mediaType: 'movie' | 'tv'; librarySectionKey: string }) => {
      return await applyWatchedObservatory({
        librarySectionKey: params.librarySectionKey,
        mediaType: params.mediaType,
      });
    },
    onSuccess: async () => {
      watchedPendingApplyRef.current = false;
      setWatchedUndoState(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['observatory', 'watched', mediaTab, activeLibraryKey],
        }),
      ]);
    },
  });

  const scheduleApply = () => {
    if (applyTimerRef.current) window.clearTimeout(applyTimerRef.current);
    applyTimerRef.current = window.setTimeout(() => {
      if (!pendingApplyRef.current) return;
      if (activeCollectionTab !== 'immaculate') return;
      applyMutation.mutate({ mediaType: mediaTab, librarySectionKey: activeLibraryKey });
    }, 120_000);
  };

  const scheduleWatchedApply = () => {
    if (watchedApplyTimerRef.current)
      window.clearTimeout(watchedApplyTimerRef.current);
    watchedApplyTimerRef.current = window.setTimeout(() => {
      if (!watchedPendingApplyRef.current) return;
      if (activeCollectionTab !== 'latestWatched') return;
      applyWatchedMutation.mutate({
        mediaType: mediaTab,
        librarySectionKey: activeLibraryKey,
      });
    }, 120_000);
  };

  const canUndo =
    Boolean(undoState) &&
    undoState?.tab === mediaTab &&
    undoState?.librarySectionKey === activeLibraryKey &&
    !recordDecisionMutation.isPending &&
    !applyMutation.isPending;

  const canWatchedUndo =
    Boolean(watchedUndoState) &&
    watchedUndoState?.tab === mediaTab &&
    watchedUndoState?.librarySectionKey === activeLibraryKey &&
    watchedUndoState?.collectionKind === watchedCollectionKind &&
    !recordWatchedDecisionMutation.isPending &&
    !applyWatchedMutation.isPending;

  const undoLast = () => {
    if (!undoState) return;
    if (undoState.tab !== mediaTab) return;
    if (undoState.librarySectionKey !== activeLibraryKey) return;

    const { card, phase: prevPhase } = undoState;
    setUndoState(null);
    setPhase(prevPhase);
    setDeck((prev) => {
      // If we currently show a sentinel because the deck ran out, replace it with the restored card.
      const rest = prev.length === 1 && prev[0]?.kind === 'sentinel' ? [] : prev;
      return [card, ...rest];
    });

    recordDecisionMutation.mutate({
      mediaType: mediaTab,
      librarySectionKey: activeLibraryKey,
      id: card.item.id,
      action: 'undo',
    });
    scheduleApply();
  };

  const undoWatchedLast = () => {
    if (!watchedUndoState) return;
    if (watchedUndoState.tab !== mediaTab) return;
    if (watchedUndoState.librarySectionKey !== activeLibraryKey) return;
    if (watchedUndoState.collectionKind !== watchedCollectionKind) return;

    const { card, phase: prevPhase, collectionKind } = watchedUndoState;
    setWatchedUndoState(null);
    setWatchedPhase(prevPhase);
    setWatchedDeck((prev) => {
      const rest = prev.length === 1 && prev[0]?.kind === 'sentinel' ? [] : prev;
      return [card, ...rest];
    });

    recordWatchedDecisionMutation.mutate({
      mediaType: mediaTab,
      librarySectionKey: activeLibraryKey,
      collectionKind,
      id: card.item.id,
      action: 'undo',
    });
    scheduleWatchedApply();
  };

  const swipeTopCardImmaculate = (dir: 'left' | 'right') => {
    if (activeCollectionTab !== 'immaculate') return;
    if (!activeLibraryKey) return;
    if (!deck.length) return;
    if (recordDecisionMutation.isPending || applyMutation.isPending) return;

    const top = deck[0];
    if (!top) return;

    // Sentinel: only Right is meaningful.
    if (top.kind === 'sentinel') {
      if (dir === 'left') return;
      setUndoState(null);
      if (top.sentinel === 'approvalsDone') {
        setDeckForReview();
      } else {
        restartCycle();
      }
      return;
    }

    const action =
      phase === 'pendingApprovals'
        ? dir === 'right'
          ? 'approve'
          : 'reject'
        : dir === 'right'
          ? 'keep'
          : 'remove';

    setUndoState({
      tab: mediaTab,
      librarySectionKey: activeLibraryKey,
      phase,
      card: { kind: 'item', item: top.item },
      action,
    });

    recordDecisionMutation.mutate({
      mediaType: mediaTab,
      librarySectionKey: activeLibraryKey,
      id: top.item.id,
      action,
    });

    advanceOneOrSentinel(
      phase === 'pendingApprovals' ? approvalsDoneCard : reviewDoneCard,
    );
    scheduleApply();
  };

  const swipeTopCardWatched = (dir: 'left' | 'right') => {
    if (activeCollectionTab !== 'latestWatched') return;
    if (!activeLibraryKey) return;
    if (!watchedDeck.length) return;
    if (recordWatchedDecisionMutation.isPending || applyWatchedMutation.isPending) return;

    const top = watchedDeck[0];
    if (!top) return;

    if (top.kind === 'sentinel') {
      if (dir === 'left') return;
      setWatchedUndoState(null);

      if (top.sentinel === 'approvalsDone') {
        setWatchedDeckForReview();
        return;
      }

      // noData or reviewDone: advance the overall flow (recently watched -> change of taste -> restart).
      if (watchedCollectionKind === 'recentlyWatched') {
        setWatchedCollectionKind('changeOfTaste');
        watchedDeckKeyRef.current = null;
      } else {
        restartWatchedCycle();
      }
      return;
    }

    const action =
      watchedPhase === 'pendingApprovals'
        ? dir === 'right'
          ? 'approve'
          : 'reject'
        : dir === 'right'
          ? 'keep'
          : 'remove';

    setWatchedUndoState({
      tab: mediaTab,
      librarySectionKey: activeLibraryKey,
      collectionKind: watchedCollectionKind,
      phase: watchedPhase,
      card: { kind: 'item', item: top.item },
      action,
    });

    recordWatchedDecisionMutation.mutate({
      mediaType: mediaTab,
      librarySectionKey: activeLibraryKey,
      collectionKind: watchedCollectionKind,
      id: top.item.id,
      action,
    });

    advanceWatchedOneOrSentinel(
      watchedPhase === 'pendingApprovals'
        ? watchedApprovalsDoneCard
        : watchedCollectionKind === 'recentlyWatched'
          ? watchedNextDeckCard
          : watchedRestartCard,
    );
    scheduleWatchedApply();
  };

  // Keep the latest swipe handler available to the keyboard listener (without re-binding listeners).
  useEffect(() => {
    swipeTopCardRef.current =
      activeCollectionTab === 'immaculate' ? swipeTopCardImmaculate : swipeTopCardWatched;
  });

  // Keyboard shortcuts: ArrowLeft/ArrowRight behave like swipes on the top card.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.repeat) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (activeCollectionTab !== 'immaculate') return;

      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          t.isContentEditable
        ) {
          return;
        }
      }

      e.preventDefault();
      swipeTopCardRef.current?.(e.key === 'ArrowLeft' ? 'left' : 'right');
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeCollectionTab]);

  // Apply on page leave/unmount (best-effort).
  useEffect(() => {
    return () => {
      if (applyTimerRef.current) window.clearTimeout(applyTimerRef.current);
      if (watchedApplyTimerRef.current)
        window.clearTimeout(watchedApplyTimerRef.current);

      if (pendingApplyRef.current) {
        applyMutation.mutate({ mediaType: mediaTab, librarySectionKey: activeLibraryKey });
      }
      if (watchedPendingApplyRef.current) {
        applyWatchedMutation.mutate({
          mediaType: mediaTab,
          librarySectionKey: activeLibraryKey,
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCollectionTab, mediaTab, activeLibraryKey]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
          {/* Background (landing-page style, amber-tinted) */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src={APP_BG_IMAGE_URL}
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        {/* Purple-tinted overlay (bright yellow top-left, purple wash, dark purple bottom-right) */}
        <div className="absolute inset-0 bg-gradient-to-br from-yellow-300/16 via-purple-800/60 to-purple-950/85" />
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
                    className="pointer-events-none absolute inset-0 bg-[#facc15] blur-xl opacity-0"
                  />
                  <div className="absolute inset-0 bg-[#facc15] blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
                  <motion.div
                    initial={{ rotate: -10, scale: 0.94, y: 2 }}
                    animate={{ rotate: -6, scale: 1, y: 0 }}
                    whileHover={{ rotate: 0, scale: 1.04 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                    style={{ backfaceVisibility: 'hidden' }}
                    className="relative will-change-transform transform-gpu p-3 md:p-4 bg-[#facc15] rounded-2xl shadow-[0_0_30px_rgba(250,204,21,0.3)] border border-white/20"
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

              <p className="text-amber-100/70 text-lg font-medium max-w-lg leading-relaxed ml-1">
                Swipe to approve downloads and curate your recommendations.
              </p>
            </motion.div>
          </div>

          {/* Primary tabs (Immaculate vs Based on Latest Watched) */}
          <div className="flex items-center justify-center gap-8 border-b border-white/10 mb-8 px-2">
            {[
              { id: 'immaculate', label: 'Immaculate Taste Collection' },
              { id: 'latestWatched', label: 'Based on Latest Watched Collection' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveCollectionTab(t.id as CollectionTab)}
                className={cn(
                  'relative pb-4 text-sm font-bold tracking-wide uppercase transition-colors duration-300',
                  activeCollectionTab === (t.id as CollectionTab)
                    ? 'text-[#facc15]'
                    : 'text-white/80 hover:text-white',
                )}
              >
                {t.label}
                {activeCollectionTab === (t.id as CollectionTab) && (
                  <motion.div
                    layoutId="observatoryActiveTab"
                    className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-[#facc15] shadow-[0_0_10px_rgba(250,204,21,0.5)]"
                  />
                )}
              </button>
            ))}
          </div>

          <div className="min-h-[300px]">
            <AnimatePresence mode="wait">
              {activeCollectionTab === 'immaculate' ? (
                <motion.div
                  key="immaculate"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* Sub-tabs (Movie / TV) */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                    <div className="flex items-center">
                      <div className="bg-white/5 rounded-lg p-1 inline-flex relative border border-white/5">
                        {['Movie', 'TV'].map((sub) => {
                          const id = sub.toLowerCase() === 'movie' ? 'movie' : 'tv';
                          const isActive = mediaTab === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setMediaTab(id)}
                              className={cn(
                                'relative px-6 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-colors z-10',
                                isActive
                                  ? 'text-[#facc15]'
                                  : 'text-white/80 hover:text-white',
                              )}
                            >
                              {sub}
                              {isActive && (
                                <motion.div
                                  layoutId="observatoryActiveSubTab"
                                  className="absolute inset-0 bg-[#facc15]/10 rounded-md shadow-[0_0_15px_rgba(250,204,21,0.1)] border border-[#facc15]/20"
                                  transition={{
                                    type: 'spring',
                                    bounce: 0.2,
                                    duration: 0.6,
                                  }}
                                  style={{ zIndex: -1 }}
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-xs text-white/60 font-semibold">
                        Library
                      </div>
                      <select
                        value={activeLibraryKey}
                        onChange={(e) => {
                          if (mediaTab === 'movie') setMovieLibrary(e.target.value);
                          else setTvLibrary(e.target.value);
                        }}
                        className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 outline-none focus:ring-2 focus:ring-white/20"
                      >
                        {(mediaTab === 'movie' ? movieLibraries : tvLibraries).map(
                          (l) => (
                            <option key={l.key} value={l.key}>
                              {l.title}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  </div>

                  <div className="mb-6 text-xs text-white/55">
                    {approvalRequired
                      ? 'Approval is ON. Pending download requests show first.'
                      : 'Approval is OFF. You’re reviewing suggestions (cleanup mode).'}
                  </div>

                  <div className="mt-6">
                    {/* Fixed frame prevents layout jitter while cards animate/throw off-screen */}
                    <div className="relative mx-auto max-w-3xl h-[540px] md:h-[720px] overflow-visible">
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
                                depth === 0
                                  ? 0
                                  : depth % 2 === 0
                                    ? 0.35
                                    : -0.35;
                              return (
                                <motion.div
                                  key={
                                    card.kind === 'sentinel'
                                      ? `sentinel:${card.sentinel}`
                                      : `${card.item.mediaType}:${card.item.id}`
                                  }
                                  initial={false}
                                  animate={{ scale, y, opacity, rotate }}
                                  transition={{
                                    type: 'spring',
                                    stiffness: 420,
                                    damping: 34,
                                  }}
                                  style={{ zIndex: 50 - depth }}
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
                                        phase === 'pendingApprovals'
                                          ? 'reject'
                                          : 'remove';
                                      setUndoState({
                                        tab: mediaTab,
                                        librarySectionKey: activeLibraryKey,
                                        phase,
                                        card: { kind: 'item', item: card.item },
                                        action,
                                      });
                                      recordDecisionMutation.mutate({
                                        mediaType: mediaTab,
                                        librarySectionKey: activeLibraryKey,
                                        id: card.item.id,
                                        action,
                                      });
                                      advanceOneOrSentinel(
                                        phase === 'pendingApprovals'
                                          ? approvalsDoneCard
                                          : reviewDoneCard,
                                      );
                                      scheduleApply();
                                    }}
                                    onSwipeRight={() => {
                                      if (card.kind === 'sentinel') {
                                        setUndoState(null);
                                        // approvalsDone -> review, reviewDone -> restart loop
                                        if (card.sentinel === 'approvalsDone') {
                                          setDeckForReview();
                                        } else {
                                          restartCycle();
                                        }
                                        return;
                                      }
                                      const action =
                                        phase === 'pendingApprovals'
                                          ? 'approve'
                                          : 'keep';
                                      setUndoState({
                                        tab: mediaTab,
                                        librarySectionKey: activeLibraryKey,
                                        phase,
                                        card: { kind: 'item', item: card.item },
                                        action,
                                      });
                                      recordDecisionMutation.mutate({
                                        mediaType: mediaTab,
                                        librarySectionKey: activeLibraryKey,
                                        id: card.item.id,
                                        action,
                                      });
                                      advanceOneOrSentinel(
                                        phase === 'pendingApprovals'
                                          ? approvalsDoneCard
                                          : reviewDoneCard,
                                      );
                                      scheduleApply();
                                    }}
                                  />
                                </motion.div>
                              );
                            })}
                        </div>
                      ) : (
                        <div className="absolute inset-0">
                          <SwipeCard
                            card={
                              (listPendingQuery.data?.items?.length ?? 0) === 0 &&
                              (listReviewQuery.data?.items?.length ?? 0) === 0
                                ? makeNoDataCard()
                                : reviewDoneCard
                            }
                            onSwipeLeft={() => undefined}
                            onSwipeRight={() => restartCycle()}
                          />
                        </div>
                      )}
                    </div>

                    <div className="mx-auto max-w-3xl mt-4 flex items-center justify-center">
                      <button
                        type="button"
                        onClick={undoLast}
                        disabled={!canUndo}
                        className={cn(
                          'h-11 rounded-2xl px-4 border text-sm font-bold transition active:scale-[0.98] flex items-center gap-2',
                          canUndo
                            ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
                            : 'border-white/10 bg-white/5 text-white/35 cursor-not-allowed',
                        )}
                        aria-label="Undo last swipe"
                        title={canUndo ? 'Undo last swipe' : 'Nothing to undo'}
                      >
                        <Undo2 className="h-4 w-4" />
                        Undo
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="latestWatched"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* Sub-tabs (Movie / TV) */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                    <div className="flex items-center">
                      <div className="rounded-lg p-1 inline-flex relative border border-white/10 bg-black/10 backdrop-blur-md">
                          {['Movie', 'TV'].map((sub) => {
                            const id = sub.toLowerCase() === 'movie' ? 'movie' : 'tv';
                            const isActive = mediaTab === id;
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setMediaTab(id)}
                                className={cn(
                                  'relative px-6 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-colors z-10',
                                  isActive
                                    ? 'text-[#facc15]'
                                    : 'text-white/80 hover:text-white',
                                )}
                              >
                                {sub}
                                {isActive && (
                                  <motion.div
                                    layoutId="observatoryActiveSubTab"
                                    className="absolute inset-0 bg-[#facc15]/10 rounded-md shadow-[0_0_15px_rgba(250,204,21,0.1)] border border-[#facc15]/20"
                                    transition={{
                                      type: 'spring',
                                      bounce: 0.2,
                                      duration: 0.6,
                                    }}
                                    style={{ zIndex: -1 }}
                                  />
                                )}
                              </button>
                            );
                          })}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-xs text-white/60 font-semibold">Library</div>
                      <select
                        value={activeLibraryKey}
                        onChange={(e) => {
                          if (mediaTab === 'movie') setMovieLibrary(e.target.value);
                          else setTvLibrary(e.target.value);
                        }}
                        className="rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white/90 outline-none focus:ring-2 focus:ring-[#facc15]/50 focus:border-transparent transition"
                      >
                        {(mediaTab === 'movie' ? movieLibraries : tvLibraries).map((l) => (
                          <option key={l.key} value={l.key}>
                            {l.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mb-6 text-xs text-white/55">
                    {watchedApprovalRequired
                      ? 'Approval is ON. Pending download requests show first.'
                      : 'Approval is OFF. You’re reviewing suggestions (cleanup mode).'}
                  </div>

                  <div className="mt-6">
                    <div className="relative mx-auto max-w-3xl h-[540px] md:h-[720px] overflow-visible">
                      {watchedDeck.length ? (
                        <div className="relative h-full">
                          {watchedDeck
                            .slice(0, 3)
                            .reverse()
                            .map((card, idx, arr) => {
                              const isTop = idx === arr.length - 1;
                              const depth = arr.length - 1 - idx;
                              const scale = 1 - depth * 0.045;
                              const y = depth * 18;
                              const opacity = 1 - depth * 0.14;
                              const rotate =
                                depth === 0 ? 0 : depth % 2 === 0 ? 0.35 : -0.35;
                              return (
                                <motion.div
                                  key={
                                    card.kind === 'sentinel'
                                      ? `watched:${watchedCollectionKind}:sentinel:${card.sentinel}`
                                      : `watched:${watchedCollectionKind}:${card.item.mediaType}:${card.item.id}`
                                  }
                                  initial={false}
                                  animate={{ scale, y, opacity, rotate }}
                                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                                  style={{ zIndex: 50 - depth }}
                                  className={cn(
                                    'absolute inset-0',
                                    !isTop && 'pointer-events-none',
                                  )}
                                >
                                  <SwipeCard
                                    card={card}
                                    disabled={
                                      !isTop ||
                                      recordWatchedDecisionMutation.isPending ||
                                      applyWatchedMutation.isPending
                                    }
                                    onSwipeLeft={() => swipeTopCardWatched('left')}
                                    onSwipeRight={() => swipeTopCardWatched('right')}
                                  />
                                </motion.div>
                              );
                            })}
                        </div>
                      ) : (
                        <div className="absolute inset-0">
                          <SwipeCard
                            card={makeWatchedNoDataCard()}
                            onSwipeLeft={() => undefined}
                            onSwipeRight={() => swipeTopCardWatched('right')}
                          />
                        </div>
                      )}
                    </div>

                    <div className="mx-auto max-w-3xl mt-4 flex items-center justify-center">
                      <button
                        type="button"
                        onClick={undoWatchedLast}
                        disabled={!canWatchedUndo}
                        className={cn(
                          'h-11 rounded-2xl px-4 border text-sm font-bold transition active:scale-[0.98] flex items-center gap-2',
                          canWatchedUndo
                            ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
                            : 'border-white/10 bg-white/5 text-white/35 cursor-not-allowed',
                        )}
                        aria-label="Undo last swipe"
                        title={canWatchedUndo ? 'Undo last swipe' : 'Nothing to undo'}
                      >
                        <Undo2 className="h-4 w-4" />
                        Undo
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </section>
    </div>
  );
}

