import { type MutableRefObject, type RefObject, useEffect } from 'react';
import { isScrollNearBottom } from '../event-store/timeline/timelineScrollUtils';
import type { LiveReplyStore } from '../messages/live/liveReplyStore';

/**
 * Keeps a reader who was at the bottom there while a reply streaming live frames grows the
 * scroll content without a timeline event to pin it.
 * Only growth after a frame applied anywhere in the room follows, so a block the reader expands
 * near the bottom unfolds in place unless a reply in the room is streaming at that moment.
 * The reader counts as at the bottom by their last scroll, before the growth: a measurement
 * correction can move the scroll position along with the growth, so the position after it
 * cannot tell a pinned reader from one a little above the bottom.
 * Only a timeline at its live end follows: at the bottom of older history, the growth is newer
 * events loading, and following it would page the reader through history they have not read.
 */
export const useFollowContentGrowth = (
  getScrollElement: () => HTMLElement | null,
  contentRef: RefObject<HTMLElement>,
  isViewportAtBottomNow: () => boolean,
  atLiveEndRef: MutableRefObject<boolean>,
  liveReplies: LiveReplyStore,
  roomId: string,
  // Rows that shrank in the frame the growth shows, which the list still holds room for until
  // React renders it: the end it follows to is that much higher.
  pendingListShrinkPx: () => number = () => 0
): void => {
  useEffect(() => {
    const scrollElement = getScrollElement();
    const content = contentRef.current;
    if (!scrollElement || !content) return undefined;
    let pinned = isViewportAtBottomNow();
    let height: number | undefined;
    let frames = liveReplies.frameCount(roomId);
    let seenScrollHeight = scrollElement.scrollHeight;
    const onScroll = () => {
      // The browser's own scroll when the end shrinks (the composer's typing line going) can be
      // reported after the content grew again, before this observed the growth: judge the reader
      // against the content as last observed, or the growth would leave them behind.
      if (scrollElement.scrollHeight > seenScrollHeight) {
        pinned = isScrollNearBottom({
          scrollHeight: seenScrollHeight,
          scrollTop: scrollElement.scrollTop,
          clientHeight: scrollElement.clientHeight,
        });
        return;
      }
      seenScrollHeight = scrollElement.scrollHeight;
      pinned = isViewportAtBottomNow();
      ((globalThis as unknown as { __seLog?: unknown[] }).__seLog?.push({ t: performance.now(), ...({ k: 'growthScroll', pinned, top: scrollElement.scrollTop, sh: scrollElement.scrollHeight }) }));
    };
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find(({ target }) => target === content);
      if (!entry) return;
      const grew = height !== undefined && entry.contentRect.height > height;
      const framed = liveReplies.frameCount(roomId) !== frames;
      height = entry.contentRect.height;
      seenScrollHeight = scrollElement.scrollHeight;
      frames = liveReplies.frameCount(roomId);
      ((globalThis as unknown as { __seLog?: unknown[] }).__seLog?.push({ t: performance.now(), ...({ k: 'growth', h: entry.contentRect.height, grew, framed, pinned, live: atLiveEndRef.current, top: scrollElement.scrollTop, sh: scrollElement.scrollHeight }) }));
      if (grew && framed && pinned && atLiveEndRef.current) {
        const end = scrollElement.scrollHeight - scrollElement.clientHeight - pendingListShrinkPx();
        scrollElement.scrollTo({ top: Math.max(0, end), behavior: 'instant' });
      }
    });
    scrollElement.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(content);
    return () => {
      observer.disconnect();
      scrollElement.removeEventListener('scroll', onScroll);
    };
  }, [
    atLiveEndRef,
    contentRef,
    getScrollElement,
    isViewportAtBottomNow,
    liveReplies,
    pendingListShrinkPx,
    roomId,
  ]);
};
