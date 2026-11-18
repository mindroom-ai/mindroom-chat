import { describe, expect, it } from 'vitest';
import type { ScrollAnchorMemory, ScrollAnchorSnapshot } from '../../ui/scrollAnchorMemory';
import { meetCompactFocusRequest, takeCompactFocusRequest } from './compactFocusRequest';

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
  takeCompactFocusRequest(memory, ROOM_ID, { eventId, entryKey });
  return memory.get(ROOM_ID);
};

describe('a compact focus request', () => {
  it('gives the card a place in a list that saved none', () => {
    const memory: ScrollAnchorMemory = new Map();
    takeCompactFocusRequest(memory, ROOM_ID, { eventId: CARD, entryKey: 'a' });
    expect(memory.get(ROOM_ID)).toEqual(focusedPlace(CARD));
  });

  it('keeps a saved place that has the card in view', () => {
    const saved = { scrollTop: 900, anchors: [{ key: CARD, offset: 320 }] };
    const memory: ScrollAnchorMemory = new Map([[ROOM_ID, saved]]);
    takeCompactFocusRequest(memory, ROOM_ID, { eventId: CARD, entryKey: 'a' });
    expect(memory.get(ROOM_ID)).toBe(saved);
  });

  it('keeps the place the reader left on a return to an entry whose request was met', () => {
    const memory: ScrollAnchorMemory = new Map();
    takeCompactFocusRequest(memory, ROOM_ID, { eventId: CARD, entryKey: 'a' });
    meetCompactFocusRequest(memory, { eventId: CARD, entryKey: 'a' });
    expect(returnTo(memory, 'a')).toBe(leftAtTop);
  });

  it('is taken again until it is met: taking it, as a render does, does not meet it', () => {
    const memory: ScrollAnchorMemory = new Map();
    takeCompactFocusRequest(memory, ROOM_ID, { eventId: CARD, entryKey: 'a' });
    takeCompactFocusRequest(memory, ROOM_ID, { eventId: CARD, entryKey: 'a' });
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
