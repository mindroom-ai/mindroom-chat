import { type RefObject, useLayoutEffect } from 'react';
import { isScrollNearBottom } from '../event-store/timeline/timelineScrollUtils';

const nearBottom = (scroll: HTMLElement) =>
  isScrollNearBottom({
    scrollHeight: scroll.scrollHeight,
    scrollTop: scroll.scrollTop,
    clientHeight: scroll.clientHeight,
  });

/**
 * Keeps a reader at the bottom there while the composer grows and while the scroll area changes
 * size, as when a phone's keyboard opens or the phone is turned. The timeline pads its end by the
 * footer's height (`probe` is an element as tall as that inset); when the inset grows, or the
 * scroll area's height shrinks, the scroll position follows by the same amount, before the next
 * paint. A new width wraps every row anew, and the rows measure again over the next frames:
 * `followLatestRows` asks the timeline to keep its newest row at the bottom until the reader
 * scrolls. A reader up in the history keeps their place.
 */
export function useFooterBottomPin(
  scroll: HTMLElement | null,
  probeRef: RefObject<HTMLElement>,
  followLatestRows: () => void
): void {
  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!scroll || !probe || typeof ResizeObserver === 'undefined') return undefined;
    let inset = probe.offsetHeight;
    let viewHeight = scroll.clientHeight;
    let viewWidth = scroll.clientWidth;
    // Read before the sizes change: once they have, the gap they open is not the reader's.
    let readerAtBottom = nearBottom(scroll);
    const onScroll = () => {
      readerAtBottom = nearBottom(scroll);
    };
    const observer = new ResizeObserver(() => {
      const nextInset = probe.offsetHeight;
      const nextViewHeight = scroll.clientHeight;
      const nextViewWidth = scroll.clientWidth;
      const covered = nextInset - inset + (viewHeight - nextViewHeight);
      const rewrapped = nextViewWidth !== viewWidth;
      inset = nextInset;
      viewHeight = nextViewHeight;
      viewWidth = nextViewWidth;
      ((globalThis as unknown as { __seLog?: unknown[] }).__seLog?.push({ t: performance.now(), ...({ k: 'footerPin', covered, readerAtBottom, inset: nextInset, top: scroll.scrollTop, sh: scroll.scrollHeight }) }));
      if (readerAtBottom && covered > 0) scroll.scrollTop += covered;
      // Until the rows have measured again, the reader still counts as at the bottom.
      const followsRows = readerAtBottom && rewrapped;
      if (followsRows) followLatestRows();
      readerAtBottom = followsRows || nearBottom(scroll);
    });
    scroll.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(probe);
    observer.observe(scroll);
    return () => {
      scroll.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [followLatestRows, probeRef, scroll]);
}
