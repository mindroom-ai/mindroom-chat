import type { Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { buildVisibleRecentThreadEntries } from './recentThreadsPanelUtils';

describe('buildVisibleRecentThreadEntries', () => {
  it('keeps only joined rooms in the visible panel entries', () => {
    const joinedRoom = {
      roomId: '!joined:example.org',
      getMyMembership: () => 'join',
    } as unknown as Room;
    const leftRoom = {
      roomId: '!left:example.org',
      getMyMembership: () => 'leave',
    } as unknown as Room;

    const visibleEntries = buildVisibleRecentThreadEntries(
      (roomId) =>
        ({
          '!joined:example.org': joinedRoom,
          '!left:example.org': leftRoom,
        }[roomId]),
      [
        { roomId: '!joined:example.org', threadId: '$joined', openedAt: 3 },
        { roomId: '!left:example.org', threadId: '$left', openedAt: 2 },
        { roomId: '!missing:example.org', threadId: '$missing', openedAt: 1 },
      ]
    );

    expect(visibleEntries).toEqual([
      {
        roomId: '!joined:example.org',
        threadId: '$joined',
        openedAt: 3,
        room: joinedRoom,
      },
    ]);
  });
});
