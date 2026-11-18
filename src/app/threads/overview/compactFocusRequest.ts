import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';

/** Where a focused Compact card without a saved place sits: its top this far below the list's. */
const COMPACT_FOCUSED_CARD_OFFSET_PX = 160;

/**
 * An address's request that the room's cards show one of them (`?focusEvent=1`): the card's event
 * and the router's key of the history entry that asks.
 */
export type CompactFocusRequest = { eventId: string; entryKey: string | undefined };

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
    memory.set(roomId, {
      scrollTop: 1,
      anchors: [{ key: request.eventId, offset: COMPACT_FOCUSED_CARD_OFFSET_PX }],
    });
  }
};

/** The list shows the card `request` asks for. For an effect: a render can be abandoned. */
export const meetCompactFocusRequest = (
  memory: ScrollAnchorMemory,
  request: CompactFocusRequest
): void => {
  const key = metKey(request);
  if (key) metRequests.set(memory, (metRequests.get(memory) ?? new Set()).add(key));
};
