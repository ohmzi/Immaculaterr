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
  /**
   * Surgically drop a decided item from both cached lists. Runs synchronously
   * on record success so sentinel-time rebuilds see truthful data without
   * waiting on refetches — the background invalidation converges the rest.
   */
  removeItemFromLists: (id: number) => void;
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
  /**
   * Perform a swipe on the top card. Returns true when the swipe was handled
   * (deck advanced / sentinel chained) so gesture code can spring the card
   * back when nothing happened.
   */
  swipeTopCard: (dir: SwipeDirection) => boolean;
  swipeLeft: () => boolean;
  swipeRight: () => boolean;
  /** Move the top card to the back of the local deck — no decision recorded. */
  skipTop: () => void;
  canSkip: boolean;
  undoLast: () => void;
  canUndo: boolean;
  /** Why undo is unavailable, so the button can say something truthful. */
  undoUnavailableReason: 'nothing' | 'applied' | 'busy';
  recordPending: boolean;
  /** True while a batched Radarr/Sonarr/Plex sync is in flight — informational only, never gates input. */
  applyPending: boolean;
  restartCycle: () => void;
  resetDeckKey: () => void;
  /** Direction of the most recent removal, driving AnimatePresence exit throws. */
  lastSwipeDir: 1 | -1;
  /** Set when Undo restores a card, so the view can slide it in from where it left. */
  lastRestored: { cardKey: string; dir: 1 | -1 } | null;
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
    removeItemFromLists,
    invalidateLists,
    invalidateAfterApply,
    announce,
  } = config;

  const [phase, setPhase] = useState<Phase>('pendingApprovals');
  const [deck, setDeck] = useState<CardModel[]>([]);
  const [undoState, setUndoState] = useState<DeckUndoState>(null);
  const [approvalRequired, setApprovalRequired] = useState(false);
  // A successful apply commits decisions to Plex and clears the undo slot —
  // remembered so the button can say "changes applied" instead of the
  // misleading "nothing to undo".
  const [undoClearedByApply, setUndoClearedByApply] = useState(false);
  // Exit-throw direction and undo-entrance marker for the view's animations.
  const [lastSwipeDir, setLastSwipeDir] = useState<1 | -1>(1);
  const [lastRestored, setLastRestored] = useState<{
    cardKey: string;
    dir: 1 | -1;
  } | null>(null);
  // Which deckKey the current deck was built for (state, not a ref: the
  // render-phase init below both reads and adjusts it).
  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  // Apply is fired immediately after every decision instead of on a timer.
  // applyInFlightRef tracks a mutation actually in progress; applyQueuedRef
  // records "another swipe landed while that was running" so exactly one
  // follow-up apply covers everything, instead of one call per swipe.
  const applyInFlightRef = useRef(false);
  const applyQueuedRef = useRef(false);
  // Backoff timer for a failed apply — retries once, shortly, rather than
  // hammering a genuinely-down Radarr/Sonarr in a tight loop.
  const retryTimerRef = useRef<number | null>(null);
  // Indirection so applyMutation's own onError/onSettled can re-fire it
  // without referencing `applyMutation` from inside its own option object —
  // that self-reference defeats the React Compiler's memoization of any
  // callback (like triggerApply below) that also depends on applyMutation.
  const applyMutateRef = useRef<() => void>(() => undefined);

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
    if (
      initializedKey !== null ||
      deck.length ||
      undoState ||
      approvalRequired ||
      lastRestored
    ) {
      setInitializedKey(null);
      setDeck([]);
      setUndoState(null);
      setApprovalRequired(false);
      setLastRestored(null);
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
      setLastRestored(null);
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
    onSuccess: (_data, vars) => {
      // Keep the cache truthful for sentinel-time rebuilds without blocking
      // the next swipe on refetches: drop the item synchronously, converge
      // with server truth in the background. (The awaited invalidation here
      // was what serialized rapid triage behind two GETs per swipe.)
      if (vars.action !== 'undo') removeItemFromLists(vars.id);
      void invalidateLists();
      // Fire the real Radarr/Sonarr/Plex sync now that the decision is
      // durable, rather than waiting on a timer — see triggerApply below.
      triggerApply();
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
      setUndoState((prev) => {
        if (prev) setUndoClearedByApply(true);
        return null;
      });
      await invalidateAfterApply();
    },
    onError: (err) => {
      // Without this, a failed Plex sync was completely silent and never
      // retried while the page sat idle.
      toast.error(
        err instanceof Error
          ? `Couldn't sync your last decisions to Plex — retrying shortly. ${err.message}`
          : "Couldn't sync your last decisions to Plex — retrying shortly.",
      );
      // A single short backoff, not a hot loop: if Radarr/Sonarr is
      // genuinely down, hammering it on every failed attempt doesn't help.
      // A real swipe in the meantime re-triggers immediately anyway.
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        applyMutateRef.current();
      }, 5_000);
    },
    onSettled: () => {
      // Coalesce: if swipes landed while this call was in flight, run
      // exactly one follow-up instead of one apply per swipe.
      if (applyQueuedRef.current) {
        applyQueuedRef.current = false;
        applyMutateRef.current();
      } else {
        applyInFlightRef.current = false;
      }
    },
  });

  // Keep the ref pointing at the latest mutate closure.
  useEffect(() => {
    applyMutateRef.current = () => applyMutation.mutate();
  });

  // Fire the batched Radarr/Sonarr/Plex sync right away instead of on a
  // timer. A call already in flight absorbs anything that lands next —
  // see the mutation's onSettled above — so rapid swiping never produces
  // one overlapping external call per card.
  const triggerApply = useCallback(() => {
    if (applyInFlightRef.current) {
      applyQueuedRef.current = true;
      return;
    }
    applyInFlightRef.current = true;
    applyMutateRef.current();
  }, []);

  // Flush on deck-context change and unmount (best-effort): the cleanup runs
  // with the previous context's applyDecisions closure, so the old library's
  // pending batch is what gets applied. Only needed when work is queued but
  // nothing is actually in flight to pick it up — if a call is still
  // running, its own onSettled will apply the queued swipe regardless of
  // whether this component is still mounted.
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
      if (applyQueuedRef.current && !applyInFlightRef.current) {
        applyQueuedRef.current = false;
        void Promise.resolve(applyDecisions())
          .then(() => invalidateAfterApply())
          .catch(() => undefined);
      }
    };
  }, [applyDecisions, invalidateAfterApply]);

  // Undo still waits for an in-flight record POST: an undo racing its own
  // decision to the server could be processed first and silently lose.
  const canUndo =
    Boolean(undoState) &&
    undoState?.deckKey === deckKey &&
    !recordMutation.isPending &&
    !applyMutation.isPending;

  const undoUnavailableReason: 'nothing' | 'applied' | 'busy' =
    undoState && undoState.deckKey === deckKey
      ? 'busy'
      : undoClearedByApply
        ? 'applied'
        : 'nothing';

  const undoLast = useCallback(() => {
    if (!undoState) return;
    if (undoState.deckKey !== deckKey) return;

    const { card, phase: prevPhase, action } = undoState;
    setUndoState(null);
    setPhase(prevPhase);
    setDeck((prev) => {
      // If we currently show a sentinel because the deck ran out, replace it with the restored card.
      const rest = prev.length === 1 && prev[0]?.kind === 'sentinel' ? [] : prev;
      return [card, ...rest];
    });
    // Let the view slide the card in from the side it was thrown out.
    setLastRestored({
      cardKey: `${card.item.mediaType}:${card.item.id}`,
      dir: action === 'approve' || action === 'keep' ? 1 : -1,
    });

    recordMutation.mutate({
      id: card.item.id,
      action: 'undo',
      card,
      phase: prevPhase,
      deckKey,
    });
    announce(`Restored "${card.item.title || `item ${card.item.id}`}" to the deck.`);
    // No triggerApply() here — recordMutation.onSuccess fires it once the
    // undo is actually durable server-side. Calling it synchronously here
    // would apply the pre-undo state before the undo POST even resolves.
  }, [announce, deckKey, recordMutation, undoState]);

  const swipeTopCard = useCallback(
    (dir: SwipeDirection): boolean => {
      if (!active) return false;
      if (!librarySectionKey) return false;
      if (!deck.length) return false;
      // Neither the record POST nor the Radarr/Sonarr/Plex apply call blocks
      // swiping — apply now fires on every decision (see triggerApply) and
      // coalesces internally, so gating input on it would serialize rapid
      // triage behind the network exactly like before.

      const top = deck[0];
      if (!top) return false;

      // Sentinel: only Right is meaningful.
      if (top.kind === 'sentinel') {
        if (dir === 'left') return false;
        setUndoState(null);
        setLastSwipeDir(1);
        setLastRestored(null);
        onSentinelRight(top.sentinel, {
          setDeckForReview,
          restartCycle,
          resetDeckKey,
        });
        return true;
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
      setUndoClearedByApply(false);

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

      setLastSwipeDir(dir === 'right' ? 1 : -1);
      setLastRestored(null);
      advanceOneOrSentinel(sentinelForPhase(phase));
      return true;
    },
    [
      active,
      advanceOneOrSentinel,
      announce,
      deck,
      deckKey,
      librarySectionKey,
      onSentinelRight,
      phase,
      recordMutation,
      resetDeckKey,
      restartCycle,
      sentinelForPhase,
      setDeckForReview,
    ],
  );

  const swipeLeft = useCallback(() => swipeTopCard('left'), [swipeTopCard]);
  const swipeRight = useCallback(() => swipeTopCard('right'), [swipeTopCard]);

  // Purely local reshuffle: the deck previously forced a keep-or-remove on
  // every card, with no way to defer one you weren't sure about.
  const canSkip =
    deck.length > 1 &&
    deck[0]?.kind === 'item' &&
    deck.filter((c) => c.kind === 'item').length > 1;
  const skipTop = useCallback(() => {
    setDeck((prev) => {
      if (prev.length < 2) return prev;
      const [top, ...rest] = prev;
      if (!top || top.kind !== 'item') return prev;
      // Sit in front of the end-of-deck sentinel rather than after it.
      const sentinelAt = rest.findIndex((c) => c.kind === 'sentinel');
      if (sentinelAt === -1) return [...rest, top];
      return [...rest.slice(0, sentinelAt), top, ...rest.slice(sentinelAt)];
    });
    setLastSwipeDir(1);
    setLastRestored(null);
  }, []);

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
    skipTop,
    canSkip,
    undoLast,
    canUndo,
    undoUnavailableReason,
    recordPending: recordMutation.isPending,
    applyPending: applyMutation.isPending,
    restartCycle,
    resetDeckKey,
    lastSwipeDir,
    lastRestored,
  };
}
