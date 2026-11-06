import {
  ClientEvent,
  createClient,
  Room,
  SyncState,
  ThreadEvent,
  type IEvent,
} from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRoomThreads, roomThreadListIsComplete } from './roomThreadList';
import { restoreCachedRoomThreads } from '../sdk/roomTimelineSdk';

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

/** A /threads request: which list, from which token, at what time, and how many were open. */
type ListRequest = { include: string | null; from: string | null; at: number; open: number };

/** A failure the transport gives instead of a page: a dropped connection or an HTTP status. */
type Failure = 'dropped' | number;

/**
 * A real SDK client whose transport answers /threads 30 roots at a time, newest activity first,
 * as the server does. A later page answers a moment after it is asked for, as over a network.
 * `fail` may answer a request with a failure instead; every request counts, failed or not.
 */
const serve = (
  beforePage?: (room: Room) => void,
  fail?: (request: ListRequest) => Failure | undefined
) => {
  const all = Array.from({ length: THREADS }, (_, index) => listedRoot(index));
  const lists: Record<string, IEvent[]> = {
    all,
    participated: all.filter((_, index) => index % 2 === 0),
  };
  const requests: ListRequest[] = [];
  /** Requests of each list that have not answered yet. */
  const open: Record<string, number> = {};
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
      open[include ?? 'all'] = (open[include ?? 'all'] ?? 0) + 1;
      const request = { include, from, at: Date.now(), open: open[include ?? 'all'] ?? 0 };
      requests.push(request);
      if (from) {
        const listedRoom = client.getRoom(ROOM);
        if (listedRoom) beforePage?.(listedRoom);
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
      }
      open[include ?? 'all'] = (open[include ?? 'all'] ?? 1) - 1;
      const failure = fail?.(request);
      if (failure === 'dropped') throw new TypeError('Failed to fetch');
      if (failure !== undefined) {
        return new Response(JSON.stringify({ errcode: 'M_UNKNOWN', error: 'Try again later' }), {
          status: failure,
          headers: { 'Content-Type': 'application/json' },
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

  it('lists every thread after a reload restored them all from the cache', async () => {
    // A reload restores every thread the page saved before the list is read. A restored thread
    // that updates (its reply count, a streaming check, a cached preview) puts its root in the
    // room's list. Here every third thread updates while the list loads, the newest of each page
    // among them, so each later page arrives with its newest root listed and the others not. A
    // busy room's list stopped there for good, and its older threads kept their cached summaries.
    const { room, requests } = serve((listedRoom) => {
      listedRoom.getThreads().forEach((thread) => {
        if (Number(thread.id.split('-')[1]) % 3 === 0) thread.emit(ThreadEvent.Update, thread);
      });
    });
    const mapper = room.client.getEventMapper();
    restoreCachedRoomThreads(
      room,
      Array.from({ length: THREADS }, (_, index) => ({ rootEvent: mapper(listedRoot(index)) }))
    );
    expect(room.getThreads()).toHaveLength(THREADS);

    await loadRoomThreads(room);

    expect(roomThreadListIsComplete(room)).toBe(true);
    const pages = Array.from({ length: Math.ceil(THREADS / 30) }, (_, page) =>
      page === 0 ? null : String(page * 30)
    );
    expect(requests.filter(({ include }) => include === 'all').map(({ from }) => from)).toEqual(
      pages
    );
  });
  describe('a read that stops before the end', () => {
    /** The room list's pages in order, each once: `null` is the first page. */
    const PAGES = Array.from({ length: Math.ceil(THREADS / 30) }, (_, page) =>
      page === 0 ? null : String(page * 30)
    );
    const roomPages = (requests: ListRequest[]) =>
      requests.filter(({ include }) => include === 'all').map(({ from }) => from);
    /** The pages in order, `page` asked for `times` times in a row. */
    const pagesWith = (page: string | null, times: number) =>
      PAGES.flatMap((from) => (from === page ? Array<string | null>(times).fill(from) : [from]));

    /** Watches a load: whether it settled, and how. */
    const watch = (load: Promise<void>) => {
      const outcome: { settled: boolean; error?: unknown } = { settled: false };
      load.then(
        () => {
          outcome.settled = true;
        },
        (error: unknown) => {
          outcome.settled = true;
          outcome.error = error;
        }
      );
      return outcome;
    };

    /** Runs the clock 5 ms at a time until `done` or `limitMs`; returns the time that passed. */
    const runClockUntil = async (done: () => boolean, limitMs: number): Promise<number> => {
      let passed = 0;
      while (!done() && passed < limitMs) {
        // eslint-disable-next-line no-await-in-loop
        await vi.advanceTimersByTimeAsync(5);
        passed += 5;
      }
      return passed;
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('goes on from the page a dropped connection lost, waiting longer while it stays down', async () => {
      // The fourth page fails three times. The read must not end there: a room whose list stopped
      // kept its older threads' cached summaries for the rest of the session.
      let failures = 0;
      const { room, requests } = serve(undefined, ({ include, from }) => {
        if (include !== 'all' || from !== '90' || failures === 3) return undefined;
        failures += 1;
        return 'dropped';
      });

      const load = watch(loadRoomThreads(room));
      await runClockUntil(() => load.settled, 60_000);

      expect(load).toEqual({ settled: true });
      expect(room.getThreads()).toHaveLength(THREADS);
      expect(roomThreadListIsComplete(room)).toBe(true);
      // The lost page four times, every other page once: the read went on from its token.
      expect(roomPages(requests)).toEqual(pagesWith('90', 4));
      const tries = requests.filter(({ from }) => from === '90').map(({ at }) => at);
      const waits = tries.slice(1).map((at, index) => at - (tries[index] ?? 0));
      expect(waits.map((wait) => Math.round(wait / 1_000))).toEqual([1, 2, 4]);
    });

    it('reads the first page again when the server answers it with an error', async () => {
      let failures = 0;
      const { room, requests } = serve(undefined, ({ include, from }) => {
        if (include !== 'all' || from !== null || failures === 2) return undefined;
        failures += 1;
        return 502;
      });

      const load = watch(loadRoomThreads(room));
      await runClockUntil(() => load.settled, 60_000);

      expect(load).toEqual({ settled: true });
      expect(roomThreadListIsComplete(room)).toBe(true);
      expect(room.getThreads()).toHaveLength(THREADS);
      expect(roomPages(requests)).toEqual(pagesWith(null, 3));
    });

    it('tries again as soon as the connection is back', async () => {
      let online = true;
      let failures = 0;
      const { room, requests } = serve(undefined, ({ include, from }) => {
        if (include === 'all' && from === '90') online = false;
        if (online) return undefined;
        failures += 1;
        return 'dropped';
      });

      const load = watch(loadRoomThreads(room));
      await runClockUntil(() => failures === 1, 5_000);
      online = true;
      // The sync loop got through again after failing.
      room.client.emit(ClientEvent.Sync, SyncState.Catchup, SyncState.Reconnecting);
      const waited = await runClockUntil(
        () => requests.filter(({ from }) => from === '90').length === 2,
        5_000
      );

      // Well before the first wait of a second would have ended.
      expect(waited).toBeLessThan(100);
      await runClockUntil(() => load.settled, 60_000);
      expect(load).toEqual({ settled: true });
      expect(roomPages(requests)).toEqual(pagesWith('90', 2));
    });

    it('lets a caller that comes while the read waits wake it, without a second reader', async () => {
      let failures = 0;
      const { room, requests } = serve(undefined, ({ include, from }) => {
        if (include !== 'all' || from !== '90' || failures === 1) return undefined;
        failures += 1;
        return 'dropped';
      });

      const first = watch(loadRoomThreads(room));
      await runClockUntil(() => failures === 1, 5_000);
      // The room opens again, twice, while the read waits to try again.
      const second = watch(loadRoomThreads(room));
      const third = watch(loadRoomThreads(room));
      const waited = await runClockUntil(
        () => requests.filter(({ from }) => from === '90').length === 2,
        5_000
      );
      await runClockUntil(() => first.settled && second.settled && third.settled, 60_000);

      expect(waited).toBeLessThan(100);
      expect([first, second, third]).toEqual([
        { settled: true },
        { settled: true },
        { settled: true },
      ]);
      // One reader: the lost page once more, and never two pages of the list at a time.
      expect(roomPages(requests)).toEqual(pagesWith('90', 2));
      expect(
        requests
          .filter(({ include, from }) => include === 'all' && from !== null)
          .map(({ open }) => open)
      ).toEqual(Array<number>(pagesWith('90', 2).length - 1).fill(1));
    });

    it('ends when its only caller leaves during the wait; the next one goes on from the lost page', async () => {
      let failures = 0;
      const { room, requests } = serve(undefined, ({ include, from }) => {
        if (include !== 'all' || from !== '90' || failures === 1) return undefined;
        failures += 1;
        return 'dropped';
      });

      const leaving = new AbortController();
      const first = watch(loadRoomThreads(room, undefined, leaving.signal));
      await runClockUntil(() => failures === 1, 5_000);
      leaving.abort();
      await runClockUntil(() => first.settled, 100);
      expect(first).toEqual({ settled: true });
      // Nobody reads the list while nobody shows it.
      const asked = requests.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(requests).toHaveLength(asked);
      expect(roomThreadListIsComplete(room)).toBe(false);

      const second = watch(loadRoomThreads(room));
      await runClockUntil(() => second.settled, 60_000);

      expect(second).toEqual({ settled: true });
      expect(roomThreadListIsComplete(room)).toBe(true);
      expect(roomPages(requests)).toEqual(pagesWith('90', 2));
    });

    it('does not try again when the server refuses the page', async () => {
      const { room, requests } = serve(undefined, ({ include, from }) =>
        include === 'all' && from === '90' ? 403 : undefined
      );

      const load = watch(loadRoomThreads(room));
      await runClockUntil(() => load.settled, 60_000);

      expect(load.settled).toBe(true);
      expect(load.error).toMatchObject({ httpStatus: 403 });
      expect(roomPages(requests)).toEqual([null, '30', '60', '90']);
    });
  });
});
