import {
  EventType,
  RelationType,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getThreadSummaryReply } from '../../matrix/client/unopenedThreadEdits';
import type { CrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import { canAskIn, isDirectRoomWith, readHomeAgents, startDirectChat } from './homeAgents';

vi.mock('../../matrix/client/unopenedThreadEdits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../matrix/client/unopenedThreadEdits')>();
  return { ...actual, getThreadSummaryReply: vi.fn(actual.getThreadSummaryReply) };
});

const ME = '@robin:example.org';
const HELPER = '@mindroom_helper:example.org';
const SCOUT = '@mindroom_scout:example.org';
const ROUTER = '@mindroom_router:example.org';
const ROUTER_HELPER = '@mindroom_router_helper:example.org';
const TITLE = { msgtype: 'm.notice', 'io.mindroom.thread_summary': { summary: 'A title' } };

type MessageSpec =
  | [string, number]
  | {
      sender: string;
      ts: number;
      type?: string;
      redacted?: boolean;
      relType?: string;
      title?: boolean;
      failed?: boolean;
    };

type RoomSpec = {
  agents?: string[];
  messages?: MessageSpec[];
  threads?: Record<string, MessageSpec[] | { loaded: MessageSpec[]; latest: MessageSpec }>;
  members?: Record<string, string | { membership: string; rawDisplayName: string }>;
  state?: Record<string, Record<string, unknown>>;
  count?: number;
};

type EventOpts = { type?: string; redacted?: boolean; relType?: string; failed?: boolean };
const event = (
  sender: string,
  ts = 0,
  content: Record<string, unknown> = {},
  opts: EventOpts = {}
) =>
  ({
    getId: () => `$${sender}-${ts}`,
    getSender: () => sender,
    getStateKey: () => sender,
    getTs: () => ts,
    getType: () => opts.type ?? EventType.RoomMessage,
    isState: () => false,
    isRedacted: () => opts.redacted ?? false,
    isDecryptionFailure: () => opts.failed ?? false,
    getRelation: () => (opts.relType ? { rel_type: opts.relType } : null),
    getContent: () => content,
  }) as unknown as MatrixEvent;

const room = (roomId: string, spec: RoomSpec = {}) => {
  const { agents = [], messages = [], threads = {}, members = {}, state = {}, count = 3 } = spec;
  const toEvents = (entries: MessageSpec[]) =>
    entries.map((e) =>
      Array.isArray(e) ? event(e[0], e[1]) : event(e.sender, e.ts, e.title ? TITLE : {}, e)
    );
  const sdkThread = (rootId: string) => {
    const known = threads[rootId] ?? [];
    const loaded = toEvents(Array.isArray(known) ? known : known.loaded);
    const replies = Array.isArray(known) ? loaded : toEvents([known.latest]);
    return {
      id: rootId,
      events: loaded,
      replyToEvent: replies.filter((r) => !r.getRelation()).at(-1) ?? null,
    };
  };
  return {
    roomId,
    myUserId: ME,
    isSpaceRoom: () => false,
    getMyMembership: () => 'join',
    getMember: (userId: string) => {
      const known = members[userId];
      if (!known) return null;
      return typeof known === 'string'
        ? { membership: known }
        : { ...known, getMxcAvatarUrl: () => null };
    },
    getMembers: () =>
      Object.entries(members).map(([userId, known]) => ({
        userId,
        membership: typeof known === 'string' ? known : known.membership,
      })),
    getJoinedMemberCount: () => count,
    getInvitedMemberCount: () => 0,
    membersLoaded: () => true,
    currentState: {
      getStateEvents: (type: string) =>
        type === 'io.mindroom.server' ? agents.map((a) => event(a)) : [],
    },
    getLiveTimeline: () => ({
      getEvents: () => toEvents(messages),
      getState: () => ({
        getStateEvents: (type: string) =>
          state[type] ? event('@admin:example.org', 0, state[type]) : undefined,
      }),
    }),
    getThreads: () => Object.keys(threads).map(sdkThread),
    getThread: (rootId: string) => (threads[rootId] ? sdkThread(rootId) : null),
  } as unknown as Room;
};

const client = (rooms: Room[], direct: unknown = {}) =>
  ({
    getRoom: (roomId: string) => rooms.find((r) => r.roomId === roomId) ?? null,
    getAccountData: () => ({ getContent: () => direct }),
  }) as unknown as MatrixClient;

const thread = (
  roomId: string,
  lastSenderId: string,
  ts: number,
  threadRootId = '$unloaded',
  preview?: string
) =>
  ({
    roomId,
    threadRootId,
    lastActivityTs: ts,
    threadRecord: {
      presentation: {
        lastSenderId,
        latestReplyTs: ts,
        latestReplyPreviewLocalization: preview && { kind: preview },
        replyParticipantIds: [HELPER],
      },
    },
  }) as unknown as CrossRoomThreadIndexEntry;

const ids = (rooms: Room[]) => rooms.map((r) => r.roomId);

describe('readHomeAgents', () => {
  it('ranks agents and rooms by own answers, excluding router and non-answer events', () => {
    const rooms = [
      room('!lobby', {
        agents: [HELPER, SCOUT, ROUTER, ROUTER_HELPER],
        messages: [
          [HELPER, 100],
          { sender: HELPER, ts: 500, type: EventType.Reaction },
          { sender: HELPER, ts: 600, relType: RelationType.Replace },
          { sender: HELPER, ts: 700, redacted: true },
          { sender: HELPER, ts: 800, title: true },
          { sender: HELPER, ts: 850, failed: true },
        ],
      }),
      room('!eng', { agents: [HELPER], messages: [[HELPER, 200]] }),
    ];
    const index = [thread('!lobby', SCOUT, 50), thread('!lobby', ME, 900)];
    const agents = readHomeAgents(client(rooms), ids(rooms), index);
    expect(agents.map((a) => a.userId)).toEqual([HELPER, SCOUT, ROUTER_HELPER]);
    expect(agents[0]).toMatchObject({
      defaultRoomId: '!eng',
      roomIds: ['!eng', '!lobby'],
      lastUsedTs: 200,
    });
    expect(agents[1]).toMatchObject({ defaultRoomId: '!lobby', lastUsedTs: 50 });
  });

  it('excludes rooms the agent left, the account cannot post in, or that are tombstoned', () => {
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

  it('ranks threads using original send time, summary replies, and non-encrypted index fallbacks', () => {
    const rooms = [
      room('!lobby', {
        agents: [HELPER],
        threads: {
          $edited: [
            [ME, 90],
            [HELPER, 100],
            { sender: HELPER, ts: 900, relType: RelationType.Replace },
          ],
          $partial: { loaded: [[HELPER, 100]], latest: [HELPER, 300] },
          $failed: [{ sender: HELPER, ts: 700, failed: true }],
        },
      }),
      room('!eng', { agents: [HELPER], messages: [[HELPER, 200]] }),
    ];
    const index = [
      thread('!lobby', HELPER, 900, '$edited'),
      thread('!lobby', HELPER, 700, '$failed', 'encrypted'),
    ];
    expect(readHomeAgents(client(rooms), ids(rooms), index)[0]).toMatchObject({
      defaultRoomId: '!lobby',
      lastUsedTs: 300,
    });

    // Unopened titled thread uses kept summary reply, falling back to index when none is kept.
    const unopened = [
      room('!lobby', {
        agents: [HELPER],
        threads: { $titled: { loaded: [], latest: { sender: ROUTER, ts: 950, title: true } } },
      }),
      room('!eng', { agents: [HELPER], messages: [[HELPER, 200]] }),
    ];
    const titledIndex = [thread('!lobby', HELPER, 900, '$titled')];
    vi.mocked(getThreadSummaryReply).mockReturnValueOnce(event(HELPER, 300));
    expect(readHomeAgents(client(unopened), ids(unopened), titledIndex)[0]?.lastUsedTs).toBe(300);
    expect(readHomeAgents(client(unopened), ids(unopened), titledIndex)[0]?.lastUsedTs).toBe(900);
  });

  it('selects valid 1:1 DMs, preferring most recently answered joined DM over invites and ignoring stale/multi-member rooms', () => {
    const GUEST = '@guest:example.org';
    const stale = room('!stale', { agents: [HELPER], count: 2 });
    const rooms = [
      room('!lobby', { agents: [HELPER, SCOUT], messages: [[HELPER, 100]] }),
      room('!group', { members: { [HELPER]: 'join' }, count: 4 }),
      room('!dm-tomb', {
        members: { [HELPER]: 'join' },
        state: { 'm.room.tombstone': { body: 'moved' } },
        count: 2,
      }),
      room('!dm-ro', {
        members: { [HELPER]: 'join' },
        state: { 'm.room.power_levels': { events_default: 50, users: { [HELPER]: 50 } } },
        count: 2,
      }),
      room('!dm-inv', { members: { [HELPER]: 'invite' }, count: 1 }),
      room('!dm-1', { members: { [HELPER]: 'join' }, count: 2, messages: [[HELPER, 200]] }),
      room('!dm-2', { members: { [HELPER]: 'join' }, count: 2, messages: [[HELPER, 500]] }),
      room('!dm-scout', { members: { [SCOUT]: 'invite' }, count: 1, messages: [[SCOUT, 900]] }),
      stale,
    ];
    const agents = readHomeAgents(
      client(rooms, {
        [HELPER]: ['!group', '!dm-tomb', '!dm-ro', '!dm-inv', '!dm-1', '!dm-2', '!stale'],
        [SCOUT]: ['!dm-scout'],
      }),
      ['!lobby'],
      []
    );
    const byId = new Map(agents.map((a) => [a.userId, a]));
    expect(byId.get(HELPER)).toMatchObject({
      direct: { roomId: '!dm-2', waiting: false },
      defaultRoomId: '!dm-2',
      lastUsedTs: 500,
    });
    expect(byId.get(SCOUT)).toMatchObject({
      direct: { roomId: '!dm-scout', waiting: true },
      defaultRoomId: '!dm-scout',
      lastUsedTs: 0,
    });
    // Strict 1:1 checks: stale state-only room and known 3rd join/invite member are rejected.
    expect(canAskIn(stale, HELPER)).toBe(true);
    expect(isDirectRoomWith(stale, HELPER)).toBe(false);
    const dmWith = (membership: string) =>
      room('!3rd', { members: { [HELPER]: 'join', [GUEST]: membership }, count: 2 });
    expect(isDirectRoomWith(dmWith('invite'), HELPER)).toBe(false);
    expect(isDirectRoomWith(dmWith('leave'), HELPER)).toBe(true);
  });

  it('handles malformed m.direct, picks first loaded name/avatar, and reveals direction controls', () => {
    const member = (rawDisplayName: string, avatar: string | null) => () => ({
      membership: 'join',
      rawDisplayName,
      getMxcAvatarUrl: () => avatar,
    });
    const rooms = [
      room('!lobby', { agents: [HELPER] }),
      Object.assign(room('!eng', { agents: [HELPER] }), {
        getMember: member('Helper\u202Etuocs', null),
      }),
      Object.assign(room('!ops', { agents: [HELPER] }), {
        getMember: member('Other', 'mxc://example.org/helper'),
      }),
    ];
    for (const bad of [{ [HELPER]: '!dm' }, { [HELPER]: [5, null] }, 'direct']) {
      const [helper] = readHomeAgents(client(rooms, bad), ids(rooms), []);
      expect(helper).toMatchObject({
        name: 'Helper<U+202E>tuocs',
        avatarMxc: 'mxc://example.org/helper',
        direct: undefined,
      });
    }
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
      createRoom: vi.fn(async () => ({ room_id: `!dm-${++made}` })),
      getAccountData: () => ({ getContent: () => direct }),
      getRoom: () => null,
    };
  };

  const startClient = (rooms: Room[], direct: Record<string, string[]>, made = '!duplicate') =>
    Object.assign(client(rooms, direct), {
      createRoom: vi.fn(async () => ({ room_id: made })),
      setAccountData: vi.fn(async () => undefined),
    });

  const unloadedDm = (
    roomId: string,
    opts: { joins?: boolean; ts?: number; load?: () => Promise<boolean> } = {}
  ) => {
    const { joins = true, ts = 0, load = async () => true } = opts;
    let loaded = false;
    return Object.assign(room(roomId, { count: 2, messages: ts ? [[SCOUT, ts]] : [] }), {
      getMember: (userId: string) =>
        loaded && joins && userId === SCOUT ? { membership: 'join' } : null,
      loadMembersIfNeeded: vi.fn(async () => {
        loaded = await load();
        return loaded;
      }),
    });
  };

  it('loads unloaded listed DMs once, reuses the most recently answered one, or creates a new DM', async () => {
    const dm1 = unloadedDm('!dm-1', { ts: 200 });
    const dm2 = unloadedDm('!dm-2', { ts: 500 });
    const mx = startClient([dm1, dm2], { [SCOUT]: ['!dm-1', '!dm-2'] });
    await expect(startDirectChat(mx, SCOUT)).resolves.toBe('!dm-2');
    expect(dm1.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(dm2.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(mx.createRoom).not.toHaveBeenCalled();

    // When the agent is not in the loaded room, a new DM is created.
    const empty = unloadedDm('!other', { joins: false });
    const fresh = startClient([empty], { [HELPER]: ['!other'] }, '!made');
    await expect(startDirectChat(fresh, HELPER)).resolves.toBe('!made');
    expect(empty.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('throws without creating a duplicate when a listed DM fails to load, and succeeds on retry or when another DM is found', async () => {
    const offline = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(true);
    const listed = unloadedDm('!dm', { load: offline });
    const mx = startClient([listed], { [SCOUT]: ['!dm'] });
    await expect(startDirectChat(mx, SCOUT)).rejects.toThrow('did not load');
    expect(mx.createRoom).not.toHaveBeenCalled();
    await expect(startDirectChat(mx, SCOUT)).resolves.toBe('!dm');
    expect(mx.createRoom).not.toHaveBeenCalled();

    const lost = unloadedDm('!lost', { load: () => Promise.reject(new Error('offline')) });
    const found = unloadedDm('!found');
    const both = startClient([lost, found], { [SCOUT]: ['!lost', '!found'] });
    await expect(startDirectChat(both, SCOUT)).resolves.toBe('!found');
    expect(both.createRoom).not.toHaveBeenCalled();
  });

  it('dedupes concurrent starts and retries m.direct listing without creating a second room', async () => {
    const mx = directClient();
    const first = startDirectChat(mx as unknown as MatrixClient, SCOUT);
    expect(startDirectChat(mx as unknown as MatrixClient, SCOUT)).toBe(first);
    await expect(first).resolves.toBe('!dm-1');
    expect(mx.createRoom).toHaveBeenCalledTimes(1);

    const mx2 = directClient();
    mx2.setAccountData.mockRejectedValueOnce(new Error('offline'));
    await expect(startDirectChat(mx2 as unknown as MatrixClient, HELPER)).rejects.toThrow(
      'offline'
    );
    await expect(startDirectChat(mx2 as unknown as MatrixClient, HELPER)).resolves.toBe('!dm-1');
    expect(mx2.createRoom).toHaveBeenCalledTimes(1);
    expect(mx2.setAccountData).toHaveBeenLastCalledWith('m.direct', { [HELPER]: ['!dm-1'] });
  });
});
