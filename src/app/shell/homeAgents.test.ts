import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { CrossRoomThreadIndexEntry } from '../threads/cross-room/crossRoomThreadIndex';
import { canAskIn, readHomeAgents, startDirectChat } from './homeAgents';

const ME = '@robin:example.org';
const HELPER = '@mindroom_helper:example.org';
const SCOUT = '@mindroom_scout:example.org';
const ROUTER = '@mindroom_router:example.org';

type RoomSpec = {
  agents?: string[];
  /** Messages the client has loaded: sender and time. */
  messages?: [string, number][];
  members?: Record<string, string>;
  state?: Record<string, Record<string, unknown>>;
  count?: number;
};

const event = (sender: string, ts = 0, content: Record<string, unknown> = {}) =>
  ({
    getSender: () => sender,
    getStateKey: () => sender,
    getTs: () => ts,
    isState: () => false,
    getContent: () => content,
  } as unknown as MatrixEvent);

const room = (roomId: string, spec: RoomSpec = {}) => {
  const { agents = [], messages = [], members = {}, state = {}, count = 3 } = spec;
  const stateEvents = (type: string) =>
    type === 'io.mindroom.server' ? agents.map((agent) => event(agent)) : [];
  return {
    roomId,
    myUserId: ME,
    isSpaceRoom: () => false,
    getMyMembership: () => 'join',
    getMember: (userId: string) => (members[userId] ? { membership: members[userId] } : null),
    getJoinedMemberCount: () => count,
    getInvitedMemberCount: () => 0,
    currentState: { getStateEvents: stateEvents },
    getLiveTimeline: () => ({
      getEvents: () => messages.map(([sender, ts]) => event(sender, ts)),
      getState: () => ({
        getStateEvents: (type: string) =>
          state[type] ? event('@admin:example.org', 0, state[type]) : undefined,
      }),
    }),
    getThreads: () => [],
  } as unknown as Room;
};

const client = (rooms: Room[], direct: Record<string, string[]> = {}) =>
  ({
    getRoom: (roomId: string) => rooms.find((candidate) => candidate.roomId === roomId) ?? null,
    getAccountData: () => ({ getContent: () => direct }),
  } as unknown as MatrixClient);

/** A thread whose newest message is `lastSenderId`'s, at `ts`. */
const thread = (roomId: string, lastSenderId: string, ts: number, participants = [HELPER]) =>
  ({
    roomId,
    lastActivityTs: ts,
    threadRecord: {
      presentation: { lastSenderId, latestReplyTs: ts, replyParticipantIds: participants },
    },
  } as unknown as CrossRoomThreadIndexEntry);

const ids = (rooms: Room[]) => rooms.map((each) => each.roomId);

describe('readHomeAgents', () => {
  it("ranks an agent's rooms by its own last answer, which a person's later message leaves", () => {
    const rooms = [
      room('!lobby', { agents: [HELPER, SCOUT, ROUTER], messages: [[HELPER, 100]] }),
      room('!eng', { agents: [HELPER], messages: [[HELPER, 200]] }),
    ];
    const before = readHomeAgents(client(rooms), ids(rooms), [thread('!lobby', SCOUT, 50)]);
    // Someone bumps the old Lobby thread Helper answered in: its newest message is theirs.
    const after = readHomeAgents(client(rooms), ids(rooms), [
      thread('!lobby', SCOUT, 50),
      thread('!lobby', ME, 900),
    ]);
    [before, after].forEach((agents) => {
      expect(agents.map((agent) => agent.userId)).toEqual([HELPER, SCOUT]);
      expect(agents[0]).toMatchObject({ defaultRoomId: '!eng', roomIds: ['!eng', '!lobby'] });
      expect(agents[1]).toMatchObject({ defaultRoomId: '!lobby', lastUsedTs: 50 });
    });
  });

  it('takes the direct chat of the two alone, waiting until the agent joins', () => {
    const rooms = [
      room('!lobby', { agents: [HELPER, SCOUT] }),
      room('!dm-scout', { members: { [SCOUT]: 'join' }, count: 2 }),
      room('!dm-helper', { members: { [HELPER]: 'invite' }, count: 1 }),
      room('!group', { members: { [HELPER]: 'join' }, count: 4 }),
    ];
    const direct = { [SCOUT]: ['!dm-scout'], [HELPER]: ['!group', '!dm-helper'] };
    const agents = readHomeAgents(client(rooms, direct), ['!lobby'], []);
    const byId = new Map(agents.map((agent) => [agent.userId, agent]));
    expect(byId.get(SCOUT)).toMatchObject({
      defaultRoomId: '!dm-scout',
      direct: { roomId: '!dm-scout', waiting: false },
    });
    // A room of four is no direct chat, whatever `m.direct` says.
    expect(byId.get(HELPER)?.direct).toEqual({ roomId: '!dm-helper', waiting: true });
    // The router routes and answers nothing itself.
    expect(byId.has(ROUTER)).toBe(false);
  });

  it('offers no room the agent left, the account may not post in, or that was replaced', () => {
    const rooms = [
      room('!lobby', { agents: [HELPER], messages: [[HELPER, 300]] }),
      room('!left', { agents: [HELPER], members: { [HELPER]: 'leave' } }),
      room('!readonly', {
        agents: [HELPER],
        state: { 'm.room.power_levels': { events_default: 50, users: { [HELPER]: 50 } } },
      }),
      room('!old', { agents: [HELPER], state: { 'm.room.tombstone': { body: 'moved' } } }),
    ];
    const [helper] = readHomeAgents(client(rooms), ids(rooms), []);
    expect(helper.roomIds).toEqual(['!lobby']);
    expect(canAskIn(rooms[2], HELPER)).toBe(false);
  });
});

describe('startDirectChat', () => {
  const directClient = () => {
    let direct: Record<string, string[]> = {};
    let made = 0;
    const setAccountData = vi.fn(async (_type: string, content: Record<string, string[]>) => {
      direct = content;
    });
    return {
      setAccountData,
      createRoom: vi.fn(async () => {
        made += 1;
        return { room_id: `!dm-${made}` };
      }),
      getAccountData: () => ({ getContent: () => direct }),
    };
  };

  it('starts one chat however often it is asked while it starts', async () => {
    const mx = directClient();
    const first = startDirectChat(mx as unknown as MatrixClient, SCOUT);
    const again = startDirectChat(mx as unknown as MatrixClient, SCOUT);
    expect(again).toBe(first);
    await expect(first).resolves.toBe('!dm-1');
    expect(mx.createRoom).toHaveBeenCalledTimes(1);
  });

  it('lists the room it made on a retry after listing it failed, rather than making another', async () => {
    const mx = directClient();
    mx.setAccountData.mockRejectedValueOnce(new Error('offline'));
    await expect(startDirectChat(mx as unknown as MatrixClient, SCOUT)).rejects.toThrow('offline');
    await expect(startDirectChat(mx as unknown as MatrixClient, SCOUT)).resolves.toBe('!dm-1');
    expect(mx.createRoom).toHaveBeenCalledTimes(1);
    expect(mx.setAccountData).toHaveBeenLastCalledWith('m.direct', { [SCOUT]: ['!dm-1'] });
  });
});
