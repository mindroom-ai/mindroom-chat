import { MatrixEvent, type EventTimelineSet, type MatrixClient, type Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { forkPrefixThreadId, rowEditTimelineSet, rowEventRoom } from './forkPrefixTimelineSet';

const reply = (id: string, threadRootId?: string) => {
  const event = new MatrixEvent({ event_id: id, type: 'm.room.message', content: {} });
  if (threadRootId) Object.defineProperty(event, 'threadRootId', { value: threadRootId });
  return event;
};

const parentSet = { name: 'parent' } as unknown as EventTimelineSet;
const rowSet = { name: 'row' } as unknown as EventTimelineSet;
const room = {
  getThread: (id: string) =>
    id === '$parent' ? { getUnfilteredTimelineSet: () => parentSet } : null,
} as unknown as Room;

describe('forkPrefixThreadId', () => {
  it("names the parent thread of a fork prefix's row, by its root or by its own ID", () => {
    const prefix = new Set(['$p', '$parent']);
    expect(forkPrefixThreadId(reply('$p', '$parent'), '$p', prefix)).toBe('$parent');
    expect(forkPrefixThreadId(reply('$parent'), '$parent', prefix)).toBe('$parent');
    expect(forkPrefixThreadId(reply('$own', '$fork'), '$own', prefix)).toBeUndefined();
    expect(forkPrefixThreadId(reply('$p', '$parent'), '$p', undefined)).toBeUndefined();
  });
});

describe('rowEditTimelineSet', () => {
  it("reads a prefix row's edits from its parent thread, and others' from the row's set", () => {
    expect(rowEditTimelineSet(room, '$parent', rowSet)).toBe(parentSet);
    expect(rowEditTimelineSet(room, undefined, rowSet)).toBe(rowSet);
    expect(rowEditTimelineSet(room, '$unknown', rowSet)).toBe(rowSet);
  });
});

describe('rowEventRoom', () => {
  const sourceRoom = { roomId: '!alpha:example.org' } as unknown as Room;
  const targetRoom = { roomId: '!beta:example.org' } as unknown as Room;
  const mx = {
    getRoom: (id: string) => (id === '!alpha:example.org' ? sourceRoom : null),
  } as unknown as MatrixClient;

  it('resolves the owning room for a cross-room prefix row and falls back to the current room otherwise', () => {
    const crossEvent = new MatrixEvent({
      event_id: '$p',
      room_id: '!alpha:example.org',
      type: 'm.room.message',
      content: {},
    });
    const unknownRoomEvent = new MatrixEvent({
      event_id: '$u',
      room_id: '!unknown:example.org',
      type: 'm.room.message',
      content: {},
    });
    expect(rowEventRoom(mx, targetRoom, crossEvent, '$parent')).toBe(sourceRoom);
    expect(rowEventRoom(mx, targetRoom, crossEvent, undefined)).toBe(targetRoom);
    expect(rowEventRoom(mx, targetRoom, unknownRoomEvent, '$parent')).toBe(targetRoom);
  });
});
