import type { ScrollAnchorMemory, ScrollAnchorSnapshot } from '../../ui/scrollAnchorMemory';

/** Where a focused Compact card without a saved place sits: its top this far below the list's. */
const COMPACT_FOCUSED_CARD_OFFSET_PX = 160;

const focusedPlace = (eventId: string): ScrollAnchorSnapshot => ({
  scrollTop: 1,
  anchors: [{ key: eventId, offset: COMPACT_FOCUSED_CARD_OFFSET_PX }],
});

/**
 * An address's request that the room's cards show one of them (`?focusEvent=1`): the card's event,
 * the router's key of the history entry that asks, and whether the router pushed that entry (a
 * link followed), which alone moves a list already mounted.
 */
export type CompactFocusRequest = {
  eventId: string;
  entryKey: string | undefined;
  pushed?: boolean;
};

// The requests a list has met, as `<history entry> <event>`, kept as long as its saved places.
const metRequests = new WeakMap<ScrollAnchorMemory, Set<string>>();

// Entries the router did not write (the one a page load starts on, a change of the fragment alone)
// share the key `default`, so a request of theirs is never met: every return to them takes it.
const metKey = ({ eventId, entryKey }: CompactFocusRequest): string | undefined =>
  entryKey && entryKey !== 'default' ? `${entryKey} ${eventId}` : undefined;

/**
 * A request is its history entry's once: it gives the card a place in the list's `memory`, unless
 * the place saved there has the card in view, until the list has shown the card. Returning to
 * that entry later (a back or forward step) keeps the place the reader left.
 */
export const takeCompactFocusRequest = (
  memory: ScrollAnchorMemory,
  roomId: string,
  request: CompactFocusRequest
): void => {
  const key = metKey(request);
  if (key && metRequests.get(memory)?.has(key)) return;
  if (!memory.get(roomId)?.anchors.some((anchor) => anchor.key === request.eventId)) {
    memory.set(roomId, focusedPlace(request.eventId));
  }
};

/** Whether the list has still to show the card `request` asks for. */
export const isCompactFocusRequestOpen = (
  memory: ScrollAnchorMemory,
  request: CompactFocusRequest
): boolean => {
  const key = metKey(request);
  return !!key && !metRequests.get(memory)?.has(key);
};

/** A request that comes to the mounted list `view`: its card's place, unless it shows whole. */
export const compactFocusPlace = (
  request: CompactFocusRequest,
  view: HTMLElement
): ScrollAnchorSnapshot | undefined => {
  const card = Array.from(view.querySelectorAll('[data-scroll-anchor]')).find(
    (row) => row.getAttribute('data-scroll-anchor') === request.eventId
  );
  const style = getComputedStyle(view);
  const shown = view.getBoundingClientRect();
  const top = shown.top + (Number.parseFloat(style.scrollPaddingTop) || 0);
  const bottom = shown.bottom - (Number.parseFloat(style.scrollPaddingBottom) || 0);
  const rect = card?.getBoundingClientRect();
  return rect && rect.top >= top && rect.bottom <= bottom
    ? undefined
    : focusedPlace(request.eventId);
};

/** The list shows the card `request` asks for. For an effect: a render can be abandoned. */
export const meetCompactFocusRequest = (
  memory: ScrollAnchorMemory,
  request: CompactFocusRequest
): void => {
  const key = metKey(request);
  if (key) metRequests.set(memory, (metRequests.get(memory) ?? new Set()).add(key));
};
