import {
  Component,
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent,
  type ReactElement,
  type RefObject,
  type TouchEvent,
} from 'react';

/** The topmost cards in view, their tops below the view's top, the scroll offset and the order. */
type CardsInView = {
  cards: { rootId: string; top: number }[];
  scrollTop: number;
  order: readonly string[];
};

/** How many cards in view are tried, from the top, for one that kept its place. */
const ANCHOR_CANDIDATES = 8;

/** The topmost cards in view below the floating header (cards carry `data-scroll-anchor`). */
const cardsInView = (view: HTMLElement, order: readonly string[]): CardsInView | undefined => {
  const { top } = view.getBoundingClientRect();
  const viewTop = top + (parseFloat(getComputedStyle(view).scrollPaddingTop) || 0);
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
    if (card && rootId) cards.push({ rootId, top: card.getBoundingClientRect().top - top });
  }
  return cards.length > 0 ? { cards, scrollTop: view.scrollTop, order } : undefined;
};

type OrderLink = { id: string; index: number; previous: OrderLink | undefined };

type SectionOfRow = (key: string) => string | undefined;

/** Find a longest increasing subsequence, excluding cards that switched between sections. */
const stationaryRows = (
  before: readonly string[],
  after: readonly string[],
  sectionOfRow?: SectionOfRow
) => {
  let section: string | undefined;
  const oldRows = new Map(
    before.map((id, index) => {
      section = sectionOfRow?.(id) ?? section;
      return [id, { index, section }] as const;
    })
  );
  section = undefined;
  const tails: OrderLink[] = [];
  for (const id of after) {
    section = sectionOfRow?.(id) ?? section;
    const old = oldRows.get(id);
    // With grouping turned on or off, there is no section on one side to compare.
    if (!old || (old.section && section && old.section !== section)) continue;
    const { index } = old;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (tails[mid]!.index < index) low = mid + 1;
      else high = mid;
    }
    tails[low] = { id, index, previous: tails[low - 1] };
  }
  const stationary = new Set<string>();
  for (let row = tails.at(-1); row; row = row.previous) stationary.add(row.id);
  return stationary;
};

/** How long after a wheel turn, a finger's move, or a scroll that follows one, the reader scrolls. */
export const SCROLL_SETTLE_MS = 120;

/** Runs `read` right before React changes the page: only a class is told when that is. */
class BeforeCommit extends Component<{ read: () => void }> {
  override getSnapshotBeforeUpdate(): null {
    const { read } = this.props;
    read();
    return null;
  }

  // React asks for one beside `getSnapshotBeforeUpdate`.
  override componentDidUpdate(): void {}

  override render(): null {
    return null;
  }
}

/**
 * A reader at the top of the list sees new cards arrive there. Further down, the cards in view
 * stay where they are whatever changes around them: the list scrolls so that the topmost card in
 * view that kept its place among the rows shows where it did. That one rule holds in every
 * browser. Chromium's scroll anchoring stays on, and the rule scrolls by what it leaves.
 * The commit that shows a section the reader opened or closed (`foldingRef`, set by the fold and
 * cleared here) is left alone: the header the reader pressed stays, as the browser has it.
 *
 * In a commit, the cards are read right before React changes the page (render what the hook
 * returns inside the list) and compared after it, once React has put the focus back. A thread
 * that sorts first has React move every other row: WebKit then scrolls to the top, Chromium's
 * scroll anchoring loses its card or follows the thread, and the focus React puts back scrolls to
 * its card. Outside a commit (a card that grows by itself, the header's inset), a resize compares
 * with the cards as the last scroll left them, and only at the scroll offset they were read at:
 * another script that scrolled since has placed the list. Until that scroll's event has come, a
 * commit leaves the list where the script put it as well.
 *
 * While the reader scrolls, WebKit scrolls on a thread of its own, and a write sets its scroll
 * back: the list is left as it is then, unless the commit itself scrolled it. Nothing is made up
 * for once the scrolling settles, when the reader may have passed the cards that changed.
 */
export const useCompactScrollAnchor = (
  rows: readonly string[],
  viewRef: RefObject<HTMLElement>,
  sectionOfRow?: SectionOfRow,
  contentRef?: RefObject<HTMLElement>,
  foldingRef?: MutableRefObject<boolean>
): ReactElement => {
  // What the listeners need of the latest commit. This ref does not decide the rows' order.
  const latestRef = useRef({ rows, sectionOfRow });
  const cardsInViewRef = useRef<CardsInView>();
  // When the reader last scrolled (`performance.now()`).
  const scrolledAtRef = useRef(-Infinity);
  // A scroll the hook did not make whose scroll event is still to come: the reader's, or another
  // script's that is placing the list (the list reopening where it was left, which gives up at a
  // scroll that is not its own).
  const placedRef = useRef(false);

  const keepPlace = useCallback(
    (committed: boolean, folding = false) => {
      const view = viewRef.current;
      if (!view) return;
      const { rows: order, sectionOfRow: sectionOf } = latestRef.current;
      const before = cardsInViewRef.current;
      const stayed = view.scrollTop === before?.scrollTop;
      if (!committed && !stayed) placedRef.current = true;
      if (!folding && before && before.scrollTop > 0 && (committed || stayed)) {
        const cards = [...view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')];
        const stationary =
          before.order === order ? undefined : stationaryRows(before.order, order, sectionOf);
        const anchor = before.cards
          .filter(({ rootId }) => stationary?.has(rootId) ?? true)
          .map(({ rootId, top }) => ({
            top,
            card: cards.find((element) => element.getAttribute('data-scroll-anchor') === rootId),
          }))
          .find(({ card }) => card);
        const viewTop = view.getBoundingClientRect().top;
        const top = anchor?.card?.getBoundingClientRect().top;
        const moved = anchor && top !== undefined ? top - viewTop - anchor.top : 0;
        const scrolling = performance.now() - scrolledAtRef.current < SCROLL_SETTLE_MS;
        const left = stayed && (scrolling || placedRef.current);
        if (Math.abs(moved) >= 0.5 && !left) view.scrollTop += moved;
      }
      cardsInViewRef.current = cardsInView(view, order);
    },
    [viewRef]
  );
  // Before a commit: again, for a reader who scrolled since, whose scroll event is still to come.
  const read = useCallback(() => {
    const view = viewRef.current;
    if (view && view.scrollTop !== cardsInViewRef.current?.scrollTop) {
      placedRef.current = true;
      cardsInViewRef.current = cardsInView(view, latestRef.current.rows);
    }
  }, [viewRef]);
  useLayoutEffect(() => {
    latestRef.current = { rows, sectionOfRow };
    keepPlace(true, foldingRef?.current);
    if (foldingRef) foldingRef.current = false;
  });
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return undefined;
    // A wheel or a finger starts the reader's scrolling and each scroll within the settle time
    // carries it on (momentum). A scroll of the list's own starts none.
    const onScroll = (event: Event) => {
      const now = performance.now();
      if (event.type !== 'scroll') scrolledAtRef.current = now;
      else {
        if (now - scrolledAtRef.current < SCROLL_SETTLE_MS) scrolledAtRef.current = now;
        placedRef.current = false;
        cardsInViewRef.current = cardsInView(view, latestRef.current.rows);
      }
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => keepPlace(false));
    observer?.observe(view);
    if (contentRef?.current) observer?.observe(contentRef.current);
    const events = ['scroll', 'wheel', 'touchmove'];
    events.forEach((type) => view.addEventListener(type, onScroll, { passive: true }));
    return () => {
      observer?.disconnect();
      events.forEach((type) => view.removeEventListener(type, onScroll));
    };
  }, [contentRef, keepPlace, viewRef]);
  return createElement(BeforeCommit, { read });
};

/**
 * How long a mouse resting on the cards still holds them: a click comes within moments of the move
 * that aimed it, and a longer hold only delays the move the reader then sees anyway.
 */
export const MOUSE_REST_HOLD_MS = 700;

/**
 * Whether a pointer is over the cards, which holds their order, and the handlers of the card list
 * that follow it. A mouse is over them from its enter, or a move for a list drawn under a resting
 * pointer, until it leaves or rests for `MOUSE_REST_HOLD_MS`: a mouse parked over a list that fills
 * the view would otherwise keep it stale for as long as it rests, and its next move holds again.
 * A finger's pointer leaves as it lifts, before the tap's
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
