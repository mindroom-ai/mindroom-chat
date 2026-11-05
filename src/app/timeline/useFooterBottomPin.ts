import { type RefObject, useLayoutEffect } from 'react';
import { isScrollNearBottom } from '../event-store/timeline/timelineScrollUtils';

const nearBottom = (scroll: HTMLElement) =>
  isScrollNearBottom({
    scrollHeight: scroll.scrollHeight,
    scrollTop: scroll.scrollTop,
    clientHeight: scroll.clientHeight,
  });

/**
 * Keeps the newest row above the composer while the composer grows. The timeline pads its end
 * by the footer's height (`probe` is an element as tall as that inset); when the inset grows
 * while the reader was at the bottom, the scroll position follows by the same amount, before
 * the next paint. A reader up in the history keeps their place.
 */
export function useFooterBottomPin(
  scroll: HTMLElement | null,
  probeRef: RefObject<HTMLElement>
): void {
  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!scroll || !probe || typeof ResizeObserver === 'undefined') return undefined;
    let inset = probe.offsetHeight;
    // Read before the inset changes: once it has grown, the gap it opens is not the reader's.
    let readerAtBottom = nearBottom(scroll);
    const onScroll = () => {
      readerAtBottom = nearBottom(scroll);
    };
    const observer = new ResizeObserver(() => {
      const next = probe.offsetHeight;
      const grown = next - inset;
      inset = next;
      if (grown > 0 && readerAtBottom) scroll.scrollTop += grown;
      readerAtBottom = nearBottom(scroll);
    });
    scroll.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(probe);
    return () => {
      scroll.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [probeRef, scroll]);
}
