import { describe, expect, it } from 'vitest';
import { stepRoom, stepUnreadRoom } from './roomSteps';

const rooms = ['a', 'b', 'c', 'd'];

describe('stepRoom', () => {
  it('moves one room and stops at either end', () => {
    expect(stepRoom(rooms, 'b', 1)).toBe('c');
    expect(stepRoom(rooms, 'b', -1)).toBe('a');
    expect(stepRoom(rooms, 'd', 1)).toBeUndefined();
    expect(stepRoom(rooms, 'a', -1)).toBeUndefined();
  });

  it('starts at the first or last room from outside the list', () => {
    expect(stepRoom(rooms, undefined, 1)).toBe('a');
    expect(stepRoom(rooms, 'x', -1)).toBe('d');
    expect(stepRoom([], undefined, 1)).toBeUndefined();
  });
});

describe('stepUnreadRoom', () => {
  const unread = new Set(['a', 'c']);
  const isUnread = (roomId: string) => unread.has(roomId);

  it('finds the nearest unread room that way, around the end', () => {
    expect(stepUnreadRoom(rooms, 'a', 1, isUnread)).toBe('c');
    expect(stepUnreadRoom(rooms, 'c', 1, isUnread)).toBe('a');
    expect(stepUnreadRoom(rooms, 'b', -1, isUnread)).toBe('a');
    expect(stepUnreadRoom(rooms, undefined, -1, isUnread)).toBe('c');
  });

  it('skips the open room and finds nothing when no other room is unread', () => {
    expect(stepUnreadRoom(rooms, 'a', 1, (roomId) => roomId === 'a')).toBeUndefined();
  });
});
