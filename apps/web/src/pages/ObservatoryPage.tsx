import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { AnimatePresence, motion, useAnimation } from 'motion/react';
import { Telescope } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePersistentState } from '@/lib/usePersistentState';

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
import { GlassSelect } from '@/components/ui/glass-select';
import { SwipeDeckView } from './observatory/swipe-deck';
import {
  useSwipeDeck,
  type CardModel,
  type DecisionAction,
  type Phase,
  type SentinelKind,
  type SwipeDeckSentinelHelpers,
  type SwipeDirection,
} from './observatory/use-swipe-deck';

type Tab = 'movie' | 'tv';
type CollectionTab = 'immaculate' | 'latestWatched';

export function ObservatoryPage() {
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const queryClient = useQueryClient();

  const [activeCollectionTab, setActiveCollectionTab] =
    usePersistentState<CollectionTab>('tcp_observatory_collection_tab', 'immaculate');
  const [mediaTab, setMediaTab] = usePersistentState<Tab>(
    'tcp_observatory_media_tab',
    'movie',
  );
  const [movieLibrary, setMovieLibrary] = useState<string>('');
  const [tvLibrary, setTvLibrary] = useState<string>('');

  // Announced via an aria-live region — the only feedback a screen-reader
  // user gets that a decision was recorded and a new card is on top.
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const [watchedCollectionKind, setWatchedCollectionKind] =
    useState<WatchedCollectionKind>('recentlyWatched');

  const swipeTopCardRef = useRef<((dir: SwipeDirection) => void) | null>(null);

  // IMPORTANT:
  // We intentionally do not enable global scroll-snap on html/body here.
  // It causes intermittent tap/routing lockups on iOS Safari / iOS PWAs after visiting this page.

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

  // Derive the default (first) library instead of pushing it into state from
  // an effect — state only holds an explicit user choice.
  const activeLibraryKey =
    mediaTab === 'movie'
      ? movieLibrary || movieLibraries[0]?.key || ''
      : tvLibrary || tvLibraries[0]?.key || '';
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
    staleTime: 30_000,
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
    staleTime: 30_000,
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
    staleTime: 30_000,
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
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // -------------------------------------------------------------------------
  // Sentinel cards (the copy is the page's concern; the machine is the hook's)
  // -------------------------------------------------------------------------

  const approvalsDoneCard = useMemo<CardModel>(
    () => ({ kind: 'sentinel', sentinel: 'approvalsDone' }),
    [],
  );
  const reviewDoneCard = useMemo<CardModel>(
    () => ({ kind: 'sentinel', sentinel: 'reviewDone' }),
    [],
  );

  const makeNoDataCard = useCallback((): CardModel => {
    const mediaTypeLabel = mediaTab === 'movie' ? 'movie' : 'tv';
    const libraryKindLabel =
      mediaTab === 'movie' ? 'Movie Library' : 'TV Show Library';
    const libraryLabel = activeLibraryTitle ? ` in ${libraryKindLabel}: ${activeLibraryTitle}` : '';
    return {
      kind: 'sentinel',
      sentinel: 'noData',
      message: `Please continue using Plex for ${mediaTypeLabel}${libraryLabel} and let the suggestion list build up, or run Immaculate Taste Collection manually for ${mediaTypeLabel} to generate suggestions.`,
    };
  }, [activeLibraryTitle, mediaTab]);

  const watchedApprovalsDoneCard = useMemo<CardModel>(
    () => ({
      kind: 'sentinel',
      sentinel: 'approvalsDone',
    }),
    [],
  );
  const watchedNextDeckCard = useMemo<CardModel>(
    () => ({
      kind: 'sentinel',
      sentinel: 'reviewDone',
      title: 'Recently watched suggestions have been reviewed',
      subtitle: 'Swipe right to review Change of Taste.',
      ctaLabel: 'Review Change of Taste',
    }),
    [],
  );
  const watchedRestartCard = useMemo<CardModel>(
    () => ({
      kind: 'sentinel',
      sentinel: 'reviewDone',
      title: 'All suggestions have been reviewed',
      subtitle: 'Swipe right to restart reviewing.',
      ctaLabel: 'Restart reviewing',
    }),
    [],
  );

  const makeWatchedNoDataCard = useCallback((): CardModel => {
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
      // Right-advance on this card moves the flow along rather than refetching.
      ctaLabel:
        watchedCollectionKind === 'recentlyWatched'
          ? 'Review Change of Taste'
          : 'Restart reviewing',
    };
  }, [activeLibraryTitle, mediaTab, watchedCollectionKind]);

  // -------------------------------------------------------------------------
  // Immaculate Taste deck
  // -------------------------------------------------------------------------

  const immaculateSentinelForPhase = useCallback(
    (p: Phase) => (p === 'pendingApprovals' ? approvalsDoneCard : reviewDoneCard),
    [approvalsDoneCard, reviewDoneCard],
  );
  const immaculateOnSentinelRight = useCallback(
    (sentinel: SentinelKind, helpers: SwipeDeckSentinelHelpers) => {
      if (sentinel === 'approvalsDone') helpers.setDeckForReview();
      else helpers.restartCycle();
    },
    [],
  );
  const immaculateRecordDecision = useCallback(
    (params: { id: number; action: DecisionAction | 'undo' }) =>
      recordImmaculateTasteDecisions({
        librarySectionKey: activeLibraryKey,
        mediaType: mediaTab,
        decisions: [{ id: params.id, action: params.action }],
      }),
    [activeLibraryKey, mediaTab],
  );
  const immaculateApplyDecisions = useCallback(
    () =>
      applyImmaculateTasteObservatory({
        librarySectionKey: activeLibraryKey,
        mediaType: mediaTab,
      }),
    [activeLibraryKey, mediaTab],
  );
  const immaculateRemoveItemFromLists = useCallback(
    (id: number) => {
      const strip = (old: { items: ObservatoryItem[] } | undefined) =>
        old ? { ...old, items: old.items.filter((i) => i.id !== id) } : old;
      queryClient.setQueryData<{ items: ObservatoryItem[] } | undefined>(
        ['observatory', 'immaculateTaste', mediaTab, activeLibraryKey, 'pendingApproval'],
        strip,
      );
      queryClient.setQueryData<{ items: ObservatoryItem[] } | undefined>(
        ['observatory', 'immaculateTaste', mediaTab, activeLibraryKey, 'review'],
        strip,
      );
    },
    [activeLibraryKey, mediaTab, queryClient],
  );
  const immaculateInvalidateLists = useCallback(
    () =>
      Promise.all([
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
      ]),
    [activeLibraryKey, mediaTab, queryClient],
  );
  const immaculateInvalidateAfterApply = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['observatory', 'immaculateTaste'] }),
        queryClient.invalidateQueries({ queryKey: ['immaculateTasteCollections'] }),
      ]),
    [queryClient],
  );

  const immaculateDeck = useSwipeDeck({
    deckKey: `immaculate:${mediaTab}:${activeLibraryKey || 'none'}`,
    active: activeCollectionTab === 'immaculate',
    librarySectionKey: activeLibraryKey,
    pendingData: listPendingQuery.data,
    reviewData: listReviewQuery.data,
    sentinelForPhase: immaculateSentinelForPhase,
    makeNoDataCard,
    onSentinelRight: immaculateOnSentinelRight,
    recordDecision: immaculateRecordDecision,
    applyDecisions: immaculateApplyDecisions,
    removeItemFromLists: immaculateRemoveItemFromLists,
    invalidateLists: immaculateInvalidateLists,
    invalidateAfterApply: immaculateInvalidateAfterApply,
    announce: setLiveAnnouncement,
  });

  // -------------------------------------------------------------------------
  // Based on Latest Watched deck
  // -------------------------------------------------------------------------

  const watchedSentinelForPhase = useCallback(
    (p: Phase) =>
      p === 'pendingApprovals'
        ? watchedApprovalsDoneCard
        : watchedCollectionKind === 'recentlyWatched'
          ? watchedNextDeckCard
          : watchedRestartCard,
    [
      watchedApprovalsDoneCard,
      watchedCollectionKind,
      watchedNextDeckCard,
      watchedRestartCard,
    ],
  );
  const invalidateWatchedBothKinds = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['observatory', 'watched', mediaTab, activeLibraryKey, 'recentlyWatched'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['observatory', 'watched', mediaTab, activeLibraryKey, 'changeOfTaste'],
        }),
      ]),
    [activeLibraryKey, mediaTab, queryClient],
  );
  const watchedOnSentinelRight = useCallback(
    (sentinel: SentinelKind, helpers: SwipeDeckSentinelHelpers) => {
      if (sentinel === 'approvalsDone') {
        helpers.setDeckForReview();
        return;
      }
      // noData or reviewDone: advance the overall flow
      // (recently watched -> change of taste -> restart).
      if (watchedCollectionKind === 'recentlyWatched') {
        setWatchedCollectionKind('changeOfTaste');
        helpers.resetDeckKey();
      } else {
        void invalidateWatchedBothKinds().finally(() => {
          setWatchedCollectionKind('recentlyWatched');
          helpers.resetDeckKey();
        });
      }
    },
    [invalidateWatchedBothKinds, watchedCollectionKind],
  );
  const watchedRecordDecision = useCallback(
    (params: { id: number; action: DecisionAction | 'undo' }) =>
      recordWatchedDecisions({
        librarySectionKey: activeLibraryKey,
        mediaType: mediaTab,
        collectionKind: watchedCollectionKind,
        decisions: [{ id: params.id, action: params.action }],
      }),
    [activeLibraryKey, mediaTab, watchedCollectionKind],
  );
  const watchedApplyDecisions = useCallback(
    () =>
      applyWatchedObservatory({
        librarySectionKey: activeLibraryKey,
        mediaType: mediaTab,
      }),
    [activeLibraryKey, mediaTab],
  );
  const watchedRemoveItemFromLists = useCallback(
    (id: number) => {
      const strip = (old: { items: ObservatoryItem[] } | undefined) =>
        old ? { ...old, items: old.items.filter((i) => i.id !== id) } : old;
      queryClient.setQueryData<{ items: ObservatoryItem[] } | undefined>(
        [
          'observatory',
          'watched',
          mediaTab,
          activeLibraryKey,
          watchedCollectionKind,
          'pendingApproval',
        ],
        strip,
      );
      queryClient.setQueryData<{ items: ObservatoryItem[] } | undefined>(
        [
          'observatory',
          'watched',
          mediaTab,
          activeLibraryKey,
          watchedCollectionKind,
          'review',
        ],
        strip,
      );
    },
    [activeLibraryKey, mediaTab, queryClient, watchedCollectionKind],
  );
  const watchedInvalidateLists = useCallback(
    () =>
      Promise.all([
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
      ]),
    [activeLibraryKey, mediaTab, queryClient, watchedCollectionKind],
  );
  const watchedInvalidateAfterApply = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['observatory', 'watched', mediaTab, activeLibraryKey],
        }),
      ]),
    [activeLibraryKey, mediaTab, queryClient],
  );

  const watchedDeck = useSwipeDeck({
    deckKey: `watched:${mediaTab}:${activeLibraryKey || 'none'}:${watchedCollectionKind}`,
    active: activeCollectionTab === 'latestWatched',
    librarySectionKey: activeLibraryKey,
    pendingData: listWatchedPendingQuery.data,
    reviewData: listWatchedReviewQuery.data,
    sentinelForPhase: watchedSentinelForPhase,
    makeNoDataCard: makeWatchedNoDataCard,
    onSentinelRight: watchedOnSentinelRight,
    recordDecision: watchedRecordDecision,
    applyDecisions: watchedApplyDecisions,
    removeItemFromLists: watchedRemoveItemFromLists,
    invalidateLists: watchedInvalidateLists,
    invalidateAfterApply: watchedInvalidateAfterApply,
    announce: setLiveAnnouncement,
  });

  const resetWatchedDeckKey = watchedDeck.resetDeckKey;

  // Whenever the watched context changes (entering the tab, or switching
  // media/library while on it), restart from the "recently watched" deck.
  // Done in the event handlers below rather than an effect so the reset is
  // tied to the user action that caused it.
  const restartWatchedFromBeginning = useCallback(() => {
    setWatchedCollectionKind('recentlyWatched');
    resetWatchedDeckKey();
  }, [resetWatchedDeckKey]);

  // The empty-deck fallback cards can't advance via the swipe handlers (those
  // early-return when the deck is empty), so their CTA buttons act directly.
  const handleWatchedFallbackAdvance = useCallback(() => {
    if (watchedCollectionKind === 'recentlyWatched') {
      setWatchedCollectionKind('changeOfTaste');
      resetWatchedDeckKey();
    } else {
      void invalidateWatchedBothKinds().finally(() => {
        setWatchedCollectionKind('recentlyWatched');
        resetWatchedDeckKey();
      });
    }
  }, [invalidateWatchedBothKinds, resetWatchedDeckKey, watchedCollectionKind]);

  // Keep the latest swipe handler available to the keyboard listener (without re-binding listeners).
  const immaculateSwipeTopCard = immaculateDeck.swipeTopCard;
  const watchedSwipeTopCard = watchedDeck.swipeTopCard;
  useEffect(() => {
    swipeTopCardRef.current =
      activeCollectionTab === 'immaculate' ? immaculateSwipeTopCard : watchedSwipeTopCard;
  });

  // Keyboard shortcuts: ArrowLeft/ArrowRight behave like swipes on the top card.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.repeat) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

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
        // Arrow keys inside any interactive control (GlassSelect's listbox of
        // buttons, the Undo button, tabs, links) are navigation, not swipe
        // intent — without this, arrowing through the library dropdown records
        // irreversible approve/reject decisions.
        if (
          typeof t.closest === 'function' &&
          t.closest('button, a, [role="listbox"], [role="option"], [tabindex]')
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

  const handleAnimateTitleIcon = useCallback(() => {
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
  }, [titleIconControls, titleIconGlowControls]);
  const handleCollectionTabClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const tab = event.currentTarget.dataset.collectionTab as CollectionTab | undefined;
      if (!tab) return;
      setActiveCollectionTab(tab);
      if (tab === 'latestWatched') restartWatchedFromBeginning();
    },
    [restartWatchedFromBeginning, setActiveCollectionTab],
  );
  const handleMediaTabClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const tab = event.currentTarget.dataset.mediaTab as Tab | undefined;
      if (!tab) return;
      setMediaTab(tab);
      if (activeCollectionTab === 'latestWatched') restartWatchedFromBeginning();
    },
    [activeCollectionTab, restartWatchedFromBeginning, setMediaTab],
  );
  const handleLibraryValueChange = useCallback(
    (value: string) => {
      if (mediaTab === 'movie') setMovieLibrary(value);
      else setTvLibrary(value);
      if (activeCollectionTab === 'latestWatched') restartWatchedFromBeginning();
    },
    [activeCollectionTab, mediaTab, restartWatchedFromBeginning],
  );
  const handleApplyNow = useCallback(() => {
    if (activeCollectionTab === 'immaculate') immaculateDeck.applyNow();
    else watchedDeck.applyNow();
  }, [activeCollectionTab, immaculateDeck, watchedDeck]);

  const activeDeck = activeCollectionTab === 'immaculate' ? immaculateDeck : watchedDeck;

  return (
    <div className="relative min-h-screen overflow-x-hidden select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
      {/* Decision feedback for screen readers; visually the cards animate. */}
      <div aria-live="polite" role="status" className="sr-only">
        {liveAnnouncement}
      </div>
      <section className="relative z-10 min-h-screen overflow-x-hidden pt-10 lg:pt-16">
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
                  onClick={handleAnimateTitleIcon}
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
                data-collection-tab={t.id}
                onClick={handleCollectionTabClick}
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

          {activeDeck.hasPendingApply ? (
            <div className="mb-6 flex items-center justify-center">
              <div className="flex items-center gap-3 rounded-full border border-[#facc15]/25 bg-[#facc15]/10 px-4 py-2 text-xs font-semibold text-[#fde68a]">
                <span>
                  Decisions recorded — they sync to Plex automatically in the
                  background.
                </span>
                <button
                  type="button"
                  onClick={handleApplyNow}
                  disabled={activeDeck.applyPending}
                  className="rounded-full border border-[#facc15]/35 bg-[#facc15]/20 px-3 py-1 font-bold text-[#facc15] transition hover:bg-[#facc15]/30 disabled:opacity-50"
                >
                  {activeDeck.applyPending ? 'Applying…' : 'Apply now'}
                </button>
              </div>
            </div>
          ) : null}

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
                              data-media-tab={id}
                              onClick={handleMediaTabClick}
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
                      <GlassSelect
                        value={activeLibraryKey}
                        placeholder="Select library"
                        options={(mediaTab === 'movie' ? movieLibraries : tvLibraries).map((l) => ({
                          value: l.key,
                          label: l.title,
                        }))}
                        onValueChange={handleLibraryValueChange}
                        triggerClassName="w-auto min-w-[12rem] rounded-2xl border-white/10 bg-white/5 px-3 py-2 text-sm shadow-none"
                      />
                    </div>
                  </div>

                  <div className="mb-6 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider',
                        immaculateDeck.phase === 'pendingApprovals'
                          ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                          : 'border-white/15 bg-white/5 text-white/70',
                      )}
                    >
                      {immaculateDeck.phase === 'pendingApprovals'
                        ? 'Download requests'
                        : 'Cleanup'}
                    </span>
                    <span className="text-xs text-white/55">
                      {immaculateDeck.phase === 'pendingApprovals'
                        ? 'Swipe right to approve the download · swipe left to reject.'
                        : 'Swipe right to keep · swipe left to remove.'}
                    </span>
                  </div>

                  <SwipeDeckView
                    api={immaculateDeck}
                    isLoading={listPendingQuery.isPending || listReviewQuery.isPending}
                    fallbackCard={
                      (listPendingQuery.data?.items?.length ?? 0) === 0 &&
                      (listReviewQuery.data?.items?.length ?? 0) === 0
                        ? makeNoDataCard()
                        : reviewDoneCard
                    }
                    onFallbackAdvance={immaculateDeck.restartCycle}
                  />
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
                                data-media-tab={id}
                                onClick={handleMediaTabClick}
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
                      <GlassSelect
                        value={activeLibraryKey}
                        placeholder="Select library"
                        options={(mediaTab === 'movie' ? movieLibraries : tvLibraries).map((l) => ({
                          value: l.key,
                          label: l.title,
                        }))}
                        onValueChange={handleLibraryValueChange}
                        triggerClassName="w-auto min-w-[12rem] rounded-2xl border-white/10 bg-transparent px-3 py-2 text-sm text-white/90 shadow-none focus:ring-2 focus:ring-[#facc15]/50 focus:border-transparent transition"
                      />
                    </div>
                  </div>

                  <div className="mb-6 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider',
                        watchedDeck.phase === 'pendingApprovals'
                          ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                          : 'border-white/15 bg-white/5 text-white/70',
                      )}
                    >
                      {watchedDeck.phase === 'pendingApprovals'
                        ? 'Download requests'
                        : 'Cleanup'}
                    </span>
                    <span className="text-xs text-white/55">
                      {watchedDeck.phase === 'pendingApprovals'
                        ? 'Swipe right to approve the download · swipe left to reject.'
                        : 'Swipe right to keep · swipe left to remove.'}
                    </span>
                  </div>

                  <SwipeDeckView
                    api={watchedDeck}
                    isLoading={
                      listWatchedPendingQuery.isPending ||
                      listWatchedReviewQuery.isPending
                    }
                    fallbackCard={makeWatchedNoDataCard()}
                    onFallbackAdvance={handleWatchedFallbackAdvance}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </section>
    </div>
  );
}
