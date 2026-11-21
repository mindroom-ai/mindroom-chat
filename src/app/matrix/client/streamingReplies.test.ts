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
import { classifyThreadWorkflow } from '../../event-store/threads/threadWorkflow';
import { loadRoomThreads } from '../../event-store/threads/roomThreadList';
import { restoreCachedRoomThreads } from '../../event-store/sdk/roomTimelineSdk';
import { installEventContentGuard, trustAgentsOfViewer } from '../protocol/untrustedContent';
import { startClient } from './clientSyncPolicy';
import { CHECK_DELAY_MS, isStreamingReplyCurrent } from './streamingReplies';
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
      if (serverThread && path.includes(`/relations/${rootId}`)) {
        if (serverThread.fail) {
          // Fail just once so a broken retry guard cannot spin against the fixture.
          serverThread.fail = false;
          return json({ errcode: 'M_UNKNOWN', error: 'Try later' }, 500);
        }
        return json({ chunk: [...serverThread.replies].reverse() });
      }
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

  it.each([
    'live',
    'cached',
    'superseded',
    'tied',
    'other sender',
    'idle',
    'human',
    'held',
    'encrypted',
    'no status',
    'run status',
    'custom agent',
    'recovery',
  ])('loads on live evidence (%s)', async (kind) => {
    const now = Date.now();
    const f = fixture();
    const sender = kind === 'custom agent' ? '@helper:example.org' : agentId;
    const rel = { rel_type: 'm.thread', event_id: rootId };
    const text = message('$text', now - 20_000, { body: 'Results', 'm.relates_to': rel });
    const file = message('$file', now - 19_000, {
      msgtype: 'm.file',
      body: 'results.txt',
      'm.relates_to': rel,
    });
    const placeholder = { ...reply(now - 49 * MINUTE), sender };
    const latest = kind === 'held' ? placeholder : file;
    const listed = withSummary(root(now - 50 * MINUTE), latest, kind === 'held' ? 1 : 3);
    const summary = listed.unsigned['m.relations']?.['m.thread'] as Record<string, unknown>;
    summary['io.mindroom.latest_reply'] = latest;
    const ts = kind === 'idle' ? now - 31 * MINUTE : now - 1_000;
    const active =
      kind === 'human'
        ? othersEdit('Checking the results', ts, 'streaming')
        : {
            ...edit('Checking the results', ts, 'streaming'),
            event_id: '$a-active',
            sender,
          };
    if (kind === 'no status' || kind === 'run status') {
      active.content['m.new_content'] = {
        body: 'Results',
        'io.mindroom.ai_run':
          kind === 'run status' ? { version: 1, status: 'streaming' } : { version: 1 },
      };
      delete active.content['io.mindroom.stream_status'];
    }
    const terminal = {
      ...edit(finished, kind === 'tied' ? ts : now, 'completed'),
      event_id: '$z-completed',
    };
    if (kind === 'other sender') terminal.sender = '@mindroom_other:example.org';
    const finishes = kind === 'superseded' || kind === 'tied';
    const answer = (revision: IEvent, fail = false) => {
      const target = withEdit(placeholder, revision);
      f.setServerReply(target);
      f.setServerThread({ root: listed, replies: [target, text, file], fail });
    };
    answer(finishes ? terminal : active, kind === 'recovery');
    const tail = kind === 'held' ? [listed] : [listed, text, file];
    if (kind === 'encrypted')
      tail.unshift({
        ...message('$encrypted', now - MINUTE, { algorithm: 'm.megolm.v1.aes-sha2' }),
        type: 'm.room.encryption',
        state_key: '',
      });
    if (kind === 'custom agent') {
      const bound = '@mindroom_router:example.org';
      const state = (type: string, key: string, content: Record<string, unknown>): IEvent => ({
        ...message(`$state-${type}`, now - MINUTE, content, bound),
        type,
        state_key: key,
      });
      tail.unshift(
        { ...membership(sender), unsigned: {} },
        state('m.room.power_levels', '', { users: { [bound]: 100 }, state_default: 50 }),
        state('io.mindroom.router', '', { user_id: bound }),
        state('io.mindroom.accounts', bound, { accounts: [sender] })
      );
    }
    if (kind === 'cached') {
      // Saved sync keeps the thread ID the SDK inferred when the edit first arrived.
      active.unsigned[UNSIGNED_THREAD_ID_FIELD.name] = rootId;
      vi.spyOn(f.mx.store, 'getSavedSyncToken').mockResolvedValue('saved');
      vi.spyOn(f.mx.store, 'getSavedSync').mockImplementation(async () => {
        await f.mx.threadSupportPending;
        const join = { [roomId]: joined([...tail, active], 'before') };
        return {
          nextBatch: 'saved',
          accountData: [],
          roomsData: { join, invite: {}, leave: {}, knock: {} },
        };
      });
    }
    await f.start();
    if (kind !== 'cached') await f.deliver(tail);
    const thread = defined(f.room().getThread(rootId), 'the unopened thread');
    const loads = () => f.requested(`/relations/${rootId}`);
    expect(loads()).toBe(0);
    expect(thread.initialEventsFetched).toBe(false);
    expect(thread.findEventById(replyId)).toBeUndefined();
    if (kind === 'held') expect(thread.replyToEvent?.getId()).toBe(replyId);
    if (kind === 'encrypted') expect(f.room().hasEncryptionStateEvent()).toBe(true);
    const workflow = () => {
      const { status } = buildThreadRecord({ room: f.room(), threadRootId: rootId });
      return classifyThreadWorkflow(status, now);
    };
    expect(workflow()).toBe('needsYou');

    const buffered = new Set(thread.replayEvents?.map((event) => event.getId()));
    f.room().on(ThreadEvent.Update, (updated) => {
      if (updated === thread) updated.replayEvents?.forEach((event) => buffered.add(event.getId()));
    });
    // Receive the newer revision first so a stale edit cannot hide it in a real SDK buffer.
    const edits = finishes || kind === 'other sender' ? [terminal, active] : [active];
    await f.deliver(kind === 'cached' ? [] : edits);
    const loadsThread = ['live', 'other sender', 'run status', 'custom agent', 'recovery'].includes(
      kind
    );
    expect(loads()).toBe(loadsThread ? 1 : 0);
    expect(buffered).toContain(active.event_id);
    if (edits.length > 1) expect(buffered).toContain(terminal.event_id);
    if (kind === 'recovery') {
      expect(thread.initialEventsFetched).toBe(false);
      await f.deliver([edit('Still checking', now, 'streaming')]);
      expect(loads()).toBe(1);
      f.mx.emit(ClientEvent.Sync, SyncState.Error, SyncState.Syncing);
      f.mx.emit(ClientEvent.Sync, SyncState.Catchup, SyncState.Error);
      const recovered = edit('Checking again', now + 1, 'streaming');
      answer(recovered);
      await f.deliver([recovered]);
      expect(loads()).toBe(2);
    }
    if (kind === 'custom agent') {
      expect(thread.initialEventsFetched).toBe(true);
      // The roster allows a load, not bypassing the card's content guard.
      expect(f.card().streaming).toBe(false);
    } else if (loadsThread) {
      workflow(); // Let the card check the loaded reply, as usual.
      await afterCheckDelay();
      expect(workflow()).toBe('working');
    }
  });

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
