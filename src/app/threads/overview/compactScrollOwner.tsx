import { type RefObject, useCallback, useLayoutEffect, useState } from 'react';
import { BeforeChange } from '../../ui/listMotion';
import {
  type ScrollAnchorMemory,
  type ScrollAnchorSnapshot,
  captureScrollAnchors,
  placeRows,
} from '../../ui/scrollAnchorMemory';
import { type CompactFocusRequest, compactFocusPlace } from './compactFocusRequest';
import { type SectionOfRow, stationaryRows } from './compactShownOrder';

/** The topmost cards in view, their tops on screen, the scroll offset and the order then. */
type CardsInView = {
  cards: { card: HTMLElement; rootId: string; top: number }[];
  scrollTop: number;
  order: readonly string[];
};

/** How many cards in view are tried, from the top, for one that kept its place. */
const ANCHOR_CANDIDATES = 8;

/** The topmost cards in view (cards carry `data-scroll-anchor`). */
const cardsInView = (
  view: HTMLElement,
  order: readonly string[],
  scrollTop: number
): CardsInView | undefined => {
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
    if (card && rootId) cards.push({ card, rootId, top: card.getBoundingClientRect().top });
  }
  return cards.length > 0 ? { cards, scrollTop, order } : undefined;
};

/** CSS scroll anchoring (Chromium, Firefox) keeps the cards in view in place by itself. */
const browserAnchorsScroll = (): boolean =>
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('overflow-anchor', 'auto');

export type CompactScrollRequest = { id: string } & (
  | ScrollAnchorSnapshot
  | { focus: CompactFocusRequest }
);

type Options = {
  viewRef: RefObject<HTMLElement>;
  contentRef: RefObject<HTMLElement>;
  rows: readonly string[];
  sectionOfRow: SectionOfRow;
  request: CompactScrollRequest | undefined;
  memory: ScrollAnchorMemory;
  roomId: string;
  ready: boolean;
};

type ScrollState = {
  rows: readonly string[];
  ready: boolean;
  offset: number;
  lastWrite?: number;
  pending?: CompactScrollRequest;
  observer?: ResizeObserver;
  consumed: Set<string>;
  jumped: boolean;
};

const writeOffset = (view: HTMLElement, state: ScrollState, top: number): boolean => {
  const before = view.scrollTop;
  if (before === top) return false;
  // eslint-disable-next-line no-param-reassign -- the Compact list's only placement write
  view.scrollTop = top;
  state.lastWrite = view.scrollTop;
  return state.lastWrite !== before;
};

const placePending = (view: HTMLElement, state: ScrollState): boolean => {
  let request = state.pending;
  if (!request) return false;
  if (view.scrollTop !== state.offset) state.pending = undefined;
  if (!state.pending || !state.ready) return false;
  if ('focus' in request) {
    const place = compactFocusPlace(request.focus, view);
    if (place === null) return false; // The mounted link's card has yet to show.
    state.pending = place && { id: request.id, ...place };
    if (!state.pending) return false; // The card already shows whole.
    request = state.pending;
  }
  const placement = placeRows(view, request, []);
  if (!placement) return false;
  const jumped = writeOffset(view, state, placement.scrollTop);
  const placed =
    placement.rows.length > 0 ||
    (request.anchors.length === 0 && Math.abs(view.scrollTop - request.scrollTop) < 0.5);
  if (placed && !view.hasAttribute('data-cards-pending')) state.pending = undefined;
  return jumped;
};

/** Measure old cards, settle once, then let the parent read for list motion. */
export const useCompactScrollOwner = ({
  viewRef,
  contentRef,
  rows,
  sectionOfRow,
  request,
  memory,
  roomId,
  ready,
}: Options) => {
  const [state] = useState<ScrollState>(() => ({
    rows,
    ready,
    offset: 0,
    consumed: new Set(),
    jumped: false,
  }));
  const read = () => {
    const view = viewRef.current;
    if (!view || browserAnchorsScroll()) return undefined;
    const offset = view.scrollTop;
    // A scroll whose event is still pending is the reader's, not a layout change to undo.
    return offset > 0 && offset === state.offset
      ? cardsInView(view, state.rows, offset)
      : undefined;
  };
  const keep = (before?: CardsInView) => {
    const view = viewRef.current;
    if (!view) return;
    state.ready = ready;
    state.rows = rows;
    state.jumped = false;
    if (request && !state.consumed.has(request.id)) {
      state.consumed.add(request.id);
      state.pending = request;
      state.offset = view.scrollTop;
    }
    if (state.pending) state.jumped = placePending(view, state);
    else if (before && view.scrollTop === before.scrollTop) {
      const stationary =
        before.order === rows ? undefined : stationaryRows(before.order, rows, sectionOfRow);
      const anchor = before.cards.find(
        ({ card, rootId }) => card.isConnected && (stationary?.has(rootId) ?? true)
      );
      const moved = anchor ? anchor.card.getBoundingClientRect().top - anchor.top : 0;
      if (Math.abs(moved) >= 0.5) writeOffset(view, state, before.scrollTop + moved);
    }
    state.offset = view.scrollTop;

    // Main follows late resizes only while placing a saved position or link, not while reading.
    if (state.pending && !state.observer) {
      state.observer = new ResizeObserver(() => {
        placePending(view, state);
        state.offset = view.scrollTop;
        if (!state.pending) stopObserving(state);
      });
      state.observer.observe(view);
      if (contentRef.current) state.observer.observe(contentRef.current);
    } else if (!state.pending) stopObserving(state);
  };

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return undefined;
    const onScroll = () => {
      state.offset = view.scrollTop;
      if (state.offset === state.lastWrite) return;
      state.lastWrite = undefined;
      state.pending = undefined;
      stopObserving(state);
    };
    view.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      view.removeEventListener('scroll', onScroll);
      stopObserving(state);
      // An empty list leaves its saved place alone.
      if (state.ready) memory.set(roomId, captureScrollAnchors(view));
    };
  }, [memory, roomId, state, viewRef]);

  // New callbacks each render: measure even when the order did not change.
  const skipMotion = useCallback(() => state.jumped, [state]);
  return { phase: <BeforeChange order="" read={read} keep={keep} />, skipMotion };
};

const stopObserving = (state: ScrollState): void => {
  state.observer?.disconnect();
  state.observer = undefined;
};
