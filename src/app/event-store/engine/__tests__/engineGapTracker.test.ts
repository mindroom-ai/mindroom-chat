/**
 * ISSUE-207 P3.2: engineGapTracker.
 *
 * Covers: TimelineReset on the room's UNFILTERED timelineSet →
 * mark + dispatch limited-sync job; TimelineReset on a thread
 * timelineSet → ignored (not a gap event); Sync→PREPARED → startup
 * jobs only for rooms with durable markers; left rooms excluded;
 * probe counter increments. Jobs go straight to the executor's
 * `enqueue`; per-room coalescing lives in the executor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Direction, type EventTimelineSet, type MatrixClient, type Room } from 'matrix-js-sdk';
import { createEngineGapTracker, type GapFillJob } from '../engineGapTracker';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../cache/cacheProbe';
import { loadRoomCacheGap, revokeCacheStoreWrites, type CachedRoomEventPage } from '../../cache/db';

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
      }) as never,
    getUnfilteredTimelineSet: () => timelineSet,
  } as unknown as Room;
};

describe('createEngineGapTracker (ISSUE-207 P3.2)', () => {
  const defaultMarkDiscontinuity = async (
    _sessionId: string,
    _roomId: string,
    marker: { markedAt: number; prevBatch?: string | null; generation?: string }
  ) => marker;
  const markDiscontinuity = vi.fn(defaultMarkDiscontinuity);
  const loadCachedTail = vi.fn(async (): Promise<CachedRoomEventPage> => ({
    events: [],
    hasMoreBefore: false,
  }));

  beforeEach(() => {
    resetCacheProbe();
    markDiscontinuity.mockReset();
    markDiscontinuity.mockImplementation(defaultMarkDiscontinuity);
    loadCachedTail.mockReset();
    loadCachedTail.mockResolvedValue({ events: [], hasMoreBefore: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetCacheProbe();
  });

  it('marks the room and enqueues a limited-sync job on TimelineReset for the unfiltered timelineSet', async () => {
    const enqueued: GapFillJob[] = [];
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    loadCachedTail.mockResolvedValueOnce({
      events: [{ event_id: '$pre-gap-tail', origin_server_ts: 1 }],
      hasMoreBefore: false,
    });
    const tracker = createEngineGapTracker({
      mx: {} as unknown as MatrixClient,
      sessionId: 'session',
      enqueueGapFill: (job) => enqueued.push(job),
      markDiscontinuity,
      loadCachedTail,
      now: () => 1000,
    });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet(), false);
    await vi.waitFor(() => expect(markDiscontinuity).toHaveBeenCalledTimes(1));
    await markDiscontinuity.mock.results[0]!.value;
    await Promise.resolve();

    expect(markDiscontinuity).toHaveBeenCalledWith('session', '!a', {
      markedAt: 1000,
      prevBatch: 'batch-1',
      generation: '1000:batch-1',
      nextToken: 'batch-1',
      overlapEventIds: ['$pre-gap-tail'],
    });
    expect(enqueued).toEqual([
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

  it('does not commit a failed pre-gap tail read as an empty boundary', async () => {
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    loadCachedTail.mockRejectedValueOnce(new Error('read failed'));
    const tracker = createEngineGapTracker({
      mx: {} as unknown as MatrixClient,
      sessionId: 'session',
      enqueueGapFill: () => undefined,
      markDiscontinuity,
      loadCachedTail,
      now: () => 1000,
    });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet(), false);
    await vi.waitFor(() => expect(markDiscontinuity).toHaveBeenCalledTimes(1));

    // [] durably means "no cached boundary existed"; a failed read must leave
    // the boundary unset so the executor takes its own guarded snapshot.
    expect(markDiscontinuity).toHaveBeenCalledWith('session', '!a', {
      markedAt: 1000,
      prevBatch: 'batch-1',
      generation: '1000:batch-1',
      nextToken: 'batch-1',
      overlapEventIds: undefined,
    });
  });

  it('ignores TimelineReset on non-unfiltered timelineSets (thread resets are not gap events)', () => {
    const enqueued: GapFillJob[] = [];
    const room = makeRoom({ roomId: '!a' });
    const tracker = createEngineGapTracker({
      mx: {} as unknown as MatrixClient,
      sessionId: 'session',
      enqueueGapFill: (job) => enqueued.push(job),
      markDiscontinuity,
    });

    const differentSet = { __id: 'thread-set' } as unknown as EventTimelineSet;
    tracker.handleTimelineReset(room, differentSet, false);

    expect(markDiscontinuity).not.toHaveBeenCalled();
    expect(enqueued).toHaveLength(0);
  });

  it('ignores TimelineReset with a missing room or timelineSet (defensive)', () => {
    const enqueued: GapFillJob[] = [];
    const tracker = createEngineGapTracker({
      mx: {} as unknown as MatrixClient,
      sessionId: 'session',
      enqueueGapFill: (job) => enqueued.push(job),
      markDiscontinuity,
    });

    tracker.handleTimelineReset(undefined, undefined, false);
    tracker.handleTimelineReset(makeRoom({ roomId: '!a' }), undefined, false);
    tracker.handleTimelineReset(
      undefined,
      { __id: 'anything' } as unknown as EventTimelineSet,
      false
    );

    expect(enqueued).toHaveLength(0);
  });

  it('enqueues startup jobs only for joined rooms with durable markers', async () => {
    const enqueued: GapFillJob[] = [];
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
      enqueueGapFill: (job) => enqueued.push(job),
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

    expect(enqueued).toEqual([
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

  it('a limited-sync reset after a startup resume dispatches a newer job for the executor to coalesce', async () => {
    const enqueued: GapFillJob[] = [];
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const mx = { getRooms: () => [room] } as unknown as MatrixClient;
    const tracker = createEngineGapTracker({
      mx,
      sessionId: 'session',
      enqueueGapFill: (job) => enqueued.push(job),
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
    await markDiscontinuity.mock.results[0]!.value;
    await Promise.resolve();

    // Both jobs dispatch; the executor keeps the one with the newest
    // markedAt, so the later reset supersedes the startup resume.
    expect(enqueued.map((job) => job.reason)).toEqual(['startup', 'limited-sync']);
    expect(enqueued[1]!.prevBatch).toBe('batch-1');
    expect(enqueued[1]!.markedAt).toBeGreaterThan(enqueued[0]!.markedAt);
  });

  it('retains and retries a limited-sync job until its marker is durable', async () => {
    vi.useFakeTimers();
    const enqueued: GapFillJob[] = [];
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    markDiscontinuity
      .mockRejectedValueOnce(new Error('blocked cache'))
      .mockImplementationOnce(async (_sessionId, _roomId, marker) => marker);
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'session',
      enqueueGapFill: (job) => enqueued.push(job),
      markDiscontinuity,
      loadCachedTail,
      now: () => 1000,
    });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet());
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
    expect(enqueued).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(enqueued).toEqual([
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

  it('keeps cache readers off the gap from the reset until its marker is durable', async () => {
    const noMarker = async () => undefined;
    let commit: (() => void) | undefined;
    markDiscontinuity.mockImplementationOnce(
      (_sessionId, _roomId, marker) =>
        new Promise((resolve) => {
          commit = () => resolve(marker);
        })
    );
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'held-session',
      enqueueGapFill: () => undefined,
      markDiscontinuity,
      loadCachedTail,
      now: () => 1000,
    });
    const room = makeRoom({ roomId: '!held', paginationToken: 'batch-1' });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet());
    expect(await loadRoomCacheGap('held-session', '!held', noMarker)).toBeDefined();
    await vi.waitFor(() => expect(commit).toBeDefined());
    expect(await loadRoomCacheGap('held-session', '!held', noMarker)).toBeDefined();

    commit?.();
    await vi.waitFor(async () =>
      expect(await loadRoomCacheGap('held-session', '!held', noMarker)).toBeUndefined()
    );
    tracker.stop();
  });

  it('lets go of an unsaved gap when the tracker stops', async () => {
    const noMarker = async () => undefined;
    markDiscontinuity.mockImplementationOnce(() => new Promise(() => undefined));
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'stopped-session',
      enqueueGapFill: () => undefined,
      markDiscontinuity,
      loadCachedTail,
    });
    const room = makeRoom({ roomId: '!stopped', paginationToken: 'batch-1' });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet());
    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet());
    expect(await loadRoomCacheGap('stopped-session', '!stopped', noMarker)).toBeDefined();
    tracker.stop();
    expect(await loadRoomCacheGap('stopped-session', '!stopped', noMarker)).toBeUndefined();
  });

  it('lets go of an unsaved gap whose room cache was cleared meanwhile', async () => {
    const noMarker = async () => undefined;
    let readTail: ((page: { events: never[]; hasMoreBefore: boolean }) => void) | undefined;
    loadCachedTail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          readTail = resolve;
        })
    );
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'cleared-session',
      enqueueGapFill: () => undefined,
      markDiscontinuity,
      loadCachedTail,
    });
    const room = makeRoom({ roomId: '!cleared', paginationToken: 'batch-1' });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet());
    expect(await loadRoomCacheGap('cleared-session', '!cleared', noMarker)).toBeDefined();
    revokeCacheStoreWrites('cleared-session');
    readTail?.({ events: [], hasMoreBefore: false });

    await vi.waitFor(async () =>
      expect(await loadRoomCacheGap('cleared-session', '!cleared', noMarker)).toBeUndefined()
    );
    expect(markDiscontinuity).not.toHaveBeenCalled();
    tracker.stop();
  });

  it('cancels an undurable marker retry when the tracker stops', async () => {
    vi.useFakeTimers();
    const enqueued: GapFillJob[] = [];
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    markDiscontinuity.mockRejectedValue(new Error('blocked cache'));
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'session',
      enqueueGapFill: (job) => enqueued.push(job),
      markDiscontinuity,
      loadCachedTail,
    });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet());
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
    tracker.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(markDiscontinuity).toHaveBeenCalledTimes(1);
    expect(enqueued).toEqual([]);
  });

  it('does not enqueue a stale marker after a newer reset supersedes it', async () => {
    const enqueued: GapFillJob[] = [];
    const firstRoom = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const secondRoom = makeRoom({ roomId: '!a', paginationToken: 'batch-2' });
    let resolveFirst:
      ((marker: { markedAt: number; prevBatch?: string | null }) => void) | undefined;
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
      enqueueGapFill: (job) => enqueued.push(job),
      markDiscontinuity,
      loadCachedTail,
      now,
    });

    tracker.handleTimelineReset(firstRoom, firstRoom.getUnfilteredTimelineSet());
    await vi.waitFor(() => expect(markDiscontinuity).toHaveBeenCalledTimes(1));
    tracker.handleTimelineReset(secondRoom, secondRoom.getUnfilteredTimelineSet());
    resolveFirst?.({ markedAt: 1000, prevBatch: 'batch-1' });
    await vi.waitFor(() => {
      expect(enqueued).toEqual([
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
    const enqueued: GapFillJob[] = [];
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
      enqueueGapFill: (job) => enqueued.push(job),
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
    expect(enqueued).toEqual([
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

  it('loads startup discontinuity markers with one bulk read for joined rooms only', async () => {
    const enqueued: GapFillJob[] = [];
    const loadAllDiscontinuities = vi.fn().mockResolvedValue(
      new Map([
        ['!join-a', { markedAt: 1000, prevBatch: 'ta', generation: 'g-a' }],
        ['!left-c', { markedAt: 1500, prevBatch: 'tc', generation: 'g-c' }],
        ['!unknown', { markedAt: 1600, prevBatch: 'tu', generation: 'g-u' }],
      ])
    );
    const tracker = createEngineGapTracker({
      mx: {
        getRooms: () => [
          makeRoom({ roomId: '!join-a', membership: 'join' }),
          makeRoom({ roomId: '!join-b', membership: 'join' }),
          makeRoom({ roomId: '!left-c', membership: 'leave' }),
        ],
      } as unknown as MatrixClient,
      sessionId: 'session',
      enqueueGapFill: (job) => enqueued.push(job),
      loadAllDiscontinuities,
    });

    await tracker.handleSyncPrepared();

    expect(loadAllDiscontinuities).toHaveBeenCalledTimes(1);
    expect(loadAllDiscontinuities).toHaveBeenCalledWith('session');
    expect(enqueued).toEqual([
      {
        roomId: '!join-a',
        reason: 'startup',
        markedAt: 1000,
        prevBatch: 'ta',
        generation: 'g-a',
      },
    ]);
  });

  it('serializes multi-room resets, prioritizes awaited overlap, and does not stall on retries', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const enqueued: GapFillJob[] = [];
    const tailOrder: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseFirstMark: (() => void) | undefined;
    let rejectFirstMark: ((error: Error) => void) | undefined;

    const serialLoadCachedTail = vi.fn(
      async (_sessionId: string, roomId: string): Promise<CachedRoomEventPage> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        tailOrder.push(roomId);
        await Promise.resolve();
        inFlight -= 1;
        return {
          events: [{ event_id: `$tail-${roomId}`, origin_server_ts: 1 }],
          hasMoreBefore: false,
        };
      }
    );
    markDiscontinuity
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            releaseFirstMark = () => resolve({ markedAt: 1000, prevBatch: 'b1' });
            rejectFirstMark = reject;
          })
      )
      .mockImplementation(defaultMarkDiscontinuity);

    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'serial-session',
      enqueueGapFill: (job) => enqueued.push(job),
      markDiscontinuity,
      loadCachedTail: serialLoadCachedTail,
      now: () => 1000,
    });

    const r1 = makeRoom({ roomId: '!r1', paginationToken: 'b1' });
    const r2 = makeRoom({ roomId: '!r2', paginationToken: 'b2' });
    const r3 = makeRoom({ roomId: '!r3', paginationToken: 'b3' });
    tracker.handleTimelineReset(r1, r1.getUnfilteredTimelineSet());
    tracker.handleTimelineReset(r2, r2.getUnfilteredTimelineSet());
    tracker.handleTimelineReset(r3, r3.getUnfilteredTimelineSet());

    // Only !r1 started immediately; !r2 and !r3 wait in the serial queue.
    expect(tailOrder).toEqual(['!r1']);
    const r1Overlap = tracker.whenOverlapCaptured?.('!r1');
    const r3Overlap = tracker.whenOverlapCaptured?.('!r3');

    // !r1 overlap resolves before its markDiscontinuity settles.
    await r1Overlap;
    await vi.waitFor(() => expect(releaseFirstMark).toBeDefined());

    // Failing !r1's mark backs off onto a timer without blocking !r3 (prioritized) or !r2.
    rejectFirstMark?.(new Error('transient idb failure'));
    await r3Overlap;
    await vi.waitFor(() => expect(enqueued.map((job) => job.roomId)).toEqual(['!r3', '!r2']));

    expect(maxInFlight).toBe(1);
    expect(tailOrder).toEqual(['!r1', '!r3', '!r2']);
    expect(consoleError).toHaveBeenCalledTimes(1);

    // !r1 retries on backoff without re-reading loadCachedTail.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(enqueued.map((job) => job.roomId)).toEqual(['!r3', '!r2', '!r1']);
    expect(tailOrder).toEqual(['!r1', '!r3', '!r2']);
    tracker.stop();
  });

  it('resolves whenOverlapCaptured on stop() or revoked lease so waiters never hang', async () => {
    loadCachedTail.mockImplementation(() => new Promise(() => undefined));
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'waiter-session',
      enqueueGapFill: () => undefined,
      markDiscontinuity,
      loadCachedTail,
    });
    const r1 = makeRoom({ roomId: '!r1', paginationToken: 'b1' });
    const r2 = makeRoom({ roomId: '!r2', paginationToken: 'b2' });
    tracker.handleTimelineReset(r1, r1.getUnfilteredTimelineSet());
    tracker.handleTimelineReset(r2, r2.getUnfilteredTimelineSet());

    const r1Wait = tracker.whenOverlapCaptured?.('!r1');
    revokeCacheStoreWrites('waiter-session');
    // Revoked queued room resolves immediately without waiting for the worker.
    expect(tracker.whenOverlapCaptured?.('!r2')).toBeUndefined();
    tracker.stop();
    await r1Wait;
  });
});
