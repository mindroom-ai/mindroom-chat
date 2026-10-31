import { type RefObject, useEffect } from 'react';
import { scrollToBottom } from '../../utils/dom';

/**
 * Keeps a reader at the bottom there while the scroll content grows without a timeline event
 * to pin it, as a reply streaming live frames does.
 * The reader counts as at the bottom by their last scroll, before the growth: a measurement
 * correction can move the scroll position along with the growth, so the position after it
 * cannot tell a pinned reader from one a little above the bottom.
 */
export const useFollowContentGrowth = (
  getScrollElement: () => HTMLElement | null,
  contentRef: RefObject<HTMLElement>,
  isViewportAtBottomNow: () => boolean
): void => {
  useEffect(() => {
    const scrollElement = getScrollElement();
    const content = contentRef.current;
    if (!scrollElement || !content) return undefined;
    let pinned = isViewportAtBottomNow();
    let height: number | undefined;
    const onScroll = () => {
      pinned = isViewportAtBottomNow();
    };
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find(({ target }) => target === content);
      if (!entry) return;
      const grew = height !== undefined && entry.contentRect.height > height;
      height = entry.contentRect.height;
      if (grew && pinned) scrollToBottom(scrollElement);
    });
    scrollElement.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(content);
    return () => {
      observer.disconnect();
      scrollElement.removeEventListener('scroll', onScroll);
    };
  }, [contentRef, getScrollElement, isViewportAtBottomNow]);
};
