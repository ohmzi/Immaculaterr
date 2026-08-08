import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Portals floating content (menus, popovers) to document.body and positions it
 * with `position: fixed` against an anchor element. Escapes any ancestor with
 * `overflow: hidden/auto`, flips to the side with more room, and clamps its own
 * max-height to whatever space is actually available so it never renders
 * off-screen on small viewports.
 *
 * Mount/unmount this component the same way you would the floating element
 * itself (e.g. `{open && <AnchoredFloatingPanel>...}` inside `AnimatePresence`)
 * — it has no internal open/closed state, so exit animations on a `motion`
 * child keep working normally.
 */
export function AnchoredFloatingPanel(props: {
  getAnchorEl: () => HTMLElement | null;
  preferredSide?: 'top' | 'bottom';
  align?: 'left' | 'right';
  gap?: number;
  zIndex?: number;
  children: ReactNode;
}) {
  const { getAnchorEl, preferredSide = 'bottom', align = 'left', gap = 8, zIndex = 10000, children } = props;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  const recomputePosition = useCallback(() => {
    const anchorEl = getAnchorEl();
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    const margin = 8;
    const minUsable = 120;
    const spaceBelow = window.innerHeight - r.bottom - gap - margin;
    const spaceAbove = r.top - gap - margin;
    const openBelow =
      preferredSide === 'bottom'
        ? spaceBelow >= minUsable || spaceBelow >= spaceAbove
        : !(spaceAbove >= minUsable || spaceAbove >= spaceBelow);

    const maxHeight = Math.max(minUsable, openBelow ? spaceBelow : spaceAbove);
    const top = openBelow ? r.bottom + gap : Math.max(margin, r.top - gap - maxHeight);

    const contentWidth = contentRef.current?.offsetWidth ?? 0;
    const rawLeft = align === 'left' ? r.left : r.right - contentWidth;
    const left = Math.min(Math.max(rawLeft, margin), Math.max(margin, window.innerWidth - contentWidth - margin));

    setPos({ left, top, maxHeight });
  }, [getAnchorEl, align, gap, preferredSide]);

  useLayoutEffect(() => {
    // Position is a measurement of an externally-owned DOM node (the anchor,
    // reached through a getter because it lives in a ref map one component
    // up), not state derivable during render — this is the "synchronize
    // with an external system" case the rule's own docs carve out, it just
    // can't be proven across this component boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    recomputePosition();
  }, [recomputePosition, children]);

  useEffect(() => {
    const onScrollOrResize = () => recomputePosition();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [recomputePosition]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={contentRef}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        maxHeight: pos.maxHeight,
        overflow: 'auto',
        overscrollBehavior: 'contain',
        zIndex,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
