/**
 * 2026-07-10 missing-middle fix: reconciler shortfall-drain tests.
 *
 * Device trace ride-trace-1783737737705 (iOS, ~130-reply thread): the
 * cache held the live-synced tail, the SDK bootstrap's backward token
 * exhausted near the thread start, and the reconciler's fetch loop
 * stopped on its very first page because "overlap with cache" was the
 * sole convergence signal — the tail ALWAYS overlaps on page 1. The
 * hole between the thread's earliest events and its tail was
 * structurally invisible: `[root + tail]` painted as a complete
 * thread, no Load-Older affordance survived, and the middle was never
 * fetched.
 *
 * Guarantees under test:
 *   1. Overlap alone no longer stops the drain while the union of
 *      known reply ids (cached + fetched) falls short of the
 *      authoritative reply count — the pass pages on and heals the
 *      middle.
 *   2. When the union satisfies the count, the first overlap still
 *      stops the drain — the D7 "cached was right" open stays a
 *      single-page cheap no-op.
 *   3. The authoritative count is the MAX of the live root's bundled
 *      m.thread count, the cached root's bundled count, and the cached
 *      page's recorded count (the SDK never updates the live bundle as
 *      replies arrive, so no single source can be trusted alone).
 *   4. A drain that observed `next_batch` exhaustion persists the
 *      server-confirmed start (`beforeTokenForEarliest: null`) but
 *      NEVER upgrades `relationSnapshotComplete` (the PR #84 contract:
 *      that proof is owned by the background prewarm — pinned in
 *      RoomTimeline.cache.test.ts); a drain stopped by overlap with
 *      pages remaining persists neither.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IEvent, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { createBackfillScheduler } from '../backfillScheduler';
import { scheduleReconcile } from '../reconciler';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../threads/cacheProbe';
import type { HydratedThreadCachePage } from '../../threads/types';

// The persist leg goes through scheduleReconcile's injectable persistRepair
// seam (this branch's committed-write variant) so its arguments — the
// completeness marker in particular — can be asserted without stubbing IDB.
const makePersistRepairSpy = () =>
  vi.fn(({ events }: { events: readonly { event: unknown }[] }) => ({
    rawEvents: events.map((mEvent) => mEvent.event),
    loadedReplyCount: 0,
    write: Promise.resolve(true),
  }));

const THREAD_ID = '$thread';

const makeFakeEvent = (raw: Partial<IEvent>): MatrixEvent =>
  ({
    getId: () => raw.event_id,
    getType: () => raw.type,
    getTs: () => raw.origin_server_ts ?? 0,
    isRedaction: () => false,
    isRedacted: () => false,
    isSending: () => false,
    getAssociatedId: () => undefined,
    getRelation: () =>
      (raw.content as Record<string, unknown> | undefined)?.['m.relates_to'] ?? null,
    getUnsigned: () => raw.unsigned ?? {},
    setUnsigned: (unsigned: IEvent['unsigned']) => {
      raw.unsigned = unsigned;
    },
    makeRedacted: () => undefined,
    makeReplaced: () => undefined,
    replacingEvent: () => null,
    getSender: () => '@bob:example',
    getContent: () => raw.content ?? {},
    getWireContent: () => raw.content ?? {},
    event: raw,
  } as unknown as MatrixEvent);

/** Raw JSON for a first-class thread reply as `/relations` returns it. */
const makeReplyRaw = (id: string, ts: number): Partial<IEvent> => ({
  event_id: id,
  type: 'm.room.message',
  origin_server_ts: ts,
  content: {
    'm.relates_to': { rel_type: 'm.thread', event_id: THREAD_ID },
  } as never,
});

const makeCachedPage = (
  replyRaws: Partial<IEvent>[],
  overrides: Partial<HydratedThreadCachePage> = {}
): HydratedThreadCachePage =>
  ({
    beforeToken: undefined,
    cacheCoverage: {} as never,
    events: replyRaws,
    hasMoreBefore: false,
    relationSnapshotComplete: false,
    rootEvent: undefined,
    snapshotComplete: false,
    tailLoaded: true,
    ...overrides,
  } as HydratedThreadCachePage);

const makeFakeRoom = (rootEvent?: MatrixEvent): Room =>
  ({
    roomId: '!room:example',
    findEventById: (id: string) => (id === THREAD_ID ? rootEvent ?? null : null),
    getThread: () => undefined,
  } as unknown as Room);

const makeMockClient = (
  room: Room,
  pages: Array<{ chunk: Partial<IEvent>[]; next_batch?: string }>
): { mx: MatrixClient; fetchRelations: ReturnType<typeof vi.fn> } => {
  let call = 0;
  const fetchRelations = vi.fn(async () => {
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return page;
  });
  const mx = {
    getRoom: () => room,
    getEventMapper: () => (raw: Partial<IEvent>) => makeFakeEvent(raw),
    fetchRelations,
  } as unknown as MatrixClient;
  return { mx, fetchRelations };
};

describe('reconciler shortfall drain (2026-07-10 missing-middle fix)', () => {
  beforeEach(() => {
    resetCacheProbe();
  });
  afterEach(() => {
    resetCacheProbe();
  });

  it('pages past the cached-tail overlap while the reply-count union shows a shortfall, and heals the middle', async () => {
    // Cache: tail replies r4, r5. Recorded expected count: 5.
    // Page 1 (newest-first) overlaps the tail immediately — the exact
    // shape that used to stop the drain after one page. Page 2 carries
    // the missing middle/start (r1..r3) and exhausts the stream.
    const room = makeFakeRoom();
    const { mx, fetchRelations } = makeMockClient(room, [
      { chunk: [makeReplyRaw('$r5', 500), makeReplyRaw('$r4', 400)], next_batch: 'p2' },
      { chunk: [makeReplyRaw('$r3', 300), makeReplyRaw('$r2', 200), makeReplyRaw('$r1', 100)] },
    ]);
    const scheduler = createBackfillScheduler({ mx });
    const onRepaired = vi.fn();

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: THREAD_ID,
      cachedPage: makeCachedPage([makeReplyRaw('$r4', 400), makeReplyRaw('$r5', 500)], {
        expectedReplyCount: 5,
      }),
      room,
      onRepaired,
    });

    // The load-bearing assertion: the overlap on page 1 did not stop
    // the drain — page 2 was fetched and the middle repaired.
    expect(fetchRelations).toHaveBeenCalledTimes(2);
    expect(result.repaired).toBe(true);
    expect(result.iterations).toBe(2);
    expect(onRepaired).toHaveBeenCalledTimes(1);
    const [batch] = onRepaired.mock.calls[0];
    const batchIds = (batch as MatrixEvent[]).map((mEvent) => mEvent.getId());
    expect(batchIds).toContain('$r1');
    expect(batchIds).toContain('$r2');
    expect(batchIds).toContain('$r3');
    // Probe evidence a device trace can read: the shortfall guard is
    // what drove the second page.
    expect(getCacheProbeSnapshot().reconcileShortfallPagesPastOverlap).toBe(1);
  });

  it('stops at the first overlap when the union satisfies the expected count (D7 cheap open preserved)', async () => {
    const room = makeFakeRoom();
    const { mx, fetchRelations } = makeMockClient(room, [
      { chunk: [makeReplyRaw('$r5', 500), makeReplyRaw('$r4', 400)], next_batch: 'p2' },
      { chunk: [makeReplyRaw('$r3', 300)] },
    ]);
    const scheduler = createBackfillScheduler({ mx });

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: THREAD_ID,
      cachedPage: makeCachedPage([makeReplyRaw('$r4', 400), makeReplyRaw('$r5', 500)], {
        expectedReplyCount: 2,
      }),
      room,
    });

    expect(fetchRelations).toHaveBeenCalledTimes(1);
    // Everything fetched was already cached — no divergence, no tick.
    expect(result.repaired).toBe(false);
    expect(getCacheProbeSnapshot().reconcileShortfallPagesPastOverlap).toBe(0);
  });

  it('derives the expected count from the live root event bundled m.thread count', async () => {
    // No recorded count on the cached page — the authority is the live
    // root's `unsigned['m.relations']['m.thread'].count` (the freshest
    // server-side signal the client holds).
    const rootEvent = makeFakeEvent({
      event_id: THREAD_ID,
      type: 'm.room.message',
      unsigned: { 'm.relations': { 'm.thread': { count: 5 } } } as never,
    });
    const room = makeFakeRoom(rootEvent);
    const { mx, fetchRelations } = makeMockClient(room, [
      { chunk: [makeReplyRaw('$r5', 500), makeReplyRaw('$r4', 400)], next_batch: 'p2' },
      { chunk: [makeReplyRaw('$r3', 300), makeReplyRaw('$r2', 200), makeReplyRaw('$r1', 100)] },
    ]);
    const scheduler = createBackfillScheduler({ mx });

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: THREAD_ID,
      cachedPage: makeCachedPage([makeReplyRaw('$r4', 400), makeReplyRaw('$r5', 500)]),
      room,
    });

    expect(fetchRelations).toHaveBeenCalledTimes(2);
    expect(result.repaired).toBe(true);
  });

  it('persists the server-confirmed start after a full drain, without claiming relationSnapshotComplete', async () => {
    const room = makeFakeRoom();
    const { mx } = makeMockClient(room, [
      { chunk: [makeReplyRaw('$r5', 500), makeReplyRaw('$r4', 400)], next_batch: 'p2' },
      { chunk: [makeReplyRaw('$r3', 300), makeReplyRaw('$r2', 200), makeReplyRaw('$r1', 100)] },
    ]);
    const scheduler = createBackfillScheduler({ mx });
    const persistRepair = makePersistRepairSpy();

    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: THREAD_ID,
      cachedPage: makeCachedPage([makeReplyRaw('$r4', 400), makeReplyRaw('$r5', 500)], {
        expectedReplyCount: 5,
      }),
      room,
      persistRepair: persistRepair as never,
    });

    expect(persistRepair).toHaveBeenCalledTimes(1);
    const [persistArgs] = persistRepair.mock.calls[0] as [Record<string, unknown>];
    // Full drain observed next_batch exhaust from HEAD → the server
    // confirmed nothing exists before the batch's earliest event:
    // record the start so the next open's count-proof can take the
    // complete-coverage paint. `relationSnapshotComplete` must NOT be
    // claimed by any open-time persist (PR #84 contract — the
    // background prewarm owns that proof).
    expect(persistArgs.beforeTokenForEarliest).toBeNull();
    expect(persistArgs.relationSnapshotComplete).toBeUndefined();
  });

  it('persists the server-confirmed start on a shortfall-driven no-divergence drain (phantom-count shape)', async () => {
    // A recorded expected count higher than the stream can ever yield
    // (e.g. server-filtered events) drives a full drain that finds
    // nothing new. The pass must still record the observed start so
    // the walk was not for nothing — but this persist fires ONLY on
    // shortfall-driven multi-page passes; the ordinary single-page
    // "cached was right" open stays zero-persist (D7).
    const room = makeFakeRoom();
    const { mx, fetchRelations } = makeMockClient(room, [
      { chunk: [makeReplyRaw('$r5', 500), makeReplyRaw('$r4', 400)], next_batch: 'p2' },
      // Page 2: also fully cached — no divergence anywhere.
      { chunk: [makeReplyRaw('$r3', 300)] },
    ]);
    const scheduler = createBackfillScheduler({ mx });
    const persistRepair = makePersistRepairSpy();

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: THREAD_ID,
      cachedPage: makeCachedPage(
        [makeReplyRaw('$r3', 300), makeReplyRaw('$r4', 400), makeReplyRaw('$r5', 500)],
        { expectedReplyCount: 9 }
      ),
      room,
      persistRepair: persistRepair as never,
    });

    expect(fetchRelations).toHaveBeenCalledTimes(2);
    expect(result.repaired).toBe(false);
    expect(persistRepair).toHaveBeenCalledTimes(1);
    const [persistArgs] = persistRepair.mock.calls[0] as [Record<string, unknown>];
    expect(persistArgs.beforeTokenForEarliest).toBeNull();
    expect(persistArgs.relationSnapshotComplete).toBeUndefined();
  });

  it('does NOT persist the completeness marker when the drain stopped on overlap with pages remaining', async () => {
    // Page 1 carries one NEW reply ($r3, divergence → persist fires)
    // AND overlaps the cached tail; the union (r3+r4+r5) satisfies the
    // expected count of 3, so the drain stops with next_batch still
    // present — the stream was NOT exhausted, so no completeness claim.
    const room = makeFakeRoom();
    const { mx, fetchRelations } = makeMockClient(room, [
      { chunk: [makeReplyRaw('$r5', 500), makeReplyRaw('$r3', 300)], next_batch: 'p2' },
      { chunk: [makeReplyRaw('$r1', 100)] },
    ]);
    const scheduler = createBackfillScheduler({ mx });
    const persistRepair = makePersistRepairSpy();

    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: THREAD_ID,
      cachedPage: makeCachedPage([makeReplyRaw('$r4', 400), makeReplyRaw('$r5', 500)], {
        expectedReplyCount: 3,
      }),
      room,
      persistRepair: persistRepair as never,
    });

    expect(fetchRelations).toHaveBeenCalledTimes(1);
    expect(persistRepair).toHaveBeenCalledTimes(1);
    const [persistArgs] = persistRepair.mock.calls[0] as [Record<string, unknown>];
    expect(persistArgs.relationSnapshotComplete).toBeUndefined();
    expect(persistArgs.beforeTokenForEarliest).toBeUndefined();
  });
});

describe('reconciler shortfall drain: replies the server counts but cannot return', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  let now = 1_000_000;
  beforeEach(() => {
    resetCacheProbe();
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    resetCacheProbe();
    vi.restoreAllMocks();
  });

  type Unreachable = { count: number; expectedReplyCount: number; recordedAt: number };
  // In-memory stand-in for the thread meta row the reconciler owns.
  const makeMemoryStore = () => {
    let unreachable: Unreachable | undefined;
    return {
      load: vi.fn(async () => undefined),
      begin: vi.fn(async (_sessionId, _roomId, _threadId, candidate) => candidate),
      checkpoint: vi.fn(async () => true),
      clear: vi.fn(async () => true),
      restartFromHead: vi.fn(async () => undefined),
      loadUnreachableReplies: vi.fn(async () => unreachable),
      recordUnreachableReplies: vi.fn(async (_sessionId, _roomId, _threadId, value) => {
        unreachable = value;
        return true;
      }),
    } satisfies NonNullable<Parameters<typeof scheduleReconcile>[0]['continuationStore']>;
  };
  const recorded = (count: number, expectedReplyCount: number) => [
    'session',
    '!room:example',
    THREAD_ID,
    { count, expectedReplyCount, recordedAt: now },
  ];

  // Tuwunel keeps counting a redacted reply in the root's m.thread count, but
  // /relations returns it without its thread relation.
  const redactedR3 = {
    event_id: '$r3',
    type: 'm.room.message',
    origin_server_ts: 300,
    content: {},
    unsigned: { redacted_because: { event_id: '$redaction' } },
  } as Partial<IEvent>;
  const serverPages = [
    { chunk: [makeReplyRaw('$r5', 500), makeReplyRaw('$r4', 400)], next_batch: 'p2' },
    { chunk: [redactedR3, makeReplyRaw('$r2', 200), makeReplyRaw('$r1', 100)] },
  ];
  const allReplies = [100, 200, 400, 500].map((ts) => makeReplyRaw(`$r${ts / 100}`, ts));

  const reconcile = async (
    continuationStore: ReturnType<typeof makeMemoryStore>,
    cachedReplies: Partial<IEvent>[],
    expectedReplyCount: number,
    pages: Array<{ chunk: Partial<IEvent>[]; next_batch?: string }> = serverPages
  ) => {
    const room = makeFakeRoom();
    const { mx, fetchRelations } = makeMockClient(room, pages);
    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx }),
      roomId: '!room:example',
      threadId: THREAD_ID,
      cachedPage: makeCachedPage(cachedReplies, { expectedReplyCount }),
      room,
      persistRepair: makePersistRepairSpy() as never,
      continuationStore,
    });
    return { calls: fetchRelations.mock.calls.length, repaired: result.repaired };
  };

  it('records the count a complete drain could not reach and does not drain for it again', async () => {
    const store = makeMemoryStore();

    expect((await reconcile(store, allReplies, 5)).calls).toBe(2);
    expect(store.recordUnreachableReplies).toHaveBeenCalledWith(...recorded(1, 5));

    // The next open overlaps on its first page and stops there.
    expect((await reconcile(store, allReplies, 5)).calls).toBe(1);
    expect(store.recordUnreachableReplies).toHaveBeenCalledTimes(1);
  });

  it('still drains for replies missing beyond the unreachable count', async () => {
    const store = makeMemoryStore();
    await reconcile(store, allReplies, 5);

    // The cache lost the thread's start: two replies short beyond the one
    // the server cannot return.
    expect(await reconcile(store, allReplies.slice(2), 5)).toEqual({ calls: 2, repaired: true });
  });

  it('stops crediting replies the count no longer includes', async () => {
    const store = makeMemoryStore();
    await reconcile(store, allReplies, 5);

    // The server stopped counting the redacted reply, and the cache lost one.
    expect(await reconcile(store, allReplies.slice(1), 4)).toEqual({ calls: 2, repaired: true });
  });

  it('measures the unreachable count again once it is a day old', async () => {
    const store = makeMemoryStore();
    await reconcile(store, allReplies, 5);

    now += DAY_MS;
    expect((await reconcile(store, allReplies, 5)).calls).toBe(2);
    expect(store.recordUnreachableReplies).toHaveBeenLastCalledWith(...recorded(1, 5));
  });

  it('clears the unreachable count once a complete drain reaches the expected count', async () => {
    const store = makeMemoryStore();
    await reconcile(store, allReplies, 5);

    await reconcile(store, allReplies.slice(2), 4);
    expect(store.recordUnreachableReplies).toHaveBeenLastCalledWith(...recorded(0, 4));
  });

  it('rewrites the value only when a complete drain measures something new', async () => {
    const store = makeMemoryStore();
    // A short thread drains to its start on every open.
    const onePage = [{ chunk: serverPages.flatMap((page) => page.chunk) }];

    await reconcile(store, allReplies, 5, onePage);
    await reconcile(store, allReplies, 5, onePage);
    expect(store.recordUnreachableReplies).toHaveBeenCalledTimes(1);

    // A new reply raises the count; the unreachable reply is still one.
    const r6 = makeReplyRaw('$r6', 600);
    await reconcile(store, [...allReplies, r6], 6, [{ chunk: [r6, ...onePage[0].chunk] }]);
    expect(store.recordUnreachableReplies).toHaveBeenLastCalledWith(...recorded(1, 6));
  });

  it('records nothing from a pass that stopped at its page cap', async () => {
    const store = makeMemoryStore();
    const endless = Array.from({ length: 30 }, (_, page) => ({
      chunk: [makeReplyRaw(`$old-${page}`, 50 - page)],
      next_batch: `page-${page + 1}`,
    }));

    const { calls } = await reconcile(store, allReplies.slice(2), 5, endless);
    expect(calls).toBe(25);
    expect(store.recordUnreachableReplies).not.toHaveBeenCalled();
  });

  it('ignores a value recorded ahead of the clock', async () => {
    const store = makeMemoryStore();
    store.loadUnreachableReplies.mockResolvedValue({
      count: 1,
      expectedReplyCount: 5,
      recordedAt: now + DAY_MS,
    });

    expect((await reconcile(store, allReplies, 5)).calls).toBe(2);
  });

  it('ignores a malformed stored value', async () => {
    const store = makeMemoryStore();
    store.loadUnreachableReplies.mockResolvedValue({
      count: 'one',
      expectedReplyCount: 5,
      recordedAt: now,
    } as never);

    expect((await reconcile(store, allReplies, 5)).calls).toBe(2);
  });

  it('records nothing from an empty drain', async () => {
    const store = makeMemoryStore();

    await reconcile(store, allReplies, 5, [{ chunk: [] }]);
    expect(store.recordUnreachableReplies).not.toHaveBeenCalled();
  });
});
