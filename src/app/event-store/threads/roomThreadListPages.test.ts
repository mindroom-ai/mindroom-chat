import { createClient, Room, type IEvent } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRoomThreads, roomThreadListIsComplete } from './roomThreadList';

const ROOM = '!big:example.org';
const READER = '@reader:example.org';
const WRITER = '@writer:example.org';
/** Threads in the room; thread 0 has the newest activity. */
const THREADS = 500;

/**
 * Thread `index` as the server lists it, with its one reply in the bundle. The reader replied to
 * the even threads, so the reader's own list holds every other thread of the room's list.
 */
const listedRoot = (index: number): IEvent => {
  const rootId = `$thread-${index}`;
  const ts = (THREADS - index) * 1_000;
  const readerReplied = index % 2 === 0;
  const reply = {
    event_id: `${rootId}-reply`,
    room_id: ROOM,
    sender: readerReplied ? READER : WRITER,
    type: 'm.room.message',
    origin_server_ts: ts + 1,
    unsigned: {},
    content: {
      msgtype: 'm.text',
      body: `Reply ${index}`,
      'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
    },
  };
  return {
    event_id: rootId,
    room_id: ROOM,
    sender: WRITER,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body: `Topic ${index}` },
    unsigned: {
      'm.relations': {
        'm.thread': { count: 1, current_user_participated: readerReplied, latest_event: reply },
      },
    },
  } as unknown as IEvent;
};

type ListRequest = { include: string | null; from: string | null };

/**
 * A real SDK client whose transport answers /threads 30 roots at a time, newest activity first,
 * as the server does. A later page answers a moment after it is asked for, as over a network.
 */
const serve = () => {
  const all = Array.from({ length: THREADS }, (_, index) => listedRoot(index));
  const lists: Record<string, IEvent[]> = {
    all,
    participated: all.filter((_, index) => index % 2 === 0),
  };
  const requests: ListRequest[] = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const client = createClient({
    baseUrl: 'https://example.org',
    userId: READER,
    accessToken: 'token',
    timelineSupport: true,
    fetchFn: async (input) => {
      const url = new URL(String(input));
      const path = decodeURIComponent(url.pathname);
      if (!path.endsWith('/threads')) throw new Error(`Unexpected request ${path}`);
      const include = url.searchParams.get('include');
      const from = url.searchParams.get('from');
      requests.push({ include, from });
      if (from) {
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
      }
      const list = lists[include ?? 'all'] ?? [];
      const start = Number(from ?? 0);
      const end = start + Number(url.searchParams.get('limit'));
      return json({
        chunk: list.slice(start, end),
        next_batch: end < list.length ? String(end) : undefined,
      });
    },
  });
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  const room = new Room(ROOM, client, READER, { timelineSupport: true });
  room.setMaxListeners(0);
  client.store.storeRoom(room);
  return { room, requests };
};

describe('room thread list pages', () => {
  let support: [FeatureSupport, FeatureSupport, FeatureSupport];
  beforeEach(() => {
    support = [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ];
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    Thread.hasServerSideListSupport = FeatureSupport.Stable;
    Thread.hasServerSideFwdPaginationSupport = FeatureSupport.Stable;
  });
  afterEach(() => {
    [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ] = support;
    vi.restoreAllMocks();
  });

  it('lists every thread when a page starts with a thread the reader’s own list showed', async () => {
    // The reader's list holds thread 30, the newest of the room list's second page, before that
    // page arrives. The list used to keep that page's token and stop after it.
    const { room, requests } = serve();

    await loadRoomThreads(room);

    expect(room.getThreads()).toHaveLength(THREADS);
    expect(roomThreadListIsComplete(room)).toBe(true);
    // Each page of the room's list once, and the first page of the reader's list.
    const pages = Array.from({ length: Math.ceil(THREADS / 30) }, (_, page) =>
      page === 0 ? null : String(page * 30)
    );
    expect(requests.filter(({ include }) => include === 'all').map(({ from }) => from)).toEqual(
      pages
    );
    expect(requests.filter(({ include }) => include === 'participated')).toHaveLength(1);
  });
});
