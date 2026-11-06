import { type RefObject, useLayoutEffect } from 'react';

/**
 * Says on a sideways scroller whether it has more to show before its start (`data-more-start`)
 * and past its end (`data-more-end`), in reading order. In a right-to-left row `scrollLeft` is 0
 * at the start and turns negative toward the end.
 */
export const markInlineOverflow = (element: HTMLElement): void => {
  const { scrollLeft, scrollWidth, clientWidth } = element;
  const fromStart = Math.abs(scrollLeft);
  element.toggleAttribute('data-more-start', fromStart > 0.5);
  element.toggleAttribute('data-more-end', fromStart + clientWidth < scrollWidth - 0.5);
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
