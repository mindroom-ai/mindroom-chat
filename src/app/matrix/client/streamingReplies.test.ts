import {
  ClientEvent,
  createClient,
  RoomEvent,
  SyncState,
  ThreadEvent,
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
} from 'matrix-js-sdk/lib/models/thread';
import { UNSIGNED_THREAD_ID_FIELD } from 'matrix-js-sdk/lib/@types/event';
import { MemoryStore } from 'matrix-js-sdk/lib/store/memory';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildThreadRecord } from '../../event-store/threads/threadRecord';
import { classifyThreadWorkflow } from '../../event-store/threads/threadWorkflow';
import { loadRoomThreads } from '../../event-store/threads/roomThreadList';
import { restoreCachedRoomThreads } from '../../event-store/sdk/roomTimelineSdk';
import { installEventContentGuard, trustAgentsOfViewer } from '../protocol/untrustedContent';
import { closeClient } from './closeClient';
import { startClient } from './clientSyncPolicy';
import { CHECK_DELAY_MS, isStreamingReplyCurrent } from './streamingReplies';
import { hasStreamHint, STREAM_HINT_MS } from './streamingThreadLoads';
import { findReply } from './unopenedThreadEdits';
import { defined } from '../../../test/utils/defined';

// A streamed reply shows as streaming on its thread's card only while the client can trust that it
// still streams: the client watched it through /sync since the room's last gap, or the server says
// so. A summary captured mid-stream, a copy kept from before a reload, or a reply whose finishing
// edit came in a sync gap is checked against the server, which bundles the reply's newest edit.

const roomId = '!room:example.org';
const agentId = '@mindroom_agent:example.org';
const readerId = '@reader:example.org';
const rootId = '$root';
const replyId = '$reply';
const MINUTE = 60_000;

const message = (
  eventId: string,
  ts: number,
  content: Record<string, unknown>,
  sender = agentId
): IEvent => ({
  event_id: eventId,
  room_id: roomId,
  sender,
  type: 'm.room.message',
  origin_server_ts: ts,
  unsigned: {},
  content: { msgtype: 'm.text', ...content },
});

const root = (ts: number): IEvent =>
  message(rootId, ts, { body: 'Which fixes go into the release notes?' }, readerId);
const reply = (ts: number): IEvent =>
  message(replyId, ts, {
    body: 'Thinking...',
    'io.mindroom.stream_status': 'pending',
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
  });
const edit = (body: string, ts: number, status: string): IEvent =>
  message(`$edit-${ts}`, ts, {
    body: `* ${body}`,
    'io.mindroom.stream_status': status,
    'm.new_content': { msgtype: 'm.text', body, 'io.mindroom.stream_status': status },
    'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
  });
/** An edit of the reply by another member than the reply's sender. */
const othersEdit = (body: string, ts: number, status: string): IEvent => ({
  ...edit(body, ts, status),
  sender: readerId,
});
/** The reply as the server serves it: with its newest edit bundled. */
const withEdit = (event: IEvent, newest: IEvent): IEvent => ({
  ...event,
  unsigned: { 'm.relations': { 'm.replace': newest } },
});
/** The root with the server's thread summary, as a thread list read at that moment had it. */
const withSummary = (rootEvent: IEvent, latest: IEvent, count = 1): IEvent => ({
  ...rootEvent,
  unsigned: {
    'm.relations': { 'm.thread': { count, current_user_participated: true, latest_event: latest } },
  },
});
const chat = (eventId: string, ts: number): IEvent =>
  message(eventId, ts, { body: 'Lunch at noon?' }, readerId);
const membership = (userId: string) => ({
  type: 'm.room.member',
  event_id: `$member-${userId}`,
  room_id: roomId,
  sender: userId,
  state_key: userId,
  origin_server_ts: 0,
  content: { membership: 'join' },
});
const joined = (events: IEvent[], prev_batch: string, limited = false) => ({
  state: { events: [membership(agentId), membership(readerId)] },
  timeline: { events, prev_batch, limited },
  ephemeral: { events: [] },
  account_data: { events: [] },
  summary: { 'm.heroes': [] },
  unread_notifications: {},
});

const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};
/** A check asks the server only after a moment, so the room's thread list can answer first. */
const afterCheckDelay = async () => {
  await new Promise((resolve) => {
    setTimeout(resolve, CHECK_DELAY_MS);
  });
  await settle();
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const clients: MatrixClient[] = [];

/** The app's client against a fake homeserver whose /sync answers come from `deliver`. */
const fixture = () => {
  const requests: string[] = [];
  const pendingSyncs: unknown[] = [];
  const waitingSyncs: Array<(response: Response) => void> = [];
  let batch = 0;
  /** What GET /event/$reply answers: the reply with its newest edit, or an error status. */
  let serverReply: IEvent | number = 404;
  /** Other events GET /event answers with. */
  const otherEvents = new Map<string, IEvent>();
  /** The roots the room's thread list holds, and a gate its pages wait for. */
  let listedRoots: IEvent[] = [];
  let listGate: Promise<void> = Promise.resolve();
  /** The thread as the server holds it, for a thread loading its first page. */
  let serverThread: { root: IEvent; replies: IEvent[]; fail?: boolean } | undefined;
  const mx = createClient({
    baseUrl: 'https://example.org',
    userId: readerId,
    accessToken: 'token',
    timelineSupport: true,
    store: new MemoryStore(),
    fetchFn: async (input) => {
      const url = new URL(String(input));
      const path = decodeURIComponent(url.pathname);
      requests.push(path);
      if (path.endsWith('/versions')) return json({ versions: ['v1.4'], unstable_features: {} });
      if (path.endsWith('/pushrules/')) return json({ global: {} });
      if (path.endsWith('/filter')) return json({ filter_id: 'filter' });
      if (path.endsWith('/capabilities')) return json({ capabilities: {} });
      if (path.endsWith('/joined_rooms')) return json({ joined_rooms: [roomId] });
      if (path.endsWith('/sync')) {
        const next = pendingSyncs.shift();
        if (next) return json(next);
        return new Promise<Response>((resolve) => {
          waitingSyncs.push(resolve);
        });
      }
      if (path.endsWith('/threads')) {
        await listGate;
        return json({ chunk: url.searchParams.get('include') === 'all' ? listedRoots : [] });
      }
      if (serverThread && path.endsWith(`/event/${rootId}`)) return json(serverThread.root);
      if (serverThread && path.includes(`/relations/${rootId}`))
        return serverThread.fail
          ? json({ errcode: 'M_UNKNOWN', error: 'Try later' }, 500)
          : json({ chunk: [...serverThread.replies].reverse() });
      const other = otherEvents.get(path.slice(path.lastIndexOf('/') + 1));
      if (other) return json(other);
      if (path.endsWith(`/event/${replyId}`))
        return typeof serverReply === 'number'
          ? json({ errcode: 'M_NOT_FOUND', error: 'Event not found' }, serverReply)
          : json(serverReply);
      throw new Error(`Unexpected request ${path}`);
    },
  });
  clients.push(mx);
  (mx as MatrixClient & { serverVersionsPromise?: Promise<unknown> }).serverVersionsPromise =
    Promise.resolve({ versions: ['v1.4'], unstable_features: {} });

  const answerSync = async (response: Record<string, unknown>) => {
    batch += 1;
    const body = { next_batch: `batch-${batch}`, ...response };
    const waiting = waitingSyncs.shift();
    if (waiting) waiting(json(body));
    else pendingSyncs.push(body);
    await settle();
  };
  /** Answers the client's next /sync with these room events; `limited` makes it a gap. */
  const deliver = (events: IEvent[], limited = false, toRoomId = roomId) =>
    answerSync({
      rooms: { join: { [toRoomId]: joined(events, `before-${batch + 1}`, limited) } },
    });
  /** Answers the client's next /sync with the account's data alone: no room has news. */
  const deliverAccountData = (type: string, content: Record<string, unknown>) =>
    answerSync({ account_data: { events: [{ type, content }] } });
  const start = async () => {
    void startClient(mx);
    await vi.waitFor(() => expect(waitingSyncs.length > 0 || pendingSyncs.length > 0).toBe(true));
    await settle();
  };
  const room = (): Room => defined(mx.getRoom(roomId), 'the room');
  /** What the thread's Compact card shows: its latest reply's preview and whether it streams. */
  const card = () => {
    const record = buildThreadRecord({ room: room(), threadRootId: rootId });
    return {
      preview: record.presentation.latestReplyPreviewText,
      streaming: record.status.isStreaming,
    };
  };
  const replyRequests = () => requests.filter((path) => path.endsWith(`/event/${replyId}`)).length;
  const serveEvent = (event: IEvent) => otherEvents.set(event.event_id, event);
  const setServerReply = (value: IEvent | number) => {
    serverReply = value;
  };
  /** The room's thread list holds `roots`; its pages answer once the returned function is called. */
  const holdThreadList = (roots: IEvent[]) => {
    listedRoots = roots;
    let open!: () => void;
    listGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    return open;
  };
  const setServerThread = (value: { root: IEvent; replies: IEvent[]; fail?: boolean }) => {
    serverThread = value;
  };
  const requested = (fragment: string) => requests.filter((path) => path.includes(fragment)).length;
  return {
    mx,
    deliver,
    deliverAccountData,
    start,
    room,
    card,
    replyRequests,
    requested,
    setServerReply,
    serveEvent,
    setServerThread,
    holdThreadList,
  };
};

const threadNamespaces = [
  FILTER_RELATED_BY_REL_TYPES,
  FILTER_RELATED_BY_SENDERS,
  THREAD_RELATION_TYPE,
];

describe('streaming replies on thread cards', () => {
  beforeAll(() => {
    installEventContentGuard();
    trustAgentsOfViewer(readerId);
  });
  let support: [FeatureSupport, FeatureSupport, FeatureSupport];
  let namespaces: boolean[];
  beforeEach(() => {
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

  const finished = 'The notes list the export fix and the keyboard shortcuts.';

  /** A thread known by its summary, once the server's check put the finished reply on its card. */
  const learnFinished = async (now: number) => {
    const f = fixture();
    f.setServerReply(withEdit(reply(now - 50_000), edit(finished, now - 20_000, 'completed')));
    await f.start();
    await f.deliver([withSummary(root(now - 60_000), reply(now - 50_000))]);
    expect(f.card().streaming).toBe(false);
    await afterCheckDelay();
    expect(f.card()).toEqual({ preview: finished, streaming: false });
    return f;
  };
  /** An older summary of the thread comes again, with a fresh copy of the reply's placeholder. */
  const resummarize = async (f: ReturnType<typeof fixture>, now: number) => {
    const thread = defined(f.room().getThread(rootId), 'the thread');
    thread.refreshListedRoot(
      f.mx.getEventMapper()(withSummary(root(now - 60_000), reply(now - 50_000)))
    );
    await settle();
    return thread;
  };

  /**
   * The app after a relaunch, mid-stream: the agent's placeholder still streams behind the text
   * and the file it posted since. The unopened thread holds only what came after the relaunch, the
   * summary names the file, and the server's newest page ends before the placeholder.
   */
  const relaunchMidStream = async (
    now: number,
    {
      sender = agentId,
      state = [],
      summary = 'file',
      tail = true,
      saved,
    }: {
      sender?: string;
      state?: IEvent[];
      summary?: 'file' | 'placeholder';
      tail?: boolean;
      /** Start from a saved sync that also holds these events. */
      saved?: IEvent[];
    } = {}
  ) => {
    const f = fixture();
    const rel = { rel_type: 'm.thread', event_id: rootId };
    const placeholder = { ...reply(now - 49 * MINUTE), sender };
    const text = message('$text', now - 20_000, { body: 'Results', 'm.relates_to': rel }, sender);
    const file = message(
      '$file',
      now - 19_000,
      { msgtype: 'm.file', body: 'results.txt', 'm.relates_to': rel },
      sender
    );
    const latest = summary === 'file' ? file : placeholder;
    const listed = withSummary(root(now - 50 * MINUTE), latest, summary === 'file' ? 3 : 1);
    const bundle = listed.unsigned['m.relations']?.['m.thread'] as Record<string, unknown>;
    bundle['io.mindroom.latest_reply'] = latest;
    const streaming = (ts: number, eventId = '$a-active'): IEvent => ({
      ...edit('Checking the results', ts, 'streaming'),
      event_id: eventId,
      sender,
    });
    const completed = (ts: number): IEvent => ({
      ...edit(finished, ts, 'completed'),
      event_id: '$z-completed',
      sender,
    });
    /** The edit that ends the stream, with the run's last status as MindRoom sends it. */
    const ending = (ts: number): IEvent => {
      const done = { ...completed(ts), event_id: '$c-ending' };
      const newContent = done.content['m.new_content'] as Record<string, unknown>;
      newContent['io.mindroom.ai_run'] = { version: 1, status: 'completed' };
      return done;
    };
    /** What GET /event/$reply answers: the placeholder, with the edit the server bundles. */
    const serve = (newest?: IEvent) =>
      f.setServerReply(newest ? withEdit(placeholder, newest) : placeholder);
    const page = Array.from({ length: 28 }, (_, i) => streaming(now - 60_000 + i, `$old-${i}`));
    f.setServerThread({ root: listed, replies: [...page, text, file] });
    const batches = [[...state, listed], ...(tail ? [[text, file]] : [])];
    if (saved) {
      vi.spyOn(f.mx.store, 'getSavedSyncToken').mockResolvedValue('saved');
      vi.spyOn(f.mx.store, 'getSavedSync').mockImplementation(async () => {
        await f.mx.threadSupportPending;
        const join = { [roomId]: joined([...batches.flat(), ...saved], 'before') };
        return {
          nextBatch: 'saved',
          accountData: [],
          roomsData: { join, invite: {}, leave: {}, knock: {} },
        };
      });
    }
    await f.start();
    for (const batch of saved ? [[]] : batches) await f.deliver(batch);
    const thread = defined(f.room().getThread(rootId), 'the unopened thread');
    const workflow = () => {
      const { status } = buildThreadRecord({ room: f.room(), threadRootId: rootId });
      return classifyThreadWorkflow(status, now);
    };
    expect(thread.initialEventsFetched).toBe(false);
    expect(thread.findEventById(replyId)).toBeUndefined();
    expect(workflow()).toBe('needsYou');
    return {
      f,
      thread,
      workflow,
      placeholder,
      text,
      file,
      listed,
      streaming,
      completed,
      ending,
      serve,
    };
  };
  type MidStream = Awaited<ReturnType<typeof relaunchMidStream>>;
  type MidStreamOptions = (now: number) => Parameters<typeof relaunchMidStream>[1];
  /** The live batches that follow; the server bundles `newest` with the placeholder. */
  type Arrival = (
    s: MidStream,
    now: number
  ) => {
    newest?: IEvent;
    live: IEvent[][];
    /** What GET /event/$reply answers instead. */
    served?: IEvent;
  };
  const arrive = async (s: MidStream, { newest, live, served }: ReturnType<Arrival>) => {
    if (served) s.f.setServerReply(served);
    else s.serve(newest);
    for (const batch of live) await s.f.deliver(batch);
  };
  /** Whether a live edit says that the reply the thread lacks streams. */
  const hinted = (s: MidStream) => hasStreamHint(s.f.room(), s.thread);

  const oneLiveEdit: Arrival = (s, now) => {
    const active = s.streaming(now - 1_000);
    return { newest: active, live: [[active]] };
  };
  /** As the SDK keeps an edit whose thread it found by fetching the reply. */
  const inThread = (event: IEvent): IEvent => ({
    ...event,
    unsigned: { [UNSIGNED_THREAD_ID_FIELD.name]: rootId },
  });
  const roster = (now: number, sender: string): IEvent[] => {
    const bound = '@mindroom_router:example.org';
    const state = (type: string, key: string, content: Record<string, unknown>): IEvent => ({
      ...message(`$state-${type}`, now - MINUTE, content, bound),
      type,
      state_key: key,
    });
    return [
      { ...membership(sender), unsigned: {} },
      state('m.room.power_levels', '', { users: { [bound]: 100 }, state_default: 50 }),
      state('io.mindroom.router', '', { user_id: bound }),
      state('io.mindroom.accounts', bound, { accounts: [sender] }),
    ];
  };
  const encryption = (now: number): IEvent => ({
    ...message('$encrypted', now - MINUTE, { algorithm: 'm.megolm.v1.aes-sha2' }),
    type: 'm.room.encryption',
    state_key: '',
  });
  const stopReaction = (now: number): IEvent => ({
    ...message('$stop', now, {
      'm.relates_to': { rel_type: 'm.annotation', event_id: replyId, key: '🛑' },
    }),
    type: 'm.reaction',
  });

  it.each<[string, Arrival, MidStreamOptions?]>([
    ['a live streaming edit', oneLiveEdit],
    [
      'a summary that names the file, with nothing synced since',
      oneLiveEdit,
      () => ({ tail: false }),
    ],
    [
      'a thread list read while the placeholder was newest',
      oneLiveEdit,
      () => ({ summary: 'placeholder' }),
    ],
    [
      'a run that says it streams',
      (s, now) => {
        const active = s.streaming(now - 1_000);
        delete active.content['io.mindroom.stream_status'];
        active.content['m.new_content'] = {
          body: 'Results',
          'io.mindroom.ai_run': { version: 1, status: 'streaming' },
        };
        return { newest: active, live: [[active]] };
      },
    ],
    [
      "another sender's newer edit",
      (s, now) => {
        const active = s.streaming(now - 1_000);
        const other = { ...s.completed(now), sender: '@mindroom_other:example.org' };
        return { newest: active, live: [[other, active]] };
      },
    ],
    [
      'a newer edit of another reply',
      (s, now) => {
        const active = s.streaming(now - 1_000);
        const done = s.completed(now);
        done.content['m.relates_to'] = { rel_type: 'm.replace', event_id: '$text' };
        return { newest: active, live: [[active, done]] };
      },
    ],
    [
      'a newer reaction of the agent',
      (s, now) => {
        const active = s.streaming(now - 1_000);
        return { newest: active, live: [[active, stopReaction(now)]] };
      },
    ],
    // The SDK fetches the reply for the first edit of a batch only.
    [
      'two edits in one sync, of a reply the server bundles no edit with',
      (s, now) => ({ live: [[s.streaming(now - 2_000, '$a-first'), s.streaming(now - 1_000)]] }),
    ],
    [
      'two edits in one sync, the older one last',
      (s, now) => ({ live: [[s.streaming(now - 1_000), s.streaming(now - 2_000, '$a-first')]] }),
    ],
  ])(
    'shows the thread Working by a live edit of the reply it lacks: %s',
    async (_name, arrival, options) => {
      const now = Date.now();
      const s = await relaunchMidStream(now, options?.(now));
      const { f, thread, workflow } = s;
      const shown = { preview: f.card().preview, replies: thread.length };
      let announced = false;
      f.room().on(ThreadEvent.Update, (updated) => {
        announced ||= hasStreamHint(f.room(), updated);
      });
      await arrive(s, arrival(s, now));

      // The SDK fetched the reply to place the edit; the thread stays as it was, and its card asks
      // the server nothing.
      expect(hinted(s)).toBe(true);
      expect(announced).toBe(true);
      // The room does not keep the fetched reply with the relations that wait in the thread.
      const waiting = thread.replayEvents ?? [];
      expect(waiting.length).toBeGreaterThan(0);
      expect(waiting.filter((event) => f.room().fetchedRelationParents.has(event))).toEqual([]);
      expect(thread.findEventById(replyId)).toBeUndefined();
      expect(thread.initialEventsFetched).toBe(false);
      expect(workflow()).toBe('working');
      await afterCheckDelay();
      expect(workflow()).toBe('working');
      expect(f.replyRequests()).toBe(1);
      expect({ preview: f.card().preview, replies: thread.length }).toEqual(shown);

      // Each further edit says so again, until the one that ends the stream.
      await f.deliver([s.streaming(now, '$b-later')]);
      expect(workflow()).toBe('working');
      await f.deliver([s.ending(now + 1)]);
      expect(hinted(s)).toBe(false);
      expect(workflow()).toBe('needsYou');
      await afterCheckDelay();
      // One request per live batch, each the SDK's to place its edit.
      expect(f.replyRequests()).toBe(3);
      expect(f.requested('/relations/')).toBe(0);
    }
  );

  it.each<[string, Arrival, MidStreamOptions?]>([
    [
      'an edit from the saved sync alone',
      () => ({ live: [] }),
      (now) => ({ saved: [inThread(edit('Checking the results', now - 1_000, 'streaming'))] }),
    ],
    [
      'a stale edit of a reply the server bundles as finished',
      (s, now) => ({ newest: s.completed(now), live: [[s.streaming(now - 1_000)]] }),
    ],
    [
      'a stale edit after the finishing one',
      (s, now) => {
        const done = s.completed(now);
        return { newest: done, live: [[done, s.streaming(now - 1_000)]] };
      },
    ],
    [
      // The SDK fetches the reply for the first edit of a batch only.
      'a streaming edit and the finishing one in one sync, of a reply the server bundles no edit with',
      (s, now) => ({ live: [[s.streaming(now - 1_000), s.completed(now)]] }),
    ],
    [
      'a stale edit sent at the same time as the finishing one the server bundles',
      (s, now) => ({ newest: s.completed(now), live: [[s.streaming(now)]] }),
    ],
    [
      // The unopened thread keeps the later arrival of the two, and the server bundles none.
      'a stale edit synced after one that finished the reply at the same time',
      (s, now) => ({ live: [[s.completed(now)], [s.streaming(now)]] }),
    ],
    [
      'a stale edit synced after one that finished the reply at the same time, in record form',
      (s, now) => {
        const done = s.completed(now);
        delete done.content['io.mindroom.stream_status'];
        const status = { 'io.mindroom.stream_status': { status: 'completed' } };
        done.content['m.new_content'] = { msgtype: 'm.text', body: finished, ...status };
        return { live: [[done], [s.streaming(now)]] };
      },
    ],
    [
      'a newer finishing edit from the saved sync that no thread took',
      (s, now) => ({ live: [[s.streaming(now - 1_000)]] }),
      (now) => ({ saved: [edit(finished, now, 'completed')] }),
    ],
    [
      'an older edit than a streaming one from the saved sync that waits in the thread',
      (s, now) => ({ live: [[s.streaming(now - 2_000)]] }),
      (now) => ({ saved: [inThread(edit('Checking the results', now - 1_000, 'streaming'))] }),
    ],
    [
      'an older edit than a streaming one from the saved sync that no thread took',
      (s, now) => ({ live: [[s.streaming(now - 2_000)]] }),
      (now) => ({ saved: [edit('Checking the results', now - 1_000, 'streaming')] }),
    ],
    [
      'a member whose edit nests a stream status below its new content',
      (s, now) => {
        const active = s.streaming(now - 1_000);
        delete active.content['io.mindroom.stream_status'];
        active.content['m.new_content'] = {
          body: 'Results',
          'm.new_content': { 'io.mindroom.stream_status': 'streaming' },
        };
        return { newest: active, live: [[active]] };
      },
      () => ({ sender: readerId }),
    ],
    [
      'a reaction to a reply the server bundles a streaming edit with',
      (s, now) => ({ newest: s.streaming(now - 1_000), live: [[stopReaction(now)]] }),
    ],
    [
      'an idle edit',
      (s, now) => {
        const active = s.streaming(now - 31 * MINUTE);
        return { newest: active, live: [[active]] };
      },
    ],
    [
      "another member's edit",
      (_s, now) => ({ live: [[othersEdit('Checking the results', now - 1_000, 'streaming')]] }),
    ],
    [
      // Only a reply's sender can edit it.
      'another agent’s edit',
      (s, now) => {
        const active = { ...s.streaming(now - 1_000), sender: '@mindroom_other:example.org' };
        return { live: [[active]] };
      },
    ],
    [
      'a run without a status',
      (s, now) => {
        const active = s.streaming(now - 1_000);
        delete active.content['io.mindroom.stream_status'];
        active.content['m.new_content'] = { body: 'Results', 'io.mindroom.ai_run': { version: 1 } };
        return { newest: active, live: [[active]] };
      },
    ],
    [
      'an agent the room lists, outside the accounts whose metadata the client trusts',
      oneLiveEdit,
      (now) => ({ sender: '@helper:example.org', state: roster(now, '@helper:example.org') }),
    ],
    ['an encrypted room', oneLiveEdit, (now) => ({ state: [encryption(now)] })],
    [
      'an ignored agent',
      (s, now) => {
        vi.spyOn(s.f.mx, 'isUserIgnored').mockImplementation((userId) => userId === agentId);
        return oneLiveEdit(s, now);
      },
    ],
    [
      'an edit without new content',
      (s, now) => {
        const active = s.streaming(now - 1_000);
        delete active.content['m.new_content'];
        return { newest: active, live: [[active]] };
      },
    ],
    [
      'an edit of another type than the reply',
      (s, now) => ({ live: [[{ ...s.streaming(now - 1_000), type: 'm.room.notice' }]] }),
    ],
    [
      'an edit that came redacted',
      (s, now) => {
        const active = s.streaming(now - 1_000);
        active.unsigned = { redacted_because: message('$redaction', now, {}) };
        return { live: [[active]] };
      },
    ],
  ])('leaves the thread in Needs you: %s', async (_name, arrival, options) => {
    const now = Date.now();
    const s = await relaunchMidStream(now, options?.(now));
    const unexpected = vi.fn();
    s.f.mx.on(ClientEvent.SyncUnexpectedError, unexpected);
    await arrive(s, arrival(s, now));

    expect(hinted(s)).toBe(false);
    expect(unexpected).not.toHaveBeenCalled();
    expect(s.workflow()).toBe('needsYou');
    expect(s.f.requested('/relations/')).toBe(0);
  });

  it('shows the thread Working once the SDK could fetch the reply', async () => {
    const now = Date.now();
    const s = await relaunchMidStream(now);
    s.f.setServerReply(500);
    await s.f.deliver([s.streaming(now - 2_000, '$a-first')]);
    expect(hinted(s)).toBe(false);

    await arrive(s, oneLiveEdit(s, now));
    expect(s.workflow()).toBe('working');
  });

  /** The thread once a live edit said that the reply it lacks streams: its card says Working. */
  const hintMidStream = async (now: number) => {
    const s = await relaunchMidStream(now);
    await arrive(s, oneLiveEdit(s, now));
    expect(s.workflow()).toBe('working');
    return s;
  };

  it('ends Working when the server bundles a newer finishing edit with the reply', async () => {
    const now = Date.now();
    const s = await hintMidStream(now);
    // The finishing edit itself has not come: the reply fetched for an older edit brings it.
    s.serve(s.ending(now + 1));
    await s.f.deliver([s.streaming(now, '$b-later')]);
    expect(hinted(s)).toBe(false);
    expect(s.workflow()).toBe('needsYou');
  });

  // The SDK fetches the reply to place a reaction too. A reaction starts no hint, but ends one.
  it('ends Working when the reply fetched for a reaction bundles a finishing edit', async () => {
    const now = Date.now();
    const s = await hintMidStream(now);
    s.serve(s.ending(now + 1));
    await s.f.deliver([stopReaction(now + 2)]);
    expect(s.f.replyRequests()).toBe(2);
    expect(hinted(s)).toBe(false);
    expect(s.workflow()).toBe('needsYou');
  });

  it('ends Working by a finishing edit the server bundles, whoever reacts', async () => {
    const now = Date.now();
    const s = await hintMidStream(now);
    const ignored = '@ignored:example.org';
    await s.f.deliverAccountData('m.ignored_user_list', { ignored_users: { [ignored]: {} } });
    expect(s.workflow()).toBe('working');
    s.serve(s.ending(now + 1));
    await s.f.deliver([{ ...stopReaction(now + 2), sender: ignored }]);
    expect(s.f.replyRequests()).toBe(2);
    expect(s.workflow()).toBe('needsYou');
  });

  it('shows Working again by the first streaming edit after a page brought a finishing one', async () => {
    const now = Date.now();
    const s = await hintMidStream(now);
    s.f.setServerThread({ root: s.listed, replies: [s.ending(now), s.text, s.file] });
    await s.thread.initialize();
    expect(s.workflow()).toBe('needsYou');

    const again = s.streaming(now + 1, '$f-again');
    await arrive(s, { newest: again, live: [[again]] });
    expect(s.workflow()).toBe('working');
  });

  it('keeps no hint by an edit that says the reply streams and that its run completed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const now = Date.now();
      const s = await relaunchMidStream(now);
      const done = s.streaming(now - 1_000);
      const newContent = done.content['m.new_content'] as Record<string, unknown>;
      newContent['io.mindroom.ai_run'] = { version: 1, status: 'completed' };
      await arrive(s, { newest: done, live: [[done]] });
      expect(s.workflow()).toBe('needsYou');
      // No hint waits out its five minutes unseen.
      const updates = vi.fn();
      s.thread.on(ThreadEvent.Update, updates);
      await vi.advanceTimersByTimeAsync(STREAM_HINT_MS + 1_000);
      expect(updates).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays in Needs you by an edit without a status after a page brought the finishing one', async () => {
    const now = Date.now();
    const s = await hintMidStream(now);
    s.f.setServerThread({ root: s.listed, replies: [s.ending(now), s.text, s.file] });
    await s.thread.initialize();
    expect(s.workflow()).toBe('needsYou');

    // The agent corrects its finished text: the edit carries no stream status.
    const correction = { ...s.completed(now + 1), event_id: '$d-correction' };
    delete correction.content['io.mindroom.stream_status'];
    correction.content['m.new_content'] = { msgtype: 'm.text', body: 'The notes, corrected.' };
    await arrive(s, { newest: correction, live: [[correction]] });
    expect(s.workflow()).toBe('needsYou');
    // No later one brings Working back but one that says the reply streams again.
    await s.f.deliver([{ ...correction, event_id: '$e-correction', origin_server_ts: now + 2 }]);
    expect(s.workflow()).toBe('needsYou');
    const again = s.streaming(now + 3, '$f-again');
    await arrive(s, { newest: again, live: [[again]] });
    expect(s.workflow()).toBe('working');
  });

  it('leaves the thread in Needs you by a stale edit when a page brought the finishing one', async () => {
    const now = Date.now();
    const s = await relaunchMidStream(now);
    // The thread's newest page holds the reply's edits, the finishing one too, but not the reply.
    s.f.setServerThread({ root: s.listed, replies: [s.completed(now), s.text, s.file] });
    await s.thread.initialize();
    expect(s.thread.findEventById(replyId)).toBeUndefined();

    await arrive(s, { live: [[s.streaming(now - 1_000)]] });
    expect(hinted(s)).toBe(false);
    expect(s.workflow()).toBe('needsYou');
  });

  it.each([
    ['the other', 'the first'],
    ['the first', 'the other'],
  ])(
    'keeps Working while one of two replies the thread lacks streams: %s ends first',
    async (first) => {
      const now = Date.now();
      const s = await hintMidStream(now);
      const other = { ...s.placeholder, event_id: '$other-reply' };
      /** An edit of the other reply, which the server then bundles with it. */
      const ofOther = async (event: IEvent) => {
        const moved = { ...event, event_id: `${event.event_id}-other` };
        moved.content = {
          ...event.content,
          'm.relates_to': { rel_type: 'm.replace', event_id: other.event_id },
        };
        s.f.serveEvent(withEdit(other, moved));
        await s.f.deliver([moved]);
      };
      const ofFirst = async (event: IEvent) => {
        s.serve(event);
        await s.f.deliver([event]);
      };
      await ofOther(s.streaming(now - 500));

      await (first === 'the other' ? ofOther : ofFirst)(s.ending(now));
      expect(s.workflow()).toBe('working');
      await (first === 'the other' ? ofFirst : ofOther)(s.ending(now + 1));
      expect(s.workflow()).toBe('needsYou');
      expect(s.f.requested('/event/$other-reply')).toBe(2);
    }
  );

  it.each<[string, Record<string, unknown>, Record<string, unknown>?]>([
    ['a stream status', { 'io.mindroom.stream_status': 'completed' }],
    ['a stream status in record form', { 'io.mindroom.stream_status': { status: 'completed' } }],
    ['only the run’s status', { 'io.mindroom.ai_run': { version: 1, status: 'completed' } }],
    // MindRoom writes the status in both places; `syncedEdits` takes it from either.
    ['a stream status beside its new content', {}, { 'io.mindroom.stream_status': 'completed' }],
  ])(
    'ends Working by a live edit that finishes the reply with %s',
    async (_name, status, beside) => {
      const now = Date.now();
      const s = await hintMidStream(now);
      const done = s.completed(now);
      delete done.content['io.mindroom.stream_status'];
      Object.assign(done.content, beside);
      done.content['m.new_content'] = { msgtype: 'm.text', body: finished, ...status };
      await arrive(s, { newest: done, live: [[done]] });
      expect(hinted(s)).toBe(false);
      expect(s.workflow()).toBe('needsYou');
    }
  );

  // Only starting needs the reply the SDK fetched; a finish the client learns of ends Working.
  it('ends Working by a finishing edit whose reply the SDK could not fetch', async () => {
    const now = Date.now();
    const s = await hintMidStream(now);
    const updates = vi.fn();
    s.thread.on(ThreadEvent.Update, updates);
    s.f.setServerReply(500);
    await s.f.deliver([s.ending(now)]);
    expect(s.f.replyRequests()).toBe(2);
    expect(updates).toHaveBeenCalled();
    expect(hinted(s)).toBe(false);
    expect(s.workflow()).toBe('needsYou');
  });

  it('ends Working when a page of the thread brings the finishing edit without the reply', async () => {
    const now = Date.now();
    const s = await hintMidStream(now);
    s.f.setServerThread({ root: s.listed, replies: [s.ending(now), s.text, s.file] });
    await s.thread.initialize();
    expect(s.thread.findEventById(replyId)).toBeUndefined();
    expect(hinted(s)).toBe(false);
    expect(s.workflow()).toBe('needsYou');
  });

  it('judges the reply by the summary’s copy once the summary names it', async () => {
    const now = Date.now();
    const s = await relaunchMidStream(now, { tail: false });
    await arrive(s, oneLiveEdit(s, now));
    expect(s.workflow()).toBe('working');

    // As when the events after the reply are gone: the card then reads the summary's copy.
    const summarized = s.f.mx.getEventMapper()(s.placeholder);
    vi.spyOn(s.thread, 'replyToEvent', 'get').mockReturnValue(summarized);
    expect(hinted(s)).toBe(false);
  });

  it('keeps Working for a reply that a title notice displaced from the thread’s summary', async () => {
    const now = Date.now();
    const s = await relaunchMidStream(now, { summary: 'placeholder', tail: false });
    // The summary's reply stays known to the card's preview, but the streaming checks read the title.
    await s.f.deliver([
      message('$title', now - 15_000, {
        msgtype: 'm.notice',
        body: 'Release notes',
        'io.mindroom.thread_summary': { summary: 'Release notes', version: 1 },
        'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
      }),
    ]);
    expect(s.thread.replyToEvent?.getId()).toBe('$title');
    expect(findReply(s.thread, replyId)).toBeDefined();

    await arrive(s, oneLiveEdit(s, now));
    expect(s.f.replyRequests()).toBe(1);
    expect(s.workflow()).toBe('working');
  });

  it.each<[string, (s: MidStream) => unknown]>([
    ['the client closes', (s) => closeClient(s.f.mx)],
    ['the account forgets the room', (s) => s.f.mx.emit(ClientEvent.DeleteRoom, roomId)],
    ['the thread is deleted', (s) => s.thread.emit(ThreadEvent.Delete, s.thread)],
  ])('forgets what it knows of the reply, and says nothing more, once %s', async (_name, end) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const now = Date.now();
      const s = await hintMidStream(now);
      const updates = vi.fn();
      s.thread.on(ThreadEvent.Update, updates);
      end(s);
      expect(hinted(s)).toBe(false);
      await vi.advanceTimersByTimeAsync(STREAM_HINT_MS + 1_000);
      expect(updates).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  /** A redaction of the edit that hints: it takes the reply's ID off the edit. */
  const redactHinting = (s: MidStream, now: number) => {
    const hinting = s.streaming(now - 1_000).event_id;
    const redaction = message('$redaction', now, { redacts: hinting });
    return s.f.deliver([{ ...redaction, type: 'm.room.redaction', redacts: hinting }]);
  };

  it('ends Working by a page’s finishing edit after the redaction of the edit that hints', async () => {
    const now = Date.now();
    const s = await hintMidStream(now);
    await redactHinting(s, now);
    expect(s.workflow()).toBe('working');
    s.f.setServerThread({ root: s.listed, replies: [s.ending(now + 1), s.text, s.file] });
    await s.thread.initialize();
    expect(s.workflow()).toBe('needsYou');
  });

  it('keeps Working by the edit that follows the redaction of the one before', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const now = Date.now();
      const s = await hintMidStream(now);
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      await redactHinting(s, now + 3 * MINUTE);
      const later = s.streaming(now + 3 * MINUTE, '$b-later');
      await arrive(s, { newest: later, live: [[later]] });

      // Past the redacted edit's five minutes, within the later one's.
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      expect(s.workflow()).toBe('working');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends Working five minutes after the last live edit, and says so', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const now = Date.now();
      const s = await hintMidStream(now);
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      await s.f.deliver([s.streaming(now + 3 * MINUTE, '$b-later')]);
      // Past the first edit's five minutes, within the second's.
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      expect(s.workflow()).toBe('working');
      const updates = vi.fn();
      s.thread.on(ThreadEvent.Update, updates);

      await vi.advanceTimersByTimeAsync(STREAM_HINT_MS - 3 * MINUTE + 1_000);
      expect(updates).toHaveBeenCalled();
      expect(hinted(s)).toBe(false);
      expect(s.workflow()).toBe('needsYou');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps Working when the thread’s own timeline starts over', async () => {
    const now = Date.now();
    const s = await hintMidStream(now);
    const resets = vi.fn();
    s.f.mx.on(RoomEvent.TimelineReset, (_room, timelineSet) => resets(timelineSet));
    s.thread.timelineSet.resetLiveTimeline();
    await settle();
    expect(resets).toHaveBeenCalledWith(s.thread.timelineSet);
    expect(hinted(s)).toBe(true);
    expect(s.workflow()).toBe('working');
  });

  it('ends Working at a sync gap of the room, until the next live edit', async () => {
    const now = Date.now();
    const s = await hintMidStream(now);
    const otherRoomId = '!other:example.org';
    const resets = vi.fn();
    s.f.mx.on(RoomEvent.TimelineReset, (room) => resets(room?.roomId));
    await s.f.deliver([chat('$other-1', now)], false, otherRoomId);
    await s.f.deliver([chat('$other-2', now)], true, otherRoomId);
    expect(resets).toHaveBeenCalledWith(otherRoomId);
    expect(s.workflow()).toBe('working');

    // The edit that ended the stream may have come in the gap.
    await s.f.deliver([chat('$chat-after-gap', now)], true);
    expect(resets).toHaveBeenCalledWith(roomId);
    expect(hinted(s)).toBe(false);
    expect(s.workflow()).toBe('needsYou');

    const later = s.streaming(now, '$b-later');
    await arrive(s, { newest: later, live: [[later]] });
    expect(s.workflow()).toBe('working');
  });

  it.each<[string, (s: MidStream, now: number) => unknown]>([
    [
      'the reader ignores its sender',
      (s) => s.f.deliverAccountData('m.ignored_user_list', { ignored_users: { [agentId]: {} } }),
    ],
    ['the room turns encryption on', (s, now) => s.f.deliver([encryption(now)])],
  ])(
    'ends Working once %s, also where the thread is read again only at its update',
    async (_name, change) => {
      const now = Date.now();
      const s = await hintMidStream(now);
      // As the sidebar's index keeps a thread: read again only when the thread says it changed.
      let kept = s.workflow();
      s.f.room().on(ThreadEvent.Update, () => {
        kept = s.workflow();
      });
      await change(s, now);
      expect(hinted(s)).toBe(false);
      expect(kept).toBe('needsYou');
    }
  );

  it('keeps another thread of the room in Needs you', async () => {
    const now = Date.now();
    const s = await hintMidStream(now);
    const otherRoot = { ...root(now - MINUTE), event_id: '$other-root' };
    const rel = { rel_type: 'm.thread', event_id: otherRoot.event_id };
    await s.f.deliver([
      withSummary(otherRoot, message('$other-done', now, { body: 'Done', 'm.relates_to': rel })),
    ]);
    const other = defined(s.f.room().getThread(otherRoot.event_id), 'the other thread');
    expect(hasStreamHint(s.f.room(), other)).toBe(false);
    const { status } = buildThreadRecord({ room: s.f.room(), threadRootId: otherRoot.event_id });
    expect(classifyThreadWorkflow(status, now)).toBe('needsYou');
    expect(s.workflow()).toBe('working');
  });

  // An edit changes no type: one of another type that waits in the thread is no revision.
  it('keeps Working by an edit of another type that says the reply finished', async () => {
    const now = Date.now();
    const s = await hintMidStream(now);
    const notice = { ...s.ending(now), type: 'm.room.notice' };
    await arrive(s, { newest: s.streaming(now - 1_000), live: [[notice]] });
    expect(s.thread.replayEvents?.map((event) => event.getId())).toContain(notice.event_id);
    expect(s.workflow()).toBe('working');
  });

  it.each(['before', 'after'])(
    'keeps Working by a live edit that comes %s a first page that ends before the reply',
    async (order) => {
      const now = Date.now();
      const s = await relaunchMidStream(now);
      const { f, thread, workflow } = s;
      const arrival = oneLiveEdit(s, now);
      if (order === 'before') await arrive(s, arrival);
      await thread.initialize();
      expect(thread.initialEventsFetched).toBe(true);
      if (order === 'after') await arrive(s, arrival);

      expect(thread.findEventById(replyId)).toBeUndefined();
      expect(workflow()).toBe('working');
      await f.deliver([s.streaming(now, '$b-later'), s.streaming(now + 1, '$b-latest')]);
      expect(workflow()).toBe('working');
      await f.deliver([s.ending(now + 2)]);
      expect(workflow()).toBe('needsYou');
    }
  );

  // The hidden edits never vouched for the reply: its copy on the page is checked as any other.
  it.each([
    ['still streams', 'working'],
    ['finished', 'needsYou'],
  ])(
    'judges the reply by the thread’s own copy once a page brings it: the server says it %s',
    async (answer, expected) => {
      const now = Date.now();
      const s = await hintMidStream(now);
      const { f, thread, workflow } = s;
      const active = s.streaming(now - 1_000);
      // The page's copy of the reply is from before it finished.
      f.setServerThread({
        root: s.listed,
        replies: [withEdit(s.placeholder, active), s.text, s.file],
      });
      s.serve(answer === 'finished' ? s.ending(now) : active);
      await thread.initialize();

      expect(thread.findEventById(replyId)).toBeDefined();
      expect(hinted(s)).toBe(false);
      expect(workflow()).toBe('needsYou');
      await afterCheckDelay();
      expect(workflow()).toBe(expected);
      expect(f.replyRequests()).toBe(2);
    }
  );

  it.each([agentId, readerId])(
    'lists 30 finished threads without loading them (%s)',
    async (sender) => {
      const now = Date.now();
      const f = fixture();
      const roots = Array.from({ length: 30 }, (_, i) => {
        const id = `$root-${i}`;
        const rel = { rel_type: 'm.thread', event_id: id };
        const ending = message(`$ending-${i}`, now, { body: 'Done', 'm.relates_to': rel }, sender);
        return withSummary({ ...root(now - 60_000), event_id: id }, ending, i % 2 ? 3 : 1);
      });
      await f.start();
      await f.deliver([chat('$chat-1', now)]);
      f.holdThreadList(roots)();
      await loadRoomThreads(f.room());
      roots.forEach(({ event_id }) =>
        buildThreadRecord({ room: f.room(), threadRootId: event_id })
      );
      await afterCheckDelay();
      expect(f.requested('/threads')).toBe(2);
      expect(f.requested('/event/')).toBe(0);
      expect(f.requested('/relations/')).toBe(0);
    }
  );

  it('does not stream a thread restored from the cache with a summary taken mid-stream', async () => {
    const now = Date.now();
    const f = fixture();
    f.setServerReply(withEdit(reply(now - 50_000), edit(finished, now - 20_000, 'completed')));
    await f.start();
    await f.deliver([chat('$chat-1', now - 10_000)]);

    // The cache kept the root as the thread list had it while the reply was its placeholder.
    const mapper = f.mx.getEventMapper();
    restoreCachedRoomThreads(f.room(), [
      { rootEvent: mapper(withSummary(root(now - 60_000), reply(now - 50_000))) },
    ]);
    expect(f.card().streaming).toBe(false);

    await afterCheckDelay();
    expect(f.card()).toEqual({ preview: finished, streaming: false });
    expect(f.replyRequests()).toBe(1);
  });

  it('stops streaming a reply whose finishing edit came in a sync gap', async () => {
    const now = Date.now();
    const f = fixture();
    f.setServerReply(withEdit(reply(now - 50_000), edit(finished, now - 5_000, 'completed')));
    await f.start();
    await f.deliver([withSummary(root(now - 60_000), reply(now - 50_000)), reply(now - 50_000)]);
    await f.deliver([edit('The notes list', now - 40_000, 'streaming')]);
    expect(f.card()).toEqual({ preview: 'The notes list', streaming: true });
    // Watched through /sync: no need to ask the server.
    expect(f.replyRequests()).toBe(0);

    // The page fell behind: the finishing edit is in the gap before this answer.
    await f.deliver([chat('$chat-1', now - 2_000)], true);
    await afterCheckDelay();
    expect(f.card()).toEqual({ preview: finished, streaming: false });
    expect(f.replyRequests()).toBe(1);
  });

  it('keeps streaming a reply that the server says still streams, and asks once', async () => {
    const now = Date.now();
    const f = fixture();
    f.setServerReply(withEdit(reply(now - 50_000), edit('The notes', now - 3_000, 'streaming')));
    await f.start();
    await f.deliver([withSummary(root(now - 60_000), reply(now - 50_000))]);
    expect(f.card().streaming).toBe(false);

    await afterCheckDelay();
    expect(f.card()).toEqual({ preview: 'The notes', streaming: true });
    f.card();
    await afterCheckDelay();
    expect(f.replyRequests()).toBe(1);

    // Its next edits come through /sync as usual.
    await f.deliver([edit(finished, now - 1_000, 'completed')]);
    expect(f.card()).toEqual({ preview: finished, streaming: false });
  });

  it('does not ask about a reply that went idle while its check waited', async () => {
    const f = fixture();
    await f.start();
    // Fresh when its card asks, idle once the check's delay has passed.
    const now = Date.now();
    f.setServerReply(withEdit(reply(now - 50_000), edit('The notes', now - 3_000, 'streaming')));
    await f.deliver([withSummary(root(now - 31 * MINUTE), reply(now - 30 * MINUTE + 1_000))]);
    expect(f.card().streaming).toBe(false);

    await afterCheckDelay();
    expect(f.replyRequests()).toBe(0);
  });

  it('does not stream a reply the server no longer has, and does not ask again', async () => {
    const now = Date.now();
    const f = fixture();
    f.setServerReply(404);
    await f.start();
    await f.deliver([withSummary(root(now - 60_000), reply(now - 50_000))]);
    await settle();
    f.card();
    await afterCheckDelay();
    expect(f.card().streaming).toBe(false);
    f.card();
    await afterCheckDelay();
    expect(f.replyRequests()).toBe(1);
  });

  it('puts the edit it learned on another copy of the reply', async () => {
    const now = Date.now();
    const f = await learnFinished(now);

    const copy = (await resummarize(f, now)).replyToEvent;
    expect(copy?.replacingEvent()).toBeNull();
    expect(f.card().streaming).toBe(false);
    await settle();
    expect(copy?.replacingEvent()?.getId()).toBe(`$edit-${now - 20_000}`);
    expect(f.card()).toEqual({ preview: finished, streaming: false });
    expect(f.replyRequests()).toBe(1);
  });

  it('announces a streaming thread once its reply has gone half an hour without an edit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const now = Date.now();
      const f = fixture();
      await f.start();
      await f.deliver([withSummary(root(now - 60_000), reply(now - 50_000)), reply(now - 50_000)]);
      await f.deliver([edit('The notes list', now - 1_000, 'streaming')]);
      expect(f.card().streaming).toBe(true);
      const updates = vi.fn();
      f.room().on(ThreadEvent.Update, updates);

      await vi.advanceTimersByTimeAsync(31 * MINUTE);
      expect(updates).toHaveBeenCalled();
      expect(f.card().streaming).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('announces a streaming thread whose reply the full store of seen replies forgets', async () => {
    const now = Date.now();
    const f = fixture();
    await f.start();
    await f.deliver([withSummary(root(now - 60_000), reply(now - 50_000)), reply(now - 50_000)]);
    await f.deliver([edit('The notes list', now - 1_000, 'streaming')]);
    expect(f.card().streaming).toBe(true);
    const updates = vi.fn();
    f.room().on(ThreadEvent.Update, updates);

    // The store keeps 5,000 replies: as many newer ones push this one out.
    const others = Array.from({ length: 5000 }, (_, index) =>
      message(`$other${index}`, now, { body: 'Done', 'io.mindroom.stream_status': 'completed' })
    );
    await f.deliver(others.slice(0, 4999));
    expect(updates).not.toHaveBeenCalled();
    await f.deliver(others.slice(4999));

    expect(updates).toHaveBeenCalledTimes(1);
    expect(f.card().streaming).toBe(false);
  });

  it('does not stream a reply without an edit for half an hour', async () => {
    const now = Date.now();
    const f = fixture();
    await f.start();
    await f.deliver([
      withSummary(root(now - 40 * MINUTE), reply(now - 35 * MINUTE)),
      reply(now - 35 * MINUTE),
    ]);
    await f.deliver([edit('The notes list', now - 31 * MINUTE, 'streaming')]);
    expect(f.card()).toEqual({ preview: 'The notes list', streaming: false });

    await f.deliver([edit('The notes list the export fix', now, 'streaming')]);
    expect(f.card().streaming).toBe(true);
  });

  it('counts only the reply sender’s bundled edit as a sign of life', async () => {
    const now = Date.now();
    const f = fixture();
    await f.start();
    await f.deliver([
      withSummary(root(now - 40 * MINUTE), reply(now - 35 * MINUTE)),
      withEdit(reply(now - 35 * MINUTE), othersEdit('The notes list', now, 'streaming')),
    ]);
    expect(f.card().streaming).toBe(false);

    await f.deliver([withEdit(reply(now - 35 * MINUTE), edit('The notes list', now, 'streaming'))]);
    expect(f.card().streaming).toBe(true);
  });

  describe('edits by another sender than the reply’s', () => {
    it('vouches for a reply on its sender’s live edit, but not on another sender’s', async () => {
      const now = Date.now();
      const f = fixture();
      f.setServerReply(withEdit(reply(now - 50_000), edit(finished, now - 20_000, 'completed')));
      await f.start();
      // The reply's sender's edit vouches for the reply the thread's summary holds.
      await f.deliver([withSummary(root(now - 60_000), reply(now - 50_000))]);
      await f.deliver([edit('The notes list', now - 40_000, 'streaming')]);
      expect(f.card()).toEqual({ preview: 'The notes list', streaming: true });
      expect(f.replyRequests()).toBe(0);

      // After a gap, another sender's edit vouches for nothing: the server is asked.
      await f.deliver([chat('$chat-1', now - 15_000)], true);
      await f.deliver([othersEdit('The notes list more', now - 10_000, 'streaming')]);
      f.card();
      await afterCheckDelay();
      expect(f.card()).toEqual({ preview: finished, streaming: false });
      expect(f.replyRequests()).toBe(1);
    });

    it('vouches for a reply outside threads on its sender’s live edit', async () => {
      const now = Date.now();
      const f = fixture();
      const roomReply = message(replyId, now - 50_000, {
        body: 'Thinking...',
        'io.mindroom.stream_status': 'pending',
      });
      await f.start();
      await f.deliver([roomReply]);
      await f.deliver([chat('$chat-1', now - 15_000)], true);
      await f.deliver([edit('The notes list', now - 10_000, 'streaming')]);

      const held = defined(f.room().findEventById(replyId), 'the reply');
      expect(isStreamingReplyCurrent(f.room(), held)).toBe(true);
      await afterCheckDelay();
      expect(f.replyRequests()).toBe(0);
    });

    it('keeps the finishing edit it learned when another sender’s live edit follows', async () => {
      const now = Date.now();
      const f = await learnFinished(now);

      await f.deliver([othersEdit('Still thinking', now - 10_000, 'streaming')]);
      await resummarize(f, now);
      expect(f.card().streaming).toBe(false);
      await settle();
      expect(f.card()).toEqual({ preview: finished, streaming: false });
      expect(f.replyRequests()).toBe(1);
    });

    it('takes no edit of another sender that the server bundles with the reply', async () => {
      const now = Date.now();
      const f = fixture();
      f.setServerReply(
        withEdit(reply(now - 50_000), othersEdit('Still thinking', now - 10_000, 'streaming'))
      );
      await f.start();
      await f.deliver([withSummary(root(now - 60_000), reply(now - 50_000))]);
      expect(f.card().streaming).toBe(false);
      await afterCheckDelay();
      expect(f.replyRequests()).toBe(1);

      // The room's thread list then names the reply with its sender's finishing edit.
      f.holdThreadList([
        withSummary(
          root(now - 60_000),
          withEdit(reply(now - 50_000), edit(finished, now - 20_000, 'completed'))
        ),
      ])();
      await loadRoomThreads(f.room());
      await settle();
      expect(f.card()).toEqual({ preview: finished, streaming: false });

      await resummarize(f, now);
      expect(f.card().streaming).toBe(false);
      await settle();
      expect(f.card()).toEqual({ preview: finished, streaming: false });
    });

    it('takes no edit of another sender that the thread list bundles with the reply', async () => {
      const now = Date.now();
      const f = await learnFinished(now);

      f.holdThreadList([
        withSummary(
          root(now - 60_000),
          withEdit(reply(now - 50_000), othersEdit('Still thinking', now - 10_000, 'streaming'))
        ),
      ])();
      await loadRoomThreads(f.room());
      expect(f.card().streaming).toBe(false);
      await settle();
      expect(f.card()).toEqual({ preview: finished, streaming: false });
      expect(f.replyRequests()).toBe(1);
    });

    it('asks about a listed reply that only another sender’s edit says streams', async () => {
      const now = Date.now();
      const f = fixture();
      const plainReply = message(replyId, now - 50_000, {
        body: 'The notes',
        'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
      });
      f.setServerReply(withEdit(plainReply, edit(finished, now - 20_000, 'completed')));
      await f.start();
      await f.deliver([chat('$chat-1', now - 10_000)]);
      const streamed = withEdit(plainReply, edit('The notes list', now - 40_000, 'streaming'));
      restoreCachedRoomThreads(f.room(), [
        { rootEvent: f.mx.getEventMapper()(withSummary(root(now - 60_000), streamed)) },
      ]);
      const openList = f.holdThreadList([
        withSummary(
          root(now - 60_000),
          withEdit(plainReply, othersEdit('Still thinking', now - 10_000, 'streaming'))
        ),
      ]);
      expect(f.card()).toEqual({ preview: 'The notes list', streaming: false });
      const listing = loadRoomThreads(f.room());
      await afterCheckDelay();

      openList();
      await listing;
      await settle();
      expect(f.replyRequests()).toBe(1);
    });
  });

  describe('while the room’s thread list is read', () => {
    /** A reload: the cache restores the thread with the summary a mid-stream list read saved. */
    const reload = async (now: number) => {
      const f = fixture();
      await f.start();
      await f.deliver([chat('$chat-1', now - 10_000)]);
      restoreCachedRoomThreads(f.room(), [
        {
          rootEvent: f.mx.getEventMapper()(withSummary(root(now - 60_000), reply(now - 50_000))),
        },
      ]);
      return f;
    };
    const title = (ts: number): IEvent =>
      message('$title', ts, {
        msgtype: 'm.notice',
        body: 'Release notes',
        'io.mindroom.thread_summary': { summary: 'Release notes', version: 1 },
        'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
      });

    it('lets the list that starts after the card asked answer for the reply', async () => {
      const now = Date.now();
      const f = await reload(now);
      f.setServerReply(withEdit(reply(now - 50_000), edit(finished, now - 20_000, 'completed')));
      const openList = f.holdThreadList([
        withSummary(
          root(now - 60_000),
          withEdit(reply(now - 50_000), edit(finished, now - 20_000, 'completed'))
        ),
      ]);
      // The card asks as it renders, before the room's list starts reading.
      expect(f.card().streaming).toBe(false);
      const listing = loadRoomThreads(f.room());
      await afterCheckDelay();
      // The check waits for the list, which is still being read.
      expect(f.replyRequests()).toBe(0);

      openList();
      await listing;
      await settle();
      expect(f.card()).toEqual({ preview: finished, streaming: false });
      await afterCheckDelay();
      expect(f.replyRequests()).toBe(0);
    });

    it('asks once about a reply whose thread the list shows with a newer event', async () => {
      const now = Date.now();
      const f = await reload(now);
      f.setServerReply(withEdit(reply(now - 50_000), edit(finished, now - 20_000, 'completed')));
      const openList = f.holdThreadList([withSummary(root(now - 60_000), title(now - 15_000), 2)]);
      expect(f.card().streaming).toBe(false);
      const listing = loadRoomThreads(f.room());
      await afterCheckDelay();

      openList();
      await listing;
      await settle();
      expect(f.card().streaming).toBe(false);
      await afterCheckDelay();
      expect(f.card().streaming).toBe(false);
      // A newer event says nothing about an older reply, which may stream on.
      expect(f.replyRequests()).toBe(1);
    });

    it('asks once when a card that still holds the reply is drawn again after the list', async () => {
      const now = Date.now();
      const f = await reload(now);
      f.setServerReply(withEdit(reply(now - 50_000), edit(finished, now - 20_000, 'completed')));
      // The cache also restored the reply into the thread's loaded events, so the card keeps it
      // after the list names the thread's newer event.
      const thread = defined(f.room().getThread(rootId), 'the thread');
      thread.timelineSet.addEventsToTimeline(
        [f.mx.getEventMapper()(reply(now - 50_000))],
        true,
        false,
        thread.liveTimeline
      );
      const openList = f.holdThreadList([withSummary(root(now - 60_000), title(now - 15_000), 2)]);
      expect(f.card().streaming).toBe(false);
      const listing = loadRoomThreads(f.room());
      await afterCheckDelay();

      openList();
      await listing;
      await settle();
      // Anything can draw the card again: the server's answer about the reply holds.
      expect(f.card().streaming).toBe(false);
      await afterCheckDelay();
      expect(f.card().streaming).toBe(false);
      expect(f.replyRequests()).toBe(1);
    });

    it('keeps streaming a reply whose thread got its title while it streamed', async () => {
      const now = Date.now();
      const f = await reload(now);
      // The title notice comes about a minute into the first reply, which streams on.
      f.setServerReply(withEdit(reply(now - 50_000), edit('The notes', now - 3_000, 'streaming')));
      const thread = defined(f.room().getThread(rootId), 'the thread');
      thread.timelineSet.addEventsToTimeline(
        [f.mx.getEventMapper()(reply(now - 50_000))],
        true,
        false,
        thread.liveTimeline
      );
      const openList = f.holdThreadList([withSummary(root(now - 60_000), title(now - 15_000), 2)]);
      const listing = loadRoomThreads(f.room());
      openList();
      await listing;
      await settle();
      f.card();
      await afterCheckDelay();
      expect(f.card().streaming).toBe(true);
      expect(f.replyRequests()).toBe(1);

      // Its next edits come through /sync as usual.
      await f.deliver([edit('The notes list', now - 1_000, 'streaming')]);
      expect(f.card().streaming).toBe(true);
      await f.deliver([edit(finished, now, 'completed')]);
      expect(f.card().streaming).toBe(false);
      expect(f.replyRequests()).toBe(1);
    });

    it('lets the reply MindRoom bundles beside a newer title answer for it', async () => {
      const now = Date.now();
      const f = await reload(now);
      const streaming = withEdit(reply(now - 50_000), edit('The notes', now - 3_000, 'streaming'));
      const thread = defined(f.room().getThread(rootId), 'the thread');
      thread.timelineSet.addEventsToTimeline(
        [f.mx.getEventMapper()(reply(now - 50_000))],
        true,
        false,
        thread.liveTimeline
      );
      const listedRoot = withSummary(root(now - 60_000), title(now - 15_000), 2);
      const summary = listedRoot.unsigned['m.relations']?.['m.thread'] as Record<string, unknown>;
      summary['io.mindroom.latest_reply'] = streaming;
      const openList = f.holdThreadList([listedRoot]);
      expect(f.card().streaming).toBe(false);
      const listing = loadRoomThreads(f.room());
      openList();
      await listing;
      await settle();
      expect(f.card().streaming).toBe(true);
      await afterCheckDelay();
      expect(f.card().streaming).toBe(true);
      expect(f.replyRequests()).toBe(0);
    });

    it('streams a reply whose restored copy went idle when the list bundles a fresh edit', async () => {
      const now = Date.now();
      const f = await reload(now);
      const old = reply(now - 31 * MINUTE);
      const thread = defined(f.room().getThread(rootId), 'the thread');
      thread.timelineSet.addEventsToTimeline(
        [f.mx.getEventMapper()(old)],
        true,
        false,
        thread.liveTimeline
      );
      const listedRoot = withSummary(root(now - 60_000), title(now - 15_000), 2);
      const summary = listedRoot.unsigned['m.relations']?.['m.thread'] as Record<string, unknown>;
      summary['io.mindroom.latest_reply'] = withEdit(
        old,
        edit('The notes', now - 3_000, 'streaming')
      );
      const openList = f.holdThreadList([listedRoot]);
      const listing = loadRoomThreads(f.room());
      openList();
      await listing;
      await settle();
      f.card();
      await settle();
      expect(f.card().streaming).toBe(true);
      expect(f.replyRequests()).toBe(0);
    });

    describe('an unopened thread whose summary names its title', () => {
      const listedRoot = (now: number, status: string) => {
        const listed = withSummary(root(now - 60_000), title(now - 15_000), 2);
        const summary = listed.unsigned['m.relations']?.['m.thread'] as Record<string, unknown>;
        summary['io.mindroom.latest_reply'] = withEdit(
          reply(now - 50_000),
          edit('The notes', now - 3_000, status)
        );
        return listed;
      };
      const reloadUnopened = async (now: number, listed: IEvent, fail = false) => {
        const f = fixture();
        f.setServerThread({
          fail,
          root: listed,
          replies: [
            withEdit(reply(now - 50_000), edit('The notes', now - 3_000, 'streaming')),
            title(now - 15_000),
          ],
        });
        f.setServerReply(
          withEdit(reply(now - 50_000), edit('The notes', now - 3_000, 'streaming'))
        );
        await f.start();
        await f.deliver([chat('$chat-1', now - 10_000)]);
        // The cache restores the root as the list had it: the reply is in no timeline.
        restoreCachedRoomThreads(f.room(), [{ rootEvent: f.mx.getEventMapper()(listed) }]);
        await afterCheckDelay();
        return f;
      };

      it('loads its first page while its bundled reply streams, and the card streams', async () => {
        const now = Date.now();
        const f = await reloadUnopened(now, listedRoot(now, 'streaming'));
        expect(f.requested(`/relations/${rootId}`)).toBe(1);
        // The loaded reply is checked as any restored reply that says it streams.
        f.card();
        await afterCheckDelay();
        expect(f.card().streaming).toBe(true);
        expect(f.replyRequests()).toBe(1);

        // Its next edits come through /sync as usual.
        await f.deliver([edit(finished, now, 'completed')]);
        expect(f.card()).toEqual({ preview: finished, streaming: false });
      });

      it('asks for the first page once when it fails', async () => {
        const now = Date.now();
        const f = await reloadUnopened(now, listedRoot(now, 'streaming'), true);
        await afterCheckDelay();
        expect(f.requested(`/relations/${rootId}`)).toBe(1);
        expect(f.card().streaming).toBe(false);

        // After an outage, the sync catches up before it runs again: the thread is tried again.
        f.setServerThread({
          root: listedRoot(now, 'streaming'),
          replies: [
            withEdit(reply(now - 50_000), edit('The notes', now - 3_000, 'streaming')),
            title(now - 15_000),
          ],
        });
        f.mx.emit(ClientEvent.Sync, SyncState.Error, SyncState.Syncing);
        f.mx.emit(ClientEvent.Sync, SyncState.Catchup, SyncState.Error);
        await f.deliver([chat('$chat-2', now - 1_000)]);
        await afterCheckDelay();
        expect(f.requested(`/relations/${rootId}`)).toBe(2);
      }, 15_000);

      it('loads the first page for a record-form streaming status', async () => {
        const now = Date.now();
        const listed = listedRoot(now, 'streaming');
        const summary = listed.unsigned['m.relations']?.['m.thread'] as Record<string, unknown>;
        const latestReply = summary['io.mindroom.latest_reply'] as IEvent;
        const newest = latestReply.unsigned['m.relations']?.['m.replace'] as IEvent;
        newest.content['m.new_content'] = {
          msgtype: 'm.text',
          body: 'The notes',
          'io.mindroom.stream_status': { state: 'streaming' },
        };
        const f = await reloadUnopened(now, listed);
        expect(f.requested(`/relations/${rootId}`)).toBe(1);
      });

      it('loads nothing for a bundled reply that finished', async () => {
        const now = Date.now();
        const f = await reloadUnopened(now, listedRoot(now, 'completed'));
        expect(f.requested(`/relations/${rootId}`)).toBe(0);
      });

      it('loads nothing for a bundled reply that went idle', async () => {
        const now = Date.now();
        const listed = listedRoot(now, 'streaming');
        const summary = listed.unsigned['m.relations']?.['m.thread'] as Record<string, unknown>;
        summary['io.mindroom.latest_reply'] = reply(now - 40 * MINUTE);
        const f = await reloadUnopened(now, listed);
        expect(f.requested(`/relations/${rootId}`)).toBe(0);
      });
    });

    it('checks a reply the list did not answer once the list is read', async () => {
      const now = Date.now();
      const f = await reload(now);
      f.setServerReply(withEdit(reply(now - 50_000), edit(finished, now - 20_000, 'completed')));
      const openList = f.holdThreadList([]);
      expect(f.card().streaming).toBe(false);
      const listing = loadRoomThreads(f.room());
      await afterCheckDelay();
      expect(f.replyRequests()).toBe(0);

      openList();
      await listing;
      await settle();
      expect(f.card()).toEqual({ preview: finished, streaming: false });
      expect(f.replyRequests()).toBe(1);
    });
  });
});
