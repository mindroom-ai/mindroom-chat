import { type RefObject, useEffect } from 'react';

/**
 * Keeps the scroll position from ending past where the list will end. Rows that shrank are still
 * counted in the list's rendered height until React renders it (`pendingListShrinkPx`), so in a
 * frame where the composer's inset shrinks or the content grows, the browser's own clamp and a
 * follow to the end can stop below the newest row and paint a blank band above the composer.
 * This observer of the content and of the footer probe is created after the timeline's other
 * observers, so it runs after them in each pass of the browser's ResizeObserver loop, and clamps
 * the position to that end before the paint.
 */
export function useListEndClamp(
  scroll: HTMLElement | null,
  contentRef: RefObject<HTMLElement>,
  probeRef: RefObject<HTMLElement>,
  pendingListShrinkPx: () => number
): void {
  useEffect(() => {
    const content = contentRef.current;
    const probe = probeRef.current;
    if (!scroll || !content || !probe || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const end = scroll.scrollHeight - scroll.clientHeight - pendingListShrinkPx();
      if (scroll.scrollTop > end) scroll.scrollTop = Math.max(0, end);
    });
    observer.observe(content);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [contentRef, pendingListShrinkPx, probeRef, scroll]);
}
