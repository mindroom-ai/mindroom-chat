import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent,
  type RefObject,
  type TouchEvent,
} from 'react';

/**
 * The shown order kept against the live one: the threads shown keep their places, threads that
 * left the list go, and new ones join where the live order puts them. One that the live order
 * puts before every shown thread leads (the top of a newest-first list, its live end), one it
 * puts after all of them ends the list, and one between follows its live neighbour.
 */
export const holdOrder = (shownIds: readonly string[], liveIds: readonly string[]): string[] => {
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

/** The topmost cards in view (cards carry `data-scroll-anchor`). */
const cardsInView = (view: HTMLElement, order: readonly string[]): CardsInView | undefined => {
  const { top: viewTop, bottom: viewBottom } = view.getBoundingClientRect();
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
  for (let index = low; index < elements.length; index += 1) {
    const card = elements[index];
    const rootId = card?.getAttribute('data-scroll-anchor');
    if (card && rootId) {
      const { top } = card.getBoundingClientRect();
      if (top >= viewBottom) break;
      cards.push({ rootId, top });
    }
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

export type CompactOrderWindow = { keys: string[]; shift?: (px: number) => void };

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
 * At depth, anchor the first visible card that kept its place. Chromium anchors natively.
 * Where it cannot, compensate at rest by scrolling, and in a live window by adjusting its spacer.
 */
export const useHeldThreadOrder = (
  liveRootIds: string[],
  held: boolean,
  viewRef?: RefObject<HTMLElement>,
  windowRef?: MutableRefObject<CompactOrderWindow>
): string[] => {
  const shownRef = useRef(liveRootIds);
  const shown = useMemo(
    () => (held ? holdOrder(shownRef.current, liveRootIds) : liveRootIds),
    [held, liveRootIds]
  );
  const cardsInViewRef = useRef<CardsInView>();
  const record = useCallback(() => {
    const view = viewRef?.current;
    if (!view) return;
    cardsInViewRef.current = cardsInView(view, shownRef.current);
    if (windowRef)
      windowRef.current.keys = cardsInViewRef.current?.cards.map(({ rootId }) => rootId) ?? [];
  }, [viewRef, windowRef]);
  useLayoutEffect(() => {
    shownRef.current = shown;
    const view = viewRef?.current;
    if (!view) return;
    const before = cardsInViewRef.current;
    const shift = windowRef?.current.shift;
    const scrollDelta = view.scrollTop - (before?.scrollTop ?? 0);
    const needsAnchor = !browserAnchorsScroll() || (held && windowRef && before?.order !== shown);
    if (before && needsAnchor && view.scrollTop > 0 && (shift || !scrollDelta)) {
      const cards = [...view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')];
      const anchor = before.cards.find(
        ({ rootId }) =>
          cards.some((card) => card.dataset.scrollAnchor === rootId) &&
          keptPlace(rootId, before.order, shown)
      );
      const card =
        anchor && cards.find((element) => element.dataset.scrollAnchor === anchor.rootId);
      const moved = card ? card.getBoundingClientRect().top - anchor.top + scrollDelta : 0;
      if (shift) shift(-moved);
      else if (Math.abs(moved) >= 0.5) view.scrollTop += moved;
    }
    record();
  });
  useEffect(() => {
    const view = viewRef?.current;
    view?.addEventListener('scroll', record, { passive: true });
    return () => view?.removeEventListener('scroll', record);
  }, [record, viewRef]);
  return shown;
};

/** How long a mouse resting on the cards still holds them: a click is almost always aimed by a move. */
export const MOUSE_REST_HOLD_MS = 3_000;

/**
 * Whether a pointer is over the cards, which holds their order (`useHeldThreadOrder`), and the
 * handlers of the card list that follow it. A mouse is over them from its enter, or a move for a
 * list drawn under a resting pointer, until it leaves or rests for `MOUSE_REST_HOLD_MS`: a mouse
 * parked over a list that fills the view would otherwise keep it stale for as long as it rests,
 * and its next move holds again. A finger's pointer leaves as it lifts, before the tap's
 * mousedown, mouseup and click, and that mousedown moves focus off a card: let go there, a new
 * order would swap the cards between the mousedown and the mouseup, and the click would miss what
 * was tapped. A finger holds until its tap's click, or lets go at once after a pointercancel, when
 * it scrolled instead. A press holds as well, with no time limit until its release: React runs the
 * updates of a pointer's enter and moves at its continuous priority, and the press's focus change
 * renders at the discrete one, which can leave them out; the pointerdown is discrete too.
 */
export const usePointerOverCards = () => {
  // A mouse at rest lets go by time; a pen, a finger or a press never does, so they hold apart.
  const [mouseInside, setMouseInside] = useState(false);
  const [otherInside, setOtherInside] = useState(false);
  const cancelledRef = useRef(false);
  const releaseOnClickRef = useRef<() => void>();
  const restTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const stopResting = useCallback(() => {
    clearTimeout(restTimerRef.current);
    restTimerRef.current = undefined;
  }, []);
  const stopWaiting = useCallback(() => {
    const release = releaseOnClickRef.current;
    if (release) document.removeEventListener('click', release, true);
    releaseOnClickRef.current = undefined;
  }, []);
  useEffect(
    () => () => {
      stopWaiting();
      stopResting();
    },
    [stopResting, stopWaiting]
  );
  const letGo = useCallback(() => {
    setMouseInside(false);
    setOtherInside(false);
  }, []);
  const onPointerEnter = useCallback(
    (event?: PointerEvent<HTMLElement>) => {
      if (event?.pointerType !== 'mouse') {
        setOtherInside(true);
        return;
      }
      setMouseInside(true);
      stopResting();
      // A press holds until it is released; only a mouse at rest lets go.
      if (event.buttons) return;
      restTimerRef.current = setTimeout(() => setMouseInside(false), MOUSE_REST_HOLD_MS);
    },
    [stopResting]
  );
  const onPointerDown = useCallback(
    (event?: PointerEvent<HTMLElement>) => {
      if (event?.pointerType !== 'mouse') {
        setOtherInside(true);
        return;
      }
      stopResting();
      setMouseInside(true);
    },
    [stopResting]
  );
  const onPointerCancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);
  const onPointerLeave = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const cancelled = cancelledRef.current;
      cancelledRef.current = false;
      stopWaiting();
      if (event.pointerType === 'mouse' || cancelled) {
        stopResting();
        letGo();
        return;
      }
      // The click is already aimed when this runs, in the capture phase.
      const release = () => {
        stopWaiting();
        letGo();
      };
      releaseOnClickRef.current = release;
      document.addEventListener('click', release, true);
    },
    [letGo, stopResting, stopWaiting]
  );
  return {
    pointerInside: mouseInside || otherInside,
    onPointerEnter,
    onPointerMove: onPointerEnter,
    onPointerDown,
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse') onPointerEnter(event);
    },
    onPointerLeave,
    onPointerCancel,
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      // A long press consumes the release click, so there is no click left to wait for.
      if (!event.defaultPrevented) return;
      stopWaiting();
      letGo();
    },
  };
};
