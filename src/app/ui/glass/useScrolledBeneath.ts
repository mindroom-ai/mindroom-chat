import { Ref, RefCallback, useCallback, useEffect, useRef } from 'react';

export const SCROLLED_BENEATH_ATTRIBUTE = 'data-scrolled-beneath';

const scrollerOf = (element: HTMLElement): HTMLElement | null => {
  const view = element.ownerDocument.defaultView;
  for (let node = element.parentElement; node && view; node = node.parentElement) {
    if (/^(auto|scroll)$/.test(view.getComputedStyle(node).overflowY)) return node;
  }
  return null;
};

/**
 * Marks `element`, a title pinned to the top of the list that scrolls it, while that list is
 * scrolled: only then does content pass beneath the title. Returns the function that stops.
 */
export const watchScrolledBeneath = (element: HTMLElement): (() => void) => {
  const scroller = scrollerOf(element);
  if (!scroller) return () => {};
  const update = () => element.toggleAttribute(SCROLLED_BENEATH_ATTRIBUTE, scroller.scrollTop > 0);
  update();
  scroller.addEventListener('scroll', update, { passive: true });
  return () => {
    scroller.removeEventListener('scroll', update);
    element.removeAttribute(SCROLLED_BENEATH_ATTRIBUTE);
  };
};

/** A ref that keeps `watchScrolledBeneath` on its element while `enabled`. */
export const useScrolledBeneath = <T extends HTMLElement>(
  forwardedRef: Ref<T> | undefined,
  enabled: boolean
): RefCallback<T> => {
  const element = useRef<T | null>(null);
  const stop = useRef<(() => void) | undefined>();
  useEffect(() => {
    // React 18 StrictMode replays effects without replaying DOM refs.
    if (enabled && element.current && !stop.current) {
      stop.current = watchScrolledBeneath(element.current);
    }
    return () => {
      stop.current?.();
      stop.current = undefined;
    };
  }, [enabled]);

  return useCallback(
    (node: T | null) => {
      stop.current?.();
      stop.current = undefined;
      element.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) (forwardedRef as { current: T | null }).current = node;
      if (enabled && node) stop.current = watchScrolledBeneath(node);
    },
    [enabled, forwardedRef]
  );
};
