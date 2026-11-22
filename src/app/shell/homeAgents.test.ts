import {
  EventType,
  RelationType,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { CrossRoomThreadIndexEntry } from '../threads/cross-room/crossRoomThreadIndex';
import { canAskIn, isDirectRoomWith, readHomeAgents, startDirectChat } from './homeAgents';

const ME = '@robin:example.org';
const HELPER = '@mindroom_helper:example.org';
const SCOUT = '@mindroom_scout:example.org';
const ROUTER = '@mindroom_router:example.org';
const ROUTER_HELPER = '@mindroom_router_helper:example.org';

type MessageSpec =
  | [string, number]
  | { sender: string; ts: number; type?: string; redacted?: boolean; relType?: string };

type RoomSpec = {
  agents?: string[];
  /** Events the client has loaded: sender and time, or full event spec. */
  messages?: MessageSpec[];
  /** The threads whose events the client has loaded, by root. */
  threads?: Record<string, MessageSpec[]>;
  /** Membership by user, or the membership and the display name the room knows. */
  members?: Record<string, string | { membership: string; rawDisplayName: string }>;
  state?: Record<string, Record<string, unknown>>;
  count?: number;
};

const event = (
  sender: string,
  ts = 0,
  content: Record<string, unknown> = {},
  options: { type?: string; redacted?: boolean; relType?: string } = {}
) =>
  ({
    getSender: () => sender,
    getStateKey: () => sender,
    getTs: () => ts,
    getType: () => options.type ?? EventType.RoomMessage,
    isState: () => false,
    isRedacted: () => options.redacted ?? false,
    getRelation: () => (options.relType ? { rel_type: options.relType } : null),
    getContent: () => content,
  } as unknown as MatrixEvent);

const room = (roomId: string, spec: RoomSpec = {}) => {
  const { agents = [], messages = [], threads = {}, members = {}, state = {}, count = 3 } = spec;
  const stateEvents = (type: string) =>
    type === 'io.mindroom.server' ? agents.map((agent) => event(agent)) : [];
  const events = (entries: MessageSpec[]) =>
    entries.map((entry) =>
      Array.isArray(entry) ? event(entry[0], entry[1]) : event(entry.sender, entry.ts, {}, entry)
    );
  const member = (userId: string) => {
    const known = members[userId];
    if (!known) return null;
    return typeof known === 'string'
      ? { membership: known }
      : { ...known, getMxcAvatarUrl: () => null };
  };
  return {
    roomId,
    myUserId: ME,
    isSpaceRoom: () => false,
    getMyMembership: () => 'join',
    getMember: member,
    getJoinedMemberCount: () => count,
    getInvitedMemberCount: () => 0,
    currentState: { getStateEvents: stateEvents },
    getLiveTimeline: () => ({
      getEvents: () => events(messages),
      getState: () => ({
        getStateEvents: (type: string) =>
          state[type] ? event('@admin:example.org', 0, state[type]) : undefined,
      }),
    }),
    getThreads: () => Object.values(threads).map((entries) => ({ events: events(entries) })),
    getThread: (rootId: string) => {
      const loaded = threads[rootId];
      return loaded ? { events: events(loaded) } : null;
    },
  } as unknown as Room;
};

const client = (rooms: Room[], direct: unknown = {}) =>
  ({
    getRoom: (roomId: string) => rooms.find((candidate) => candidate.roomId === roomId) ?? null,
    getAccountData: () => ({ getContent: () => direct }),
  } as unknown as MatrixClient);

/** A thread of the index whose newest message is `lastSenderId`'s, at `ts`. */
const thread = (roomId: string, lastSenderId: string, ts: number, threadRootId = '$unloaded') =>
  ({
    roomId,
    threadRootId,
    lastActivityTs: ts,
    threadRecord: {
      presentation: { lastSenderId, latestReplyTs: ts, replyParticipantIds: [HELPER] },
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
    const readonlyRoom = room('!readonly', {
      agents: [HELPER],
      state: { 'm.room.power_levels': { events_default: 50, users: { [HELPER]: 50 } } },
    });
    const rooms = [
      room('!lobby', { agents: [HELPER], messages: [[HELPER, 300]] }),
      room('!left', { agents: [HELPER], members: { [HELPER]: 'leave' } }),
      readonlyRoom,
      room('!old', { agents: [HELPER], state: { 'm.room.tombstone': { body: 'moved' } } }),
    ];
    const [helper] = readHomeAgents(client(rooms), ids(rooms), []);
    expect(helper?.roomIds).toEqual(['!lobby']);
    expect(canAskIn(readonlyRoom, HELPER)).toBe(false);
  });

  it('skips tombstoned and unwritable DMs and prefers a joined DM over a pending invite', () => {
    const rooms = [
      room('!lobby', { agents: [HELPER, SCOUT] }),
      room('!dm-tombstoned', {
        members: { [HELPER]: 'join' },
        state: { 'm.room.tombstone': { body: 'moved' } },
        count: 2,
      }),
      room('!dm-readonly', {
        members: { [HELPER]: 'join' },
        state: { 'm.room.power_levels': { events_default: 50, users: { [HELPER]: 50 } } },
        count: 2,
      }),
      room('!dm-invited', { members: { [HELPER]: 'invite' }, count: 1 }),
      room('!dm-usable', { members: { [HELPER]: 'join' }, count: 2 }),
    ];
    const direct = {
      [HELPER]: ['!dm-tombstoned', '!dm-readonly', '!dm-invited', '!dm-usable'],
    };
    const agents = readHomeAgents(client(rooms, direct), ['!lobby'], []);
    const helper = agents.find((agent) => agent.userId === HELPER);
    expect(helper?.direct).toEqual({ roomId: '!dm-usable', waiting: false });
  });

  it('ignores agent reactions, edits, and redacted messages when ranking rooms, and keeps router_* agents', () => {
    const rooms = [
      room('!eng', { agents: [HELPER, ROUTER, ROUTER_HELPER], messages: [[HELPER, 200]] }),
      room('!lobby', {
        agents: [HELPER],
        messages: [
          [HELPER, 100],
          { sender: HELPER, ts: 500, type: EventType.Reaction },
          { sender: HELPER, ts: 600, type: EventType.RoomMessage, relType: RelationType.Replace },
          { sender: HELPER, ts: 700, type: EventType.RoomMessage, redacted: true },
        ],
      }),
    ];
    const agents = readHomeAgents(client(rooms), ids(rooms), []);
    const byId = new Map(agents.map((agent) => [agent.userId, agent]));
    expect(byId.get(HELPER)).toMatchObject({ defaultRoomId: '!eng', lastUsedTs: 200 });
    expect(byId.has(ROUTER)).toBe(false);
    expect(byId.has(ROUTER_HELPER)).toBe(true);
  });

  it('ranks a loaded thread by when its answer was sent, which a later edit leaves', () => {
    const rooms = [
      room('!lobby', {
        agents: [HELPER],
        threads: {
          // An old answer, edited just now.
          $old: [
            [ME, 90],
            [HELPER, 100],
            { sender: HELPER, ts: 900, relType: RelationType.Replace },
          ],
        },
      }),
      room('!eng', { agents: [HELPER], messages: [[HELPER, 200]] }),
    ];
    // The index gives the edit's time for the loaded thread, and all it has for one not loaded.
    const index = [thread('!lobby', HELPER, 900, '$old')];
    const [helper] = readHomeAgents(client(rooms), ids(rooms), index);
    expect(helper).toMatchObject({ defaultRoomId: '!eng', lastUsedTs: 200 });

    const [later] = readHomeAgents(client(rooms), ids(rooms), [
      ...index,
      thread('!lobby', HELPER, 300, '$unloaded'),
    ]);
    expect(later).toMatchObject({ defaultRoomId: '!lobby', lastUsedTs: 300 });
  });

  it('counts the answers in a joined direct chat where the agent publishes no state', () => {
    const rooms = [
      room('!lobby', { agents: [HELPER, SCOUT], messages: [[HELPER, 100]] }),
      room('!dm-helper', { members: { [HELPER]: 'join' }, count: 2, messages: [[HELPER, 500]] }),
      room('!dm-scout', { members: { [SCOUT]: 'invite' }, count: 1, messages: [[SCOUT, 900]] }),
    ];
    const direct = { [HELPER]: ['!dm-helper'], [SCOUT]: ['!dm-scout'] };
    const agents = readHomeAgents(client(rooms, direct), ['!lobby'], []);
    // Helper's newest answer is in its direct chat; a chat Scout has yet to join counts nothing.
    expect(agents.map((agent) => agent.userId)).toEqual([HELPER, SCOUT]);
    expect(agents[0]).toMatchObject({
      defaultRoomId: '!dm-helper',
      lastUsedTs: 500,
      roomIds: ['!lobby'],
    });
    expect(agents[1]).toMatchObject({ defaultRoomId: '!dm-scout', lastUsedTs: 0 });
  });

  it('takes no room for a direct chat on the state an agent left in it', () => {
    // Listed in `m.direct`, two in it, the agent's state still there: but its membership is not
    // known (it left; the other is someone else).
    const stale = room('!stale', { agents: [HELPER], count: 2 });
    const rooms = [room('!lobby', { agents: [HELPER] }), stale];
    const [helper] = readHomeAgents(client(rooms, { [HELPER]: ['!stale'] }), ['!lobby'], []);
    expect(canAskIn(stale, HELPER)).toBe(true);
    expect(isDirectRoomWith(stale, HELPER)).toBe(false);
    expect(helper?.direct).toBeUndefined();
    expect(helper?.defaultRoomId).toBeUndefined();
  });

  it.each([
    ['no list', { [HELPER]: '!dm' }],
    ['a list of other things', { [HELPER]: [5, null, { roomId: '!dm' }] }],
    ['no object', 'direct'],
  ])('reads malformed `m.direct` content (%s) as listing no chat', (_name, direct) => {
    const rooms = [
      room('!lobby', { agents: [HELPER] }),
      room('!dm', { members: { [HELPER]: 'join' }, count: 2 }),
    ];
    const [helper] = readHomeAgents(client(rooms, direct), ['!lobby'], []);
    expect(helper?.direct).toBeUndefined();
  });

  it("writes out the direction controls of an agent's name", () => {
    const rooms = [
      room('!lobby', {
        agents: [HELPER],
        members: { [HELPER]: { membership: 'join', rawDisplayName: 'Helper\u202Etuocs' } },
      }),
    ];
    const [helper] = readHomeAgents(client(rooms), ids(rooms), []);
    expect(helper?.name).toBe('Helper<U+202E>tuocs');
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
