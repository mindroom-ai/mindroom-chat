import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';

/**
 * The shown order kept against the live one: the threads shown keep their places, threads that
 * left the list go, and new ones join where the live order puts them. One that the live order
 * puts before every shown thread leads (the top of a newest-first list, its live end), one it
 * puts after all of them ends the list, and one between follows its live neighbour.
 */
const holdOrder = (shownIds: string[], liveIds: string[]): string[] => {
  const live = new Set(liveIds);
  const kept = shownIds.filter((id) => live.has(id));
  const keptIds = new Set(kept);
  const firstKept = liveIds.findIndex((id) => keptIds.has(id));
  const lastKept = liveIds.findLastIndex((id) => keptIds.has(id));
  const leading: string[] = [];
  const trailing: string[] = [];
  liveIds.forEach((id, index) => {
    if (keptIds.has(id)) return;
    if (firstKept === -1 || index < firstKept) leading.push(id);
    else if (index > lastKept) trailing.push(id);
    else kept.splice(kept.indexOf(liveIds[index - 1] ?? '') + 1, 0, id);
  });
  return [...leading, ...kept, ...trailing];
};

type CardInView = { rootId: string; top: number };

/** The topmost card in view (cards carry `data-scroll-anchor`) and its top on screen. */
const firstCardInView = (view: HTMLElement): CardInView | undefined => {
  const viewTop = view.getBoundingClientRect().top;
  for (const card of view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')) {
    const { top, bottom } = card.getBoundingClientRect();
    const rootId = card.getAttribute('data-scroll-anchor');
    if (bottom > viewTop && rootId) return { rootId, top };
  }
  return undefined;
};

/**
 * The overview's thread order, held while `held` (the reader points at, focuses or has a menu
 * open on a card) so no card moves under the pointer: the threads keep the order they were shown
 * in, threads that leave the list go, and new ones join at their place in the live order, so a
 * newest-first list still shows them at the top. Once released, the live order applies.
 *
 * A reader at the top of the list sees new cards arrive there. Further down, cards that join
 * above the ones in view would push them down, so while held the list scrolls by as much and the
 * cards in view stay where they are; Chromium's scroll anchoring does that by itself, WebKit has
 * none.
 */
export const useHeldThreadOrder = (
  liveRootIds: string[],
  held: boolean,
  viewRef?: RefObject<HTMLElement>
): string[] => {
  const shownRef = useRef(liveRootIds);
  const shown = useMemo(
    () => (held ? holdOrder(shownRef.current, liveRootIds) : liveRootIds),
    [held, liveRootIds]
  );
  const cardInViewRef = useRef<CardInView>();
  useLayoutEffect(() => {
    shownRef.current = shown;
    const view = viewRef?.current;
    if (!view) return;
    const before = cardInViewRef.current;
    if (held && before && view.scrollTop > 0) {
      const card = [...view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')].find(
        (element) => element.getAttribute('data-scroll-anchor') === before.rootId
      );
      const moved = card ? card.getBoundingClientRect().top - before.top : 0;
      if (Math.abs(moved) >= 0.5) view.scrollTop += moved;
    }
    cardInViewRef.current = firstCardInView(view);
  }, [held, shown, viewRef]);
  // The reader's own scrolling moves the cards; the next order change compares from there.
  useEffect(() => {
    const view = viewRef?.current;
    if (!view) return undefined;
    const record = () => {
      cardInViewRef.current = firstCardInView(view);
    };
    view.addEventListener('scroll', record, { passive: true });
    return () => view.removeEventListener('scroll', record);
  }, [viewRef]);
  return shown;
};
