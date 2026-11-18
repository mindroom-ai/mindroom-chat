import { describe, expect, it } from 'vitest';
import type { ScrollAnchorMemory, ScrollAnchorSnapshot } from '../../ui/scrollAnchorMemory';
import { takeCompactFocusRequest } from './compactFocusRequest';

const ROOM_ID = '!room:example.org';
const CARD = '$card';
const focusedPlace = (key: string): ScrollAnchorSnapshot => ({
  scrollTop: 1,
  anchors: [{ key, offset: 160 }],
});
const leftAtTop: ScrollAnchorSnapshot = { scrollTop: 0, anchors: [{ key: '$top', offset: 0 }] };
const entry = (key?: string) => ({ idx: 0, usr: null, ...(key ? { key } : {}) });

describe('takeCompactFocusRequest', () => {
  it('gives the card a place in a list that saved none', () => {
    const memory: ScrollAnchorMemory = new Map();
    takeCompactFocusRequest(memory, ROOM_ID, CARD, [CARD], entry('a'));
    expect(memory.get(ROOM_ID)).toEqual(focusedPlace(CARD));
  });

  it('keeps a saved place that has the card in view', () => {
    const saved = { scrollTop: 900, anchors: [{ key: CARD, offset: 320 }] };
    const memory: ScrollAnchorMemory = new Map([[ROOM_ID, saved]]);
    takeCompactFocusRequest(memory, ROOM_ID, CARD, [CARD], entry('a'));
    expect(memory.get(ROOM_ID)).toBe(saved);
  });

  it('keeps the place the reader left on a return to an entry whose request the list met', () => {
    const memory: ScrollAnchorMemory = new Map();
    takeCompactFocusRequest(memory, ROOM_ID, CARD, [CARD, '$top'], entry('a'));
    // The reader scrolls to the top and opens a card: the list saves that place as it goes.
    memory.set(ROOM_ID, leftAtTop);
    takeCompactFocusRequest(memory, ROOM_ID, CARD, [CARD, '$top'], entry('a'));
    expect(memory.get(ROOM_ID)).toBe(leftAtTop);
  });

  it('takes the same request again from another entry, such as a thread left once more', () => {
    const memory: ScrollAnchorMemory = new Map();
    takeCompactFocusRequest(memory, ROOM_ID, CARD, [CARD], entry('a'));
    memory.set(ROOM_ID, leftAtTop);
    takeCompactFocusRequest(memory, ROOM_ID, CARD, [CARD], entry('b'));
    expect(memory.get(ROOM_ID)).toEqual(focusedPlace(CARD));
  });

  it('takes a request again until the list holds its card', () => {
    const memory: ScrollAnchorMemory = new Map();
    // The card's thread has not loaded: the list shows other cards, and is left and shown again.
    takeCompactFocusRequest(memory, ROOM_ID, CARD, ['$top'], entry('a'));
    memory.set(ROOM_ID, leftAtTop);
    takeCompactFocusRequest(memory, ROOM_ID, CARD, ['$top', CARD], entry('a'));
    expect(memory.get(ROOM_ID)).toEqual(focusedPlace(CARD));
    memory.set(ROOM_ID, leftAtTop);
    takeCompactFocusRequest(memory, ROOM_ID, CARD, ['$top', CARD], entry('a'));
    expect(memory.get(ROOM_ID)).toBe(leftAtTop);
  });

  it('takes a met request again in a list with a new memory, such as after another room', () => {
    takeCompactFocusRequest(new Map(), ROOM_ID, CARD, [CARD], entry('a'));
    const memory: ScrollAnchorMemory = new Map();
    takeCompactFocusRequest(memory, ROOM_ID, CARD, [CARD], entry('a'));
    expect(memory.get(ROOM_ID)).toEqual(focusedPlace(CARD));
  });

  it('knows the entry a page load starts on, which has no key, and its request by its event', () => {
    const memory: ScrollAnchorMemory = new Map();
    takeCompactFocusRequest(memory, ROOM_ID, CARD, [CARD, '$other'], entry());
    memory.set(ROOM_ID, leftAtTop);
    takeCompactFocusRequest(memory, ROOM_ID, CARD, [CARD, '$other'], null);
    expect(memory.get(ROOM_ID)).toBe(leftAtTop);
    takeCompactFocusRequest(memory, ROOM_ID, '$other', [CARD, '$other'], null);
    expect(memory.get(ROOM_ID)).toEqual(focusedPlace('$other'));
  });
});
