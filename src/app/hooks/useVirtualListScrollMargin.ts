import { RefObject, useLayoutEffect, useState } from 'react';

/**
 * How far a virtual list starts below the top of its scroll container, for the virtualizer's
 * `scrollMargin`. Follows size changes of the container's content.
 */
export const useVirtualListScrollMargin = (
  scrollRef: RefObject<HTMLElement>,
  listRef: RefObject<HTMLElement>
): number => {
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    const listElement = listRef.current;
    if (!scrollElement || !listElement) return undefined;
    const measure = () => {
      const offset =
        listElement.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop;
      setMargin(Math.max(0, Math.round(offset)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(scrollElement);
    observer.observe(listElement);
    return () => observer.disconnect();
  }, [scrollRef, listRef]);

  return margin;
};
