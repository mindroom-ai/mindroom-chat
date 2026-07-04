/**
 * CINNY-207 P5.1 reconciler unit tests.
 *
 * Two guarantees under test:
 *
 *   AC9 — coverage gates PAINT, never REVALIDATE. A reconcile
 *         scheduled with `reason: 'open-complete-coverage'` still
 *         performs the network verify (mocked fetchRelations invoked).
 *
 *   D7 no-op — when the fetched page's event ids are entirely already
 *              present in the cached window, `onRepaired` is NEVER
 *              called and no persist happens. That guarantee is what
 *              makes "cached was right" cost zero UI flicker.
 *
 * Plus the invariants that ride on the scheduler:
 *   - Enters the scheduler with kind `'reconcile'` and band 0.
 *   - Dedup: a second schedule for the same key while the first is
 *     in-flight returns the in-flight promise identity (AC9 wording:
 *     "coalescing returns the in-flight promise").
 *   - Paging past the pre-P5 200-event ceiling (F7): the reconciler
 *     keeps requesting until the fetched chunk overlaps the cached
 *     window by event id.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IEvent, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { createBackfillScheduler } from '../backfillScheduler';
import { scheduleReconcile } from '../reconciler';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../threads/cacheProbe';
import type { HydratedThreadCachePage } from '../../threads/threadOpenCacheController';

// ---------------------------------------------------------------------------
// Minimal fixtures — a MatrixEvent-shaped stub the reconciler can consume via
// its narrow surface (getId, isRedaction, getAssociatedId, event.unsigned).
// A real matrix-js-sdk MatrixEvent is not needed for these units.
// ---------------------------------------------------------------------------

type FakeEventInit = {
  id: string;
  redaction?: { targetId: string };
  bundledReplaceId?: string;
};

const makeFakeEvent = ({ id, redaction, bundledReplaceId }: FakeEventInit): MatrixEvent => {
  const raw: Partial<IEvent> = {
    event_id: id,
    type: redaction ? 'm.room.redaction' : 'm.room.message',
    origin_server_ts: 0,
    unsigned: bundledReplaceId
      ? { 'm.relations': { 'm.replace': { event_id: bundledReplaceId } } as never }
      : undefined,
    content: {},
  };
  return {
    getId: () => id,
    getType: () => raw.type,
    getTs: () => 0,
    isRedaction: () => !!redaction,
    isRedacted: () => false,
    getAssociatedId: () => redaction?.targetId,
    getRelation: () => null,
    getUnsigned: () => raw.unsigned ?? {},
    makeRedacted: () => undefined,
    makeReplaced: () => undefined,
    replacingEvent: () => null,
    getSender: () => '@bob:example',
    event: raw,
  } as unknown as MatrixEvent;
};

const makeCachedPage = (ids: string[]): HydratedThreadCachePage =>
  ({
    beforeToken: null,
    cacheCoverage: {} as never,
    events: ids.map((id) => ({ event_id: id })) as Partial<IEvent>[],
    hasMoreBefore: false,
    relationSnapshotComplete: true,
    rootEvent: undefined,
    snapshotComplete: true,
    tailLoaded: true,
  } as HydratedThreadCachePage);

type FetchRelationsCall = {
  from?: string;
};

const makeMockClient = ({
  fetchRelations,
  room,
}: {
  fetchRelations: (call: FetchRelationsCall) => {
    chunk: Array<Partial<IEvent>>;
    next_batch?: string;
  };
  room: Room;
}): MatrixClient => {
  const identity = (rawEvent: Partial<IEvent>): MatrixEvent =>
    makeFakeEvent({ id: (rawEvent.event_id as string) ?? '', ...(rawEvent.type === 'm.room.redaction' ? { redaction: { targetId: (rawEvent.content as Record<string, string> | undefined)?.redacts ?? '' } } : {}) });
  return {
    getRoom: () => room,
    // Test mapper: returns a MatrixEvent-shaped stub. The prefer-live
    // mapper wraps this internally — for these unit tests we don't
    // stress the stale-copy heal path (that's Commit 4's dedicated
    // Tuwunel stale-copy test).
    getEventMapper: () => identity,
    fetchRelations: vi.fn(async (_roomId, _threadId, _relationType, _eventType, opts) => {
      return fetchRelations({ from: opts?.from as string | undefined });
    }),
  } as unknown as MatrixClient;
};

const makeFakeRoom = (): Room =>
  ({
    roomId: '!room:example',
    findEventById: () => null,
    getThread: () => undefined,
  } as unknown as Room);

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduleReconcile (CINNY-207 P5.1)', () => {
  beforeEach(() => {
    resetCacheProbe();
  });
  afterEach(() => {
    resetCacheProbe();
  });

  it('enters the scheduler with kind "reconcile" at band 0 (AC8 dedup domain)', async () => {
    const room = makeFakeRoom();
    const mx = makeMockClient({
      room,
      fetchRelations: () => ({ chunk: [], next_batch: undefined }),
    });
    const scheduler = createBackfillScheduler({ mx });

    const result = scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage([]),
      reason: 'open-complete-coverage',
    });

    // Snapshot the pending queue before it drains — the pending job's
    // kind + priority is what AC8 uses for its dedup key. `band 0` is
    // the D7 policy: reconciles the user is looking at right now.
    const jobs = scheduler.pendingJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      roomId: '!room:example',
      threadId: '$thread',
      kind: 'reconcile',
      priority: 0,
    });

    await result;
  });

  it('coverage-complete still performs the network verify (AC9)', async () => {
    // Coverage-complete request must not short-circuit — the reconciler
    // is scheduled unconditionally on every open, per D7. This test
    // proves the fetchRelations call actually fires even when the
    // caller flagged the cache as complete.
    const room = makeFakeRoom();
    const fetchRelations = vi.fn(async () => ({ chunk: [], next_batch: undefined }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1', '$reply-2']),
      reason: 'open-complete-coverage',
    });

    expect(fetchRelations).toHaveBeenCalledTimes(1);
  });

  it('deduplicates: a second schedule for the same key while the first is in-flight returns the in-flight promise identity', async () => {
    // AC9 explicit wording: SCHEDULING is unconditional; COALESCING
    // returns the in-flight promise. This is what makes "user opens
    // thread + browser refocuses + engine noteRoomFocused" all safe
    // to call — only one /relations round-trip fires.
    const room = makeFakeRoom();
    let resolveFetch: (value: { chunk: Array<Partial<IEvent>> }) => void = () => undefined;
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations: vi.fn(
        () =>
          new Promise<{ chunk: Array<Partial<IEvent>> }>((resolve) => {
            resolveFetch = resolve;
          })
      ),
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    const first = scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage([]),
      reason: 'open-complete-coverage',
    });
    await flushMicrotasks();

    const second = scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage([]),
      reason: 'resume',
    });
    expect(second).toBe(first);

    // Only one probe increment for enqueue; one for dedup.
    const probe = getCacheProbeSnapshot();
    expect(probe.schedulerEnqueued).toBe(1);
    expect(probe.schedulerDeduped).toBe(1);

    resolveFetch({ chunk: [] });
    await first;
  });

  it('empty diff is a no-op (D7): no onRepaired tick when fetched page overlaps cache', async () => {
    // The core "cached was right" guarantee: server returns event ids
    // the client already has → no persist, no tick, no flicker.
    const room = makeFakeRoom();
    const fetchRelations = vi.fn(async () => ({
      // Chunk is newest-first in the SDK's response shape; the
      // reconciler reverses it before diffing.
      chunk: [{ event_id: '$reply-2' }, { event_id: '$reply-1' }] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });
    const onRepaired = vi.fn();

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1', '$reply-2']),
      reason: 'open-complete-coverage',
      onRepaired,
    });

    expect(fetchRelations).toHaveBeenCalledTimes(1);
    expect(onRepaired).not.toHaveBeenCalled();
    expect(result.repaired).toBe(false);
    expect(result.fetchedCount).toBe(2);
  });

  it('detects a new event id (missed message) and fires onRepaired exactly once', async () => {
    const room = makeFakeRoom();
    const fetchRelations = vi.fn(async () => ({
      chunk: [{ event_id: '$reply-3-new' }, { event_id: '$reply-2' }] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });
    const onRepaired = vi.fn();

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1', '$reply-2']),
      reason: 'open-complete-coverage',
      onRepaired,
    });

    expect(result.repaired).toBe(true);
    // One tick per pass, regardless of how many things needed
    // repairing. Batching is the D7 promise.
    expect(onRepaired).toHaveBeenCalledTimes(1);
  });

  it('pages further past 200 (F7) until the fetched chunk overlaps the cached window', async () => {
    // The pre-P5 tail refresh capped at one limit-200 batch, so a
    // divergence deeper than 200 events never converged. The
    // reconciler pages further; overlap by event id is the stop
    // condition. This test proves the second page happens when the
    // first doesn't overlap.
    const room = makeFakeRoom();
    let iteration = 0;
    const fetchRelations = vi.fn(async () => {
      iteration += 1;
      if (iteration === 1) {
        return {
          chunk: [{ event_id: '$far-3' }, { event_id: '$far-2' }, { event_id: '$far-1' }] as Partial<IEvent>[],
          next_batch: 'page-2',
        };
      }
      // Second page: overlap with cached window ($reply-1) → stop.
      return {
        chunk: [{ event_id: '$mid' }, { event_id: '$reply-1' }] as Partial<IEvent>[],
        next_batch: undefined,
      };
    });
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1']),
      reason: 'open-complete-coverage',
    });

    expect(fetchRelations).toHaveBeenCalledTimes(2);
    expect(result.iterations).toBe(2);
    expect(result.fetchedCount).toBe(5);
  });
});
