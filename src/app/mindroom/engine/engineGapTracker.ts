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
import {
  getTailDiscontinuityGeneration,
  loadLatestCachedRoomEvents,
  loadRoomTailDiscontinuity,
  markRoomTailDiscontinuity,
} from '../threads/cacheStore';

export type GapFillReason = 'limited-sync' | 'startup';

export type GapFillJob = {
  roomId: string;
  reason: GapFillReason;
  markedAt: number;
  prevBatch?: string | null;
  generation?: string;
};

export type GapFillScheduler = {
  enqueueGapFill(job: GapFillJob): void;
  pendingJobs(): readonly GapFillJob[];
  /**
   * Subscribe to enqueue events. The listener fires once per accepted
   * enqueue (deduped rejects don't fire). Returns an unsubscribe
   * function. CINNY-207 P4.2 uses this so `gapFillExecutor` can drain
   * the queue promptly rather than polling.
   */
  onEnqueue(listener: (job: GapFillJob) => void): () => void;
  remove(roomId: string): void;
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
  const listeners = new Set<(job: GapFillJob) => void>();
  return {
    enqueueGapFill(job) {
      const existing = jobs.get(job.roomId);
      // `limited-sync` beats `startup` when both are present — a fresh
      // reset carries a real prevBatch and supersedes an earlier
      // opportunistic startup job.
      if (existing && existing.reason === 'limited-sync' && job.reason === 'startup') return;
      jobs.set(job.roomId, job);
      countCacheProbe('gapFillsEnqueued');
      listeners.forEach((listener) => {
        try {
          listener(job);
        } catch {
          // A misbehaving subscriber must not break the tracker.
        }
      });
    },
    pendingJobs: () => Array.from(jobs.values()),
    onEnqueue(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    remove: (roomId) => jobs.delete(roomId),
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
  /** Test hook: swap the durable marker reader. */
  loadDiscontinuity?: typeof loadRoomTailDiscontinuity;
  /** Test hook: control the pre-reset cache boundary snapshot. */
  loadCachedTail?: typeof loadLatestCachedRoomEvents;
  /** Test hook: override the wall-clock time. */
  now?: () => number;
  /** Report a durable marker failure while the tracker retains it for retry. */
  onPersistenceError?: (error: Error, job: GapFillJob) => void;
};

export type EngineGapTracker = {
  scheduler: GapFillScheduler;
  handleTimelineReset(
    room: Room | undefined,
    timelineSet: EventTimelineSet | undefined,
    resetAllTimelines?: boolean
  ): void;
  handleSyncPrepared(): Promise<void>;
  stop(): void;
};

const GAP_MARK_RETRY_BASE_MS = 1_000;
const GAP_MARK_RETRY_MAX_MS = 30_000;
export const GAP_FILL_OVERLAP_TAIL_LIMIT = 200;

type PendingGapMark = {
  job: GapFillJob;
  marker: {
    markedAt: number;
    prevBatch?: string | null;
    generation: string;
    nextToken?: string | null;
    overlapEventIds?: string[];
  };
  overlapEventIds: Promise<string[]>;
  failureCount: number;
  reported: boolean;
  retryTimer?: ReturnType<typeof globalThis.setTimeout>;
};

export const createEngineGapTracker = (options?: EngineGapTrackerOptions): EngineGapTracker => {
  const scheduler = options?.scheduler ?? createInMemoryGapFillScheduler();
  const markDiscontinuity = options?.markDiscontinuity ?? markRoomTailDiscontinuity;
  const loadDiscontinuity = options?.loadDiscontinuity ?? loadRoomTailDiscontinuity;
  const loadCachedTail = options?.loadCachedTail ?? loadLatestCachedRoomEvents;
  const now = options?.now ?? (() => Date.now());
  const pendingMarks = new Map<string, PendingGapMark>();
  const inFlightMarks = new Set<string>();
  let stopped = false;

  const reportPersistenceError = (error: unknown, pending: PendingGapMark): void => {
    if (pending.reported) return;
    pending.reported = true;
    const normalizedError =
      error instanceof Error ? error : new Error('Tail-discontinuity marker persistence failed.');
    if (options?.onPersistenceError) {
      try {
        options.onPersistenceError(normalizedError, pending.job);
      } catch {
        // Error reporting must not discard retained gap work.
      }
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[MindRoom gap tracker] Retrying an undurable timeline gap.', normalizedError);
  };

  const attemptPendingMark = (roomId: string): void => {
    if (stopped || inFlightMarks.has(roomId)) return;
    const pending = pendingMarks.get(roomId);
    if (!pending) return;
    inFlightMarks.add(roomId);

    void pending.overlapEventIds
      .then((overlapEventIds) => {
        if (stopped || pendingMarks.get(roomId) !== pending) return undefined;
        return markDiscontinuity(options?.sessionId ?? '', roomId, {
          ...pending.marker,
          overlapEventIds,
        });
      })
      .then((durableMarker) => {
        if (!durableMarker || stopped || pendingMarks.get(roomId) !== pending) return;
        pendingMarks.delete(roomId);
        scheduler.enqueueGapFill({
          roomId,
          reason: 'limited-sync',
          markedAt: durableMarker.markedAt,
          prevBatch: durableMarker.nextToken ?? durableMarker.prevBatch,
          generation: getTailDiscontinuityGeneration(durableMarker),
        });
      })
      .catch((error: unknown) => {
        if (stopped || pendingMarks.get(roomId) !== pending) return;
        pending.failureCount += 1;
        reportPersistenceError(error, pending);
        const retryDelay = Math.min(
          GAP_MARK_RETRY_BASE_MS * 2 ** (pending.failureCount - 1),
          GAP_MARK_RETRY_MAX_MS
        );
        pending.retryTimer = globalThis.setTimeout(() => {
          pending.retryTimer = undefined;
          attemptPendingMark(roomId);
        }, retryDelay);
      })
      .finally(() => {
        inFlightMarks.delete(roomId);
        const current = pendingMarks.get(roomId);
        if (!stopped && current && current !== pending && !current.retryTimer) {
          attemptPendingMark(roomId);
        }
      });
  };

  const handleTimelineReset = (
    room: Room | undefined,
    timelineSet: EventTimelineSet | undefined,
    _resetAllTimelines?: boolean
  ) => {
    if (stopped) return;
    if (!room || !timelineSet) return;
    // Only the room's UNFILTERED live timelineSet reset means "limited
    // sync". Thread timelineSets can reset for other reasons (thread
    // rebuild); those are not gap events.
    if (timelineSet !== room.getUnfilteredTimelineSet()) return;

    const prevBatch = room.getLiveTimeline().getPaginationToken(Direction.Backward);
    const markedAt = now();
    const marker = { markedAt, prevBatch };
    const generation = getTailDiscontinuityGeneration(marker);
    const job: GapFillJob = {
      roomId: room.roomId,
      reason: 'limited-sync',
      markedAt,
      prevBatch,
      generation,
    };

    if (options?.sessionId) {
      const previous = pendingMarks.get(room.roomId);
      if (previous?.retryTimer) globalThis.clearTimeout(previous.retryTimer);
      const overlapEventIds =
        previous?.overlapEventIds ??
        loadCachedTail(options.sessionId, room.roomId, GAP_FILL_OVERLAP_TAIL_LIMIT)
          .then((cachedTail) => [
            ...new Set(
              cachedTail.events.flatMap((cachedEvent) =>
                typeof cachedEvent.event_id === 'string' && cachedEvent.event_id.length > 0
                  ? [cachedEvent.event_id]
                  : []
              )
            ),
          ])
          .catch(() => []);
      pendingMarks.set(room.roomId, {
        job,
        marker: {
          ...marker,
          generation,
          nextToken: prevBatch,
        },
        overlapEventIds,
        failureCount: 0,
        reported: false,
      });
      attemptPendingMark(room.roomId);
      return;
    }

    scheduler.enqueueGapFill(job);
  };

  const handleSyncPrepared = async () => {
    if (stopped) return;
    const mx = options?.mx;
    if (!mx) return;

    const rooms = mx.getRooms?.() ?? [];
    await Promise.all(
      rooms.map(async (room) => {
        // Membership filter: only joined rooms. Left rooms have no live
        // tail worth filling.
        const membership = room.getMyMembership?.();
        if (membership && membership !== 'join') return;

        const marker = await loadDiscontinuity(options?.sessionId ?? '', room.roomId);
        if (stopped || !marker) return;
        scheduler.enqueueGapFill({
          roomId: room.roomId,
          reason: 'startup',
          markedAt: marker.markedAt,
          prevBatch: marker.nextToken ?? marker.prevBatch,
          generation: getTailDiscontinuityGeneration(marker),
        });
      })
    );
  };

  const stop = () => {
    stopped = true;
    pendingMarks.forEach(({ retryTimer }) => {
      if (retryTimer) globalThis.clearTimeout(retryTimer);
    });
    pendingMarks.clear();
  };

  return {
    scheduler,
    handleTimelineReset,
    handleSyncPrepared,
    stop,
  };
};
