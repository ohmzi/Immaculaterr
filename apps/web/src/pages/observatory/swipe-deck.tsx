import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  AnimatePresence,
  motion,
  useAnimation,
  useMotionValue,
  useTransform,
  type PanInfo,
} from 'motion/react';
import { Check, ChevronUp, ExternalLink, Undo2, X } from 'lucide-react';

import { APP_BG_IMAGE_URL } from '@/lib/ui-classes';
import { cn } from '@/components/ui/utils';
import type { ObservatoryItem } from '@/api/observatory';
import type { CardModel, Phase, SwipeDeckApi } from './use-swipe-deck';

const NOOP = () => undefined;

// One exit path for every removal — pointer throw, keyboard, action buttons,
// undo replacing the top card — driven by the deck's last swipe direction via
// AnimatePresence custom. zIndex lifts the leaver above the incoming top card.
const STACK_EXIT_VARIANTS = {
  exit: (dir: 1 | -1) => ({
    x: dir * 560,
    rotate: dir * 18,
    opacity: 0,
    zIndex: 60,
    transition: { type: 'spring' as const, stiffness: 520, damping: 34, mass: 0.55 },
  }),
};

function LoadingPlaceholder() {
  return (
    <div
      role="status"
      aria-label="Loading suggestions"
      className="relative h-full overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/70 shadow-2xl backdrop-blur-2xl"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-white/20 border-t-[#facc15] animate-spin" />
          <div className="text-white/50 text-sm font-medium">Loading suggestions…</div>
        </div>
      </div>
    </div>
  );
}

function formatRating(v: unknown): string | null {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
  if (n === null) return null;
  // TMDB vote_average is /10; show 1 decimal.
  const rounded = Math.round(n * 10) / 10;
  if (!Number.isFinite(rounded) || rounded <= 0) return null;
  return `${rounded.toFixed(1)}/10`;
}

function formatSentDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * The API's raw enums (`pending`/`active`, `none`/`pending`/`approved`/
 * `rejected`) were rendered verbatim; these turn them into something that
 * says what it means for the item in front of you.
 */
function statusChip(item: ObservatoryItem): { label: string; className: string } {
  return item.status === 'active'
    ? {
        label: 'In your collection',
        className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
      }
    : {
        label: 'Suggested, not added yet',
        className: 'border-white/15 bg-white/5 text-white/75',
      };
}

function approvalChip(
  item: ObservatoryItem,
): { label: string; className: string } | null {
  switch (item.downloadApproval) {
    case 'pending':
      return {
        label: 'Download awaiting approval',
        className: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
      };
    case 'approved':
      return {
        label: 'Download approved',
        className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
      };
    case 'rejected':
      return {
        label: 'Download rejected',
        className: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
      };
    default:
      return null;
  }
}

/** TMDB page for the item — movies key off `id`, TV needs the optional `tmdbId`. */
function tmdbUrl(item: ObservatoryItem): string | null {
  if (item.mediaType === 'movie') {
    return item.id > 0 ? `https://www.themoviedb.org/movie/${item.id}` : null;
  }
  const tv = item.tmdbId;
  return typeof tv === 'number' && tv > 0
    ? `https://www.themoviedb.org/tv/${tv}`
    : null;
}

/**
 * Everything known about the item beyond title + poster. Shared by the desktop
 * detail pane and the mobile tap-to-expand sheet so they can't drift.
 */
function CardDetails({
  item,
  phase,
  onLinkPointerDown,
}: {
  item: ObservatoryItem;
  phase: Phase;
  onLinkPointerDown: (event: ReactPointerEvent<HTMLAnchorElement>) => void;
}) {
  const status = statusChip(item);
  const approval = approvalChip(item);
  const sentAt = formatSentDate(
    item.mediaType === 'movie' ? item.sentToRadarrAt : item.sentToSonarrAt,
  );
  const points = Number.isFinite(item.points) ? Math.round(item.points) : null;
  const url = tmdbUrl(item);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <span
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] font-bold',
            status.className,
          )}
        >
          {status.label}
        </span>
        {approval ? (
          <span
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-bold',
              approval.className,
            )}
          >
            {approval.label}
          </span>
        ) : null}
      </div>

      <dl className="space-y-1 text-sm text-white/70">
        {points !== null && points > 0 ? (
          <div className="flex gap-2">
            <dt>Match strength</dt>
            <dd className="text-white/90 font-semibold">{points} pts</dd>
          </div>
        ) : null}
        {sentAt ? (
          <div className="flex gap-2">
            <dt>Sent to {item.mediaType === 'movie' ? 'Radarr' : 'Sonarr'}</dt>
            <dd className="text-white/90 font-semibold">{sentAt}</dd>
          </div>
        ) : null}
      </dl>

      {url ? (
        // Research before deciding — a wrong left-swipe is a permanent
        // blocklist entry, and the card alone is thin evidence.
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          onPointerDown={onLinkPointerDown}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/85 transition hover:bg-white/10"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Look up on TMDB
        </a>
      ) : null}

      <div className="text-xs text-white/55 leading-relaxed">
        {phase === 'pendingApprovals'
          ? 'Swipe right to approve the download. Swipe left to reject.'
          : 'Swipe right to keep. Swipe left to remove.'}
      </div>
    </div>
  );
}

export function SwipeCard({
  card,
  disabled,
  phase = 'review',
  onSwipeLeft,
  onSwipeRight,
}: {
  card: CardModel;
  disabled?: boolean;
  // A right-swipe means "approve this download request" during pendingApprovals
  // but "keep in the collection" during review — the badges and hint copy must
  // say which one, or the gesture is mislabeled for half the session.
  phase?: Phase;
  // A false return means "nothing happened" — the card springs back instead of
  // being left stranded at its drag offset. void counts as handled.
  onSwipeLeft: () => boolean | void;
  onSwipeRight: () => boolean | void;
}) {
  const rightLabel = phase === 'pendingApprovals' ? 'Approve' : 'Keep';
  const leftLabel = phase === 'pendingApprovals' ? 'Reject' : 'Remove';
  // Every sentinel ignores left swipes in the deck handlers, so committing the
  // throw animation would just teleport the card back — spring home instead.
  const allowLeft = card.kind !== 'sentinel';
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-10, 0, 10]);
  // Floor at 0.35 while dragging: the card (and the badges/tints inside it)
  // must stay visible under the finger — the throw animation owns the fade
  // to zero once a swipe commits.
  const opacity = useTransform(x, [-240, -80, 0, 80, 240], [0.35, 1, 1, 1, 0.35]);
  // Badges reach full opacity exactly at the commit threshold (120), so a
  // fully lit badge always means "release commits this".
  const likeOpacity = useTransform(x, [40, 120], [0, 1]);
  const nopeOpacity = useTransform(x, [-120, -40], [1, 0]);
  // The tint layers are /40-alpha fills, so the effective tint is motion
  // opacity × 0.4 — the old 0.28 ceiling meant a barely-there 11%.
  const greenTintOpacity = useTransform(x, [0, 70, 180], [0, 0.22, 0.45]);
  const redTintOpacity = useTransform(x, [0, -70, -180], [0, 0.22, 0.45]);

  const controls = useAnimation();
  // Mobile has no room for a detail pane, so the metadata lives behind a
  // pull-up sheet on the caption bar.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Defensive pointer-capture handling:
  // Some mobile browsers + heavy drag interactions can end up in a "stuck" state where taps stop
  // dispatching correctly after a swipe interaction. Explicitly capturing/releasing the pointer
  // (and releasing on unmount) prevents lingering capture from blocking future UI interaction.
  const pointerCaptureRef = useRef<{ el: HTMLDivElement; pointerId: number } | null>(
    null,
  );

  const releasePointerCapture = useCallback(() => {
    const p = pointerCaptureRef.current;
    if (!p) return;
    try {
      p.el.releasePointerCapture(p.pointerId);
    } catch {
      // ignore
    }
    pointerCaptureRef.current = null;
  }, []);

  useEffect(() => {
    return () => releasePointerCapture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const threshold = 120;
  const springBack = useMemo(
    () => ({ type: 'spring' as const, stiffness: 420, damping: 28 }),
    [],
  );
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Ensure we always release capture on pointerup/cancel/unmount.
      pointerCaptureRef.current = {
        el: event.currentTarget,
        pointerId: event.pointerId,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    },
    [],
  );
  const handlePointerRelease = useCallback(() => {
    releasePointerCapture();
  }, [releasePointerCapture]);
  const stopPointerPropagation = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      // Keep CTA presses out of the drag machinery: without this the card's
      // pointer capture swallows the click.
      event.stopPropagation();
    },
    [],
  );
  const stopLinkPointerPropagation = useCallback(
    (event: ReactPointerEvent<HTMLAnchorElement>) => {
      event.stopPropagation();
    },
    [],
  );
  const toggleDetails = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      setDetailsOpen((v) => !v);
    },
    [],
  );
  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      // Some browsers may fire dragEnd without a clean pointerup; ensure capture is released.
      releasePointerCapture();
      if (disabled) {
        // disabled can flip mid-drag (the debounced apply firing); without a
        // spring-back the card strands frozen at its drag offset.
        void controls.start({ x: 0, rotate: 0, transition: springBack });
        return;
      }
      // A flick is intent too: project ~250ms of release velocity onto the
      // offset so a fast short flick commits and a slow overshoot still counts.
      const projectedX = info.offset.x + info.velocity.x * 0.25;
      const springHome = () => {
        void controls.start({ x: 0, rotate: 0, transition: springBack });
      };
      // Commit immediately: the deck advances and this card unmounts through
      // the stack's AnimatePresence exit throw (which starts from the drag
      // offset, since this inner transform is preserved during the exit).
      // The old imperative throw-then-advance kept the next card locked out
      // until the animation finished — and its .finally reset was the source
      // of the boomerang/blink glitches.
      if (info.offset.x > threshold || projectedX > threshold) {
        if (onSwipeRight() === false) springHome();
        return;
      }
      if (info.offset.x < -threshold || projectedX < -threshold) {
        if (!allowLeft) {
          springHome();
          return;
        }
        if (onSwipeLeft() === false) springHome();
        return;
      }
      springHome();
    },
    [
      allowLeft,
      controls,
      disabled,
      onSwipeLeft,
      onSwipeRight,
      releasePointerCapture,
      springBack,
      threshold,
    ],
  );

  return (
    <motion.div
      animate={controls}
      drag={disabled ? false : 'x'}
      dragMomentum={false}
      // pan-y: the browser owns vertical panning (so a thumb resting on the
      // card — which fills most of a phone screen — can still scroll the page)
      // while Motion direction-locks horizontal drags for the swipe. pan-x
      // forbade vertical scroll entirely, and the page has no horizontal pan.
      style={{ x, rotate, opacity, touchAction: 'pan-y' }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerRelease}
      onPointerCancel={handlePointerRelease}
      onDragEnd={handleDragEnd}
      className="relative w-full h-full"
    >
      <div className="relative h-full overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/70 shadow-2xl backdrop-blur-2xl">
        {/* Swipe tint feedback. Sentinels only answer to right swipes, so the
            red layer would promise a rejection that never happens. */}
        <div className="pointer-events-none absolute inset-0 z-20">
          <motion.div
            style={{ opacity: greenTintOpacity }}
            className="absolute inset-0 bg-emerald-400/40"
          />
          {allowLeft ? (
            <motion.div
              style={{ opacity: redTintOpacity }}
              className="absolute inset-0 bg-rose-400/40"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/15 via-transparent to-black/10" />
        </div>

        {card.kind !== 'sentinel' ? (
          <div className="absolute inset-0 pointer-events-none z-30">
            <motion.div
              style={{ opacity: likeOpacity }}
              className="absolute top-8 left-6 -rotate-12 rounded-xl border-2 border-emerald-400/60 bg-emerald-400/15 px-4 py-1.5 text-xl md:text-2xl font-black uppercase tracking-wider text-emerald-100"
            >
              {rightLabel}
            </motion.div>
            <motion.div
              style={{ opacity: nopeOpacity }}
              className="absolute top-8 right-6 rotate-12 rounded-xl border-2 border-rose-400/60 bg-rose-400/15 px-4 py-1.5 text-xl md:text-2xl font-black uppercase tracking-wider text-rose-100"
            >
              {leftLabel}
            </motion.div>
          </div>
        ) : null}

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

            {/* A real button, not instruction text: keyboard and screen-reader
                users (and anyone who'd rather tap) can advance the flow without
                performing a drag gesture. */}
            <div className="absolute inset-x-0 bottom-0 min-h-[64px] bg-[#0b0c0f]/80 backdrop-blur-2xl border-t border-white/10 flex items-center justify-center px-5 py-3">
              <button
                type="button"
                disabled={disabled}
                onClick={onSwipeRight}
                onPointerDown={stopPointerPropagation}
                className="h-11 rounded-2xl px-5 border text-sm font-bold transition active:scale-[0.98] border-[#facc15]/30 bg-[#facc15]/15 text-[#fde68a] hover:bg-[#facc15]/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {card.ctaLabel ??
                  (card.sentinel === 'approvalsDone'
                    ? 'Review suggestions'
                    : card.sentinel === 'noData'
                      ? 'Check again'
                      : 'Restart reviewing')}
              </button>
            </div>
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

              {/* Bottom caption, expanding into a details sheet on tap */}
              <div className="absolute inset-x-0 bottom-0 bg-[#0b0c0f]/85 backdrop-blur-2xl border-t border-white/10">
                <div className="flex min-h-[56px] items-center gap-3 px-5">
                  <div className="min-w-0 flex-1 text-white font-semibold text-sm leading-tight line-clamp-1">
                    {card.item.title ||
                      (card.item.mediaType === 'movie'
                        ? `TMDB ${card.item.id}`
                        : `TVDB ${card.item.id}`)}
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {/* The mobile caption is the only cue for what a swipe does. */}
                    <div
                      className={cn(
                        'rounded-xl border px-2 py-1 text-[10px] font-bold uppercase tracking-wider',
                        phase === 'pendingApprovals'
                          ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                          : 'border-white/10 bg-white/5 text-white/60',
                      )}
                    >
                      {phase === 'pendingApprovals' ? 'Request' : 'Cleanup'}
                    </div>
                    {formatRating(card.item.tmdbVoteAvg ?? null) && (
                      <div className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold text-white/90">
                        {formatRating(card.item.tmdbVoteAvg ?? null)}
                      </div>
                    )}
                    <button
                      type="button"
                      onPointerDown={toggleDetails}
                      aria-expanded={detailsOpen}
                      aria-label={detailsOpen ? 'Hide details' : 'Show details'}
                      title={detailsOpen ? 'Hide details' : 'Show details'}
                      className="rounded-xl border border-white/10 bg-white/5 p-1.5 text-white/70 transition hover:bg-white/10"
                    >
                      <ChevronUp
                        className={cn(
                          'h-4 w-4 transition-transform',
                          detailsOpen && 'rotate-180',
                        )}
                      />
                    </button>
                  </div>
                </div>
                {detailsOpen ? (
                  <div className="border-t border-white/10 px-5 py-4">
                    <CardDetails
                      item={card.item}
                      phase={phase}
                      onLinkPointerDown={stopLinkPointerPropagation}
                    />
                  </div>
                ) : null}
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
              <div className="p-10 flex flex-col h-full">
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
                <div className="mt-5">
                  <CardDetails
                    item={card.item}
                    phase={phase}
                    onLinkPointerDown={stopLinkPointerPropagation}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Deck view: fixed frame + top-3 stack + fallback + action row
// ---------------------------------------------------------------------------

export function SwipeDeckView({
  api,
  isLoading,
  fallbackCard,
  onFallbackAdvance,
}: {
  api: SwipeDeckApi;
  /** List queries still fetching (shown only while the deck is empty). */
  isLoading: boolean;
  /** Card to show when the deck is empty and not loading (always a sentinel). */
  fallbackCard: CardModel;
  /** Advance action for the fallback card — the deck handlers no-op on an empty deck. */
  onFallbackAdvance: () => void;
}) {
  // Only the batched apply blocks interaction — a decision POST in flight no
  // longer locks the deck, so rapid triage isn't serialized on the network.
  const busy = api.applyPending;
  const topIsItem = api.deck[0]?.kind === 'item';
  const leftActionLabel =
    api.phase === 'pendingApprovals' ? 'Reject download request' : 'Remove from collection';
  const rightActionLabel =
    api.phase === 'pendingApprovals' ? 'Approve download request' : 'Keep in collection';

  return (
    <div className="mt-6">
      {/* Fixed frame prevents layout jitter while cards animate/throw off-screen */}
      <div
        aria-busy={busy}
        className="relative mx-auto max-w-3xl h-[max(380px,min(540px,calc(100dvh-21rem)))] md:h-[max(480px,min(720px,calc(100dvh-23rem)))] overflow-visible"
      >
        {api.deck.length ? (
          <div className="relative h-full">
            {/* Render a small stack: top 3 */}
            <AnimatePresence initial={false} custom={api.lastSwipeDir}>
              {api.deck
                .slice(0, 3)
                .reverse()
                .map((card, idx, arr) => {
                  const isTop = idx === arr.length - 1;
                  const depth = arr.length - 1 - idx;
                  // Make the waiting-deck feel obvious (without being distracting).
                  const scale = 1 - depth * 0.045;
                  const y = depth * 18;
                  const opacity = 1 - depth * 0.14;
                  const rotate = depth === 0 ? 0 : depth % 2 === 0 ? 0.35 : -0.35;
                  const restored =
                    card.kind === 'item' &&
                    api.lastRestored?.cardKey ===
                      `${card.item.mediaType}:${card.item.id}`
                      ? api.lastRestored
                      : null;
                  return (
                    <motion.div
                      key={
                        card.kind === 'sentinel'
                          ? `${api.deckKey}:sentinel:${card.sentinel}`
                          : `${api.deckKey}:${card.item.mediaType}:${card.item.id}`
                      }
                      // Undo mounts the restored card sliding in from the side
                      // it was thrown out; everything else appears in place.
                      initial={
                        restored
                          ? {
                              x: restored.dir * 560,
                              rotate: restored.dir * 18,
                              opacity: 0,
                            }
                          : false
                      }
                      animate={{ scale, y, opacity, rotate, x: 0 }}
                      exit="exit"
                      variants={STACK_EXIT_VARIANTS}
                      custom={api.lastSwipeDir}
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      // Scale about the bottom edge so the y-offset shows as a real
                      // rim below the top card — center-origin scaling swallowed
                      // nearly all of it and the stack read as a single card.
                      style={{ zIndex: 50 - depth, transformOrigin: 'bottom center' }}
                      aria-hidden={!isTop}
                      className={cn('absolute inset-0', !isTop && 'pointer-events-none')}
                    >
                      <SwipeCard
                        card={card}
                        disabled={!isTop || busy}
                        phase={api.phase}
                        onSwipeLeft={api.swipeLeft}
                        onSwipeRight={api.swipeRight}
                      />
                    </motion.div>
                  );
                })}
            </AnimatePresence>
          </div>
        ) : isLoading ? (
          <div className="absolute inset-0">
            <LoadingPlaceholder />
          </div>
        ) : (
          <div className="absolute inset-0">
            <SwipeCard
              card={fallbackCard}
              phase={api.phase}
              onSwipeLeft={NOOP}
              onSwipeRight={onFallbackAdvance}
            />
          </div>
        )}
      </div>

      <div className="mx-auto max-w-3xl mt-4 flex items-center justify-center gap-3">
        {api.itemsLeft > 0 ? (
          <div className="text-xs font-semibold text-white/50 tabular-nums">
            {api.itemsLeft} left
          </div>
        ) : null}
        <button
          type="button"
          onClick={api.swipeLeft}
          disabled={!topIsItem || busy}
          className="h-11 w-11 rounded-2xl border flex items-center justify-center transition active:scale-[0.98] border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={leftActionLabel}
          title={leftActionLabel}
        >
          <X className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={api.undoLast}
          disabled={!api.canUndo}
          className={cn(
            'h-11 rounded-2xl px-4 border text-sm font-bold transition active:scale-[0.98] flex items-center gap-2',
            api.canUndo
              ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
              : 'border-white/10 bg-white/5 text-white/35 cursor-not-allowed',
          )}
          aria-label="Undo last swipe"
          title={api.canUndo ? 'Undo last swipe' : 'Nothing to undo'}
        >
          <Undo2 className="h-4 w-4" />
          Undo
        </button>
        <button
          type="button"
          onClick={api.swipeRight}
          disabled={!topIsItem || busy}
          className="h-11 w-11 rounded-2xl border flex items-center justify-center transition active:scale-[0.98] border-emerald-400/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={rightActionLabel}
          title={rightActionLabel}
        >
          <Check className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
