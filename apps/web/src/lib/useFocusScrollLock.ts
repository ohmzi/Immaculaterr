import { useCallback, useRef, type FocusEvent } from 'react';

// How much of the newly focused field has to stay on screen for the scroll to
// be worth undoing — about half an input. Below that the browser's scroll is
// doing real work (the field is off screen) and is left alone.
const MIN_VISIBLE_PX = 24;

/**
 * Keeps a scroll container still when focus moves between the fields inside it.
 *
 * Browsers scroll the nearest scrollable ancestor to reveal a field that just
 * took focus, which is what makes a form slide up and down as the user moves
 * between inputs. The scroll happens during the focusing steps, so the
 * pre-focus position is captured on the interaction that *causes* the focus
 * (pointer down, or Tab) and restored once focus lands — restoring it from the
 * same task means the browser never paints the intermediate position.
 *
 * The scroll is left in place when undoing it would push the focused field off
 * screen, so a field below the fold still gets revealed and nobody ends up
 * typing blind. Scrolling by hand keeps working too: every interaction
 * re-captures the position, so only the browser's focus scroll is undone.
 *
 * Spread the returned props onto the scroll container.
 */
export function useFocusScrollLock<T extends HTMLElement>() {
  const elementRef = useRef<T | null>(null);
  const restoreTo = useRef(0);

  const remember = useCallback(() => {
    const element = elementRef.current;
    if (element) restoreTo.current = element.scrollTop;
  }, []);

  const restore = useCallback((event: FocusEvent<T>) => {
    const element = elementRef.current;
    if (!element) return;

    const scrolledBy = element.scrollTop - restoreTo.current;
    if (scrolledBy === 0) return;

    const field = event.target;
    if (field instanceof HTMLElement) {
      // Undoing the scroll shifts the field back down by the same amount.
      const fieldBox = field.getBoundingClientRect();
      const containerBox = element.getBoundingClientRect();
      const visible =
        Math.min(fieldBox.bottom + scrolledBy, containerBox.bottom) -
        Math.max(fieldBox.top + scrolledBy, containerBox.top);
      if (visible < MIN_VISIBLE_PX) {
        // Let the browser keep this one, and hold the new position from here on.
        restoreTo.current = element.scrollTop;
        return;
      }
    }

    element.scrollTop = restoreTo.current;
  }, []);

  return {
    ref: elementRef,
    onPointerDownCapture: remember,
    onKeyDownCapture: remember,
    onFocusCapture: restore,
  };
}
