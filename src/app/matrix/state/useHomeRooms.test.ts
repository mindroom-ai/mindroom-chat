import { describe, expect, it } from 'vitest';
import {
  getHomeSearchRooms,
  getUnspacedHomeRooms,
  isOrdinaryRoom,
  mergeHomeSearchRoomSources,
} from './useHomeRooms';

/** A room whose m.room.create event has the given `type`. */
const roomOfType = (type: string) =>
  ({
    getLiveTimeline: () => ({
      getState: () => ({ getStateEvents: () => ({ getContent: () => ({ type }) }) }),
    }),
  }) as never;

const mxWithTypes = (types: Record<string, string>) =>
  ({
    getRoom: (roomId: string) => (types[roomId] ? roomOfType(types[roomId]) : null),
  }) as never;

describe('isOrdinaryRoom', () => {
  it('excludes direct messages, spaces, and the server emoji room', () => {
    const mx = mxWithTypes({
      '!space:example.org': 'm.space',
      '!emoji:example.org': 'io.mindroom.emoji',
    });
    const directs = new Set(['!dm:example.org']);

    expect(isOrdinaryRoom(mx, '!room:example.org', directs)).toBe(true);
    expect(isOrdinaryRoom(mx, '!dm:example.org', directs)).toBe(false);
    expect(isOrdinaryRoom(mx, '!space:example.org', directs)).toBe(false);
    expect(isOrdinaryRoom(mx, '!emoji:example.org', directs)).toBe(false);
  });
});

describe('getHomeSearchRooms', () => {
  it('includes both unspaced and spaced ordinary rooms while excluding directs, spaces, and emoji', () => {
    const mx = mxWithTypes({
      '!space:example.org': 'm.space',
      '!emoji:example.org': 'io.mindroom.emoji',
    });

    expect(
      getHomeSearchRooms(
        mx,
        [
          '!root:example.org',
          '!space:example.org',
          '!child:example.org',
          '!dm:example.org',
          '!emoji:example.org',
        ],
        new Set(['!dm:example.org'])
      )
    ).toEqual(['!root:example.org', '!child:example.org']);
  });

  it('deduplicates room ids when multiple room sources are merged upstream', () => {
    expect(
      mergeHomeSearchRoomSources(
        ['!root:example.org', '!sdk-only:example.org'],
        ['!root:example.org', '!other:example.org']
      )
    ).toEqual(['!root:example.org', '!sdk-only:example.org', '!other:example.org']);
  });
});

describe('getUnspacedHomeRooms', () => {
  it('keeps unspaced rooms and their chat sub-rooms, excluding rooms inside joined spaces', () => {
    const mx = mxWithTypes({ '!space:example.org': 'm.space' });
    const joined = new Set([
      '!space:example.org',
      '!room:example.org',
      '!room-sub:example.org',
      '!space-room:example.org',
      '!space-room-sub:example.org',
      '!dm:example.org',
    ]);
    const parents = new Map([
      ['!room-sub:example.org', new Set(['!room:example.org'])],
      ['!space-room:example.org', new Set(['!space:example.org'])],
      ['!space-room-sub:example.org', new Set(['!space-room:example.org'])],
    ]);

    expect(
      getUnspacedHomeRooms(
        mx,
        [
          '!space:example.org',
          '!room:example.org',
          '!room-sub:example.org',
          '!space-room:example.org',
          '!space-room-sub:example.org',
          '!dm:example.org',
        ],
        new Set(['!dm:example.org']),
        parents,
        joined
      )
    ).toEqual(['!room:example.org', '!room-sub:example.org']);
  });

  it('falls back to unspaced when the enclosing space is left (cached in SDK but not joined)', () => {
    const mx = mxWithTypes({
      '!joined-outer:example.org': 'm.space',
      '!left-space:example.org': 'm.space',
    });
    // Only !joined-outer and the two rooms are joined; !left-space was left.
    const joined = new Set([
      '!joined-outer:example.org',
      '!orphaned-room:example.org',
      '!nested-in-left:example.org',
    ]);
    const parents = new Map([
      ['!orphaned-room:example.org', new Set(['!left-space:example.org'])],
      ['!left-space:example.org', new Set(['!joined-outer:example.org'])],
      ['!nested-in-left:example.org', new Set(['!left-space:example.org'])],
    ]);

    expect(
      getUnspacedHomeRooms(
        mx,
        ['!orphaned-room:example.org', '!nested-in-left:example.org'],
        new Set(),
        parents,
        joined
      )
    ).toEqual(['!orphaned-room:example.org', '!nested-in-left:example.org']);
  });
});
