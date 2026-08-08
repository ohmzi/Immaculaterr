import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pins a `position: fixed` element to the *visible* viewport.
 *
 * Mobile browsers do not shrink the layout viewport when the software keyboard
 * opens — they shrink and scroll the visual viewport instead. A full-height
 * fixed shell therefore keeps a height that runs behind the keyboard, and the
 * browser scrolls the page to reveal whichever field just took focus. That
 * scroll is what makes a vertically centered card slide up and down as focus
 * moves between fields.
 *
 * Sizing the element to `visualViewport.height` and offsetting it by
 * `visualViewport.offsetTop` keeps it glued over the area the user can actually
 * see, so a card centered inside it stays put no matter which field is focused.
 *
 * Returns a ref callback to attach to the element. No-op on browsers without
 * `visualViewport`, where the element keeps its CSS height.
 */
export function useVisualViewportPin<T extends HTMLElement>() {
  const elementRef = useRef<T | null>(null);
  // Bumped on attach/detach so the effect re-binds when the node changes.
  const [attachCount, setAttachCount] = useState(0);

  const setElement = useCallback((node: T | null) => {
    elementRef.current = node;
    setAttachCount((count) => count + 1);
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    const viewport = window.visualViewport;
    if (!element || !viewport) return;

    const sync = () => {
      element.style.height = `${viewport.height}px`;
      element.style.top = `${viewport.offsetTop}px`;
    };

    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);

    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
      element.style.height = '';
      element.style.top = '';
    };
  }, [attachCount]);

  return setElement;
}
