import { createClient, type IEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import {
  FeatureSupport,
  FILTER_RELATED_BY_REL_TYPES,
  FILTER_RELATED_BY_SENDERS,
  THREAD_RELATION_TYPE,
  Thread,
} from 'matrix-js-sdk/lib/models/thread';
import { MemoryStore } from 'matrix-js-sdk/lib/store/memory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildThreadRecord } from '../../event-store/threads/threadRecord';
import {
  clearThreadSummarySharedState,
  getThreadSummaryStateSnapshot,
} from '../../event-store/threads/threadSummaryState';
import { keepThreadTitles } from './threadTitleWatch';
import { defined } from '../../../test/utils/defined';

// The titles' disk copy: empty, and every write succeeds.
vi.mock('../../event-store/cache/db', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadCachedThreadSummaries: () => Promise.resolve(new Map()),
  saveCachedThreadSummary: () => Promise.resolve(),
}));

const sessionId = 'session';
const roomId = '!room:example.org';
const agentId = '@agent:example.org';
const personId = '@person:example.org';
const rootId = '$root';
const TITLE = 'Release checklist for the November build';

const message = (
  eventId: string,
  ts: number,
  content: Record<string, unknown>,
  sender = agentId
): IEvent =>
  ({
    event_id: eventId,
    room_id: roomId,
    sender,
    type: 'm.room.message',
    origin_server_ts: ts,
    unsigned: {},
    content: { msgtype: 'm.text', ...content },
  } as IEvent);
const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } };
const root = (): IEvent => message(rootId, 1, { body: 'What goes into the release?' }, personId);
const reply = (): IEvent =>
  message('$reply', 100, { body: 'The checklist has 4 items.', ...inThread });
const titleNotice = (): IEvent =>
  message('$title', 110, {
    msgtype: 'm.notice',
    body: TITLE,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: TITLE,
      message_count: 1,
      generated_at: '2026-11-05T10:00:00Z',
      model: 'default',
    },
    ...inThread,
  });
const laterQuestion = (): IEvent =>
  message('$later', 200, { body: 'And the changelog?', ...inThread }, personId);
/** The root as the server lists it: its summary names the latest thread event and the count. */
const listedRoot = (latest: IEvent, count: number): IEvent => ({
  ...root(),
  unsigned: {
    'm.relations': {
      'm.thread': { count, current_user_participated: true, latest_event: latest },
    },
  },
});
/** The title the room's state holds for the thread, as MindRoom would write it. */
const titleState = (summary = TITLE): IEvent =>
  ({
    type: 'io.mindroom.thread_summary',
    event_id: '$title-state',
    room_id: roomId,
    sender: agentId,
    state_key: rootId,
    origin_server_ts: 120,
    unsigned: {},
    content: {
      version: 1,
      summary,
      message_count: 1,
      generated_at: '2026-11-05T10:00:00Z',
      model: 'default',
      event_id: '$title',
    },
  } as IEvent);
const encryption = (): IEvent =>
  ({
    type: 'm.room.encryption',
    event_id: '$encryption',
    room_id: roomId,
    sender: personId,
    state_key: '',
    origin_server_ts: 0,
    unsigned: {},
    content: { algorithm: 'm.megolm.v1.aes-sha2' },
  } as IEvent);
const membership = (userId: string): IEvent =>
  ({
    type: 'm.room.member',
    event_id: `$member-${userId}`,
    room_id: roomId,
    sender: userId,
    state_key: userId,
    origin_server_ts: 0,
    content: { membership: 'join' },
  } as IEvent);

const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const clients: MatrixClient[] = [];

/** A real SDK client against a fake homeserver; `serverThread` is the thread's latest page. */
const fixture = (serverThread: () => IEvent[]) => {
  const pendingSyncs: unknown[] = [];
  const waitingSyncs: Array<(response: Response) => void> = [];
  let batch = 0;
  const mx = createClient({
    baseUrl: 'https://example.org',
    userId: personId,
    accessToken: 'token',
    timelineSupport: true,
    store: new MemoryStore(),
    fetchFn: async (input) => {
      const path = decodeURIComponent(new URL(String(input)).pathname);
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
      if (path.endsWith(`/event/${rootId}`)) return json(listedRoot(titleNotice(), 2));
      if (path.includes(`/relations/${rootId}`)) return json({ chunk: serverThread() });
      throw new Error(`Unexpected request ${path}`);
    },
  });
  clients.push(mx);
  (mx as MatrixClient & { serverVersionsPromise?: Promise<unknown> }).serverVersionsPromise =
    Promise.resolve({ versions: ['v1.4'], unstable_features: {} });

  const deliver = async (events: IEvent[], state: IEvent[] = []) => {
    batch += 1;
    const response = {
      next_batch: `batch-${batch}`,
      rooms: {
        join: {
          [roomId]: {
            state: { events: [membership(agentId), membership(personId), ...state] },
            timeline: { events, prev_batch: 'before', limited: false },
            ephemeral: { events: [] },
            account_data: { events: [] },
          },
        },
      },
    };
    const waiting = waitingSyncs.shift();
    if (waiting) waiting(json(response));
    else pendingSyncs.push(response);
    await settle();
  };
  const start = async (keep = true) => {
    if (keep) keepThreadTitles(mx, sessionId);
    void mx.startClient({ threadSupport: true, lazyLoadMembers: true });
    await vi.waitFor(() => expect(waitingSyncs.length > 0 || pendingSyncs.length > 0).toBe(true));
    await settle();
  };
  const room = (): Room => mx.getRoom(roomId)!;
  /** The title the thread's card, sidebar row and Threads page row show. */
  const title = () =>
    buildThreadRecord({
      room: room(),
      threadRootId: rootId,
      summaryInfo: getThreadSummaryStateSnapshot(sessionId, roomId).get(rootId),
    }).presentation.primarySummaryText;
  return { deliver, start, room, title };
};

const threadNamespaces = [
  FILTER_RELATED_BY_REL_TYPES,
  FILTER_RELATED_BY_SENDERS,
  THREAD_RELATION_TYPE,
];

describe('thread titles a device did not see arrive', () => {
  let support: [FeatureSupport, FeatureSupport, FeatureSupport];
  let namespaces: boolean[];
  beforeEach(() => {
    clearThreadSummarySharedState();
    namespaces = threadNamespaces.map((value) => value.name === value.unstable);
    support = [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ];
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

  it("keeps a title known from the root's server summary after a later reply", async () => {
    const f = fixture(() => [titleNotice(), reply()]);
    await f.start();
    // The thread arrives listed: the server's summary names the title notice as its latest event.
    await f.deliver([listedRoot(titleNotice(), 2)]);
    expect(f.title()).toBe(TITLE);

    await f.deliver([laterQuestion()]);
    expect(f.room().getThread(rootId)?.replyToEvent?.getId()).toBe('$later');
    expect(f.title()).toBe(TITLE);
  });

  it('keeps the title a loaded page held', async () => {
    const f = fixture(() => [laterQuestion(), titleNotice(), reply()]);
    await f.start();
    await f.deliver([listedRoot(laterQuestion(), 3)]);
    expect(f.title()).toBe('What goes into the release?');

    // A card on screen loads the thread's latest page, which holds the title notice.
    await f.room().getThread(rootId)?.initialize();
    await settle();
    expect(getThreadSummaryStateSnapshot(sessionId, roomId).get(rootId)?.summaryText).toBe(TITLE);
  });

  it("knows a title from the room's state, in a thread it never loaded", async () => {
    const f = fixture(() => []);
    await f.start();
    // The title notice is history; the server's summary names a later question.
    await f.deliver([listedRoot(laterQuestion(), 3)], [titleState()]);
    expect(f.title()).toBe(TITLE);

    await f.deliver([], [titleState('Release checklist and changelog')]);
    expect(f.title()).toBe('Release checklist and changelog');
  });

  it("ignores titles in an encrypted room's state", async () => {
    const f = fixture(() => []);
    await f.start();
    await f.deliver([listedRoot(laterQuestion(), 3)], [encryption(), titleState()]);
    expect(f.title()).toBe('What goes into the release?');
  });
});
