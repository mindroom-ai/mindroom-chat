import { useEffect, useRef, useState, type RefObject } from 'react';

/** Older pages one approach to the end of the cards may load before the reader moves again. */
export const COMPACT_HISTORY_PAGES_PER_APPROACH = 3;

/** The cards' end is in reach: within one screen of the bottom, or the cards fit the view. */
export const isNearCardsEnd = ({
  scrollTop,
  scrollHeight,
  clientHeight,
}: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>): boolean =>
  scrollHeight - scrollTop - clientHeight <= clientHeight;

/**
 * Compact cards of roots without replies come from the room's loaded history, which the
 * coverage backfill fills only so far. When the reader moves toward the end of the cards, older
 * history loads a page at a time, up to a few pages until the reader moves again, so older roots
 * get their cards without paging a long room's whole history unasked.
 */
export const useCompactHistoryAtEnd = ({
  enabled,
  roomId,
  hostRef,
  canPaginateBack,
  hasMoreCachedBack,
  paginateBack,
}: {
  enabled: boolean;
  /** The room shown; a new room mounts a new compact view. */
  roomId: string;
  /** An element holding the compact view (`[data-compact-room-view]`). */
  hostRef: RefObject<HTMLElement>;
  canPaginateBack: boolean;
  hasMoreCachedBack: boolean;
  paginateBack: (backwards: boolean) => Promise<void>;
}): void => {
  const stateRef = useRef({ canPaginateBack, hasMoreCachedBack, paginateBack });
  stateRef.current = { canPaginateBack, hasMoreCachedBack, paginateBack };
  // A last, empty page ends the history without new events; the caller renders again to see it.
  const [, setPagesSettled] = useState(0);

  useEffect(() => {
    const view = hostRef.current?.querySelector<HTMLElement>('[data-compact-room-view]');
    if (!enabled || !view) return undefined;
    let pages = 0;
    let inFlight = false;
    let alive = true;
    let lastScrollTop = view.scrollTop;

    const loadIfAtEnd = () => {
      const state = stateRef.current;
      if (!alive || inFlight || pages <= 0) return;
      if (!state.canPaginateBack && !state.hasMoreCachedBack) return;
      if (!isNearCardsEnd(view)) return;
      inFlight = true;
      pages -= 1;
      state
        .paginateBack(true)
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
          if (!alive) return;
          setPagesSettled((count) => count + 1);
          // Let the new cards render, then look again: the end may still be in reach.
          requestAnimationFrame(loadIfAtEnd);
        });
    };
    const approach = () => {
      pages = COMPACT_HISTORY_PAGES_PER_APPROACH;
      loadIfAtEnd();
    };
    const onScroll = () => {
      const moved = view.scrollTop > lastScrollTop;
      lastScrollTop = view.scrollTop;
      if (moved) approach();
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY > 0) approach();
    };

    view.addEventListener('scroll', onScroll, { passive: true });
    view.addEventListener('wheel', onWheel, { passive: true });
    view.addEventListener('touchmove', approach, { passive: true });
    return () => {
      alive = false;
      view.removeEventListener('scroll', onScroll);
      view.removeEventListener('wheel', onWheel);
      view.removeEventListener('touchmove', approach);
    };
  }, [enabled, roomId, hostRef]);
};
