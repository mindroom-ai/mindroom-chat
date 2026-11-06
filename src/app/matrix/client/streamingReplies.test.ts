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
import { restoreCachedRoomThreads } from '../../event-store/sdk/roomTimelineSdk';
import { startClient } from './clientSyncPolicy';
import { defined } from '../../../test/utils/defined';

// A streamed reply shows as streaming on its thread's card only while the client can trust that it
// still streams: the client watched it through /sync since the room's last gap, or the server says
// so. A summary captured mid-stream, a copy kept from before a reload, or a reply whose finishing
// edit came in a sync gap is checked against the server, which bundles the reply's newest edit.

const roomId = '!room:example.org';
const agentId = '@agent:example.org';
const readerId = '@reader:example.org';
const rootId = '$root';
const replyId = '$reply';
const MINUTE = 60_000;

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
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
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
      if (path.endsWith('/threads')) return json({ chunk: [] });
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
      rooms: {
        join: {
          [roomId]: {
            state: { events: [membership(agentId), membership(readerId)] },
            timeline: { events, prev_batch: `before-${batch}`, limited },
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
  return { mx, deliver, start, room, card, replyRequests, setServerReply };
};

const threadNamespaces = [
  FILTER_RELATED_BY_REL_TYPES,
  FILTER_RELATED_BY_SENDERS,
  THREAD_RELATION_TYPE,
];

describe('streaming replies on thread cards', () => {
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

    await settle();
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
    await settle();
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

    await settle();
    expect(f.card()).toEqual({ preview: 'The notes', streaming: true });
    f.card();
    await settle();
    expect(f.replyRequests()).toBe(1);

    // Its next edits come through /sync as usual.
    await f.deliver([edit(finished, now - 1_000, 'completed')]);
    expect(f.card()).toEqual({ preview: finished, streaming: false });
  });

  it('does not stream a reply the server no longer has, and does not ask again', async () => {
    const now = Date.now();
    const f = fixture();
    f.setServerReply(404);
    await f.start();
    await f.deliver([withSummary(root(now - 60_000), reply(now - 50_000))]);
    await settle();
    f.card();
    await settle();
    expect(f.card().streaming).toBe(false);
    expect(f.replyRequests()).toBe(1);
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
});
