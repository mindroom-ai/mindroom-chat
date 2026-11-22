import { type ReactElement, type RefObject, useLayoutEffect, useState } from 'react';
import {
  type ScrollAnchorMemory,
  type ScrollAnchorSnapshot,
  captureScrollAnchors,
  getRowKeys,
  keepsRowOrder,
  placeRows,
} from '../../ui/scrollAnchorMemory';
import { type CompactFocusRequest, compactFocusPlace } from './compactFocusRequest';
import { type SectionOfRow, stationaryRows } from './compactShownOrder';

/** The topmost cards in view, their tops on screen, the scroll offset and the order then. */
type CardsInView = {
  cards: { rootId: string; top: number }[];
  scrollTop: number;
  order: readonly string[];
};

/** How many cards in view are tried, from the top, for one that kept its place. */
const ANCHOR_CANDIDATES = 8;

const cardsInView = (view: HTMLElement, order: readonly string[]): CardsInView | undefined => {
  const viewTop = view.getBoundingClientRect().top;
  const elements = view.querySelectorAll<HTMLElement>('[data-scroll-anchor]');
  // The cards stack in one column: find the first one in view by halving, so a reader far down a
  // long list costs a few layout reads rather than one per card above the view.
  let low = 0;
  let high = elements.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((elements[mid]?.getBoundingClientRect().bottom ?? Infinity) > viewTop) high = mid;
    else low = mid + 1;
  }
  const cards: CardsInView['cards'] = [];
  for (let i = low; i < elements.length && cards.length < ANCHOR_CANDIDATES; i += 1) {
    const card = elements[i];
    const rootId = card?.getAttribute('data-scroll-anchor');
    if (card && rootId) cards.push({ rootId, top: card.getBoundingClientRect().top });
  }
  return cards.length > 0 ? { cards, scrollTop: view.scrollTop, order } : undefined;
};

/** CSS scroll anchoring (Chromium, Firefox) keeps the cards in view in place by itself. */
const browserAnchorsScroll = (): boolean =>
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('overflow-anchor', 'auto');

/** The request of a room's saved place: the first request a room's list takes uses it up. */
export const MOUNT_REQUEST = 'mount';

/** A place to put the list at, once: the one a room opens with, or a link's card. */
export type CompactScrollRequest = { id: string } & (
  | ScrollAnchorSnapshot
  | { focus: CompactFocusRequest }
);

type Options = {
  viewRef: RefObject<HTMLElement>;
  contentRef: RefObject<HTMLElement>;
  /** The shown order: the cards that kept their places in it are the ones kept in view. */
  rows: readonly string[];
  sectionOfRow: SectionOfRow;
  request: CompactScrollRequest | undefined;
  memory: ScrollAnchorMemory;
  roomId: string;
  /** False until the cards to place the list by have rendered. */
  ready: boolean;
};

type ScrollState = {
  rows: readonly string[];
  ready: boolean;
  /** The cards as the last commit or scroll event left them: what the next commit keeps. */
  record?: CardsInView;
  /** The requested place the list still follows, and what its last write placed. */
  placing?: {
    place: ScrollAnchorSnapshot;
    placedRows: string[];
    rowOrder: string[];
    scrollTop: number;
    observer?: ResizeObserver;
  };
  taken: Set<string>;
};

const stopPlacing = (state: ScrollState): void => {
  state.placing?.observer?.disconnect();
  state.placing = undefined;
};

// A reader who scrolled since the last write keeps their place, and so do cards the list kept in
// view meanwhile. Late layout moves the placed cards together (the header padding settling, cards
// loading above). Cards that move apart or change order, as rendered (a pinned card moves without
// a new order), are the list changing under the reader, and stay where they land.
const place = (view: HTMLElement, state: ScrollState): void => {
  const { placing } = state;
  if (!placing || !state.ready) return;
  const placement = placeRows(view, placing.place, placing.placedRows);
  const rowOrder = getRowKeys(view);
  if (
    view.scrollTop !== placing.scrollTop ||
    !placement ||
    !keepsRowOrder(placing.rowOrder, rowOrder)
  ) {
    stopPlacing(state);
    return;
  }
  // eslint-disable-next-line no-param-reassign -- the list's own place
  view.scrollTop = placement.scrollTop;
  Object.assign(placing, { placedRows: placement.rows, rowOrder, scrollTop: view.scrollTop });
};

/** A child's layout effect runs before its parent's, whatever the order of the parent's hooks. */
function BeforeParent({ run }: { run: () => void }): null {
  useLayoutEffect(run);
  return null;
}

/**
 * The one writer of the Compact list's scroll offset, apart from the reader and the browser. It
 * writes in two phases of a commit, on either side of the read of `useListMotion`, so call it
 * after that hook and render the element it returns after the list.
 *
 * Before that read, it keeps the cards in view where they were, where the browser does not
 * (WebKit, so iOS too): cards that join or grow above them would push them down, so the list
 * scrolls by as much. It compares the topmost card in view, of those that kept their relative
 * order, with where the last commit or scroll event left it, and acts only at the offset recorded
 * then: after a scroll whose event is still to come, it records the cards without moving them.
 *
 * After that read, so the cards glide from where they were and not by the jump, it places the
 * list for a `request`, each once by its id: by the cards of that place where they show, else at
 * its offset. Until the reader scrolls, the cards are kept in view by the first phase or the
 * browser, or they change order, it places them again as late layout resizes the list. On
 * unmount, and for the room it leaves, it saves the place in `memory`.
 */
export const useCompactScrollOwner = ({
  viewRef,
  contentRef,
  rows,
  sectionOfRow,
  request,
  memory,
  roomId,
  ready,
}: Options): ReactElement => {
  const [state] = useState<ScrollState>(() => ({ rows, ready: false, taken: new Set() }));

  // Every commit: a card's thread that loads above the view changes its height without an order
  // change.
  const keep = () => {
    state.rows = rows;
    const view = viewRef.current;
    if (!view || browserAnchorsScroll()) return;
    const before = state.record;
    if (before && view.scrollTop > 0 && view.scrollTop === before.scrollTop) {
      // By root id: a card that moved under another parent, as a pinned one does, is a new element.
      const cards = [...view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')];
      const stationary =
        before.order === rows ? undefined : stationaryRows(before.order, rows, sectionOfRow);
      const anchor = before.cards
        .filter(({ rootId }) => stationary?.has(rootId) ?? true)
        .map(({ rootId, top }) => ({
          top,
          card: cards.find((element) => element.getAttribute('data-scroll-anchor') === rootId),
        }))
        .find(({ card }) => card);
      const moved = anchor?.card ? anchor.card.getBoundingClientRect().top - anchor.top : 0;
      if (Math.abs(moved) >= 0.5) view.scrollTop += moved;
    }
    state.record = cardsInView(view, rows);
  };

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return undefined;
    const keeps = !browserAnchorsScroll();
    const onScroll = () => {
      if (state.placing && view.scrollTop !== state.placing.scrollTop) stopPlacing(state);
      // The reader's own scrolling moves the cards; the next commit compares from there.
      if (keeps) state.record = cardsInView(view, state.rows);
    };
    view.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      view.removeEventListener('scroll', onScroll);
      stopPlacing(state);
      state.taken.clear();
      // A list without its cards, before they render or after they all went, keeps the place
      // saved before it.
      if (state.ready) memory.set(roomId, captureScrollAnchors(view));
    };
  }, [memory, roomId, state, viewRef]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    const first = ready && !state.ready;
    state.ready = ready;
    if (!view || !ready) return;
    let taken = false;
    if (request && !state.taken.has(request.id)) {
      // A link that came before the cards outranks the place the room would open with.
      state.taken.add(request.id).add(MOUNT_REQUEST);
      // A link's card that shows whole stays where it is.
      const to = 'focus' in request ? compactFocusPlace(request.focus, view) : request;
      if (to) {
        stopPlacing(state);
        state.placing = { place: to, placedRows: [], rowOrder: [], scrollTop: view.scrollTop };
        taken = true;
      }
    }
    if (!state.placing || !(taken || first)) return;
    place(view, state);
    if (!state.placing) return;
    state.placing.observer?.disconnect();
    state.placing.observer = new ResizeObserver(() => place(view, state));
    state.placing.observer.observe(view);
    if (contentRef.current) state.placing.observer.observe(contentRef.current);
  });

  return <BeforeParent run={keep} />;
};
