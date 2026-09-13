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
import {
  createEngineGapTracker,
  createInMemoryGapFillScheduler,
} from '../engineGapTracker';
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
  const timelineSet = unfiltered ?? ({ __id: `${roomId}:unfiltered` } as unknown as EventTimelineSet);
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
  const markDiscontinuity = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    resetCacheProbe();
    markDiscontinuity.mockClear();
  });

  afterEach(() => {
    resetCacheProbe();
  });

  it('marks the room and enqueues a limited-sync job on TimelineReset for the unfiltered timelineSet', () => {
    const scheduler = createInMemoryGapFillScheduler();
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const tracker = createEngineGapTracker({
      mx: {} as unknown as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      now: () => 1000,
    });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet(), false);

    expect(markDiscontinuity).toHaveBeenCalledWith('session', '!a', {
      markedAt: 1000,
      prevBatch: 'batch-1',
    });
    expect(scheduler.pendingJobs()).toEqual([
      { roomId: '!a', reason: 'limited-sync', markedAt: 1000, prevBatch: 'batch-1' },
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

  it('enqueues one startup job per joined room on Sync→PREPARED, skipping non-joined rooms', () => {
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
      now: () => 2000,
    });

    tracker.handleSyncPrepared();

    const jobs = scheduler.pendingJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.roomId).sort()).toEqual(['!join-a', '!join-b']);
    expect(jobs.every((j) => j.reason === 'startup' && j.markedAt === 2000)).toBe(true);
    expect(jobs.find((j) => j.roomId === '!join-a')?.prevBatch).toBe('ta');
    expect(getCacheProbeSnapshot().gapFillsEnqueued).toBe(2);
  });

  it('a limited-sync job that arrives after a startup job wins the dedup', () => {
    const scheduler = createInMemoryGapFillScheduler();
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const mx = { getRooms: () => [room] } as unknown as MatrixClient;
    const tracker = createEngineGapTracker({
      mx,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      now: () => 3000,
    });

    tracker.handleSyncPrepared();
    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet(), false);

    const jobs = scheduler.pendingJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].reason).toBe('limited-sync');
    expect(jobs[0].prevBatch).toBe('batch-1');
  });

  it('handleSyncPrepared is a no-op when no MatrixClient is present (safety valve)', () => {
    const scheduler = createInMemoryGapFillScheduler();
    const tracker = createEngineGapTracker({
      // @ts-expect-error deliberately omit for the safety test
      mx: undefined,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
    });
    tracker.handleSyncPrepared();
    expect(scheduler.pendingJobs()).toHaveLength(0);
  });
});
