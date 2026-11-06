import type { MatrixClient, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { findReplacedRooms } from './replacedRooms';

type FakeRoom = { roomId: string; membership: string; successor?: string };

const makeClient = (rooms: FakeRoom[]) => {
  const byId = new Map(
    rooms.map((room) => [
      room.roomId,
      {
        roomId: room.roomId,
        getMyMembership: () => room.membership,
        currentState: {
          getStateEvents: (type: string) =>
            type === 'm.room.tombstone' && room.successor !== undefined
              ? { getContent: () => ({ replacement_room: room.successor }) }
              : null,
        },
      } as unknown as Room,
    ])
  );
  return {
    getRooms: () => [...byId.values()],
    getRoom: (roomId: string) => byId.get(roomId) ?? null,
  } as unknown as MatrixClient;
};

describe('findReplacedRooms', () => {
  it('lists an upgraded room once its successor is joined', () => {
    const mx = makeClient([
      { roomId: '!old:hs', membership: 'join', successor: '!new:hs' },
      { roomId: '!new:hs', membership: 'join' },
    ]);
    expect([...findReplacedRooms(mx)]).toEqual(['!old:hs']);
  });

  it('keeps an upgraded room whose successor is not joined, unknown, or itself', () => {
    const mx = makeClient([
      { roomId: '!invited-old:hs', membership: 'join', successor: '!invited-new:hs' },
      { roomId: '!invited-new:hs', membership: 'invite' },
      { roomId: '!lost-old:hs', membership: 'join', successor: '!elsewhere:hs' },
      { roomId: '!loop:hs', membership: 'join', successor: '!loop:hs' },
      { roomId: '!plain:hs', membership: 'join' },
    ]);
    expect(findReplacedRooms(mx).size).toBe(0);
  });
});
