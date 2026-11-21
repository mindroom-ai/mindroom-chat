import { describe, expect, it } from 'vitest';
import type { ScrollAnchorMemory, ScrollAnchorSnapshot } from '../../ui/scrollAnchorMemory';
import { meetCompactFocusRequest, compactMountPlace } from './compactFocusRequest';

const ROOM_ID = '!room:example.org';
const CARD = '$card';
const focusedPlace = (key: string): ScrollAnchorSnapshot => ({
  scrollTop: 1,
  anchors: [{ key, offset: 160 }],
});
const leftAtTop: ScrollAnchorSnapshot = { scrollTop: 0, anchors: [{ key: '$top', offset: 0 }] };

// The reader scrolls to the top and opens a card (the list saves that place as it goes), then
// comes back to the entry `entryKey`, whose address asks for `eventId`.
const returnTo = (memory: ScrollAnchorMemory, entryKey: string | undefined, eventId = CARD) => {
  memory.set(ROOM_ID, leftAtTop);
  return compactMountPlace(memory, ROOM_ID, { eventId, entryKey }) ?? leftAtTop;
};

describe('a compact focus request', () => {
  it('gives the card a place in a list that saved none', () => {
    const memory: ScrollAnchorMemory = new Map();
    expect(compactMountPlace(memory, ROOM_ID, { eventId: CARD, entryKey: 'a' })).toEqual(
      focusedPlace(CARD)
    );
    expect(memory.size).toBe(0);
  });

  it('keeps a saved place that has the card in view', () => {
    const saved = { scrollTop: 900, anchors: [{ key: CARD, offset: 320 }] };
    const memory: ScrollAnchorMemory = new Map([[ROOM_ID, saved]]);
    expect(compactMountPlace(memory, ROOM_ID, { eventId: CARD, entryKey: 'a' })).toBe(saved);
  });

  it('keeps the place the reader left on a return to an entry whose request was met', () => {
    const memory: ScrollAnchorMemory = new Map();
    compactMountPlace(memory, ROOM_ID, { eventId: CARD, entryKey: 'a' });
    meetCompactFocusRequest(memory, { eventId: CARD, entryKey: 'a' });
    expect(returnTo(memory, 'a')).toBe(leftAtTop);
  });

  it("keeps the place the reader left on a return that put a new entry in the thread's place", () => {
    // The iOS app's Back replaces the thread's entry with the room's address, request included:
    // the request is the room entry's, met there, and the reader has scrolled since.
    const memory: ScrollAnchorMemory = new Map();
    meetCompactFocusRequest(memory, { eventId: CARD, entryKey: 'a' });
    memory.set(ROOM_ID, leftAtTop);
    expect(
      compactMountPlace(memory, ROOM_ID, { eventId: CARD, entryKey: 'b', returned: true })
    ).toBeUndefined();
  });

  it('is taken on a return with no saved place, as after a reload', () => {
    const memory: ScrollAnchorMemory = new Map();
    expect(
      compactMountPlace(memory, ROOM_ID, { eventId: CARD, entryKey: 'b', returned: true })
    ).toEqual(focusedPlace(CARD));
  });

  it('is taken again until it is met: taking it, as a render does, does not meet it', () => {
    const memory: ScrollAnchorMemory = new Map();
    compactMountPlace(memory, ROOM_ID, { eventId: CARD, entryKey: 'a' });
    compactMountPlace(memory, ROOM_ID, { eventId: CARD, entryKey: 'a' });
    expect(returnTo(memory, 'a')).toEqual(focusedPlace(CARD));
  });

  it('is met for its own entry and event only', () => {
    const memory: ScrollAnchorMemory = new Map();
    meetCompactFocusRequest(memory, { eventId: CARD, entryKey: 'a' });
    // The same card from another entry, such as its thread left once more.
    expect(returnTo(memory, 'b')).toEqual(focusedPlace(CARD));
    expect(returnTo(memory, 'a', '$other')).toEqual(focusedPlace('$other'));
    expect(returnTo(memory, 'a')).toBe(leftAtTop);
  });

  it('is taken again in a list with a new memory, such as after another room', () => {
    meetCompactFocusRequest(new Map(), { eventId: CARD, entryKey: 'a' });
    expect(returnTo(new Map(), 'a')).toEqual(focusedPlace(CARD));
  });

  it.each([['default'], [undefined]])(
    'is never met for an entry the router did not key (%s), which others share',
    (entryKey) => {
      const memory: ScrollAnchorMemory = new Map();
      meetCompactFocusRequest(memory, { eventId: CARD, entryKey });
      expect(returnTo(memory, entryKey)).toEqual(focusedPlace(CARD));
    }
  );
});
