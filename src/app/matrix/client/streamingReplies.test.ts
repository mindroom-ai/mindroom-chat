import {
  ClientEvent,
  createClient,
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
import { getThreadStreamingReplies } from '../../event-store/threads/useThreadStreamingState';
import { classifyThreadWorkflow } from '../../event-store/threads/threadWorkflow';
import { loadRoomThreads } from '../../event-store/threads/roomThreadList';
import { restoreCachedRoomThreads } from '../../event-store/sdk/roomTimelineSdk';
import { installEventContentGuard, trustAgentsOfViewer } from '../protocol/untrustedContent';
import { startClient } from './clientSyncPolicy';
import { CHECK_DELAY_MS, isStreamingReplyCurrent } from './streamingReplies';
import { revealedReplies } from './streamingThreadLoads';
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

  /** Answers the client's next /sync with these room events; `limited` makes it a gap. */
  const deliver = async (events: IEvent[], limited = false) => {
    batch += 1;
    const response = {
      next_batch: `batch-${batch}`,
      rooms: { join: { [roomId]: joined(events, `before-${batch}`, limited) } },
    };
    const waiting = waitingSyncs.shift();
    if (waiting) waiting(json(response));
    else pendingSyncs.push(response);
    await settle();
  };
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
    start,
    room,
    card,
    replyRequests,
    requested,
    setServerReply,
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
  const redaction = (eventId: string, ts: number, sender = agentId): IEvent => ({
    ...message(`$redaction-${eventId}`, ts, { redacts: eventId }, sender),
    type: 'm.room.redaction',
    redacts: eventId,
  });
  /** The reply as the server holds it once it is redacted. */
  const redacted = (event: IEvent, ts: number): IEvent => ({
    ...event,
    content: {},
    unsigned: { redacted_because: redaction(event.event_id, ts) },
  });
  const loaderWarnings = () =>
    vi
      .mocked(console.warn)
      .mock.calls.filter(([text]) => String(text).includes('[streamingThreadLoads]'));

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
        const stop = {
          ...message('$stop', now, {
            'm.relates_to': { rel_type: 'm.annotation', event_id: replyId, key: '🛑' },
          }),
          type: 'm.reaction',
        };
        return { newest: active, live: [[active, stop]] };
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
  ])('reveals the hidden reply by a live edit: %s', async (_name, arrival, options) => {
    const now = Date.now();
    const s = await relaunchMidStream(now, options?.(now));
    const { f, thread, workflow } = s;
    const shown = { preview: f.card().preview, replies: thread.length };
    let announced = false;
    f.room().on(ThreadEvent.Update, (updated) => {
      announced ||= !!revealedReplies.get(updated);
    });
    await arrive(s, arrival(s, now));

    // The SDK fetched the reply to place the edit; the thread itself stays as it was.
    const revealed = revealedReplies.get(thread);
    expect(revealed?.replacingEvent()?.getId()).toBe('$a-active');
    expect(announced).toBe(true);
    expect(thread.findEventById(replyId)).toBeUndefined();
    expect(thread.initialEventsFetched).toBe(false);
    // The card checks the reply as it checks any other: the live edit vouches for it, by the
    // sender of the copy the SDK fetched, so the check asks the server nothing.
    expect(workflow()).toBe('working');
    await afterCheckDelay();
    expect(workflow()).toBe('working');
    expect(f.replyRequests()).toBe(1);
    expect({ preview: f.card().preview, replies: thread.length }).toEqual(shown);

    // The same copy takes the reply's further edits, to the one that ends the stream.
    await f.deliver([s.streaming(now, '$b-later')]);
    expect(revealedReplies.get(thread)).toBe(revealed);
    expect(revealed?.replacingEvent()?.getId()).toBe('$b-later');
    expect(workflow()).toBe('working');
    await f.deliver([s.ending(now + 1)]);
    expect(workflow()).toBe('needsYou');
    await afterCheckDelay();
    // One request per live edit, each the SDK's to place it.
    expect(f.replyRequests()).toBe(3);
    expect(f.requested('/relations/')).toBe(0);
  });

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
      'a stale edit sent at the same time as the finishing one',
      (s, now) => ({ newest: s.completed(now), live: [[s.streaming(now)]] }),
    ],
    [
      'a newer finishing edit from the saved sync that no thread took',
      (s, now) => ({ live: [[s.streaming(now - 1_000)]] }),
      (now) => ({ saved: [edit(finished, now, 'completed')] }),
    ],
    [
      'a newer streaming edit from the saved sync',
      (s, now) => ({ live: [[s.completed(now - 2_000)]] }),
      (now) => ({ saved: [inThread(edit('Checking the results', now - 1_000, 'streaming'))] }),
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
      (s, now) => {
        const active = { ...s.streaming(now - 1_000), type: 'm.room.notice' };
        return { live: [[active]] };
      },
    ],
    [
      'an edit that came redacted',
      (s, now) => {
        const active = s.streaming(now - 1_000);
        active.unsigned = { redacted_because: redaction(active.event_id, now) };
        return { live: [[active]] };
      },
    ],
    [
      'a reply the server holds redacted',
      (s, now) => ({ served: redacted(s.placeholder, now), live: [[s.streaming(now - 1_000)]] }),
    ],
  ])('leaves the hidden reply unrevealed: %s', async (_name, arrival, options) => {
    const now = Date.now();
    const s = await relaunchMidStream(now, options?.(now));
    const { f, thread, workflow } = s;
    vi.spyOn(console, 'warn');
    await arrive(s, arrival(s, now));

    expect(revealedReplies.get(thread)).toBeUndefined();
    expect(loaderWarnings()).toEqual([]);
    expect(workflow()).toBe('needsYou');
    expect(f.requested('/relations/')).toBe(0);
  });

  it('does not stream a reply by a stale edit synced after one that finished it at the same time', async () => {
    const now = Date.now();
    const s = await relaunchMidStream(now);
    // The server bundles no edit, and the unopened thread keeps the later arrival of the two.
    await arrive(s, { live: [[s.completed(now)], [s.streaming(now)]] });
    expect(s.workflow()).toBe('needsYou');
    await afterCheckDelay();
    expect(s.workflow()).toBe('needsYou');
  });

  it('reveals the hidden reply once the SDK could fetch it', async () => {
    const now = Date.now();
    const s = await relaunchMidStream(now);
    const { f, thread, workflow } = s;
    f.setServerReply(500);
    await f.deliver([s.streaming(now - 2_000, '$a-first')]);
    expect(revealedReplies.get(thread)).toBeUndefined();

    const { newest, live } = oneLiveEdit(s, now);
    s.serve(newest);
    await f.deliver(defined(live[0], 'the live batch'));
    expect(revealedReplies.get(thread)).toBeDefined();
    expect(workflow()).toBe('working');
  });

  /** The hidden reply once a live edit revealed it: its card says Working. */
  const revealMidStream = async (
    now: number,
    options?: Parameters<typeof relaunchMidStream>[1]
  ) => {
    const s = await relaunchMidStream(now, options);
    await arrive(s, oneLiveEdit(s, now));
    expect(revealedReplies.get(s.thread)?.replacingEvent()?.getId()).toBe('$a-active');
    expect(s.workflow()).toBe('working');
    return s;
  };
  const moderatorId = '@moderator:example.com';
  const guestId = '@guest:example.com';
  /** A room of two servers: only the moderator of the other one may redact for others. */
  const moderated = (now: number): IEvent[] => {
    const state = (type: string, content: Record<string, unknown>): IEvent => ({
      ...message(`$state-${type}`, now - MINUTE, content, readerId),
      type,
      state_key: '',
    });
    return [
      state('m.room.create', { room_version: '10' }),
      { ...membership(moderatorId), unsigned: {} },
      { ...membership(guestId), unsigned: {} },
      state('m.room.power_levels', { users: { [moderatorId]: 50 }, redact: 50 }),
    ];
  };

  // No redaction reaches the revealed copy through the room, which holds it in no timeline.
  it.each<[string, (s: MidStream, now: number) => Promise<unknown>]>([
    [
      'a member of its sender’s server redacts it',
      (s, now) => s.f.deliver([redaction(replyId, now, readerId)]),
    ],
    [
      'a moderator of another server redacts it',
      (s, now) => s.f.deliver([redaction(replyId, now, moderatorId)]),
    ],
    ['the edit it shows is redacted', (s, now) => s.f.deliver([redaction('$a-active', now)])],
    [
      'the server holds it redacted at its next edit',
      (s, now) => {
        s.f.setServerReply(redacted(s.placeholder, now));
        return s.f.deliver([s.streaming(now, '$b-later')]);
      },
    ],
  ])('forgets the revealed reply once %s', async (_name, redact) => {
    const now = Date.now();
    const s = await revealMidStream(now, { state: moderated(now) });
    let announced = false;
    s.thread.on(ThreadEvent.Update, () => {
      announced ||= !revealedReplies.get(s.thread);
    });
    await redact(s, now);

    expect(revealedReplies.get(s.thread)).toBeUndefined();
    expect(announced).toBe(true);
    expect(s.workflow()).toBe('needsYou');
    await afterCheckDelay();
    expect(s.workflow()).toBe('needsYou');
  });

  it('reveals the reply again by the edit that follows a redacted one', async () => {
    const now = Date.now();
    const s = await revealMidStream(now);
    await s.f.deliver([redaction('$a-active', now)]);
    expect(s.workflow()).toBe('needsYou');

    const later = s.streaming(now + 1, '$b-later');
    await arrive(s, { newest: later, live: [[later]] });
    expect(revealedReplies.get(s.thread)?.replacingEvent()?.getId()).toBe('$b-later');
    expect(s.workflow()).toBe('working');
  });

  it('keeps the revealed reply that a member who may not redact it tries to redact', async () => {
    const now = Date.now();
    const s = await revealMidStream(now, { state: moderated(now) });
    await s.f.deliver([redaction(replyId, now, guestId)]);
    expect(revealedReplies.get(s.thread)?.replacingEvent()?.getId()).toBe('$a-active');
    expect(s.workflow()).toBe('working');
  });

  it('ends the stream of a revealed reply that the server bundles a newer finishing edit with', async () => {
    const now = Date.now();
    const s = await revealMidStream(now);
    const revealed = revealedReplies.get(s.thread);
    // The finishing edit itself has not come, or never comes: the copy fetched for an older one
    // brings it.
    s.serve(s.ending(now + 1));
    await s.f.deliver([s.streaming(now, '$b-later')]);
    expect(revealedReplies.get(s.thread)).toBe(revealed);
    expect(revealed?.replacingEvent()?.getId()).toBe('$c-ending');
    expect(s.workflow()).toBe('needsYou');
    await afterCheckDelay();
    expect(s.workflow()).toBe('needsYou');

    // Nor does an older edit start it again when the server bundles none with a later copy.
    s.serve();
    await s.f.deliver([s.streaming(now, '$b-stale')]);
    expect(revealed?.replacingEvent()?.getId()).toBe('$c-ending');
    expect(s.workflow()).toBe('needsYou');
  });

  it('keeps the sync going when revealing the reply fails', async () => {
    const now = Date.now();
    const s = await relaunchMidStream(now);
    let failed = false;
    s.thread.on(ThreadEvent.Update, () => {
      if (failed || !revealedReplies.get(s.thread)) return;
      failed = true;
      throw new Error('A listener of the thread failed');
    });
    const unexpected = vi.fn();
    s.f.mx.on(ClientEvent.SyncUnexpectedError, unexpected);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await arrive(s, oneLiveEdit(s, now));

    expect(failed).toBe(true);
    expect(loaderWarnings()).toHaveLength(1);
    expect(unexpected).not.toHaveBeenCalled();
    expect(s.workflow()).toBe('working');
  });

  it.each([
    ['before', 'ends before the reply'],
    ['after', 'ends before the reply'],
    ['before', 'reaches the reply'],
  ])(
    'keeps the revealed reply streaming, revealed %s a first page that %s',
    async (order, page) => {
      const now = Date.now();
      const s = await relaunchMidStream(now);
      const { f, thread, workflow } = s;
      const { newest, live } = oneLiveEdit(s, now);
      s.serve(newest);
      if (page === 'reaches the reply')
        f.setServerThread({
          root: s.listed,
          replies: [withEdit(s.placeholder, defined(newest, 'the edit')), s.text, s.file],
        });
      if (order === 'before') await f.deliver(defined(live[0], 'the live batch'));
      await thread.initialize();
      expect(thread.initialEventsFetched).toBe(true);
      if (order === 'after') await f.deliver(defined(live[0], 'the live batch'));

      expect(!!thread.findEventById(replyId)).toBe(page === 'reaches the reply');
      workflow();
      await afterCheckDelay();
      expect(workflow()).toBe('working');
      const streaming = () => getThreadStreamingReplies(f.room(), rootId).map((e) => e.getId());
      expect(streaming()).toEqual([replyId]);
      // The SDK fetches the reply for the first edit of a batch only.
      await f.deliver([s.streaming(now, '$b-later'), s.streaming(now + 1, '$b-latest')]);
      const shown = thread.findEventById(replyId) ?? revealedReplies.get(thread);
      expect(shown?.replacingEvent()?.getId()).toBe('$b-latest');
      expect(streaming()).toEqual([replyId]);
      await f.deliver([s.ending(now + 2)]);
      expect(workflow()).toBe('needsYou');
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
