import { getHistoryEntryKey } from '../../routes/roomNavigateState';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';

/** Where a focused Compact card without a saved place sits: its top this far below the list's. */
const COMPACT_FOCUSED_CARD_OFFSET_PX = 160;

// The requests a list has met, as `<history entry> <event>`, kept as long as its saved places.
const metRequests = new WeakMap<ScrollAnchorMemory, Set<string>>();

/**
 * An address can ask a room's cards to show one of them (`?focusEvent=1`). The request is its
 * history entry's (`historyState`), once: it gives the card a place in the list's `memory`, unless
 * the place saved there has the card in view, until the list holds the card. Returning to that
 * entry later (a back or forward step) keeps the place the reader left.
 */
export const takeCompactFocusRequest = (
  memory: ScrollAnchorMemory,
  roomId: string,
  eventId: string,
  cardIds: readonly string[],
  historyState: unknown
): void => {
  // The entry a page load starts on has no key; the router calls it `default`.
  const request = `${getHistoryEntryKey(historyState) ?? 'default'} ${eventId}`;
  const met = metRequests.get(memory) ?? new Set<string>();
  if (met.has(request)) return;
  if (!memory.get(roomId)?.anchors.some((anchor) => anchor.key === eventId)) {
    memory.set(roomId, {
      scrollTop: 1,
      anchors: [{ key: eventId, offset: COMPACT_FOCUSED_CARD_OFFSET_PX }],
    });
  }
  if (cardIds.includes(eventId)) metRequests.set(memory, met.add(request));
};
