import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { type ObservatoryItem } from '@/api/observatory';

// ---------------------------------------------------------------------------
// The one swipe-deck machine. The Observatory page runs two decks (Immaculate
// Taste and Based on Latest Watched) that used to be two textually parallel
// copies of everything below — state, builders, mutations, rollback, undo.
// Anything deck-shaped belongs here; the page supplies only what genuinely
// differs (API calls, sentinel copy, phase chaining) via config.
// ---------------------------------------------------------------------------

export type Phase = 'pendingApprovals' | 'review';
export type SwipeDirection = 'left' | 'right';
export type DecisionAction = 'approve' | 'reject' | 'keep' | 'remove';
export type SentinelKind = 'approvalsDone' | 'reviewDone' | 'noData';

export type CardModel =
  | { kind: 'item'; item: ObservatoryItem }
  | {
      kind: 'sentinel';
      sentinel: SentinelKind;
      title?: string;
      subtitle?: string;
      // Label for the CTA button in the sentinel's bottom bar; a default is
      // derived from the sentinel kind when omitted.
      ctaLabel?: string;
      message?: string;
    };

type ItemCard = { kind: 'item'; item: ObservatoryItem };

type DeckUndoState = {
  deckKey: string;
  phase: Phase;
  card: ItemCard;
  action: DecisionAction;
} | null;

export type SwipeDeckListData =
  | {
      items: ObservatoryItem[];
      approvalRequiredFromObservatory?: boolean;
    }
  | undefined;

export type SwipeDeckSentinelHelpers = {
  /** Move this deck into the review (cleanup) phase. */
  setDeckForReview: () => void;
  /** Invalidate this deck's lists, then rebuild from the approval flag. */
  restartCycle: () => void;
  /** Clear the identity guard so the deck rebuilds from current data. */
  resetDeckKey: () => void;
};

export type UseSwipeDeckConfig = {
  /**
   * Identity of the deck contents. Include everything whose change should
   * rebuild the deck (media tab, library, watched collection kind). The
   * rebuild guard, undo validity and error rollbacks all key off it.
   */
  deckKey: string;
  /** False while another collection tab owns the view — deck resets, swipes no-op. */
  active: boolean;
  /** Selected library; swipes are ignored without one. */
  librarySectionKey: string;
  pendingData: SwipeDeckListData;
  reviewData: SwipeDeckListData;
  /** End-of-phase sentinel: approvalsDone-style for pendingApprovals, the reviewDone variant for review. */
  sentinelForPhase: (phase: Phase) => CardModel;
  makeNoDataCard: () => CardModel;
  /** A right-swipe on a sentinel chains phases/decks — the one place the two decks truly differ. */
  onSentinelRight: (sentinel: SentinelKind, helpers: SwipeDeckSentinelHelpers) => void;
  recordDecision: (params: {
    id: number;
    action: DecisionAction | 'undo';
  }) => Promise<unknown>;
  applyDecisions: () => Promise<unknown>;
  /** Invalidate this deck's two list queries (after record success/failure). */
  invalidateLists: () => Promise<unknown>;
  /** Invalidate whatever a successful apply refreshes. */
  invalidateAfterApply: () => Promise<unknown>;
  /** aria-live feedback ("Kept \"Dune\".") — page owns the single region. */
  announce: (message: string) => void;
};

export type SwipeDeckApi = {
  /** Echo of the config deckKey — used to scope stack keys so cards remount when the deck identity changes. */
  deckKey: string;
  deck: CardModel[];
  phase: Phase;
  itemsLeft: number;
  swipeTopCard: (dir: SwipeDirection) => void;
  swipeLeft: () => void;
  swipeRight: () => void;
  undoLast: () => void;
  canUndo: boolean;
  recordPending: boolean;
  applyPending: boolean;
  hasPendingApply: boolean;
  applyNow: () => void;
  restartCycle: () => void;
  resetDeckKey: () => void;
};

function buildDeck(items: ObservatoryItem[]): CardModel[] {
  return items.map((item) => ({ kind: 'item', item }));
}

const DECISION_VERB: Record<DecisionAction, string> = {
  approve: 'Approved',
  reject: 'Rejected',
  keep: 'Kept',
  remove: 'Removed',
};

export function useSwipeDeck(config: UseSwipeDeckConfig): SwipeDeckApi {
  const {
    deckKey,
    active,
    librarySectionKey,
    pendingData,
    reviewData,
    sentinelForPhase,
    makeNoDataCard,
    onSentinelRight,
    recordDecision,
    applyDecisions,
    invalidateLists,
    invalidateAfterApply,
    announce,
  } = config;

  const [phase, setPhase] = useState<Phase>('pendingApprovals');
  const [deck, setDeck] = useState<CardModel[]>([]);
  const [undoState, setUndoState] = useState<DeckUndoState>(null);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [hasPendingApply, setHasPendingApply] = useState(false);
  // Which deckKey the current deck was built for (state, not a ref: the
  // render-phase init below both reads and adjusts it).
  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  const pendingApplyRef = useRef(false);
  const applyTimerRef = useRef<number | null>(null);
  // Latest scheduler for the apply mutation's onError — the mutation is
  // declared before the scheduler, which in turn references the mutation.
  const scheduleApplyRef = useRef<(() => void) | null>(null);

  // Pure deck composition, shared by the render-phase init (which reads render
  // props) and the event-time builders (which read the ref for freshness).
  const composeApprovalsDeck = useCallback(
    (pending: ObservatoryItem[], review: ObservatoryItem[]) =>
      pending.length
        ? buildDeck(pending)
        : review.length
          ? [sentinelForPhase('pendingApprovals')]
          : [makeNoDataCard()],
    [makeNoDataCard, sentinelForPhase],
  );
  const composeReviewDeck = useCallback(
    (pending: ObservatoryItem[], review: ObservatoryItem[]) =>
      review.length
        ? buildDeck(review)
        : pending.length
          ? [sentinelForPhase('review')]
          : [makeNoDataCard()],
    [makeNoDataCard, sentinelForPhase],
  );

  // Event-time builders read query data through a ref so a rebuild after an
  // awaited invalidation sees the freshest lists, not a stale closure.
  const dataRef = useRef({ pendingData, reviewData, approvalRequired });
  useEffect(() => {
    dataRef.current = { pendingData, reviewData, approvalRequired };
  });

  const setDeckForApprovals = useCallback(() => {
    const { pendingData: p, reviewData: r } = dataRef.current;
    setPhase('pendingApprovals');
    setDeck(composeApprovalsDeck(p?.items ?? [], r?.items ?? []));
  }, [composeApprovalsDeck]);

  const setDeckForReview = useCallback(() => {
    const { pendingData: p, reviewData: r } = dataRef.current;
    setPhase('review');
    setDeck(composeReviewDeck(p?.items ?? [], r?.items ?? []));
  }, [composeReviewDeck]);

  const advanceOneOrSentinel = useCallback((sentinel: CardModel) => {
    setDeck((prev) => {
      const next = prev.slice(1);
      return next.length ? next : [sentinel];
    });
  }, []);

  const resetDeckKey = useCallback(() => {
    setInitializedKey(null);
  }, []);

  const restartCycle = useCallback(() => {
    void Promise.resolve(invalidateLists()).finally(() => {
      if (dataRef.current.approvalRequired) setDeckForApprovals();
      else setDeckForReview();
    });
  }, [invalidateLists, setDeckForApprovals, setDeckForReview]);

  // Deck initialization as a render-phase adjustment ("adjusting state when
  // props change"): rebuild only when the deck identity changes — never on
  // plain refetches, so a mid-session invalidation can't resurrect
  // already-swiped cards.
  if (!active) {
    if (initializedKey !== null || deck.length || undoState || approvalRequired) {
      setInitializedKey(null);
      setDeck([]);
      setUndoState(null);
      setApprovalRequired(false);
    }
  } else if (librarySectionKey && (pendingData || reviewData)) {
    const approval =
      pendingData?.approvalRequiredFromObservatory ??
      reviewData?.approvalRequiredFromObservatory ??
      false;
    const pendingItems = pendingData?.items ?? [];
    const reviewItems = reviewData?.items ?? [];

    if (initializedKey !== deckKey) {
      setInitializedKey(deckKey);
      setUndoState(null);
      setApprovalRequired(approval);
      if (approval) {
        setPhase('pendingApprovals');
        setDeck(composeApprovalsDeck(pendingItems, reviewItems));
      } else {
        setPhase('review');
        setDeck(composeReviewDeck(pendingItems, reviewItems));
      }
    } else {
      // If we previously locked into the "no suggestions" sentinel due to
      // cached/empty data, self-heal once real items arrive (without a swipe).
      const isNoDataDeck =
        deck.length === 1 &&
        deck[0]?.kind === 'sentinel' &&
        deck[0]?.sentinel === 'noData';
      if (isNoDataDeck && (pendingItems.length > 0 || reviewItems.length > 0)) {
        setApprovalRequired(approval);
        if (approval) {
          setPhase('pendingApprovals');
          setDeck(composeApprovalsDeck(pendingItems, reviewItems));
        } else {
          setPhase('review');
          setDeck(composeReviewDeck(pendingItems, reviewItems));
        }
      }
    }
  }

  const recordMutation = useMutation({
    mutationFn: async (params: {
      id: number;
      action: DecisionAction | 'undo';
      // Carried for the onError rollback only — never sent to the API.
      card?: ItemCard;
      phase?: Phase;
      deckKey: string;
    }) => {
      return await recordDecision({ id: params.id, action: params.action });
    },
    onSuccess: async () => {
      pendingApplyRef.current = true;
      setHasPendingApply(true);
      await invalidateLists();
    },
    onError: (err, vars) => {
      // The deck advanced optimistically; the server never saw this decision.
      // Reconcile the local deck instead of leaving them divergent — but only
      // if the user is still looking at the same deck.
      const card = vars.card;
      if (card && vars.deckKey === deckKey) {
        if (vars.action === 'undo') {
          // Undo failed: the original decision still stands server-side, so
          // take the optimistically-restored card back out.
          toast.error(
            err instanceof Error
              ? `Undo failed — the original decision still stands. ${err.message}`
              : 'Undo failed — the original decision still stands.',
          );
          setDeck((prev) => {
            const rest = prev.filter(
              (c) => !(c.kind === 'item' && c.item.id === card.item.id),
            );
            if (rest.length) return rest;
            return [sentinelForPhase(vars.phase ?? 'review')];
          });
        } else {
          toast.error(
            err instanceof Error
              ? `Swipe not saved — the card is back in the deck. ${err.message}`
              : 'Swipe not saved — the card is back in the deck.',
          );
          if (vars.phase) setPhase(vars.phase);
          setDeck((prev) => {
            const rest =
              prev.length === 1 && prev[0]?.kind === 'sentinel' ? [] : prev;
            return [card, ...rest];
          });
          // The undo slot points at this failed decision — clear it.
          setUndoState(null);
        }
      } else {
        toast.error(
          err instanceof Error ? err.message : 'Failed to save swipe decision',
        );
      }
      // Best-effort: reload server truth.
      void invalidateLists();
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => applyDecisions(),
    onSuccess: async () => {
      pendingApplyRef.current = false;
      setHasPendingApply(false);
      setUndoState(null);
      await invalidateAfterApply();
    },
    onError: (err) => {
      // Without this, a failed Plex sync was completely silent and the batch
      // never retried while the page sat idle.
      toast.error(
        err instanceof Error
          ? `Couldn't apply your review to Plex — retrying in 2 minutes. ${err.message}`
          : "Couldn't apply your review to Plex — retrying in 2 minutes.",
      );
      // pendingApplyRef stays true; re-arm the timer so the batch retries.
      scheduleApplyRef.current?.();
    },
  });

  const scheduleApply = useCallback(() => {
    if (applyTimerRef.current) window.clearTimeout(applyTimerRef.current);
    applyTimerRef.current = window.setTimeout(() => {
      if (!pendingApplyRef.current) return;
      applyMutation.mutate();
    }, 120_000);
  }, [applyMutation]);

  // Keep the apply-retry ref pointing at the latest scheduler (the apply
  // mutation's onError fires long after any given render).
  useEffect(() => {
    scheduleApplyRef.current = scheduleApply;
  });

  // Flush on deck-context change and unmount (best-effort): the cleanup runs
  // with the previous context's applyDecisions closure, so the old library's
  // pending batch is what gets applied.
  useEffect(() => {
    return () => {
      if (applyTimerRef.current) window.clearTimeout(applyTimerRef.current);
      if (pendingApplyRef.current) {
        pendingApplyRef.current = false;
        setHasPendingApply(false);
        void Promise.resolve(applyDecisions())
          .then(() => invalidateAfterApply())
          .catch(() => undefined);
      }
    };
  }, [applyDecisions, invalidateAfterApply]);

  const canUndo =
    Boolean(undoState) &&
    undoState?.deckKey === deckKey &&
    !recordMutation.isPending &&
    !applyMutation.isPending;

  const undoLast = useCallback(() => {
    if (!undoState) return;
    if (undoState.deckKey !== deckKey) return;

    const { card, phase: prevPhase } = undoState;
    setUndoState(null);
    setPhase(prevPhase);
    setDeck((prev) => {
      // If we currently show a sentinel because the deck ran out, replace it with the restored card.
      const rest = prev.length === 1 && prev[0]?.kind === 'sentinel' ? [] : prev;
      return [card, ...rest];
    });

    recordMutation.mutate({
      id: card.item.id,
      action: 'undo',
      card,
      phase: prevPhase,
      deckKey,
    });
    announce(`Restored "${card.item.title || `item ${card.item.id}`}" to the deck.`);
    scheduleApply();
  }, [announce, deckKey, recordMutation, scheduleApply, undoState]);

  const swipeTopCard = useCallback(
    (dir: SwipeDirection) => {
      if (!active) return;
      if (!librarySectionKey) return;
      if (!deck.length) return;
      if (recordMutation.isPending || applyMutation.isPending) return;

      const top = deck[0];
      if (!top) return;

      // Sentinel: only Right is meaningful.
      if (top.kind === 'sentinel') {
        if (dir === 'left') return;
        setUndoState(null);
        onSentinelRight(top.sentinel, {
          setDeckForReview,
          restartCycle,
          resetDeckKey,
        });
        return;
      }

      const action: DecisionAction =
        phase === 'pendingApprovals'
          ? dir === 'right'
            ? 'approve'
            : 'reject'
          : dir === 'right'
            ? 'keep'
            : 'remove';

      setUndoState({
        deckKey,
        phase,
        card: { kind: 'item', item: top.item },
        action,
      });

      recordMutation.mutate({
        id: top.item.id,
        action,
        card: { kind: 'item', item: top.item },
        phase,
        deckKey,
      });

      announce(
        `${DECISION_VERB[action]} "${top.item.title || `item ${top.item.id}`}".`,
      );

      advanceOneOrSentinel(sentinelForPhase(phase));
      scheduleApply();
    },
    [
      active,
      advanceOneOrSentinel,
      announce,
      applyMutation.isPending,
      deck,
      deckKey,
      librarySectionKey,
      onSentinelRight,
      phase,
      recordMutation,
      resetDeckKey,
      restartCycle,
      scheduleApply,
      sentinelForPhase,
      setDeckForReview,
    ],
  );

  const swipeLeft = useCallback(() => swipeTopCard('left'), [swipeTopCard]);
  const swipeRight = useCallback(() => swipeTopCard('right'), [swipeTopCard]);
  const applyNow = useCallback(() => applyMutation.mutate(), [applyMutation]);

  const itemsLeft = useMemo(
    () => deck.filter((c) => c.kind === 'item').length,
    [deck],
  );

  return {
    deckKey,
    deck,
    phase,
    itemsLeft,
    swipeTopCard,
    swipeLeft,
    swipeRight,
    undoLast,
    canUndo,
    recordPending: recordMutation.isPending,
    applyPending: applyMutation.isPending,
    hasPendingApply,
    applyNow,
    restartCycle,
    resetDeckKey,
  };
}
