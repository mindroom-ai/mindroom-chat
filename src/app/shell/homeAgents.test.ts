import {
  EventType,
  RelationType,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getThreadSummaryReply } from '../matrix/client/unopenedThreadEdits';
import type { CrossRoomThreadIndexEntry } from '../threads/cross-room/crossRoomThreadIndex';
import { canAskIn, isDirectRoomWith, readHomeAgents, startDirectChat } from './homeAgents';

// The real one, which a test can have name the reply an unopened thread kept from before its
// title notice: the app's watcher of threads keeps that, and is not running here.
vi.mock('../matrix/client/unopenedThreadEdits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../matrix/client/unopenedThreadEdits')>();
  return { ...actual, getThreadSummaryReply: vi.fn(actual.getThreadSummaryReply) };
});

const ME = '@robin:example.org';
const HELPER = '@mindroom_helper:example.org';
const SCOUT = '@mindroom_scout:example.org';
const ROUTER = '@mindroom_router:example.org';
const ROUTER_HELPER = '@mindroom_router_helper:example.org';

/** A message's sender and time; `title` makes it a thread's title notice. */
type MessageSpec =
  | [string, number]
  | {
      sender: string;
      ts: number;
      type?: string;
      redacted?: boolean;
      relType?: string;
      title?: boolean;
      /** It could not be decrypted. */
      failed?: boolean;
    };
const TITLE = { msgtype: 'm.notice', 'io.mindroom.thread_summary': { summary: 'A title' } };

type RoomSpec = {
  agents?: string[];
  /** Events the client has loaded: sender and time, or full event spec. */
  messages?: MessageSpec[];
  /**
   * The threads the client has, by root: the events loaded, and with `latest` the newest reply the
   * server told of, when that is not among them.
   */
  threads?: Record<string, MessageSpec[] | { loaded: MessageSpec[]; latest: MessageSpec }>;
  /** Membership by user, or the membership and the display name the room knows. */
  members?: Record<string, string | { membership: string; rawDisplayName: string }>;
  state?: Record<string, Record<string, unknown>>;
  count?: number;
};

const event = (
  sender: string,
  ts = 0,
  content: Record<string, unknown> = {},
  options: { type?: string; redacted?: boolean; relType?: string; failed?: boolean } = {}
) =>
  ({
    getId: () => `$${sender}-${ts}`,
    getSender: () => sender,
    getStateKey: () => sender,
    getTs: () => ts,
    getType: () => options.type ?? EventType.RoomMessage,
    isState: () => false,
    isRedacted: () => options.redacted ?? false,
    isDecryptionFailure: () => options.failed ?? false,
    getRelation: () => (options.relType ? { rel_type: options.relType } : null),
    getContent: () => content,
  } as unknown as MatrixEvent);

const room = (roomId: string, spec: RoomSpec = {}) => {
  const { agents = [], messages = [], threads = {}, members = {}, state = {}, count = 3 } = spec;
  const stateEvents = (type: string) =>
    type === 'io.mindroom.server' ? agents.map((agent) => event(agent)) : [];
  const events = (entries: MessageSpec[]) =>
    entries.map((entry) =>
      Array.isArray(entry)
        ? event(entry[0], entry[1])
        : event(entry.sender, entry.ts, entry.title ? TITLE : {}, entry)
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
    getMembers: () =>
      Object.entries(members).map(([userId, known]) => ({
        userId,
        membership: typeof known === 'string' ? known : known.membership,
      })),
    getJoinedMemberCount: () => count,
    getInvitedMemberCount: () => 0,
    membersLoaded: () => true,
    currentState: { getStateEvents: stateEvents },
    getLiveTimeline: () => ({
      getEvents: () => events(messages),
      getState: () => ({
        getStateEvents: (type: string) =>
          state[type] ? event('@admin:example.org', 0, state[type]) : undefined,
      }),
    }),
    getThreads: () => Object.keys(threads).map(sdkThread),
    getThread: (rootId: string) => (threads[rootId] ? sdkThread(rootId) : null),
  } as unknown as Room;

  // As the SDK's thread: its loaded events, and the reply it shows last, an edit never.
  function sdkThread(rootId: string) {
    const known = threads[rootId] ?? [];
    const loaded = events(Array.isArray(known) ? known : known.loaded);
    const replies = Array.isArray(known) ? loaded : events([known.latest]);
    return {
      id: rootId,
      events: loaded,
      replyToEvent: replies.filter((reply) => !reply.getRelation()).at(-1) ?? null,
    };
  }
};

const client = (rooms: Room[], direct: unknown = {}) =>
  ({
    getRoom: (roomId: string) => rooms.find((candidate) => candidate.roomId === roomId) ?? null,
    getAccountData: () => ({ getContent: () => direct }),
  } as unknown as MatrixClient);

/**
 * A thread of the index whose newest message is `lastSenderId`'s, at `ts`; `preview` is what the
 * index made of that message, when it is not its text.
 */
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

  it('ranks by the newest reply of a thread, which an older reply that is loaded does not hide', () => {
    const rooms = [
      room('!lobby', {
        agents: [HELPER],
        // Its old answer is loaded; the server told of a newer one, edited since.
        threads: { $partial: { loaded: [[HELPER, 100]], latest: [HELPER, 300] } },
      }),
      room('!eng', { agents: [HELPER], messages: [[HELPER, 200]] }),
    ];
    const index = [thread('!lobby', HELPER, 900, '$partial')];
    const [helper] = readHomeAgents(client(rooms), ids(rooms), index);
    expect(helper).toMatchObject({ defaultRoomId: '!lobby', lastUsedTs: 300 });

    // A thread someone else wrote in last counts nothing from the index, whatever that still says.
    const answered = [
      room('!lobby', {
        agents: [HELPER],
        threads: { $partial: { loaded: [[HELPER, 100]], latest: [ME, 300] } },
      }),
    ];
    const [earlier] = readHomeAgents(client(answered), ids(answered), index);
    expect(earlier?.lastUsedTs).toBe(100);
  });

  it("counts no thread's title notice as an answer, and the answer it followed still", () => {
    const eng = (ts: number) => room('!eng', { agents: [HELPER], messages: [[HELPER, ts]] });
    // Loaded, the notice that followed Helper's answer is no later answer.
    const loaded = [
      room('!lobby', {
        agents: [HELPER],
        threads: {
          $titled: [[HELPER, 100], { sender: HELPER, ts: 500, title: true }],
        },
      }),
      eng(200),
    ];
    const [helper] = readHomeAgents(client(loaded), ids(loaded), []);
    expect(helper).toMatchObject({ defaultRoomId: '!eng', lastUsedTs: 200 });

    // Not loaded, the thread shows the notice last, which the router sent; the index names
    // Helper's answer, by the time of its last edit.
    const unopened = (engTs: number) => [
      room('!lobby', {
        agents: [HELPER],
        threads: { $titled: { loaded: [], latest: { sender: ROUTER, ts: 950, title: true } } },
      }),
      eng(engTs),
    ];
    const index = [thread('!lobby', HELPER, 900, '$titled')];
    // The answer kept from before the notice counts, by when it was sent: after Engineering's
    // of 200, before one of 400.
    vi.mocked(getThreadSummaryReply).mockReturnValueOnce(event(HELPER, 300));
    const [kept] = readHomeAgents(client(unopened(200)), ids(unopened(200)), index);
    expect(kept).toMatchObject({ defaultRoomId: '!lobby', lastUsedTs: 300 });
    vi.mocked(getThreadSummaryReply).mockReturnValueOnce(event(HELPER, 300));
    const [earlier] = readHomeAgents(client(unopened(400)), ids(unopened(400)), index);
    expect(earlier).toMatchObject({ defaultRoomId: '!eng', lastUsedTs: 400 });

    // With none kept (after a reload), the notice hides no answer: the index's counts.
    const [indexed] = readHomeAgents(client(unopened(200)), ids(unopened(200)), index);
    expect(indexed).toMatchObject({ defaultRoomId: '!lobby', lastUsedTs: 900 });
  });

  it('counts no message that could not be decrypted, whatever it turns out to be', () => {
    const lobby = (failed: boolean) => [
      room('!lobby', {
        agents: [HELPER],
        // Helper's title notice, which reads as a message while it cannot be decrypted.
        messages: [[HELPER, 100], failed ? { sender: HELPER, ts: 500, failed } : [HELPER, 500]],
      }),
      room('!eng', { agents: [HELPER], messages: [[HELPER, 200]] }),
    ];
    const [undecrypted] = readHomeAgents(client(lobby(true)), ids(lobby(true)), []);
    expect(undecrypted).toMatchObject({ defaultRoomId: '!eng', lastUsedTs: 200 });
    // Decrypted, it is the notice it is, and still counts nothing.
    const titled = [
      room('!lobby', {
        agents: [HELPER],
        messages: [[HELPER, 100], { sender: HELPER, ts: 500, title: true }],
      }),
      room('!eng', { agents: [HELPER], messages: [[HELPER, 200]] }),
    ];
    const [decrypted] = readHomeAgents(client(titled), ids(titled), []);
    expect(decrypted).toMatchObject({ defaultRoomId: '!eng', lastUsedTs: 200 });
    // A message that is read counts.
    const [read] = readHomeAgents(client(lobby(false)), ids(lobby(false)), []);
    expect(read).toMatchObject({ defaultRoomId: '!lobby', lastUsedTs: 500 });
  });

  it("counts no thread's reply that the index could not decrypt either", () => {
    const rooms = [
      room('!lobby', {
        agents: [HELPER],
        threads: { $root: [{ sender: HELPER, ts: 500, failed: true }] },
      }),
      room('!eng', { agents: [HELPER], messages: [[HELPER, 200]] }),
    ];
    const encrypted = [thread('!lobby', HELPER, 500, '$root', 'encrypted')];
    const [undecrypted] = readHomeAgents(client(rooms), ids(rooms), encrypted);
    expect(undecrypted).toMatchObject({ defaultRoomId: '!eng', lastUsedTs: 200 });
    // A reply the index could read counts by it, as one of a thread that is not loaded.
    const image = [thread('!lobby', HELPER, 500, '$root', 'image')];
    const [read] = readHomeAgents(client(rooms), ids(rooms), image);
    expect(read).toMatchObject({ defaultRoomId: '!lobby', lastUsedTs: 500 });
  });

  it('keeps a loaded answer at the time it was sent when a title notice ends its thread', () => {
    const rooms = [
      room('!lobby', {
        agents: [HELPER],
        threads: {
          // Helper's answer, edited since, then the router's title notice.
          $titled: [
            [ME, 90],
            [HELPER, 100],
            { sender: HELPER, ts: 400, relType: RelationType.Replace },
            { sender: ROUTER, ts: 500, title: true },
          ],
        },
      }),
      room('!eng', { agents: [HELPER], messages: [[HELPER, 200]] }),
    ];
    // The index gives the edit's time, which counts nothing beside the answer the client has.
    const index = [thread('!lobby', HELPER, 400, '$titled')];
    const [helper] = readHomeAgents(client(rooms), ids(rooms), index);
    expect(helper).toMatchObject({ defaultRoomId: '!eng', lastUsedTs: 200 });
  });

  it("counts a thread's newest reply before the index has the thread", () => {
    const rooms = [
      room('!lobby', { agents: [HELPER], messages: [[HELPER, 100]] }),
      // Not loaded, and not in the index yet: the server told of Helper's reply.
      room('!eng', {
        agents: [HELPER],
        threads: { $unopened: { loaded: [], latest: [HELPER, 200] } },
      }),
    ];
    const [helper] = readHomeAgents(client(rooms), ids(rooms), []);
    expect(helper).toMatchObject({ defaultRoomId: '!eng', lastUsedTs: 200 });
  });

  it("counts a thread's newest reply for its sender when the index names someone else", () => {
    const rooms = [
      room('!lobby', {
        agents: [HELPER, SCOUT],
        // Not loaded: the server told of Helper's reply, the index still of Scout's.
        threads: { $unopened: { loaded: [], latest: [HELPER, 300] } },
      }),
    ];
    const index = [thread('!lobby', SCOUT, 900, '$unopened')];
    const agents = readHomeAgents(client(rooms), ids(rooms), index);
    expect(agents.map((agent) => [agent.userId, agent.lastUsedTs])).toEqual([
      [SCOUT, 900],
      [HELPER, 300],
    ]);
  });

  it('takes, of several direct chats the agent has joined, the one it last answered in', () => {
    // Helper publishes no state in either chat.
    const chats = (first: number, second: number) => [
      room('!lobby', { agents: [HELPER], messages: [[HELPER, 100]] }),
      room('!dm-first', { members: { [HELPER]: 'join' }, count: 2, messages: [[HELPER, first]] }),
      room('!dm-second', { members: { [HELPER]: 'join' }, count: 2, messages: [[HELPER, second]] }),
    ];
    const direct = { [HELPER]: ['!dm-first', '!dm-second'] };
    const [newest] = readHomeAgents(client(chats(200, 500), direct), ['!lobby'], []);
    expect(newest).toMatchObject({
      direct: { roomId: '!dm-second', waiting: false },
      defaultRoomId: '!dm-second',
      lastUsedTs: 500,
    });
    // Answered in at one time, or never, the first `m.direct` lists is it; a room answered in
    // later than both is where a question goes.
    const [tied] = readHomeAgents(client(chats(50, 50), direct), ['!lobby'], []);
    expect(tied).toMatchObject({
      direct: { roomId: '!dm-first', waiting: false },
      defaultRoomId: '!lobby',
      lastUsedTs: 100,
    });
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

  it('takes no room for a direct chat that a third member it knows of is in or invited to', () => {
    const GUEST = '@guest:example.org';
    // The room's counts still say two.
    const withGuest = (membership: string) =>
      room('!dm', { members: { [HELPER]: 'join', [GUEST]: membership }, count: 2 });
    expect(isDirectRoomWith(withGuest('join'), HELPER)).toBe(false);
    expect(isDirectRoomWith(withGuest('invite'), HELPER)).toBe(false);
    expect(isDirectRoomWith(withGuest('leave'), HELPER)).toBe(true);
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
      getRoom: () => null,
    };
  };

  it('takes no invitation for the direct chat while the agent may be in a chat not loaded yet', async () => {
    // `m.direct` lists a chat of two whose members are yet to load, then one Scout is invited
    // to. Loaded, Scout is in the first (`joins`), or is not.
    const listing = (joins: boolean) => {
      let loaded = false;
      const unloaded = Object.assign(room('!dm-unloaded', { count: 2 }), {
        membersLoaded: () => loaded,
        getMember: (userId: string) =>
          loaded && joins && userId === SCOUT ? { membership: 'join' } : null,
        loadMembersIfNeeded: vi.fn(async () => {
          loaded = true;
          return true;
        }),
      });
      const rooms = [
        room('!lobby', { agents: [SCOUT] }),
        unloaded,
        room('!dm-invited', { members: { [SCOUT]: 'invite' }, count: 1 }),
      ];
      const mx = Object.assign(client(rooms, { [SCOUT]: ['!dm-unloaded', '!dm-invited'] }), {
        createRoom: vi.fn(async () => ({ room_id: '!duplicate' })),
        setAccountData: vi.fn(async () => undefined),
      });
      const direct = () => readHomeAgents(mx, ['!lobby'], [])[0]?.direct;
      return { mx, direct };
    };

    // Not known yet: no direct chat, so Home offers to start one, which loads the members.
    const joined = listing(true);
    expect(joined.direct()).toBeUndefined();
    await expect(startDirectChat(joined.mx, SCOUT)).resolves.toBe('!dm-unloaded');
    expect(joined.direct()).toEqual({ roomId: '!dm-unloaded', waiting: false });

    // Scout is not in the first after all: the invitation stands, and no chat is made beside it.
    const elsewhere = listing(false);
    expect(elsewhere.direct()).toBeUndefined();
    await expect(startDirectChat(elsewhere.mx, SCOUT)).resolves.toBe('!dm-invited');
    expect(elsewhere.direct()).toEqual({ roomId: '!dm-invited', waiting: true });
    expect(joined.mx.createRoom).not.toHaveBeenCalled();
    expect(elsewhere.mx.createRoom).not.toHaveBeenCalled();
  });

  it('makes no second chat beside a listed one whose members were not loaded', async () => {
    // A chat of two `m.direct` lists, the agent's membership in it not loaded yet.
    let loaded = false;
    const listed = Object.assign(room('!dm', { count: 2 }), {
      getMember: (userId: string) => (loaded && userId === SCOUT ? { membership: 'join' } : null),
      loadMembersIfNeeded: vi.fn(async () => {
        loaded = true;
        return true;
      }),
    });
    const mx = Object.assign(client([listed], { [SCOUT]: ['!dm'] }), {
      createRoom: vi.fn(async () => ({ room_id: '!duplicate' })),
      setAccountData: vi.fn(async () => undefined),
    });
    await expect(startDirectChat(mx, SCOUT)).resolves.toBe('!dm');
    expect(listed.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(mx.createRoom).not.toHaveBeenCalled();

    // Loaded, a chat the agent is not in is no chat with it: one is made.
    const other = Object.assign(room('!other', { count: 2 }), {
      loadMembersIfNeeded: vi.fn(async () => true),
    });
    const fresh = Object.assign(client([other], { [HELPER]: ['!other'] }), {
      createRoom: vi.fn(async () => ({ room_id: '!made' })),
      setAccountData: vi.fn(async () => undefined),
    });
    await expect(startDirectChat(fresh, HELPER)).resolves.toBe('!made');
    expect(other.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('loads a chat `m.direct` lists only while the members of another load', async () => {
    // `m.direct` lists `listed`, Scout in none of them, and the chat Scout is in only once the
    // first room's members are loading.
    const listing = (listed: string[]) => {
      const direct = { [SCOUT]: listed };
      let joined = false;
      const first = Object.assign(room('!dm-first', { count: 2 }), {
        loadMembersIfNeeded: vi.fn(async () => {
          direct[SCOUT] = [...listed, '!dm-late'];
          return true;
        }),
      });
      const late = Object.assign(room('!dm-late', { count: 2 }), {
        getMember: (userId: string) => (joined && userId === SCOUT ? { membership: 'join' } : null),
        loadMembersIfNeeded: vi.fn(async () => {
          joined = true;
          return true;
        }),
      });
      const invited = room('!dm-invited', { members: { [SCOUT]: 'invite' }, count: 1 });
      const mx = Object.assign(client([first, late, invited], direct), {
        createRoom: vi.fn(async () => ({ room_id: '!duplicate' })),
        setAccountData: vi.fn(async () => undefined),
      });
      return { mx, first, late };
    };
    // Neither a second chat is made beside it, nor is an invitation listed before it taken.
    const alone = listing(['!dm-first']);
    await expect(startDirectChat(alone.mx, SCOUT)).resolves.toBe('!dm-late');
    expect(alone.mx.createRoom).not.toHaveBeenCalled();
    expect(alone.first.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(alone.late.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    const withInvitation = listing(['!dm-first', '!dm-invited']);
    await expect(startDirectChat(withInvitation.mx, SCOUT)).resolves.toBe('!dm-late');
    expect(withInvitation.mx.createRoom).not.toHaveBeenCalled();
  });

  it('makes no chat while the members of a listed one do not load, and can be tried again', async () => {
    const unloaded = (roomId: string, load: () => Promise<boolean>) => {
      let loaded = false;
      return Object.assign(room(roomId, { count: 2 }), {
        getMember: (userId: string) => (loaded && userId === SCOUT ? { membership: 'join' } : null),
        loadMembersIfNeeded: vi.fn(async () => {
          loaded = await load();
          return loaded;
        }),
      });
    };
    const mxFor = (rooms: Room[]) =>
      Object.assign(client(rooms, { [SCOUT]: ids(rooms) }), {
        createRoom: vi.fn(async () => ({ room_id: '!duplicate' })),
        setAccountData: vi.fn(async () => undefined),
      });
    const offline = vi.fn<() => Promise<boolean>>().mockRejectedValueOnce(new Error('offline'));
    offline.mockResolvedValue(true);
    const listed = unloaded('!dm', offline);
    const mx = mxFor([listed]);
    // The chat may be this one: none is made beside it.
    await expect(startDirectChat(mx, SCOUT)).rejects.toThrow('did not load');
    expect(mx.createRoom).not.toHaveBeenCalled();
    // Tried again once its members load, the chat is this one.
    await expect(startDirectChat(mx, SCOUT)).resolves.toBe('!dm');
    expect(listed.loadMembersIfNeeded).toHaveBeenCalledTimes(2);
    expect(mx.createRoom).not.toHaveBeenCalled();

    // A chat found among the others listed is taken, whatever did not load.
    const lost = unloaded('!lost', () => Promise.reject(new Error('offline')));
    const found = unloaded('!found', async () => true);
    const both = mxFor([lost, found]);
    await expect(startDirectChat(both, SCOUT)).resolves.toBe('!found');
    expect(lost.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(both.createRoom).not.toHaveBeenCalled();
  });

  it('takes, of several listed chats whose members load, the one the agent last answered in', async () => {
    // Two chats `m.direct` lists, Scout's membership in neither loaded yet.
    const listing = (first: number, second: number) => {
      let loaded = false;
      const chat = (roomId: string, ts: number) =>
        Object.assign(room(roomId, { count: 2, messages: [[SCOUT, ts]] }), {
          getMember: (userId: string) =>
            loaded && userId === SCOUT ? { membership: 'join' } : null,
          loadMembersIfNeeded: vi.fn(async () => {
            loaded = true;
            return true;
          }),
        });
      const rooms = [chat('!dm-first', first), chat('!dm-second', second)];
      return Object.assign(client(rooms, { [SCOUT]: ids(rooms) }), {
        createRoom: vi.fn(async () => ({ room_id: '!duplicate' })),
        setAccountData: vi.fn(async () => undefined),
      });
    };
    // As `readHomeAgents` takes it: by its messages the client has, then by the thread index.
    await expect(startDirectChat(listing(200, 500), SCOUT)).resolves.toBe('!dm-second');
    await expect(startDirectChat(listing(200, 200), SCOUT)).resolves.toBe('!dm-first');
    const index = [thread('!dm-first', SCOUT, 900)];
    const indexed = listing(200, 500);
    await expect(startDirectChat(indexed, SCOUT, undefined, index)).resolves.toBe('!dm-first');
    expect(indexed.createRoom).not.toHaveBeenCalled();
  });

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
