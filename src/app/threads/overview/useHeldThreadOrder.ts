import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react';

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

/** The topmost cards in view, their tops on screen, the scroll offset and the order then. */
type CardsInView = {
  cards: { rootId: string; top: number }[];
  scrollTop: number;
  order: readonly string[];
};

/** How many cards in view are tried, from the top, for one that kept its place. */
const ANCHOR_CANDIDATES = 8;

/** The topmost cards in view (cards carry `data-scroll-anchor`). */
const cardsInView = (view: HTMLElement, order: readonly string[]): CardsInView | undefined => {
  const viewTop = view.getBoundingClientRect().top;
  const elements = view.querySelectorAll<HTMLElement>('[data-scroll-anchor]');
  // The cards stack in one column: find the first one in view by halving, so a reader far down a
  // long list costs a few layout reads rather than one per card above the view.
  let low = 0;
  let high = elements.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((elements[middle]?.getBoundingClientRect().bottom ?? Infinity) > viewTop) high = middle;
    else low = middle + 1;
  }
  const cards: CardsInView['cards'] = [];
  for (let index = low; index < elements.length && cards.length < ANCHOR_CANDIDATES; index += 1) {
    const card = elements[index];
    const rootId = card?.getAttribute('data-scroll-anchor');
    if (card && rootId) cards.push({ rootId, top: card.getBoundingClientRect().top });
  }
  return cards.length > 0 ? { cards, scrollTop: view.scrollTop, order } : undefined;
};

/** Whether `rootId` kept its place: every card shown before it that is still shown still is. */
const keptPlace = (rootId: string, before: readonly string[], after: readonly string[]) => {
  const index = new Map(after.map((id, position) => [id, position]));
  const now = index.get(rootId);
  if (now === undefined) return false;
  for (const id of before) {
    if (id === rootId) return true;
    if ((index.get(id) ?? -1) > now) return false;
  }
  return true;
};

/** CSS scroll anchoring (Chromium, Firefox) keeps the cards in view in place by itself. */
const browserAnchorsScroll = (): boolean =>
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('overflow-anchor', 'auto');

/**
 * The overview's thread order, held while `held` (the reader points at, focuses or has a menu
 * open on a card) so no card moves under the pointer: the threads keep the order they were shown
 * in, threads that leave the list go, and new ones join at their place in the live order, so a
 * newest-first list still shows them at the top. Once released, the live order applies.
 *
 * A reader at the top of the list sees new cards arrive there. Further down, cards that join or
 * grow above the ones in view would push them down, so the list scrolls by as much and the cards
 * in view stay where they are, held or not, as Chromium's scroll anchoring keeps them by itself:
 * the list scrolls only in browsers without it (WebKit, so iOS too). It keeps the topmost card in
 * view that kept its place; a card that moved up past others (it got a reply, in the live order)
 * leaves its place to the next. It acts only on a render that finds the scroll offset where it
 * recorded the cards: a scroll since then, the reader's (whose scroll event comes at the next
 * frame) or another script's (the list reopening on a card it left from), is not a move, and the
 * cards are recorded again.
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
  const cardsInViewRef = useRef<CardsInView>();
  // Every commit: a card's thread that loads above the view changes its height without an order
  // change.
  useLayoutEffect(() => {
    shownRef.current = shown;
    const view = viewRef?.current;
    // With scroll anchoring the browser keeps the cards in place, and nothing needs recording.
    if (!view || browserAnchorsScroll()) return;
    const before = cardsInViewRef.current;
    if (before && view.scrollTop > 0 && view.scrollTop === before.scrollTop) {
      const cards = [...view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')];
      const anchor = before.cards
        .filter(({ rootId }) => keptPlace(rootId, before.order, shown))
        .map(({ rootId, top }) => ({
          top,
          card: cards.find((element) => element.getAttribute('data-scroll-anchor') === rootId),
        }))
        .find(({ card }) => card);
      const moved = anchor?.card ? anchor.card.getBoundingClientRect().top - anchor.top : 0;
      if (Math.abs(moved) >= 0.5) view.scrollTop += moved;
    }
    cardsInViewRef.current = cardsInView(view, shown);
  });
  // The reader's own scrolling moves the cards; the next commit compares from there.
  useEffect(() => {
    const view = viewRef?.current;
    if (!view || browserAnchorsScroll()) return undefined;
    const record = () => {
      cardsInViewRef.current = cardsInView(view, shownRef.current);
    };
    view.addEventListener('scroll', record, { passive: true });
    return () => view.removeEventListener('scroll', record);
  }, [viewRef]);
  return shown;
};

/**
 * Whether a pointer is over the cards, which holds their order (`useHeldThreadOrder`), and the
 * handlers of the card list that follow it. A mouse is over them from its enter, or a move for a
 * list drawn under a resting pointer, until it leaves. A finger's pointer leaves as it lifts,
 * before the tap's mousedown, mouseup and click, and that mousedown moves focus off a card: let go
 * there, a new order would swap the cards between the mousedown and the mouseup, and the click
 * would miss what was tapped. A finger holds until its tap's click, or lets go at once after a
 * pointercancel, when it scrolled instead. A press holds as well: React runs the updates of a
 * pointer's enter and moves at its continuous priority, and the press's focus change renders at
 * the discrete one, which can leave them out; the pointerdown is discrete too.
 */
export const usePointerOverCards = () => {
  const [pointerInside, setPointerInside] = useState(false);
  const cancelledRef = useRef(false);
  const releaseOnClickRef = useRef<() => void>();
  const stopWaiting = useCallback(() => {
    const release = releaseOnClickRef.current;
    if (release) document.removeEventListener('click', release, true);
    releaseOnClickRef.current = undefined;
  }, []);
  useEffect(() => stopWaiting, [stopWaiting]);
  const onPointerEnter = useCallback(() => setPointerInside(true), []);
  const onPointerCancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);
  const onPointerLeave = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const cancelled = cancelledRef.current;
      cancelledRef.current = false;
      stopWaiting();
      if (event.pointerType === 'mouse' || cancelled) {
        setPointerInside(false);
        return;
      }
      // The click is already aimed when this runs, in the capture phase.
      const release = () => {
        stopWaiting();
        setPointerInside(false);
      };
      releaseOnClickRef.current = release;
      document.addEventListener('click', release, true);
    },
    [stopWaiting]
  );
  return {
    pointerInside,
    onPointerEnter,
    onPointerMove: onPointerEnter,
    onPointerDown: onPointerEnter,
    onPointerLeave,
    onPointerCancel,
  };
};
