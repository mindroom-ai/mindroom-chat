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
  /**
   * An element holding the compact view (`[data-compact-room-view]`), marked
   * `data-cards-pending` while some of its cards are still to mount.
   */
  hostRef: RefObject<HTMLElement | null>;
  canPaginateBack: boolean;
  hasMoreCachedBack: boolean;
  paginateBack: (backwards: boolean) => Promise<void>;
}): void => {
  const stateRef = useRef({ canPaginateBack, hasMoreCachedBack, paginateBack });
  stateRef.current = { canPaginateBack, hasMoreCachedBack, paginateBack };
  // A last, empty page ends the history without new events; the caller renders again to see it.
  const [, setPagesSettled] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!enabled || !host) return undefined;
    const currentView = (): HTMLElement | null =>
      host.querySelector<HTMLElement>('[data-compact-room-view]');
    const initialView = currentView();
    const listenTarget = typeof host.addEventListener === 'function' ? host : initialView;
    if (!listenTarget || typeof listenTarget.addEventListener !== 'function') return undefined;

    let pages = 0;
    let inFlight = false;
    let alive = true;
    let retry = 0;
    const lastScrollTop = new WeakMap<HTMLElement, number>();
    let activeScroller: HTMLElement | undefined;

    const hasColumnsBoard = (view: HTMLElement): boolean =>
      typeof view.querySelector === 'function' &&
      Boolean(view.querySelector('[data-compact-columns-board]'));

    if (initialView) {
      lastScrollTop.set(initialView, initialView.scrollTop);
      if (typeof initialView.querySelectorAll === 'function') {
        initialView.querySelectorAll<HTMLElement>('[data-compact-column-body]').forEach((body) => {
          lastScrollTop.set(body, body.scrollTop);
        });
      }
    }

    const resolveScroller = (target: EventTarget | null | undefined): HTMLElement | undefined => {
      const view = currentView();
      if (!view) return undefined;
      if (
        target &&
        typeof Node !== 'undefined' &&
        target instanceof Node &&
        typeof view.contains === 'function' &&
        !view.contains(target)
      ) {
        return undefined;
      }
      if (!hasColumnsBoard(view)) return view;
      if (typeof Element !== 'undefined' && target instanceof Element) {
        return target.closest<HTMLElement>('[data-compact-column-body]') ?? undefined;
      }
      return undefined;
    };

    const loadIfAtEnd = () => {
      const state = stateRef.current;
      if (!alive || inFlight || pages <= 0) return;
      if (!state.canPaginateBack && !state.hasMoreCachedBack) return;
      const view = currentView();
      const scroller = activeScroller;
      if (!view || !scroller || scroller.isConnected === false) return;
      if (hasColumnsBoard(view) && scroller === view) return;
      // While cards still mount, the view ends before the cards do: a shown list looks again on
      // the next frame, as the cards a page brought are measured without the reader moving.
      const pending = scroller === view && view.hasAttribute('data-cards-pending');
      cancelAnimationFrame(retry);
      if (pending && view.clientHeight) retry = requestAnimationFrame(loadIfAtEnd);
      if (pending || !isNearCardsEnd(scroller)) return;
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
    const approach = (scroller: HTMLElement | undefined) => {
      if (!scroller) return;
      activeScroller = scroller;
      pages = COMPACT_HISTORY_PAGES_PER_APPROACH;
      loadIfAtEnd();
    };
    const onScroll = (event: Event) => {
      const scroller = resolveScroller(event?.target);
      if (!scroller) return;
      const prevTop = lastScrollTop.get(scroller) ?? 0;
      const moved = scroller.scrollTop > prevTop;
      lastScrollTop.set(scroller, scroller.scrollTop);
      if (moved) approach(scroller);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY > 0) approach(resolveScroller(event.target));
    };
    const onTouchMove = (event: TouchEvent) => {
      approach(resolveScroller(event?.target));
    };

    // Capture on the stable host so non-bubbling column scrolls and Vertical <-> Columns view
    // swaps are handled seamlessly without detaching listeners.
    listenTarget.addEventListener('scroll', onScroll, { capture: true, passive: true });
    listenTarget.addEventListener('wheel', onWheel, { capture: true, passive: true });
    listenTarget.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    return () => {
      alive = false;
      cancelAnimationFrame(retry);
      listenTarget.removeEventListener('scroll', onScroll, { capture: true });
      listenTarget.removeEventListener('wheel', onWheel, { capture: true });
      listenTarget.removeEventListener('touchmove', onTouchMove, { capture: true });
    };
  }, [enabled, roomId, hostRef]);
};
