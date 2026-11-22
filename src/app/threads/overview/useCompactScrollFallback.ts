import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
  type TouchEvent,
} from 'react';

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

/** CSS scroll anchoring (Chromium, Firefox) keeps the cards in view in place by itself. */
const browserAnchorsScroll = (): boolean =>
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('overflow-anchor', 'auto');

/** How long after the last wheel, touch or scroll event a reader scroll counts as settled. */
export const SCROLL_SETTLE_MS = 120;

/**
 * A reader at the top of the list sees new cards arrive there. Further down, cards that join or
 * grow above the ones in view would push them down, so the list scrolls by as much and the cards
 * in view stay where they are, as Chromium's scroll anchoring keeps them by itself. The list
 * scrolls only in browsers without it (WebKit, so iOS too). It anchors to the topmost card in view
 * from the rows that kept their relative order, even if other cards moved down. It also observes
 * `contentRef` for card height changes outside a parent commit, and defers `scrollTop` writes until
 * an active wheel or touch scroll settles so WebKit's scrolling thread is never fought mid-gesture.
 */
export const useCompactScrollFallback = (
  rows: readonly string[],
  viewRef: RefObject<HTMLElement>,
  sectionOfRow?: SectionOfRow,
  contentRef?: RefObject<HTMLElement>
): void => {
  // The scroll and resize listeners need the latest committed rows and section lookup.
  const latestRowsRef = useRef(rows);
  const latestSectionRef = useRef(sectionOfRow);
  const cardsInViewRef = useRef<CardsInView>();
  // True between reader scroll input and the scroll event or commit that records it, so a real
  // scroll to 0 is kept while WebKit's reset-to-0 during a DOM reorder is compensated.
  const readerScrolledRef = useRef(false);
  const scrollingRef = useRef(false);
  const touchingRef = useRef(false);
  const pendingDeltaRef = useRef(0);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const compensate = useCallback(
    (view: HTMLElement, nextRows: readonly string[], rowSection?: SectionOfRow) => {
      const before = cardsInViewRef.current;
      const webkitReset =
        !!before &&
        view.scrollTop === 0 &&
        before.order !== nextRows &&
        !readerScrolledRef.current;
      const inScroll = scrollingRef.current && view.scrollTop > 0;
      if (
        before &&
        before.scrollTop > 0 &&
        (view.scrollTop === before.scrollTop || webkitReset || inScroll)
      ) {
        const cards = [...view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')];
        const stationary =
          before.order === nextRows ? undefined : stationaryRows(before.order, nextRows, rowSection);
        const anchor = before.cards
          .filter(({ rootId }) => stationary?.has(rootId) ?? true)
          .map(({ rootId, top }) => ({
            top,
            card: cards.find((element) => element.getAttribute('data-scroll-anchor') === rootId),
          }))
          .find(({ card }) => card);
        const rawMoved = anchor?.card ? anchor.card.getBoundingClientRect().top - anchor.top : 0;
        const moved = inScroll ? rawMoved + (view.scrollTop - before.scrollTop) : rawMoved;
        if (Math.abs(moved) >= 0.5) {
          if (scrollingRef.current) pendingDeltaRef.current += moved;
          else view.scrollTop += moved;
        }
      }
      readerScrolledRef.current = false;
      cardsInViewRef.current = cardsInView(view, nextRows);
    },
    []
  );

  // Every commit: a card's thread that loads above the view changes its height without an order
  // change.
  useLayoutEffect(() => {
    latestRowsRef.current = rows;
    latestSectionRef.current = sectionOfRow;
    const view = viewRef.current;
    // With scroll anchoring the browser keeps the cards in place, and nothing needs recording.
    if (!view || browserAnchorsScroll()) return;
    compensate(view, rows, sectionOfRow);
  });
  // The reader's own scrolling moves the cards; the next commit compares from there.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || browserAnchorsScroll()) return undefined;
    const scheduleSettle = () => {
      clearTimeout(settleTimerRef.current);
      if (touchingRef.current) return;
      settleTimerRef.current = setTimeout(() => {
        scrollingRef.current = false;
        const delta = pendingDeltaRef.current;
        pendingDeltaRef.current = 0;
        if (view.scrollTop > 0 && Math.abs(delta) >= 0.5) view.scrollTop += delta;
        cardsInViewRef.current = cardsInView(view, latestRowsRef.current);
      }, SCROLL_SETTLE_MS);
    };
    const markReaderScroll = () => {
      readerScrolledRef.current = true;
    };
    const onWheel = () => {
      readerScrolledRef.current = true;
      scrollingRef.current = true;
      scheduleSettle();
    };
    const onTouchStart = () => {
      readerScrolledRef.current = true;
      touchingRef.current = true;
      scrollingRef.current = true;
      clearTimeout(settleTimerRef.current);
    };
    const onTouchEnd = () => {
      touchingRef.current = false;
      if (scrollingRef.current) scheduleSettle();
    };
    const record = () => {
      readerScrolledRef.current = false;
      cardsInViewRef.current = cardsInView(view, latestRowsRef.current);
      if (scrollingRef.current) scheduleSettle();
    };
    const content = contentRef?.current;
    const resizeObserver =
      content && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() =>
            compensate(view, latestRowsRef.current, latestSectionRef.current)
          )
        : undefined;
    if (content) resizeObserver?.observe(content);
    const listeners: [string, EventListener, AddEventListenerOptions | boolean][] = [
      ['scroll', record, { passive: true }],
      ['wheel', onWheel, { passive: true }],
      ['touchstart', onTouchStart, { passive: true }],
      ['touchmove', markReaderScroll, { passive: true }],
      ['touchend', onTouchEnd, { passive: true }],
      ['touchcancel', onTouchEnd, { passive: true }],
      ['keydown', markReaderScroll, true],
      ['pointerdown', markReaderScroll, true],
    ];
    listeners.forEach(([type, handler, opts]) => view.addEventListener(type, handler, opts));
    return () => {
      clearTimeout(settleTimerRef.current);
      scrollingRef.current = false;
      touchingRef.current = false;
      pendingDeltaRef.current = 0;
      resizeObserver?.disconnect();
      listeners.forEach(([type, handler, opts]) => view.removeEventListener(type, handler, opts));
    };
  }, [compensate, contentRef, viewRef]);
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
