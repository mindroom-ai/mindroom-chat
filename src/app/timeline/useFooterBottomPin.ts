import { type RefObject, useLayoutEffect } from 'react';
import { isScrollNearBottom } from '../event-store/timeline/timelineScrollUtils';

const nearBottom = (scroll: HTMLElement) =>
  isScrollNearBottom({
    scrollHeight: scroll.scrollHeight,
    scrollTop: scroll.scrollTop,
    clientHeight: scroll.clientHeight,
  });

/**
 * Keeps the newest row above the composer while the composer grows or the scroll area gets
 * shorter, as when a phone's keyboard opens. The timeline pads its end by the footer's height
 * (`probe` is an element as tall as that inset); when the inset grows, or the scroll area's height
 * shrinks, while the reader was at the bottom, the scroll position follows by the same amount,
 * before the next paint. A reader up in the history keeps their place.
 */
export function useFooterBottomPin(
  scroll: HTMLElement | null,
  probeRef: RefObject<HTMLElement>
): void {
  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!scroll || !probe || typeof ResizeObserver === 'undefined') return undefined;
    let inset = probe.offsetHeight;
    let viewHeight = scroll.clientHeight;
    // Read before the sizes change: once they have, the gap they open is not the reader's.
    let readerAtBottom = nearBottom(scroll);
    const onScroll = () => {
      readerAtBottom = nearBottom(scroll);
    };
    const observer = new ResizeObserver(() => {
      const nextInset = probe.offsetHeight;
      const nextViewHeight = scroll.clientHeight;
      const covered = nextInset - inset + (viewHeight - nextViewHeight);
      inset = nextInset;
      viewHeight = nextViewHeight;
      if (covered > 0 && readerAtBottom) scroll.scrollTop += covered;
      readerAtBottom = nearBottom(scroll);
    });
    scroll.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(probe);
    observer.observe(scroll);
    return () => {
      scroll.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [probeRef, scroll]);
}
