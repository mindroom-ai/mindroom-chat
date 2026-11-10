import type { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { readActivityInvites } from './activityInvites';

const ME = '@alice:x';

const invitedRoom = (roomId: string, name: string, inviter: string, ts: number) => ({
  roomId,
  name,
  getCanonicalAlias: () => null,
  getMxcAvatarUrl: () => null,
  isSpaceRoom: () => false,
  getMember: (userId: string) =>
    userId === ME
      ? {
          events: { member: { getSender: () => inviter, getTs: () => ts, getContent: () => ({}) } },
        }
      : null,
  currentState: { getMember: () => null, getStateEvents: () => undefined },
});

describe('readActivityInvites', () => {
  it('lists each pending invite with its inviter and time, without spam', () => {
    const rooms = new Map([
      ['!team:x', invitedRoom('!team:x', 'Partner Pilot', '@tom:x', 500)],
      ['!spam:x', invitedRoom('!spam:x', 'nsfw pics', '@bot:y', 600)],
    ]);
    const mx = {
      getUserId: () => ME,
      getRoom: (roomId: string) => rooms.get(roomId) ?? null,
      getAccountData: () => undefined,
      getRooms: () => [],
    } as unknown as MatrixClient;

    expect(readActivityInvites(mx, ['!team:x', '!spam:x', '!gone:x'])).toEqual([
      { roomId: '!team:x', inviterId: '@tom:x', ts: 500 },
    ]);
  });
});
