import {
  Direction,
  MatrixClient,
  MatrixEvent,
  MemoryStore,
  Room,
  ThreadEvent,
  type IEvent,
} from 'matrix-js-sdk';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLatestVisibleReply, getThreadUnread } from '../../event-store/threads/roomThreadList';
import { runThreadOpenSdkBootstrap } from './threadOpenSdkBootstrap';

// A reader opens a thread just after an agent started its reply, before /sync brought that reply.
// Opening the thread loads it from the server. The copy of the reply that /sync brings next, and
// the edits that stream it, must reach the thread's live timeline: thread cards, the unread state
// and read receipts read that timeline.

const ROOM_ID = '!desk:example.org';
const READER = '@reader:example.org';
const HELPER = '@helper:example.org';

const raw = (
  id: string,
  ts: number,
  content: Record<string, unknown>,
  sender = HELPER
): Partial<IEvent> => ({
  event_id: id,
  room_id: ROOM_ID,
  sender,
  type: 'm.room.message',
  origin_server_ts: ts,
  content,
});

const ROOT = raw('$root', 1000, { msgtype: 'm.text', body: 'Which fixes go into the notes?' }, READER);
const REPLY = raw('$reply', 2000, {
  msgtype: 'm.text',
  body: 'Checking the notes.',
  'io.mindroom.stream_status': 'streaming',
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: '$root',
    is_falling_back: true,
    'm.in_reply_to': { event_id: '$root' },
  },
});
const FINISHED = 'Ready: the notes list the export fix and the keyboard shortcuts.';
const edit = (id: string, ts: number, body: string, status: string) =>
  raw(id, ts, {
    msgtype: 'm.text',
    body: `* ${body}`,
    'm.new_content': { msgtype: 'm.text', body, 'io.mindroom.stream_status': status },
    'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
  });

/** The root as the server sends it once the reply exists: with its thread summary. */
const rootWithSummary = (): Partial<IEvent> => ({
  ...ROOT,
  unsigned: {
    'm.relations': {
      'm.thread': { count: 1, latest_event: REPLY, current_user_participated: false },
    },
  },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

type Server = {
  /** Thread replies (and their edits) on the server, oldest first. */
  replies: Partial<IEvent>[];
  /** Holds the thread's relation pages until released. */
  holdRelations?: Promise<void>;
};

/** A homeserver for one room: the root's context, the root, and the thread's relations. */
const serve =
  (server: Server) =>
  async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname);
    if (path.endsWith('/context/$root')) {
      return json({
        event: server.replies.length ? rootWithSummary() : ROOT,
        start: 'before-root',
        end: 'after-root',
        events_before: [],
        events_after: [],
        state: [],
      });
    }
    if (path.endsWith('/event/$root')) return json(server.replies.length ? rootWithSummary() : ROOT);
    if (path.includes('/relations/$root')) {
      await server.holdRelations;
      // Relations are newest first; nothing precedes the root.
      const older = url.searchParams.get('from') === 'before-root';
      return json({ chunk: older ? [] : server.replies.slice().reverse() });
    }
    return json({ errcode: 'M_NOT_FOUND', error: 'Not found' }, 404);
  };

class TestClient extends MatrixClient {
  constructor(server: Server) {
    super({
      baseUrl: 'https://example.org',
      userId: READER,
      fetchFn: serve(server),
      store: new MemoryStore(),
    });
    // Real thread routing without a sync loop.
    this.clientOpts = { threadSupport: true };
    this.canSupport.set(Feature.RelationsRecursion, ServerSupport.Stable);
  }
}

/** A room whose live timeline holds the root; the client has not seen a reply yet. */
const setup = async (server: Server) => {
  const mx = new TestClient(server);
  const room = new Room(ROOM_ID, mx, READER);
  mx.store.storeRoom(room);
  await room.addLiveEvents([new MatrixEvent(structuredClone(ROOT))], { addToState: false });
  return { mx, room };
};

const open = (mx: MatrixClient, room: Room) =>
  runThreadOpenSdkBootstrap({
    debugTraceId: undefined,
    isMounted: () => true,
    mx,
    room,
    threadId: '$root',
    persistThreadEventCache: vi.fn(),
    pinThreadToBottomOnOpen: vi.fn(),
    setSupplementalThreadEvents: vi.fn(),
    onBootstrap: vi.fn(),
    shouldScrollToLatestOnOpen: true,
  });

/** /sync brings events: each one a new object, as a sync response maps it. */
const sync = (room: Room, ...events: Partial<IEvent>[]) =>
  room.addLiveEvents(
    // The SDK writes into an event's JSON, so each delivery gets its own copy.
    events.map((event) => new MatrixEvent(structuredClone(event))),
    { addToState: false }
  );

const liveIds = (room: Room) =>
  room
    .getThread('$root')
    ?.events.map((event) => event.getId())
    .filter((id) => id !== undefined);

describe('runThreadOpenSdkBootstrap and a reply /sync brings later', () => {
  let support: [FeatureSupport, FeatureSupport];

  beforeEach(() => {
    support = [Thread.hasServerSideSupport, Thread.hasServerSideFwdPaginationSupport];
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    Thread.hasServerSideFwdPaginationSupport = FeatureSupport.Stable;
  });

  afterEach(() => {
    [Thread.hasServerSideSupport, Thread.hasServerSideFwdPaginationSupport] = support;
    vi.restoreAllMocks();
  });

  it('keeps the reply and its finishing edit in the live timeline when the open loads it first', async () => {
    const { mx, room } = await setup({ replies: [REPLY] });

    expect(await open(mx, room)).toBe(true);
    const thread = room.getThread('$root')!;
    expect(liveIds(room)).toEqual(['$root', '$reply']);

    const updates = vi.fn();
    thread.on(ThreadEvent.Update, updates);
    await sync(room, REPLY);
    await sync(room, edit('$step', 3000, 'Checking the notes. Two entries are missing.', 'streaming'));
    await sync(room, edit('$finish', 4000, FINISHED, 'completed'));
    await vi.waitFor(() => expect(updates).toHaveBeenCalled());

    expect(liveIds(room)).toEqual(['$root', '$reply', '$step', '$finish']);
    expect(getLatestVisibleReply(thread)?.getContent().body).toBe(FINISHED);
    // The reader has not read the reply.
    expect(getThreadUnread(thread, READER)).toBe(true);
  });

  it('keeps the order when /sync brings the reply while the open is loading it', async () => {
    let release!: () => void;
    const server: Server = {
      replies: [REPLY],
      holdRelations: new Promise((resolve) => {
        release = resolve;
      }),
    };
    const { mx, room } = await setup(server);

    const opening = open(mx, room);
    await vi.waitFor(() => expect(room.getThread('$root')).toBeTruthy());
    await sync(room, REPLY);
    release();
    expect(await opening).toBe(true);

    expect(liveIds(room)).toEqual(['$root', '$reply']);
  });

  it('starts a thread without replies at its root, with nothing older to load', async () => {
    const { mx, room } = await setup({ replies: [] });

    expect(await open(mx, room)).toBe(true);
    const thread = room.getThread('$root')!;
    expect(liveIds(room)).toEqual(['$root']);
    expect(thread.liveTimeline.getPaginationToken(Direction.Backward)).toBeNull();

    await sync(room, REPLY);
    expect(liveIds(room)).toEqual(['$root', '$reply']);
  });
});
