import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import { roomToParentsAtom } from './roomToParents';
import { roomToUnreadAtom } from './roomToUnread';

const SPACE = '!space:example.org';
const ROOM = '!garden:example.org';
const SUB_ROOM = '!seeds:example.org';

/** A room in a space with a sub-room under it, both with unread messages. */
const setup = () => {
  const store = createStore();
  store.set(roomToParentsAtom, {
    type: 'INITIALIZE',
    roomToParents: new Map([
      [ROOM, new Set([SPACE])],
      [SUB_ROOM, new Set([ROOM])],
    ]),
    chatRooms: [ROOM],
  });
  store.set(roomToUnreadAtom, {
    type: 'RESET',
    unreadInfos: [
      { roomId: ROOM, total: 5, highlight: 2 },
      { roomId: SUB_ROOM, total: 1, highlight: 0 },
    ],
  });
  return store.get(roomToUnreadAtom);
};

describe('roomToUnreadAtom with sub-rooms', () => {
  it("keeps a room's own counts when a sub-room under it is unread", () => {
    expect(setup().get(ROOM)).toEqual({ total: 5, highlight: 2 });
  });

  it('counts a sub-room in the spaces above its room', () => {
    expect(setup().get(SPACE)).toEqual({
      total: 6,
      highlight: 2,
      from: new Set([ROOM, SUB_ROOM]),
    });
  });
});
