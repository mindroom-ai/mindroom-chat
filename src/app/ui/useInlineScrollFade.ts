import { type RefObject, useLayoutEffect } from 'react';

/**
 * Says on a sideways scroller whether it has more to show before its start (`data-more-start`)
 * and past its end (`data-more-end`), in reading order. In a right-to-left row `scrollLeft` is 0
 * at the start and turns negative toward the end.
 */
export const markInlineOverflow = (element: HTMLElement): void => {
  const { scrollLeft, scrollWidth, clientWidth } = element;
  // More than a pixel each way: fractional layout leaves a row at an edge up to a pixel short of
  // it (Chromium stops a right-to-left row a pixel before its end).
  const fromStart = Math.abs(scrollLeft);
  element.toggleAttribute('data-more-start', fromStart > 1);
  element.toggleAttribute('data-more-end', scrollWidth - clientWidth - fromStart > 1);
};

/** Keeps the marks of {@link markInlineOverflow} current as the row scrolls or changes size. */
export const useInlineScrollFade = (ref: RefObject<HTMLElement>): void => {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const mark = () => markInlineOverflow(element);
    mark();
    element.addEventListener('scroll', mark, { passive: true });
    // The row's items change width with the language, which leaves the row's own size alone.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(mark);
    observer?.observe(element);
    Array.from(element.children).forEach((child) => observer?.observe(child));
    return () => {
      element.removeEventListener('scroll', mark);
      observer?.disconnect();
    };
  }, [ref]);
};
