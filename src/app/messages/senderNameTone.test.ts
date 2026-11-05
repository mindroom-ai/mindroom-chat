import { describe, expect, it } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { getSenderNameTone } from './senderNameTone';

type RoomSetup = {
  roomVersion?: string;
  creator?: string;
  members?: Record<string, number>;
  powerLevels?: { users?: Record<string, number>; users_default?: number };
};

const stateEvent = (content: Record<string, unknown>, sender?: string) => ({
  getContent: () => content,
  getSender: () => sender,
});

const makeRoom = ({ roomVersion = '11', creator, members = {}, powerLevels }: RoomSetup) =>
  ({
    getMember: (userId: string) => (userId in members ? { powerLevel: members[userId] } : null),
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (type: string) => {
          if (type === 'm.room.create' && creator) {
            return stateEvent({ room_version: roomVersion }, creator);
          }
          if (type === 'm.room.power_levels' && powerLevels) return stateEvent(powerLevels);
          return null;
        },
      }),
    }),
  } as unknown as Room);

describe('getSenderNameTone', () => {
  it('leads with the creators of rooms that privilege them', () => {
    const room = makeRoom({ roomVersion: '12', creator: '@priya:hs', members: { '@priya:hs': 0 } });
    expect(getSenderNameTone(room, '@priya:hs')).toBe('lead');
  });

  it('ranks members by power level in older room versions', () => {
    const room = makeRoom({
      creator: '@priya:hs',
      members: { '@priya:hs': 100, '@mod:hs': 50, '@maya:hs': 0 },
    });
    expect(getSenderNameTone(room, '@priya:hs')).toBe('lead');
    expect(getSenderNameTone(room, '@mod:hs')).toBe('moderator');
    expect(getSenderNameTone(room, '@maya:hs')).toBe('member');
  });

  it('reads the power levels event for senders who left', () => {
    const room = makeRoom({ powerLevels: { users: { '@gone:hs': 50 }, users_default: 0 } });
    expect(getSenderNameTone(room, '@gone:hs')).toBe('moderator');
    expect(getSenderNameTone(room, '@other:hs')).toBe('member');
  });

  it('treats a room without state as members only', () => {
    expect(getSenderNameTone({} as Room, '@anyone:hs')).toBe('member');
  });
});
