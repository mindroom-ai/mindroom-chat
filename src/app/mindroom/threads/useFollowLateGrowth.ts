import { type MutableRefObject, type RefObject, useEffect } from 'react';
import { scrollToBottom } from '../../utils/dom';
import { isScrollNearBottom } from './timelineScrollUtils';

/** How long after the reader's own input in the timeline a row's growth still counts as theirs. */
export const OWN_INPUT_WINDOW_MS = 1000;

const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

const nearBottom = (scroll: HTMLElement) =>
  isScrollNearBottom({
    scrollHeight: scroll.scrollHeight,
    scrollTop: scroll.scrollTop,
    clientHeight: scroll.clientHeight,
  });

/**
 * Keeps a reader at the bottom of the live timeline there when a row grows by itself after it
 * rendered: a link preview or a picture that loads late would otherwise push the newest row
 * under the composer. A row that grows right after the reader's own input in the timeline (a
 * long message or a tool call they expand, `[+all]`) unfolds in place instead, as the
 * timeline's measurement rules want; a reply streaming live frames is followed by
 * `useFollowContentGrowth`.
 *
 * The reader counts as at the bottom by their last scroll, before the growth. Until a first
 * scroll the timeline is still opening, at the newest row or at an unread line, and that is the
 * opening's call, so nothing follows before it.
 */
export function useFollowLateGrowth(
  scroll: HTMLElement | null,
  contentRef: RefObject<HTMLElement>,
  atLiveEndRef: MutableRefObject<boolean>
): void {
  useEffect(() => {
    const content = contentRef.current;
    if (!scroll || !content || typeof ResizeObserver === 'undefined') return undefined;
    let pinned = false;
    let lastInputAt = Number.NEGATIVE_INFINITY;
    let height = content.offsetHeight;
    const onScroll = () => {
      pinned = nearBottom(scroll);
    };
    const onInput = () => {
      lastInputAt = performance.now();
    };
    const observer = new ResizeObserver(() => {
      const next = content.offsetHeight;
      const grew = next > height;
      height = next;
      if (!grew || !pinned || !atLiveEndRef.current) return;
      if (performance.now() - lastInputAt < OWN_INPUT_WINDOW_MS) return;
      // Rows that land above the reader leave the bottom where it was (the timeline's offset
      // ledger keeps the reader's rows still); only growth that moved the bottom away is written.
      if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 1) return;
      scrollToBottom(scroll);
    });
    scroll.addEventListener('scroll', onScroll, { passive: true });
    INPUT_EVENTS.forEach((type) =>
      scroll.addEventListener(type, onInput, { capture: true, passive: true })
    );
    observer.observe(content);
    return () => {
      observer.disconnect();
      scroll.removeEventListener('scroll', onScroll);
      INPUT_EVENTS.forEach((type) => scroll.removeEventListener(type, onInput, { capture: true }));
    };
  }, [atLiveEndRef, contentRef, scroll]);
}
