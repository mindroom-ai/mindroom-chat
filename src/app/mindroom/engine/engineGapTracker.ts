/**
 * CINNY-207 P3.2: engine gap tracker.
 *
 * Two live signals converge here:
 *
 *   1. `RoomEvent.TimelineReset` on the room's unfiltered timelineSet
 *      — the SDK's way of saying "your last sync token wasn't good
 *      enough; I discarded the tail and started fresh from a newer
 *      state, so events between then and now are gone". The tracker
 *      marks the room as tail-discontinuous in the cache (so the fill
 *      survives a page reload) and enqueues a `limited-sync` gap-fill
 *      job.
 *   2. `ClientEvent.Sync → PREPARED` on the initial cold start — the
 *      moment when we can enumerate joined rooms and know that the
 *      liveMode gate is about to unlock. We enqueue a `startup` job
 *      per joined room to fill anything the cold catchup missed
 *      (this is what turns AC13 green after a restart).
 *
 * P3.2 scope (per plan Deviations): the tracker only MARKS and
 * ENQUEUES. Executing the fill is Phase 4's job — the scheduler here
 * is an in-memory stub with `pendingJobs()` for inspection. The
 * `gapFillsEnqueued` probe counter is the AC13 evidence handle.
 */

import type { EventTimelineSet, MatrixClient, Room } from 'matrix-js-sdk';
import { Direction } from 'matrix-js-sdk';
import { countCacheProbe } from '../threads/cacheProbe';
import { markRoomTailDiscontinuity } from '../threads/cacheStore';

export type GapFillReason = 'limited-sync' | 'startup';

export type GapFillJob = {
  roomId: string;
  reason: GapFillReason;
  markedAt: number;
  prevBatch?: string | null;
};

export type GapFillScheduler = {
  enqueueGapFill(job: GapFillJob): void;
  pendingJobs(): readonly GapFillJob[];
  /** Test-only: drop all queued jobs. */
  clear(): void;
};

/**
 * In-memory gap-fill queue. Dedupes by roomId — the executor runs one
 * fill per room and the reason is informational (Phase 4 may promote
 * a `startup` job to `limited-sync` if a reset arrives later). No
 * persistence across restarts is required at this layer because
 * `tailDiscontinuity` in the cache is the durable record.
 */
export const createInMemoryGapFillScheduler = (): GapFillScheduler => {
  const jobs = new Map<string, GapFillJob>();
  return {
    enqueueGapFill(job) {
      const existing = jobs.get(job.roomId);
      // `limited-sync` beats `startup` when both are present — a fresh
      // reset carries a real prevBatch and supersedes an earlier
      // opportunistic startup job.
      if (existing && existing.reason === 'limited-sync' && job.reason === 'startup') return;
      jobs.set(job.roomId, job);
      countCacheProbe('gapFillsEnqueued');
    },
    pendingJobs: () => Array.from(jobs.values()),
    clear: () => jobs.clear(),
  };
};

export type EngineGapTrackerOptions = {
  mx: MatrixClient;
  sessionId: string;
  /** Test hook: inject a scheduler double. */
  scheduler?: GapFillScheduler;
  /** Test hook: swap the durable marker writer. */
  markDiscontinuity?: typeof markRoomTailDiscontinuity;
  /** Test hook: override the wall-clock time. */
  now?: () => number;
};

export type EngineGapTracker = {
  scheduler: GapFillScheduler;
  handleTimelineReset(
    room: Room | undefined,
    timelineSet: EventTimelineSet | undefined,
    resetAllTimelines?: boolean
  ): void;
  handleSyncPrepared(): void;
  stop(): void;
};

export const createEngineGapTracker = (
  options?: EngineGapTrackerOptions
): EngineGapTracker => {
  const scheduler = options?.scheduler ?? createInMemoryGapFillScheduler();
  const markDiscontinuity = options?.markDiscontinuity ?? markRoomTailDiscontinuity;
  const now = options?.now ?? (() => Date.now());

  const handleTimelineReset = (
    room: Room | undefined,
    timelineSet: EventTimelineSet | undefined,
    _resetAllTimelines?: boolean
  ) => {
    if (!room || !timelineSet) return;
    // Only the room's UNFILTERED live timelineSet reset means "limited
    // sync". Thread timelineSets can reset for other reasons (thread
    // rebuild); those are not gap events.
    if (timelineSet !== room.getUnfilteredTimelineSet()) return;

    const prevBatch = room.getLiveTimeline().getPaginationToken(Direction.Backward);
    const markedAt = now();

    if (options?.sessionId) {
      markDiscontinuity(options.sessionId, room.roomId, { markedAt, prevBatch }).catch(
        () => undefined
      );
    }

    scheduler.enqueueGapFill({
      roomId: room.roomId,
      reason: 'limited-sync',
      markedAt,
      prevBatch,
    });
  };

  const handleSyncPrepared = () => {
    const mx = options?.mx;
    if (!mx) return;

    const markedAt = now();
    const rooms = mx.getRooms?.() ?? [];
    rooms.forEach((room) => {
      // Membership filter: only joined rooms. Left rooms have no live
      // tail worth filling.
      const membership = room.getMyMembership?.();
      if (membership && membership !== 'join') return;

      const prevBatch = room.getLiveTimeline?.().getPaginationToken?.(Direction.Backward);
      scheduler.enqueueGapFill({
        roomId: room.roomId,
        reason: 'startup',
        markedAt,
        prevBatch,
      });
    });
  };

  const stop = () => {
    // In-memory scheduler needs no teardown. Kept as a slot for
    // symmetry when Phase 4 wires a real executor with pending timers.
  };

  return {
    scheduler,
    handleTimelineReset,
    handleSyncPrepared,
    stop,
  };
};
