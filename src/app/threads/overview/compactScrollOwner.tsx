import { type RefObject, useCallback, useLayoutEffect, useState } from 'react';
import { BeforeChange } from '../../ui/listMotion';
import {
  type ScrollAnchorMemory,
  type ScrollAnchorSnapshot,
  captureScrollAnchors,
  keepsRowOrder,
  placeRows,
} from '../../ui/scrollAnchorMemory';
import { type CompactFocusRequest, compactFocusPlace } from './compactFocusRequest';
import { type SectionOfRow, stationaryRows } from './compactShownOrder';

type CardsInView = {
  cards: { card: HTMLElement; rootId: string; top: number }[];
  scrollTop: number;
  order: readonly string[];
};

const ANCHOR_CANDIDATES = 8;

const cardsInView = (
  view: HTMLElement,
  order: readonly string[],
  scrollTop: number
): CardsInView | undefined => {
  const viewTop = view.getBoundingClientRect().top;
  const elements = view.querySelectorAll<HTMLElement>('[data-scroll-anchor]');
  // Binary search the single column of cards so reading far down a long list costs O(log n) reads.
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
    if (card && rootId) cards.push({ card, rootId, top: card.getBoundingClientRect().top });
  }
  return cards.length > 0 ? { cards, scrollTop, order } : undefined;
};

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
  placedRows: string[];
  rowOrder: readonly string[];
  observer?: ResizeObserver;
  consumed: Set<string>;
  jumped: boolean;
};

const stopObserving = (state: ScrollState): void => {
  state.observer?.disconnect();
  state.observer = undefined;
};

const clearPending = (state: ScrollState): false => {
  state.pending = undefined;
  state.placedRows = [];
  state.rowOrder = [];
  stopObserving(state);
  return false;
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
  if (view.scrollTop !== state.offset) return clearPending(state);
  if (!state.ready) return false;
  if ('focus' in request) {
    const place = compactFocusPlace(request.focus, view);
    if (place === null) return false;
    if (!place) return clearPending(state);
    request = { id: request.id, ...place };
    state.pending = request;
  }
  const placement = placeRows(view, request, state.placedRows);
  const reordered =
    state.placedRows.length > 0 &&
    state.rowOrder !== state.rows &&
    !keepsRowOrder(state.rowOrder, state.rows);
  if (!placement || reordered) return clearPending(state);
  const jumped = writeOffset(view, state, placement.scrollTop);
  state.placedRows = placement.rows;
  state.rowOrder = state.rows;
  return jumped;
};

/** Measure old cards, settle once before layout effects, then let the parent read for motion. */
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
    placedRows: [],
    rowOrder: [],
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
      state.placedRows = [];
      state.rowOrder = [];
      state.offset = view.scrollTop;
    }
    if (state.pending) state.jumped = placePending(view, state);
    if (!state.pending && before && view.scrollTop === before.scrollTop) {
      const stationary =
        before.order === rows ? undefined : stationaryRows(before.order, rows, sectionOfRow);
      const anchor = before.cards.find(
        ({ card, rootId }) => card.isConnected && (stationary?.has(rootId) ?? true)
      );
      const moved = anchor ? anchor.card.getBoundingClientRect().top - anchor.top : 0;
      if (Math.abs(moved) >= 0.5) writeOffset(view, state, before.scrollTop + moved);
    }
    state.offset = view.scrollTop;

    // Follow late resizes (insets, hydrating cards) while placing a saved position or link.
    if (state.pending && !state.observer && typeof ResizeObserver !== 'undefined') {
      state.observer = new ResizeObserver(() => {
        placePending(view, state);
        state.offset = view.scrollTop;
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
      clearPending(state);
    };
    view.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      view.removeEventListener('scroll', onScroll);
      stopObserving(state);
      if (state.ready) memory.set(roomId, captureScrollAnchors(view));
    };
  }, [memory, roomId, state, viewRef]);

  // New callbacks each render: measure even when the order did not change.
  const skipMotion = useCallback(() => state.jumped, [state]);
  return { phase: <BeforeChange order="" read={read} keep={keep} />, skipMotion };
};
