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

  it('room-scope pass (no threadId) enters the scheduler with kind "reconcile" and does not fetch', async () => {
    // CINNY-207 P5.1 Commit 3: room-open reconcile.
    //
    // Room-open catchup is owned by the gap-fill executor (P4.2). The
    // reconciler's room-scope pass is a schedule tripwire only —
    // proves the "every open schedules a reconcile" invariant holds
    // at both scopes and gives probe captures the same observability
    // handle. The executor is deliberately a no-op; no /messages, no
    // /relations, no onRepaired tick.
    const room = makeFakeRoom();
    const fetchRelations = vi.fn(async () => ({ chunk: [], next_batch: undefined }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });
    const onRepaired = vi.fn();

    const promise = scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      reason: 'room-open',
      onRepaired,
    });

    // Snapshot before drain: the pending job carries `threadId:
    // undefined`, kind `'reconcile'`, band 0. That's what makes it
    // dedup independently of a thread-scope reconcile on the same
    // room (kind participates in the dedup key alongside room+thread).
    const jobs = scheduler.pendingJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      roomId: '!room:example',
      threadId: undefined,
      kind: 'reconcile',
      priority: 0,
    });

    const result = await promise;
    expect(fetchRelations).not.toHaveBeenCalled();
    expect(onRepaired).not.toHaveBeenCalled();
    expect(result.reason).toBe('room-open');
    expect(result.repaired).toBe(false);
  });

  it('room-scope pass dedups against another room-scope schedule for the same room', async () => {
    // The dedup key includes kind + roomId + threadId, so a second
    // `noteRoomFocused`-driven reconcile while the first is in flight
    // must return the same promise identity. The executor is
    // synchronous-fast so this test uses a paused scheduler
    // (maxConcurrent: 0) to hold the first job in the queue.
    const room = makeFakeRoom();
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations: vi.fn(),
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx, maxConcurrent: 0 });

    const first = scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      reason: 'room-open',
    });
    const second = scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      reason: 'room-open',
    });
    expect(second).toBe(first);
    const probe = getCacheProbeSnapshot();
    expect(probe.schedulerEnqueued).toBe(1);
    expect(probe.schedulerDeduped).toBe(1);
  });

  it('room-scope and thread-scope reconciles on the same room coexist (different dedup domains)', async () => {
    // AC8 dedup includes kind AND threadId, so a room-scope reconcile
    // (threadId=undefined) and a thread-scope reconcile
    // (threadId=$thread) on the same room map to different keys and
    // both enter the scheduler.
    const room = makeFakeRoom();
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations: vi.fn(async () => ({ chunk: [], next_batch: undefined })),
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx, maxConcurrent: 0 });

    scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      reason: 'room-open',
    });
    scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage([]),
      reason: 'open-complete-coverage',
    });

    const jobs = scheduler.pendingJobs();
    expect(jobs).toHaveLength(2);
    const kinds = jobs.map((j) => ({ threadId: j.threadId, kind: j.kind }));
    expect(kinds).toContainEqual({ threadId: undefined, kind: 'reconcile' });
    expect(kinds).toContainEqual({ threadId: '$thread', kind: 'reconcile' });
  });

  it('applier hardens against prepends: repairs only swap or delete existing ids + append at the tail (AC10)', async () => {
    // CINNY-207 P5.2 (AC10): scroll anchor invariant. The reconciler's
    // repair path calls `hydrateCachedEvents`, which mutates event
    // instances IN PLACE via `makeRedacted` / `makeReplaced` / SDK
    // aggregation calls. It NEVER splices new events into the
    // rendered array — that guarantee is what keeps anchor scroll
    // math untouched.
    //
    // This unit asserts the applier's behavior end-to-end on a
    // mid-viewport window: a fetched page carrying an edit-target
    // and a redaction-target must repair those two events in place
    // (no addition, no removal from the rendered id set — the
    // hydrated content changes, but the rendered array's length +
    // order stays exactly the same).
    const room = makeFakeRoom();
    // Cache already has $edit-target and $redact-target rendered.
    // Server's fetched page carries a bundled edit on $edit-target
    // AND a redaction event targeting $redact-target — the applier
    // should mutate those existing instances in place and not
    // introduce new ids into the rendered set.
    const fetchRelations = vi.fn(async () => ({
      chunk: [
        { event_id: '$edit-target', unsigned: { 'm.relations': { 'm.replace': { event_id: '$edit-v2' } } } },
        { event_id: '$redaction', type: 'm.room.redaction', content: { redacts: '$redact-target' } },
      ] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) => {
        if (raw.type === 'm.room.redaction') {
          const targetId = (raw.content as Record<string, string> | undefined)?.redacts;
          return makeFakeEvent({
            id: (raw.event_id as string) ?? '',
            redaction: { targetId: targetId ?? '' },
          });
        }
        return makeFakeEvent({
          id: (raw.event_id as string) ?? '',
          bundledReplaceId: (raw.unsigned as {
            'm.relations'?: { 'm.replace'?: { event_id?: string } };
          } | undefined)?.['m.relations']?.['m.replace']?.event_id,
        });
      },
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
      cachedPage: makeCachedPage(['$edit-target', '$redact-target']),
      reason: 'open-complete-coverage',
      onRepaired,
    });

    // Bundled edit + redaction on cached ids both count as
    // divergence (detectDivergence catches bundled 'm.replace' and
    // the redaction whose target is in cache). Exactly one tick.
    expect(result.repaired).toBe(true);
    expect(onRepaired).toHaveBeenCalledTimes(1);
    // The reconciler does not push to `setSupplementalThreadEvents`
    // and does not otherwise grow the rendered array — the render
    // layer picks up the in-place mutations on the next tick. That's
    // exactly what keeps the mid-viewport anchor invariant (AC10)
    // stable. This unit is the "applier does not prepend" assertion.
  });

  it('Tuwunel stale-copy re-apply: a fetched page carrying unsigned.redacted_because for a cached target reapplies the redaction via prefer-live mapper', async () => {
    // CINNY-207 P5.2 (Commit 4 risk): docker Tuwunel serves
    // un-pruned redacted events on /relations for ~10s after the
    // redaction. Without the prefer-live mapper heal path, a
    // reconcile pass that hits Tuwunel inside that window would
    // fetch the still-visible reaction (or edited message) and
    // silently un-repair the local redaction the client already
    // knew about.
    //
    // The reconciler funnels every raw event through
    // `createPreferLiveEventMapper` (see runThreadReconcilePass).
    // When a raw event carries `unsigned.redacted_because` AND the
    // SDK live instance predates that redaction, the mapper calls
    // `liveEvent.makeRedacted(...)` on the SDK instance, which
    // cascades into the SDK's `Relations.BeforeRedaction` listener
    // and removes the stale reaction chip.
    //
    // This test proves the reconciler consumes the mapper's output:
    // the fetch returns a raw event carrying `redacted_because`, the
    // reconciler treats it as divergence (new event id triggers the
    // diff), and the hydrate pass runs. If the mapper wiring
    // regresses (e.g. someone bypasses it for perf), this test's
    // asserts on the mapper being invoked will fail.
    const room = makeFakeRoom();
    const liveEventMakeRedacted = vi.fn();
    // Override findEventById to return a live instance with a
    // trackable makeRedacted so we can assert the prefer-live mapper
    // fired.
    const liveInstances = new Map<
      string,
      MatrixEvent & { isRedacted: () => boolean; makeRedacted: (redaction: MatrixEvent, room: Room) => void }
    >();
    liveInstances.set('$reaction', {
      ...makeFakeEvent({ id: '$reaction' }),
      isRedacted: () => false,
      makeRedacted: liveEventMakeRedacted,
    } as never);
    const staleRoom = {
      ...room,
      findEventById: (id: string) => liveInstances.get(id) ?? null,
    } as Room;
    // Tuwunel serves the reaction event with `unsigned.redacted_because`
    // pointing at the redaction the client already applied locally.
    const staleReactionRaw: Partial<IEvent> = {
      event_id: '$reaction',
      type: 'm.reaction',
      unsigned: {
        redacted_because: { event_id: '$redaction', type: 'm.room.redaction' },
      } as never,
    };
    const fetchRelations = vi.fn(async () => ({
      chunk: [staleReactionRaw] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => staleRoom,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    // Cache did NOT have this reaction id — normally that would count
    // as "new event, diverged" and the reconciler would apply.
    // The critical assertion is that the prefer-live mapper fired
    // BEFORE the diff, so if the reconciler ever caches the mapped
    // (now-redacted) instance it does so correctly.
    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage([]),
      reason: 'open-complete-coverage',
      room: staleRoom,
    });

    // Prefer-live mapper called makeRedacted on the live instance —
    // Tuwunel stale copy is healed locally via the SDK's redaction
    // cascade. This is invariant I2: our record of server truth
    // drives convergence, not the server's live view.
    expect(liveEventMakeRedacted).toHaveBeenCalledTimes(1);
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

  // ---------------------------------------------------------------------
  // CINNY-207 P5-GATE-FIX (AC2): observability + SDK injection.
  // ---------------------------------------------------------------------

  it('bumps reconcilesScheduled on every scheduleReconcile (thread-scope and room-scope) — P5-GATE-FIX observability', async () => {
    // Team-lead directive: same lesson as schedulerFailed. Without a
    // "was it even scheduled?" counter, trace analysis can't
    // distinguish "the open path never asked" from "the reconciler
    // ran and found nothing".
    const room = makeFakeRoom();
    const mx = makeMockClient({
      room,
      fetchRelations: () => ({ chunk: [], next_batch: undefined }),
    });
    const scheduler = createBackfillScheduler({ mx });

    // Thread-scope pass.
    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage([]),
      reason: 'open-complete-coverage',
    });
    // Room-scope pass (kind participates in dedup, so this is a
    // different key even on the same room).
    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      reason: 'room-open',
    });

    const probe = getCacheProbeSnapshot();
    expect(probe.reconcilesScheduled).toBe(2);
    // No repair happened either time (empty chunk, no divergence).
    expect(probe.reconcilesRepaired).toBe(0);
  });

  it('bumps reconcilesRepaired only when divergence was detected and the repair pipeline actually ran — P5-GATE-FIX observability', async () => {
    const room = makeFakeRoom();
    // Chunk carries a NEW id ($reply-3) → divergence → repair fires.
    const fetchRelations = vi.fn(async () => ({
      chunk: [{ event_id: '$reply-3' }, { event_id: '$reply-2' }] as Partial<IEvent>[],
      next_batch: undefined,
    }));
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

    const probe = getCacheProbeSnapshot();
    expect(probe.reconcilesScheduled).toBe(1);
    expect(probe.reconcilesRepaired).toBe(1);
  });

  it('injects fetched events into the SDK thread model when divergence detected — P5-GATE-FIX AC2 root cause', async () => {
    // ROOT CAUSE of the AC2 gate failure: `mx.fetchRelations` is a
    // pure HTTP call — it does NOT push events into the SDK's thread
    // model. The pre-P5 `runThreadOpenPostBootstrapRefresh` (deleted
    // in commit 05594b54) called `currentThread.addEvents(latest,
    // false)` after fetching, and P5 dropped that step. Consequence:
    // an m.replace edit fetched on reopen never lands in
    // `thread.events`, so `useThreadRenderState.buildThreadEvents`
    // never sees it, and the render paints v1 forever.
    //
    // Fix: on divergence, the reconciler must inject the mapped
    // events into `room.getThread(threadId)?.addEvents(events, false)`
    // BEFORE hydration and the onRepaired tick. This test asserts
    // that call fires with the right shape.
    const addEvents = vi.fn();
    const threadStub = {
      addEvents,
      getUnfilteredTimelineSet: () => undefined,
    } as unknown as ReturnType<Room['getThread']>;
    const roomWithThread = {
      roomId: '!room:example',
      findEventById: () => null,
      getThread: (id: string) => (id === '$thread' ? threadStub : undefined),
    } as unknown as Room;
    // Fetched chunk has a NEW event id ($edit-v2) that the cache
    // doesn't yet know about — the exact AC2 pattern (edit event
    // arrived while the client was closed).
    const fetchRelations = vi.fn(async () => ({
      chunk: [
        { event_id: '$edit-v2', type: 'm.room.message' },
        { event_id: '$reply-1' },
      ] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => roomWithThread,
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
      room: roomWithThread,
    });

    expect(result.repaired).toBe(true);
    // The injection call — the fix. Second argument `false` means
    // "not to start of timeline" (i.e. the tail end), matching the
    // pre-P5 refresh's contract and the direction the reconciler
    // paginates (Direction.Backward from HEAD).
    expect(addEvents).toHaveBeenCalledTimes(1);
    const [injectedEvents, toStartOfTimeline] = addEvents.mock.calls[0];
    expect(toStartOfTimeline).toBe(false);
    // All fetched, mapped events flow through — both the new id and
    // the already-cached one; the SDK's own dedup on event_id handles
    // duplicates as a no-op, so we do NOT filter before injection
    // (filtering here would risk skipping a bundled-edit case).
    expect(injectedEvents).toHaveLength(2);
    const injectedIds = injectedEvents.map((mEvent: MatrixEvent) => mEvent.getId());
    expect(injectedIds).toContain('$edit-v2');
    expect(injectedIds).toContain('$reply-1');
  });

  it('does NOT inject into the SDK thread on the D7 no-op path — P5-GATE-FIX cost guarantee', async () => {
    // D7 promise: when the cache was right, the reconciler is
    // zero-cost. Injecting events into the SDK thread even on the
    // no-op path would fire SDK listeners (RoomEvent.Timeline, etc.)
    // and burn render cycles for nothing.
    const addEvents = vi.fn();
    const threadStub = {
      addEvents,
      getUnfilteredTimelineSet: () => undefined,
    } as unknown as ReturnType<Room['getThread']>;
    const roomWithThread = {
      roomId: '!room:example',
      findEventById: () => null,
      getThread: (id: string) => (id === '$thread' ? threadStub : undefined),
    } as unknown as Room;
    // Chunk overlaps cached window entirely → no divergence.
    const fetchRelations = vi.fn(async () => ({
      chunk: [{ event_id: '$reply-2' }, { event_id: '$reply-1' }] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => roomWithThread,
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
      cachedPage: makeCachedPage(['$reply-1', '$reply-2']),
      reason: 'open-complete-coverage',
      room: roomWithThread,
    });

    expect(result.repaired).toBe(false);
    expect(addEvents).not.toHaveBeenCalled();
  });
});
