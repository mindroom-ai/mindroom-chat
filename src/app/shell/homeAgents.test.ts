import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import type { CrossRoomThreadIndexEntry } from '../threads/cross-room/crossRoomThreadIndex';
import { readHomeAgents } from './homeAgents';

const ME = '@robin:example.org';
const HELPER = '@mindroom_helper:example.org';
const SCOUT = '@mindroom_scout:example.org';
const ROUTER = '@mindroom_router:example.org';

const serverState = (agentId: string) =>
  ({ getSender: () => agentId, getStateKey: () => agentId } as unknown as MatrixEvent);

const room = (roomId: string, agents: string[], lastActive = 0) =>
  ({
    roomId,
    myUserId: ME,
    isSpaceRoom: () => false,
    getMyMembership: () => 'join',
    getLastActiveTimestamp: () => lastActive,
    getMember: () => null,
    currentState: { getStateEvents: () => agents.map(serverState) },
  } as unknown as Room);

const client = (rooms: Room[], direct: Record<string, string[]> = {}) =>
  ({
    getRoom: (roomId: string) => rooms.find((candidate) => candidate.roomId === roomId) ?? null,
    getAccountData: () => ({ getContent: () => direct }),
  } as unknown as MatrixClient);

const thread = (roomId: string, repliers: string[], lastActivityTs: number) =>
  ({
    roomId,
    lastActivityTs,
    threadRecord: { presentation: { replyParticipantIds: repliers } },
  } as unknown as CrossRoomThreadIndexEntry);

describe('readHomeAgents', () => {
  const rooms = [
    room('!lobby', [HELPER, SCOUT, ROUTER], 30),
    room('!eng', [HELPER], 10),
    room('!dm-scout', [SCOUT], 5),
  ];

  it('sends a question to the room last used with the agent, the agent used last first', () => {
    const agents = readHomeAgents(
      client(rooms),
      rooms.map((each) => each.roomId),
      [
        thread('!lobby', [HELPER], 100),
        thread('!eng', [HELPER], 200),
        thread('!lobby', [SCOUT], 50),
      ]
    );
    expect(agents.map((agent) => agent.userId)).toEqual([HELPER, SCOUT]);
    expect(agents[0]).toMatchObject({ defaultRoomId: '!eng', roomIds: ['!eng', '!lobby'] });
    expect(agents[1]).toMatchObject({ defaultRoomId: '!lobby' });
  });

  it('falls back to the direct chat, and to none to start, for an agent never used', () => {
    const agents = readHomeAgents(
      client(rooms, { [SCOUT]: ['!dm-scout'] }),
      rooms.map((each) => each.roomId),
      []
    );
    const byId = new Map(agents.map((agent) => [agent.userId, agent]));
    expect(byId.get(SCOUT)).toMatchObject({
      defaultRoomId: '!dm-scout',
      directRoomId: '!dm-scout',
    });
    expect(byId.get(HELPER)?.defaultRoomId).toBeUndefined();
    // The router routes and answers nothing itself.
    expect(byId.has(ROUTER)).toBe(false);
  });

  it('counts only replies in a room the agent is still in', () => {
    const agents = readHomeAgents(client(rooms), ['!lobby'], [thread('!eng', [HELPER], 200)]);
    expect(agents.find((agent) => agent.userId === HELPER)?.lastUsedTs).toBe(0);
  });
});
