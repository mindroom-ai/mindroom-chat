import {
  ClientEvent,
  createClient,
  type IEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import {
  FeatureSupport,
  FILTER_RELATED_BY_REL_TYPES,
  FILTER_RELATED_BY_SENDERS,
  THREAD_RELATION_TYPE,
  Thread,
  ThreadEvent,
} from 'matrix-js-sdk/lib/models/thread';
import type { ISavedSync } from 'matrix-js-sdk/lib/store';
import { MemoryStore } from 'matrix-js-sdk/lib/store/memory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRoomThreads } from '../../event-store/threads/roomThreadList';
import { getThreadReplyCount } from '../../event-store/threads/threadRecord';
import { keepThreadReplyCounts } from './threadReplyCounts';
import { defined } from '../../../test/utils/defined';

const roomId = '!room:example.org';
const userId = '@alice:example.org';
const rootId = '$root';

const message = (eventId: string, ts: number, content: Record<string, unknown> = {}): IEvent =>
  ({
    event_id: eventId,
    room_id: roomId,
    sender: userId,
    type: 'm.room.message',
    origin_server_ts: ts,
    unsigned: {},
    content: { msgtype: 'm.text', body: eventId, ...content },
  } as IEvent);
const reply = (index: number): IEvent =>
  message(`$reply-${index}`, 100 + index, {
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
  });
const edit = (index: number, body: string, ts: number): IEvent =>
  message(`$edit-${ts}`, ts, {
    body: `* ${body}`,
    'm.new_content': { msgtype: 'm.text', body },
    'm.relates_to': { rel_type: 'm.replace', event_id: `$reply-${index}` },
  });
const redaction = (index: number, ts: number): IEvent => ({
  ...message(`$redaction-${ts}`, ts),
  type: 'm.room.redaction',
  redacts: `$reply-${index}`,
  content: { redacts: `$reply-${index}` },
});
/** The root as the server sends it: its unsigned summary counts the replies the server has. */
const summarizedRoot = (replies: IEvent[]): IEvent => ({
  ...message(rootId, 1),
  unsigned: replies.length
    ? {
        'm.relations': {
          'm.thread': {
            count: replies.length,
            current_user_participated: true,
            latest_event: replies[replies.length - 1],
          },
        },
      }
    : {},
});
const membership: IEvent = {
  type: 'm.room.member',
  event_id: '$membership',
  room_id: roomId,
  sender: userId,
  state_key: userId,
  origin_server_ts: 0,
  content: { membership: 'join' },
} as IEvent;
const joinedRoom = (events: IEvent[], state: IEvent[] = []) => ({
  state: { events: [membership, ...state] },
  timeline: { events, prev_batch: 'before', limited: false },
  ephemeral: { events: [] },
  account_data: { events: [] },
});
const savedSync = (events: IEvent[], state: IEvent[] = []): ISavedSync => ({
  nextBatch: 'saved',
  accountData: [],
  roomsData: {
    join: { [roomId]: joinedRoom(events, state) as never },
    invite: {},
    leave: {},
    knock: {},
  },
});

const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

type FixtureOptions = {
  /** The thread's replies on the server. */
  replies: IEvent[];
  /** What a reload replays from the store, if anything. */
  saved?: ISavedSync;
  /** The `/versions` answer kept from the last session, as the app hands it to the SDK. */
  cachedVersions?: boolean;
};

const clients: MatrixClient[] = [];

/** A real SDK client against a fake homeserver whose /sync answers come from `deliver`. */
const fixture = ({ replies, saved, cachedVersions = true }: FixtureOptions) => {
  // `pageGate`, while set, holds the answers for the thread's reply pages.
  const server: { replies: IEvent[]; pageGate?: Promise<void> } = { replies: [...replies] };
  const pendingSyncs: unknown[] = [];
  const waitingSyncs: Array<(response: Response) => void> = [];
  let batch = 0;
  const store = new MemoryStore();
  // The browser's IndexedDB answers after server discovery has ended.
  vi.spyOn(store, 'getSavedSync').mockImplementation(
    () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(saved ? structuredClone(saved) : null), 20);
      })
  );
  vi.spyOn(store, 'getSavedSyncToken').mockResolvedValue(saved?.nextBatch ?? null);
  const mx = createClient({
    baseUrl: 'https://example.org',
    userId,
    accessToken: 'token',
    timelineSupport: true,
    store,
    fetchFn: async (input) => {
      const url = new URL(String(input));
      const path = decodeURIComponent(url.pathname);
      if (path.endsWith('/versions')) return json({ versions: ['v1.4'], unstable_features: {} });
      if (path.endsWith('/pushrules/')) return json({ global: {} });
      if (path.endsWith('/filter')) return json({ filter_id: 'filter' });
      if (path.endsWith('/capabilities')) return json({ capabilities: {} });
      if (path.endsWith('/sync')) {
        const next = pendingSyncs.shift();
        if (next) return json(next);
        return new Promise<Response>((resolve) => {
          waitingSyncs.push(resolve);
        });
      }
      if (path.endsWith('/messages')) return json({ chunk: [], start: 'start', end: 'end' });
      if (path.endsWith('/threads')) return json({ chunk: [summarizedRoot(server.replies)] });
      if (path.endsWith(`/event/${rootId}`)) return json(summarizedRoot(server.replies));
      if (path.includes(`/relations/${rootId}`)) {
        await server.pageGate;
        return json({ chunk: [...server.replies].reverse() });
      }
      throw new Error(`Unexpected request ${path}`);
    },
  });
  clients.push(mx);
  if (cachedVersions) {
    (mx as MatrixClient & { serverVersionsPromise?: Promise<unknown> }).serverVersionsPromise =
      Promise.resolve({ versions: ['v1.4'], unstable_features: {} });
  }

  /** Answers the client's next /sync with these room events, as the server sends them. */
  const deliver = async (events: IEvent[]) => {
    batch += 1;
    const response = {
      next_batch: `batch-${batch}`,
      rooms: { join: { [roomId]: joinedRoom(events) } },
    };
    const waiting = waitingSyncs.shift();
    if (waiting) waiting(json(response));
    else pendingSyncs.push(response);
    await settle();
  };
  const start = async (keep = true) => {
    if (keep) keepThreadReplyCounts(mx);
    void mx.startClient({ threadSupport: true, lazyLoadMembers: true });
    // Started: the saved rooms are back and the first /sync is waiting for an answer.
    await vi.waitFor(() => expect(waitingSyncs.length > 0 || pendingSyncs.length > 0).toBe(true));
    await settle();
  };
  const room = (): Room => mx.getRoom(roomId)!;
  const thread = (): Thread => room().getThread(rootId)!;
  /** The count a thread card or badge shows for the root. */
  const shownCount = () => getThreadReplyCount(room(), room().findEventById(rootId)!);
  return { mx, server, deliver, start, room, thread, shownCount };
};

const threadNamespaces = [
  FILTER_RELATED_BY_REL_TYPES,
  FILTER_RELATED_BY_SENDERS,
  THREAD_RELATION_TYPE,
];

describe('thread reply counts', () => {
  let support: [FeatureSupport, FeatureSupport, FeatureSupport];
  let namespaces: boolean[];
  beforeEach(() => {
    namespaces = threadNamespaces.map((value) => value.name === value.unstable);
    support = [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ];
    Thread.hasServerSideSupport = FeatureSupport.None;
    Thread.hasServerSideListSupport = FeatureSupport.None;
    Thread.hasServerSideFwdPaginationSupport = FeatureSupport.None;
  });
  afterEach(() => {
    clients.splice(0).forEach((mx) => mx.stopClient());
    [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ] = support;
    threadNamespaces.forEach((value, index) =>
      value.setPreferUnstable(defined(namespaces[index], 'a saved namespace preference'))
    );
    vi.restoreAllMocks();
  });

  it('counts the replies that come with their root once', async () => {
    const replies = [reply(1), reply(2), reply(3)];
    const f = fixture({ replies });
    await f.start();
    await f.deliver([summarizedRoot(replies), ...replies]);

    expect(f.thread().initialEventsFetched).toBe(false);
    expect(f.thread().length).toBe(3);
    expect(f.shownCount()).toBe(3);
  });

  it('counts each new reply once', async () => {
    const replies = [reply(1), reply(2)];
    const f = fixture({ replies });
    await f.start();
    await f.deliver([summarizedRoot(replies), ...replies]);

    await f.deliver([reply(3)]);
    expect(f.thread().length).toBe(3);
    await f.deliver([reply(4), reply(5)]);
    expect(f.thread().length).toBe(5);
    expect(f.shownCount()).toBe(5);
  });

  it('does not count a reply again when the event cache adds it later', async () => {
    const replies = [reply(1), reply(2), reply(3)];
    const f = fixture({ replies });
    await f.start();
    // A short sync window holds only the latest reply.
    await f.deliver([summarizedRoot(replies), reply(3)]);
    expect(f.thread().length).toBe(3);

    await f.room().addLiveEvents([reply(1), reply(2)].map(f.mx.getEventMapper()), {
      addToState: false,
      fromCache: true,
    });
    await settle();
    expect(f.thread().length).toBe(3);
  });

  describe('after a reload', () => {
    // The saved root's summary dates from the sync that first brought it; a reply came after it.
    const replies = [reply(1), reply(2), reply(3)];
    const saved = savedSync([summarizedRoot(replies.slice(0, 2)), ...replies]);

    it('counts the saved replies once', async () => {
      const f = fixture({ replies, saved });
      await f.start();

      expect(f.thread().length).toBe(3);
      expect(f.shownCount()).toBe(3);
    });

    it('applies a saved redaction of a reply saved with it', async () => {
      const f = fixture({
        replies: [defined(replies[0], 'reply 1'), defined(replies[2], 'reply 3')],
        saved: savedSync([summarizedRoot(replies.slice(0, 2)), ...replies, redaction(2, 300)]),
      });
      await f.start();

      expect(f.room().findEventById('$reply-2')?.isRedacted()).toBe(true);
      expect(f.thread().length).toBe(2);
      expect(f.shownCount()).toBe(2);
    });

    it('applies a saved redaction of a reply by a moderator who left after it', async () => {
      const moderator = '@moderator:elsewhere.org';
      const state = (type: string, stateKey: string, content: object, extra = {}) =>
        ({
          type,
          state_key: stateKey,
          event_id: `$${type}-${stateKey}-${JSON.stringify(content)}`,
          room_id: roomId,
          sender: moderator,
          origin_server_ts: 0,
          content,
          ...extra,
        } as IEvent);
      const leave = state(
        'm.room.member',
        moderator,
        { membership: 'leave' },
        { unsigned: { prev_content: { membership: 'join' } } }
      );
      const f = fixture({
        replies: [defined(replies[0], 'reply 1'), defined(replies[2], 'reply 3')],
        saved: savedSync(
          [
            summarizedRoot(replies.slice(0, 2)),
            ...replies,
            { ...redaction(2, 300), sender: moderator },
            leave,
          ],
          [
            state('m.room.create', '', { creator: userId, room_version: '10' }),
            state('m.room.member', moderator, { membership: 'join' }),
            state('m.room.power_levels', '', { users: { [moderator]: 50 }, redact: 50 }),
          ]
        ),
      });
      await f.start();

      expect(f.room().findEventById('$reply-2')?.isRedacted()).toBe(true);
      expect(f.thread().length).toBe(2);
    });

    it('keeps the replies after the summary while server discovery is pending', async () => {
      const f = fixture({ replies, saved, cachedVersions: false });
      await f.start();
      // The SDK reads the summary again once discovery ends, before the first /sync.
      await vi.waitFor(() => expect(Thread.hasServerSideSupport).toBe(FeatureSupport.Stable));
      await settle();

      expect(f.thread().length).toBe(3);
    });
  });

  it('lowers the count and the summary when a reply is redacted', async () => {
    const replies = [reply(1), reply(2), reply(3)];
    const f = fixture({ replies });
    await f.start();
    await f.deliver([summarizedRoot(replies), ...replies]);

    await f.deliver([redaction(1, 200)]);
    expect(f.thread().length).toBe(2);
    expect(f.shownCount()).toBe(2);

    // The summary's latest reply: the SDK reads the summary again.
    await f.deliver([redaction(3, 201)]);
    expect(f.thread().length).toBe(1);
    expect(f.shownCount()).toBe(1);
  });

  it('does not count edits', async () => {
    const replies = [reply(1), reply(2)];
    const f = fixture({ replies });
    await f.start();
    await f.deliver([summarizedRoot(replies), ...replies]);

    await f.deliver([edit(2, 'streamed', 150), edit(2, 'streamed more', 151)]);
    expect(f.thread().length).toBe(2);
    expect(f.shownCount()).toBe(2);
  });

  it('keeps the count when the thread opens, then counts its new replies and redactions', async () => {
    const replies = [reply(1), reply(2), reply(3)];
    const f = fixture({ replies });
    await f.start();
    await f.deliver([summarizedRoot(replies), ...replies]);

    await f.thread().initialize();
    await settle();
    expect(f.thread().initialEventsFetched).toBe(true);
    expect(f.thread().length).toBe(3);

    f.server.replies.push(reply(4));
    await f.deliver([reply(4)]);
    expect(f.thread().length).toBe(4);
    expect(f.shownCount()).toBe(4);

    f.server.replies.splice(0, 1);
    await f.deliver([redaction(1, 200)]);
    expect(f.thread().length).toBe(3);
    expect(f.shownCount()).toBe(3);

    await f.deliver([edit(4, 'edited', 201)]);
    expect(f.thread().length).toBe(3);
  });

  it('counts a reply once when sync brings it while the thread opens', async () => {
    const replies = [reply(1), reply(2), reply(3)];
    const f = fixture({ replies });
    await f.start();
    await f.deliver([summarizedRoot(replies), ...replies]);

    // A fourth reply reaches the server. The opening thread reads the root, whose summary counts
    // it, and sync brings the reply before the thread's first page.
    f.server.replies.push(reply(4));
    let releasePage = () => {};
    f.server.pageGate = new Promise<void>((resolve) => {
      releasePage = resolve;
    });
    const opening = f.thread().initialize();
    await settle();
    await f.deliver([reply(4)]);
    expect(f.thread().length).toBe(4);
    expect(f.shownCount()).toBe(4);

    releasePage();
    await opening;
    await settle();
    expect(f.thread().initialEventsFetched).toBe(true);
    expect(f.thread().length).toBe(4);
    expect(f.shownCount()).toBe(4);
  });

  it('agrees with the server thread list', async () => {
    const replies = [reply(1), reply(2), reply(3)];
    const f = fixture({ replies });
    await f.start();
    await f.deliver([summarizedRoot(replies), ...replies]);
    await f.deliver([reply(4)]);
    f.server.replies.push(reply(4));

    await loadRoomThreads(f.room());
    await settle();
    expect(f.thread().length).toBe(4);
    expect(f.shownCount()).toBe(4);
  });

  it('is what keeps the SDK from counting them twice', async () => {
    const replies = [reply(1), reply(2), reply(3)];
    const f = fixture({ replies });
    await f.start(false);
    await f.deliver([summarizedRoot(replies), reply(3)]);
    expect(f.thread().length).toBe(4);

    const stop = keepThreadReplyCounts(f.mx);
    expect(f.thread().length).toBe(3);
    stop();
    await f.room().addLiveEvents([reply(1)].map(f.mx.getEventMapper()), { addToState: false });
    await settle();
    expect(f.thread().length).toBe(4);
  });

  it('lets go of a room the account forgets', async () => {
    const replies = [reply(1)];
    const f = fixture({ replies });
    await f.start(false);
    await f.deliver([summarizedRoot(replies)]);
    const room = f.room();
    const before = room.listenerCount(ThreadEvent.New);
    keepThreadReplyCounts(f.mx);
    expect(room.listenerCount(ThreadEvent.New)).toBe(before + 1);

    // What the SDK announces once `forget` takes the room out of the store.
    f.mx.emit(ClientEvent.DeleteRoom, roomId);
    expect(room.listenerCount(ThreadEvent.New)).toBe(before);
  });
});
