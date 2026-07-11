/**
 * CINNY-207 P3.2: engineGapTracker + inMemoryGapFillScheduler.
 *
 * Covers: TimelineReset on the room's UNFILTERED timelineSet →
 * mark + enqueue limited-sync job; TimelineReset on a thread
 * timelineSet → ignored (not a gap event); Sync→PREPARED → one
 * startup job per joined room; dedup + priority (limited-sync
 * beats startup); left rooms excluded; probe counter increments.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Direction, type EventTimelineSet, type MatrixClient, type Room } from 'matrix-js-sdk';
import { createEngineGapTracker, createInMemoryGapFillScheduler } from '../engineGapTracker';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../threads/cacheProbe';

const makeRoom = ({
  roomId,
  membership = 'join',
  paginationToken = null,
  unfiltered,
}: {
  roomId: string;
  membership?: string;
  paginationToken?: string | null;
  unfiltered?: EventTimelineSet;
}): Room => {
  const timelineSet =
    unfiltered ?? ({ __id: `${roomId}:unfiltered` } as unknown as EventTimelineSet);
  return {
    roomId,
    getMyMembership: () => membership,
    getLiveTimeline: () =>
      ({
        getPaginationToken: (dir: Direction) =>
          dir === Direction.Backward ? paginationToken : null,
      } as never),
    getUnfilteredTimelineSet: () => timelineSet,
  } as unknown as Room;
};

describe('createInMemoryGapFillScheduler (CINNY-207 P3.2)', () => {
  beforeEach(() => resetCacheProbe());
  afterEach(() => resetCacheProbe());

  it('enqueues a job and exposes it via pendingJobs()', () => {
    const scheduler = createInMemoryGapFillScheduler();
    scheduler.enqueueGapFill({ roomId: '!a', reason: 'startup', markedAt: 1 });
    expect(scheduler.pendingJobs()).toHaveLength(1);
    expect(scheduler.pendingJobs()[0].roomId).toBe('!a');
    expect(getCacheProbeSnapshot().gapFillsEnqueued).toBe(1);
  });

  it('dedupes by roomId (later enqueue replaces earlier)', () => {
    const scheduler = createInMemoryGapFillScheduler();
    scheduler.enqueueGapFill({ roomId: '!a', reason: 'startup', markedAt: 1 });
    scheduler.enqueueGapFill({
      roomId: '!a',
      reason: 'limited-sync',
      markedAt: 2,
      prevBatch: 'tok',
    });
    expect(scheduler.pendingJobs()).toHaveLength(1);
    expect(scheduler.pendingJobs()[0].reason).toBe('limited-sync');
    expect(scheduler.pendingJobs()[0].prevBatch).toBe('tok');
  });

  it('does not downgrade limited-sync to startup', () => {
    const scheduler = createInMemoryGapFillScheduler();
    scheduler.enqueueGapFill({
      roomId: '!a',
      reason: 'limited-sync',
      markedAt: 2,
      prevBatch: 'tok',
    });
    scheduler.enqueueGapFill({ roomId: '!a', reason: 'startup', markedAt: 3 });
    expect(scheduler.pendingJobs()[0].reason).toBe('limited-sync');
  });
});

describe('createEngineGapTracker (CINNY-207 P3.2)', () => {
  const defaultMarkDiscontinuity = async (
    _sessionId: string,
    _roomId: string,
    marker: { markedAt: number; prevBatch?: string | null; generation?: string }
  ) => marker;
  const markDiscontinuity = vi.fn(defaultMarkDiscontinuity);
  const loadCachedTail = vi.fn(async () => ({ events: [], hasMoreBefore: false }));

  beforeEach(() => {
    resetCacheProbe();
    markDiscontinuity.mockReset();
    markDiscontinuity.mockImplementation(defaultMarkDiscontinuity);
    loadCachedTail.mockReset();
    loadCachedTail.mockResolvedValue({ events: [], hasMoreBefore: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetCacheProbe();
  });

  it('marks the room and enqueues a limited-sync job on TimelineReset for the unfiltered timelineSet', async () => {
    const scheduler = createInMemoryGapFillScheduler();
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    loadCachedTail.mockResolvedValueOnce({
      events: [{ event_id: '$pre-gap-tail', origin_server_ts: 1 }],
      hasMoreBefore: false,
    });
    const tracker = createEngineGapTracker({
      mx: {} as unknown as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadCachedTail,
      now: () => 1000,
    });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet(), false);
    await vi.waitFor(() => expect(markDiscontinuity).toHaveBeenCalledTimes(1));
    await markDiscontinuity.mock.results[0].value;
    await Promise.resolve();

    expect(markDiscontinuity).toHaveBeenCalledWith('session', '!a', {
      markedAt: 1000,
      prevBatch: 'batch-1',
      generation: '1000:batch-1',
      nextToken: 'batch-1',
      overlapEventIds: ['$pre-gap-tail'],
    });
    expect(scheduler.pendingJobs()).toEqual([
      {
        roomId: '!a',
        reason: 'limited-sync',
        markedAt: 1000,
        prevBatch: 'batch-1',
        generation: '1000:batch-1',
      },
    ]);
    expect(getCacheProbeSnapshot().gapFillsEnqueued).toBe(1);
  });

  it('ignores TimelineReset on non-unfiltered timelineSets (thread resets are not gap events)', () => {
    const scheduler = createInMemoryGapFillScheduler();
    const room = makeRoom({ roomId: '!a' });
    const tracker = createEngineGapTracker({
      mx: {} as unknown as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      onPersistenceError: vi.fn(),
    });

    const differentSet = { __id: 'thread-set' } as unknown as EventTimelineSet;
    tracker.handleTimelineReset(room, differentSet, false);

    expect(markDiscontinuity).not.toHaveBeenCalled();
    expect(scheduler.pendingJobs()).toHaveLength(0);
  });

  it('ignores TimelineReset with a missing room or timelineSet (defensive)', () => {
    const scheduler = createInMemoryGapFillScheduler();
    const tracker = createEngineGapTracker({
      mx: {} as unknown as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
    });

    tracker.handleTimelineReset(undefined, undefined, false);
    tracker.handleTimelineReset(makeRoom({ roomId: '!a' }), undefined, false);
    tracker.handleTimelineReset(
      undefined,
      { __id: 'anything' } as unknown as EventTimelineSet,
      false
    );

    expect(scheduler.pendingJobs()).toHaveLength(0);
  });

  it('enqueues startup jobs only for joined rooms with durable markers', async () => {
    const scheduler = createInMemoryGapFillScheduler();
    const joinedA = makeRoom({ roomId: '!join-a', paginationToken: 'ta' });
    const joinedB = makeRoom({ roomId: '!join-b', paginationToken: null });
    const leftC = makeRoom({ roomId: '!left-c', membership: 'leave', paginationToken: 'tc' });
    const invitedD = makeRoom({ roomId: '!invited-d', membership: 'invite' });

    const mx = {
      getRooms: () => [joinedA, joinedB, leftC, invitedD],
    } as unknown as MatrixClient;

    const tracker = createEngineGapTracker({
      mx,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadDiscontinuity: async (_sessionId, roomId) => {
        if (roomId === '!join-a') {
          return {
            markedAt: 1000,
            prevBatch: 'ta',
            nextToken: 'ta-checkpoint',
            generation: 'gap-a',
          };
        }
        return undefined;
      },
    });

    await tracker.handleSyncPrepared();

    const jobs = scheduler.pendingJobs();
    expect(jobs).toEqual([
      {
        roomId: '!join-a',
        reason: 'startup',
        markedAt: 1000,
        prevBatch: 'ta-checkpoint',
        generation: 'gap-a',
      },
    ]);
    expect(getCacheProbeSnapshot().gapFillsEnqueued).toBe(1);
  });

  it('a limited-sync job that arrives after a startup job wins the dedup', async () => {
    const scheduler = createInMemoryGapFillScheduler();
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const mx = { getRooms: () => [room] } as unknown as MatrixClient;
    const tracker = createEngineGapTracker({
      mx,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadCachedTail,
      loadDiscontinuity: async () => ({
        markedAt: 2000,
        prevBatch: 'old-batch',
      }),
      now: () => 3000,
    });

    await tracker.handleSyncPrepared();
    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet(), false);
    await vi.waitFor(() => expect(markDiscontinuity).toHaveBeenCalledTimes(1));
    await markDiscontinuity.mock.results[0].value;
    await Promise.resolve();

    const jobs = scheduler.pendingJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].reason).toBe('limited-sync');
    expect(jobs[0].prevBatch).toBe('batch-1');
  });

  it('handleSyncPrepared is a no-op when no MatrixClient is present (safety valve)', async () => {
    const scheduler = createInMemoryGapFillScheduler();
    const tracker = createEngineGapTracker({
      // @ts-expect-error deliberately omit for the safety test
      mx: undefined,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
    });
    await tracker.handleSyncPrepared();
    expect(scheduler.pendingJobs()).toHaveLength(0);
  });

  it('retains and retries a limited-sync job until its marker is durable', async () => {
    vi.useFakeTimers();
    const scheduler = createInMemoryGapFillScheduler();
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const onPersistenceError = vi.fn();
    markDiscontinuity
      .mockRejectedValueOnce(new Error('blocked cache'))
      .mockImplementationOnce(async (_sessionId, _roomId, marker) => marker);
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadCachedTail,
      onPersistenceError,
      now: () => 1000,
    });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet());
    await vi.waitFor(() => expect(onPersistenceError).toHaveBeenCalledTimes(1));
    expect(scheduler.pendingJobs()).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(scheduler.pendingJobs()).toEqual([
      {
        roomId: '!a',
        reason: 'limited-sync',
        markedAt: 1000,
        prevBatch: 'batch-1',
        generation: '1000:batch-1',
      },
    ]);
    tracker.stop();
  });

  it('cancels an undurable marker retry when the tracker stops', async () => {
    vi.useFakeTimers();
    const scheduler = createInMemoryGapFillScheduler();
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const onPersistenceError = vi.fn();
    markDiscontinuity.mockRejectedValue(new Error('blocked cache'));
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadCachedTail,
      onPersistenceError,
    });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet());
    await vi.waitFor(() => expect(onPersistenceError).toHaveBeenCalledTimes(1));
    tracker.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(markDiscontinuity).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingJobs()).toEqual([]);
  });

  it('does not enqueue a stale marker after a newer reset supersedes it', async () => {
    const scheduler = createInMemoryGapFillScheduler();
    const firstRoom = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const secondRoom = makeRoom({ roomId: '!a', paginationToken: 'batch-2' });
    let resolveFirst:
      | ((marker: { markedAt: number; prevBatch?: string | null }) => void)
      | undefined;
    markDiscontinuity
      .mockImplementationOnce(
        async () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(defaultMarkDiscontinuity);
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadCachedTail,
      now,
    });

    tracker.handleTimelineReset(firstRoom, firstRoom.getUnfilteredTimelineSet());
    await vi.waitFor(() => expect(markDiscontinuity).toHaveBeenCalledTimes(1));
    tracker.handleTimelineReset(secondRoom, secondRoom.getUnfilteredTimelineSet());
    resolveFirst?.({ markedAt: 1000, prevBatch: 'batch-1' });
    await vi.waitFor(() => {
      expect(scheduler.pendingJobs()).toEqual([
        {
          roomId: '!a',
          reason: 'limited-sync',
          markedAt: 2000,
          prevBatch: 'batch-2',
          generation: '2000:batch-2',
        },
      ]);
    });
    tracker.stop();
  });

  it('shares the pre-gap boundary when a newer reset supersedes a pending mark', async () => {
    const scheduler = createInMemoryGapFillScheduler();
    const firstRoom = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const secondRoom = makeRoom({ roomId: '!a', paginationToken: 'batch-2' });
    let resolveBoundary:
      | ((page: {
          events: { event_id: string; origin_server_ts: number }[];
          hasMoreBefore: boolean;
        }) => void)
      | undefined;
    loadCachedTail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBoundary = resolve;
        })
    );
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadCachedTail,
      now,
    });

    tracker.handleTimelineReset(firstRoom, firstRoom.getUnfilteredTimelineSet());
    tracker.handleTimelineReset(secondRoom, secondRoom.getUnfilteredTimelineSet());

    expect(loadCachedTail).toHaveBeenCalledTimes(1);
    resolveBoundary?.({
      events: [{ event_id: '$pre-gap-tail', origin_server_ts: 1 }],
      hasMoreBefore: false,
    });

    await vi.waitFor(() => {
      expect(markDiscontinuity).toHaveBeenCalledTimes(1);
      expect(markDiscontinuity).toHaveBeenCalledWith('session', '!a', {
        markedAt: 2000,
        prevBatch: 'batch-2',
        generation: '2000:batch-2',
        nextToken: 'batch-2',
        overlapEventIds: ['$pre-gap-tail'],
      });
    });
    expect(scheduler.pendingJobs()).toEqual([
      {
        roomId: '!a',
        reason: 'limited-sync',
        markedAt: 2000,
        prevBatch: 'batch-2',
        generation: '2000:batch-2',
      },
    ]);
    tracker.stop();
  });
});
