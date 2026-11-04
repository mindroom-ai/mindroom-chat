import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { allowMembersToCall, readCallAccess } from './callAccess';

const CALL_MEMBER = 'org.matrix.msc3401.call.member';

type Levels = {
  users?: Record<string, number>;
  users_default?: number;
  state_default?: number;
  events?: Record<string, number>;
};

/** A room whose state answers permission checks from `levels` as the Matrix auth rules do. */
const roomWith = (levels: Levels, members: Record<string, 'join' | 'invite' | 'leave'>) => {
  const userLevel = (userId: string) => levels.users?.[userId] ?? levels.users_default ?? 0;
  const eventLevel = (type: string) => levels.events?.[type] ?? levels.state_default ?? 50;
  const state = {
    maySendStateEvent: (type: string, userId: string) => userLevel(userId) >= eventLevel(type),
    getStateEvents: () => ({ getContent: () => levels }),
  };
  return {
    roomId: '!room:calls.test',
    getLiveTimeline: () => ({ getState: () => state }),
    getMembers: () =>
      Object.entries(members).map(([userId, membership]) => ({ userId, membership })),
  } as unknown as Room;
};

const admin = '@admin:calls.test';
const member = '@member:calls.test';
const invited = '@invited:calls.test';

describe('readCallAccess', () => {
  const levels: Levels = {
    users: { [admin]: 100 },
    users_default: 0,
    events: { 'm.room.power_levels': 100 },
  };
  const room = roomWith(levels, { [admin]: 'join', [member]: 'join', [invited]: 'invite' });

  it('names the joined members a private_chat room keeps out of its calls', () => {
    expect(readCallAccess(room, admin)).toEqual({
      canJoin: true,
      blocked: [member],
      canAllow: true,
    });
  });

  it('lets a member see they cannot join, without offering them the fix', () => {
    expect(readCallAccess(room, member)).toEqual({
      canJoin: false,
      blocked: [member],
      canAllow: false,
    });
  });

  it('blocks nobody once call membership is at the members level', () => {
    const open = roomWith(
      { ...levels, events: { ...levels.events, [CALL_MEMBER]: 0 } },
      {
        [admin]: 'join',
        [member]: 'join',
      }
    );
    expect(readCallAccess(open, admin).blocked).toEqual([]);
  });

  it('offers no fix to a moderator who cannot change the power levels', () => {
    const moderated = roomWith(
      { ...levels, users: { [admin]: 100, [member]: 50 } },
      { [admin]: 'join', [member]: 'join' }
    );
    expect(readCallAccess(moderated, member)).toMatchObject({ canJoin: true, canAllow: false });
  });
});

describe('allowMembersToCall', () => {
  it('moves call membership to the members level and keeps every other level', async () => {
    const levels: Levels = {
      users: { [admin]: 100 },
      users_default: 10,
      events: { 'm.room.power_levels': 100, 'm.room.name': 50 },
    };
    const sendStateEvent = vi.fn().mockResolvedValue({ event_id: '$levels' });
    await allowMembersToCall(
      { sendStateEvent } as unknown as MatrixClient,
      roomWith(levels, { [admin]: 'join' })
    );
    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:calls.test',
      'm.room.power_levels',
      {
        users: { [admin]: 100 },
        users_default: 10,
        events: { 'm.room.power_levels': 100, 'm.room.name': 50, [CALL_MEMBER]: 10 },
      },
      ''
    );
  });
});
