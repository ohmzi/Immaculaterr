import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowDown, Info, X } from 'lucide-react';

import type { LargeFileItem } from '@/api/cutting-room';
import type { FaqReturnState } from '@/lib/faq-feature-links';
import { useSafeNavigate } from '@/lib/navigation';
import { fmtBytes, lfItemKey, SHIFT_RANGE_HINT, useShiftRangeSelect } from './shared';

export function TagPillInput(props: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const { value, onChange, placeholder, ariaLabel } = props;
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    const additions = raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && !value.includes(t));
    if (additions.length > 0) onChange([...value, ...additions]);
    setDraft('');
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 w-full rounded-xl bg-black/30 border border-white/15 px-2 py-1.5 focus-within:border-[#facc15]/50"
      onClick={(e) => {
        const input = (e.currentTarget as HTMLElement).querySelector('input');
        input?.focus();
      }}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-white/10 border border-white/10 px-2.5 py-1 text-xs font-semibold text-white/85"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((t) => t !== tag));
            }}
            className="rounded-full p-0.5 text-white/50 hover:text-white hover:bg-white/15 transition"
            aria-label={`Remove tag ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const next = e.target.value;
          if (next.includes(',')) commit(next);
          else setDraft(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft);
        }}
        placeholder={value.length === 0 ? placeholder : ''}
        aria-label={ariaLabel}
        className="flex-1 min-w-[8rem] bg-transparent px-1 py-1 text-sm text-white placeholder:text-white/30 focus:outline-none"
      />
    </div>
  );
}

export function FaqPill(props: { section: string; label: string }) {
  const navigate = useSafeNavigate();
  const location = useLocation();
  const returnState: FaqReturnState = {
    featureReturnTo: location.pathname,
    featureReturnAnchor: props.section,
  };
  return (
    <button
      type="button"
      onClick={() => void navigate(`/faq#${props.section}`, { state: returnState })}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold leading-none text-white/75 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs"
      aria-label={`Open FAQ for ${props.label}`}
      title={`Open FAQ for ${props.label}`}
    >
      <Info className="h-3.5 w-3.5 shrink-0" />
      <span className="max-[420px]:hidden">FAQ</span>
    </button>
  );
}

/**
 * Vertical band above the viewport bottom that the floating button itself
 * occupies (its `bottom` offset plus its height, plus breathing room). The
 * action row only counts as "on screen" once it clears this band, so the button
 * never hides while still covering the thing it points at — and so the show/hide
 * decision has ~170px of hysteresis instead of flipping on a single subpixel.
 */
const JUMP_BUTTON_CLEARANCE_PX = 168;

/**
 * Floating shortcut down to a wizard step's action row.
 *
 * The candidate lists run to hundreds of rows, so once something is selected the
 * Continue button can be several screens below the fold. This appears only when
 * there is a selection *and* the action row is not on screen, and scrolls to it.
 *
 * Portaled to the body: cutting-room content lives inside a backdrop-filter
 * card, which would otherwise become the containing block for this fixed button
 * and clip it away.
 *
 * Stays mounted and animates between shown/hidden rather than mounting through
 * AnimatePresence: a fixed element gets its own compositor layer, and creating
 * and tearing that down on every appearance is visible as a hitch. `initial`
 * is false so the first paint snaps to the hidden state without an entrance.
 *
 * Only `transition-colors` here, never Tailwind's `transition` — that shorthand
 * covers opacity/transform/translate/scale/backdrop-filter, i.e. everything
 * Motion drives, so the browser would re-interpolate each of Motion's per-frame
 * writes over 150ms. The rendered value then lags the timeline and gets cut off
 * mid-fade, which reads as a flash.
 */
export function JumpToActionButton(props: {
  active: boolean;
  targetRef: RefObject<HTMLElement | null>;
  label: string;
}) {
  const { active, targetRef, label } = props;
  // Starts true so the button stays hidden until the observer has actually
  // measured the row. Observed regardless of `active` so the flag can never go
  // stale between selection cycles and mount the button on an old measurement.
  const [rowOnScreen, setRowOnScreen] = useState(true);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => setRowOnScreen(entry.isIntersecting),
      { rootMargin: `0px 0px -${JUMP_BUTTON_CLEARANCE_PX}px 0px` },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetRef]);

  const handleClick = useCallback(() => {
    targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [targetRef]);

  const visible = active && !rowOnScreen;

  return createPortal(
    <motion.button
      type="button"
      onClick={handleClick}
      initial={false}
      animate={
        visible ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 8, scale: 0.96 }
      }
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      whileTap={{ scale: 0.95 }}
      style={{ pointerEvents: visible ? 'auto' : 'none' }}
      className="fixed bottom-28 right-4 z-20 inline-flex items-center gap-2 rounded-full border border-[#facc15]/30 bg-[#0F0B15]/95 px-4 py-3 text-sm font-bold text-[#facc15] shadow-[0_0_24px_rgba(250,204,21,0.18)] transition-colors hover:bg-[#15101f] hover:text-[#fde68a] touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-[#facc15]/40 sm:bottom-8 sm:right-6"
      aria-label={`Jump to ${label}`}
      title={`Jump to ${label}`}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
    >
      <ArrowDown className="h-4 w-4" />
      {label}
    </motion.button>,
    document.body,
  );
}

export function LargeFilesTable(props: {
  items: LargeFileItem[];
  selectedKeys: Set<string>;
  onSelect: (keys: string[], selected: boolean) => void;
}) {
  const { items, selectedKeys, onSelect } = props;
  const rangeFor = useShiftRangeSelect(items);
  const handleRowClick = (index: number, shiftKey: boolean) => {
    const nextSelected = !selectedKeys.has(lfItemKey(items[index]));
    const [from, to] = rangeFor(index, shiftKey);
    const keys: string[] = [];
    for (let i = from; i <= to; i += 1) keys.push(lfItemKey(items[i]));
    onSelect(keys, nextSelected);
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-white/5 text-white/60 text-xs uppercase">
          <tr>
            <th className="p-3 text-left w-10" />
            <th className="p-3 text-left">Title</th>
            <th className="p-3 text-left">Type</th>
            <th className="p-3 text-right">Size</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const key = lfItemKey(item);
            return (
              <tr key={key} className="border-t border-white/5">
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(key)}
                    onClick={(e) => handleRowClick(index, e.shiftKey)}
                    onChange={() => undefined}
                    onMouseDown={(e) => {
                      if (e.shiftKey) e.preventDefault();
                    }}
                    className="h-4 w-4 accent-[#facc15]"
                    aria-label={`Select ${item.title}`}
                    title={SHIFT_RANGE_HINT}
                  />
                </td>
                <td
                  className="p-3 font-semibold text-white"
                  title={item.path ?? undefined}
                >
                  {item.kind === 'episode' && item.showTitle ? (
                    <>
                      {item.showTitle}
                      <span className="text-white/40">
                        {' '}
                        {item.seasonNumber !== null && item.episodeNumber !== null
                          ? `S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')} · `
                          : '· '}
                      </span>
                      <span className="text-white/70">{item.title}</span>
                    </>
                  ) : (
                    item.title
                  )}
                </td>
                <td className="p-3 text-white/60">{item.kind}</td>
                <td className="p-3 text-right font-mono text-white/80">
                  {fmtBytes(item.sizeBytes)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


// ---------------------------------------------------------------------------

