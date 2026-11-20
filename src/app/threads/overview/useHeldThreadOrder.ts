import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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

/** A run of rows still in their old order, by its last row: the best one that ends there. */
type Run = {
  /** How many of the cards in view it holds, how many rows, and the sum of their old places. */
  seen: number;
  length: number;
  places: number;
  /** Its last row, by its place among the rows both orders hold, and the run before that row. */
  row: number;
  rest?: Run;
};

/** The better of two runs: more cards in view, then more rows, then rows that stood earlier. */
const betterRun = (a: Run | undefined, b: Run | undefined): Run | undefined => {
  if (!a || !b) return a ?? b;
  return (a.seen - b.seen || a.length - b.length || b.places - a.places) >= 0 ? a : b;
};

/**
 * The rows that moved up past rows that stay, from `before` to `after`, in their order in
 * `after`. Rows that only one of the lists holds neither move nor stay.
 *
 * The rows that stay are a run of rows still in their old order: the one that holds the most of
 * the cards `inView`, of those the longest, and of those the one whose rows stood first (of two
 * rows that swap, the upper one). So as few cards in view move as can, also when several rows
 * move at once, up and down: several replies in one sync, or a held order let go.
 *
 * A row that moved down past rows that stay is not named. React moves that row by itself: it
 * keeps a row in the page unless one that stood after it now stands before it, and takes out and
 * puts back each row that a row it kept moved up past. So with a new key for each row named
 * here (`useRowKeys`), the rows that stay never leave the page.
 */
export const rowsMovedUp = (
  before: readonly string[],
  after: readonly string[],
  inView: ReadonlySet<string> = new Set()
): string[] => {
  const placeBefore = new Map(before.map((id, index) => [id, index]));
  // The rows both orders hold, in their new order, each with its old place.
  const rows = after.flatMap((id) => {
    const was = placeBefore.get(id);
    return was === undefined ? [] : [{ id, was }];
  });
  // A card that joined or left, and nothing else: every row stays.
  if (rows.every(({ was }, row) => was > (rows[row - 1]?.was ?? -1))) return [];

  // The best run to end with each row follows the best one that ends before the row's old
  // place. A tree over the old places finds that one in a few steps (a Fenwick tree: the node
  // at `place` holds the best run that ends in the `place & -place` places up to it).
  const bestTo: (Run | undefined)[] = [];
  let best: Run | undefined;
  rows.forEach(({ id, was }, row) => {
    let rest: Run | undefined;
    // eslint-disable-next-line no-bitwise
    for (let place = was; place > 0; place -= place & -place) {
      rest = betterRun(rest, bestTo[place]);
    }
    const run: Run = {
      seen: (rest?.seen ?? 0) + Number(inView.has(id)),
      length: (rest?.length ?? 0) + 1,
      places: (rest?.places ?? 0) + was,
      row,
      rest,
    };
    // eslint-disable-next-line no-bitwise
    for (let place = was + 1; place <= before.length; place += place & -place) {
      bestTo[place] = betterRun(bestTo[place], run);
    }
    best = betterRun(best, run);
  });
  const stays = new Set<number>();
  for (let run = best; run; run = run.rest) stays.add(run.row);

  // Of the other rows, one that stood after the last row that stays before it moved up past
  // that row; one that stood before it moved down.
  const up: string[] = [];
  let lastStay = -1;
  rows.forEach(({ id, was }, row) => {
    if (stays.has(row)) lastStay = was;
    else if (was > lastStay) up.push(id);
  });
  return up;
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
 * The React key of each of the list's rendered `rows` (cards, and in sections their headers): the
 * row's own, or, for a row that moved up past others while the list was scrolled down
 * (`rowsMovedUp`), a new one. React then takes that one row out and puts a new one in at its
 * place, as for a card that joins, and the rows it passed stay in the page.
 *
 * With the same key, React keeps the row that moved up in the page and takes out and puts back
 * every row it passed, the cards in view among them. The browser's scroll anchoring (Chromium)
 * holds on to one of those and loses a card that leaves the page, even within one commit. So
 * the cards in view showed lower by the height of the card that moved, and a reply in a thread
 * whose card was itself in view took the list to its top: the browser followed the one row that
 * had stayed in the page.
 *
 * Only where the browser anchors the scroll, and only while the list is scrolled down: without
 * scroll anchoring the list scrolls itself (`useHeldThreadOrder`), and at its top nothing is
 * kept in place.
 *
 * The row with a new key mounts again. Its card still shows the reply that moved it and keeps
 * the focus a click left on it (`CompactThreadCard`), and its `data-motion-row` stays, so it
 * glides or fades in as before. No press, swipe or menu is under way on it: each holds the order.
 */
export const useRowKeys = (
  rows: readonly string[],
  viewRef: RefObject<HTMLElement>
): ((row: string) => string) => {
  // The rows of the last commit, and those among them that show under their second key.
  const shownRef = useRef<{ rows: readonly string[]; renewed: ReadonlySet<string> }>({
    rows,
    renewed: new Set(),
  });
  const order = rows.join('\n');
  const renewed = useMemo(() => {
    const shown = shownRef.current;
    const listed = new Set(rows);
    const next = new Set([...shown.renewed].filter((row) => listed.has(row)));
    const view = viewRef.current;
    if (view && view.scrollTop > 0 && browserAnchorsScroll()) {
      // The cards that lead the view, as the page shows them before this render: the browser's
      // anchor is one of them.
      const inView = new Set(cardsInView(view, shown.rows)?.cards.map(({ rootId }) => rootId));
      // Back to its first key the next time: a row only ever has one of two.
      rowsMovedUp(shown.rows, rows, inView).forEach((row) => {
        if (!next.delete(row)) next.add(row);
      });
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `order` stands for the rows
  }, [order, viewRef]);
  useLayoutEffect(() => {
    shownRef.current = { rows, renewed };
  });
  return useCallback((row: string) => (renewed.has(row) ? `${row}#` : row), [renewed]);
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
