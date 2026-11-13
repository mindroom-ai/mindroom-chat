/**
 * ISSUE-207 P3.2: engine gap tracker.
 *
 * Two live signals converge here:
 *
 *   1. `RoomEvent.TimelineReset` on the room's unfiltered timelineSet
 *      — the SDK's way of saying "your last sync token wasn't good
 *      enough; I discarded the tail and started fresh from a newer
 *      state, so events between then and now are gone". The tracker
 *      durably marks the room as tail-discontinuous in the cache (so
 *      the fill survives a page reload) and enqueues a `limited-sync`
 *      gap-fill job. This marker is the sole gap-detection signal.
 *   2. `ClientEvent.Sync → PREPARED` on the initial cold start —
 *      startup jobs are enqueued only for joined rooms whose durable
 *      tail-discontinuity markers survived a previous session, so an
 *      unfinished fill resumes after a restart.
 *
 * The tracker only MARKS and ENQUEUES. Executing the fill is the
 * gap-fill executor's job; it supersedes stale work by the marker's
 * markedAt/generation. The `gapFillsEnqueued` probe counter is the
 * AC13 evidence handle.
 */

import type { EventTimelineSet, MatrixClient, Room } from 'matrix-js-sdk';
import { Direction } from 'matrix-js-sdk';
import { countCacheProbe } from '../cache/cacheProbe';
import {
  getTailDiscontinuityGeneration,
  loadLatestCachedRoomEvents,
  loadRoomTailDiscontinuity,
  markRoomTailDiscontinuity,
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  type CacheStoreWriteLease,
  holdUnsavedRoomCacheGap,
} from '../cache/db';

export type GapFillReason = 'limited-sync' | 'startup';

export type GapFillJob = {
  roomId: string;
  reason: GapFillReason;
  markedAt: number;
  prevBatch?: string | null;
  generation?: string;
};

export type EngineGapTrackerOptions = {
  mx: MatrixClient;
  sessionId: string;
  /** Runs (or coalesces) the fill of a marked gap: the gap-fill executor's `enqueue`. */
  enqueueGapFill: (job: GapFillJob) => void;
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

/**
 * Unique event ids of a cached-tail page, in page order. Both the tracker
 * (marker write) and the executor (marker-less fallback snapshot) derive the
 * pre-gap boundary through this one helper so the two can never diverge.
 */
export const collectOverlapEventIds = (events: readonly { event_id?: unknown }[]): string[] => [
  ...new Set(
    events.flatMap((event) =>
      typeof event.event_id === 'string' && event.event_id.length > 0 ? [event.event_id] : []
    )
  ),
];

type PendingGapMark = {
  writeLease: CacheStoreWriteLease;
  job: GapFillJob;
  marker: {
    markedAt: number;
    prevBatch?: string | null;
    generation: string;
    nextToken?: string | null;
    overlapEventIds?: string[];
  };
  overlapEventIds: Promise<string[] | undefined>;
  failureCount: number;
  reported: boolean;
  retryTimer?: ReturnType<typeof globalThis.setTimeout>;
  /** Keeps readers off the cache across this gap until its marker is durable. */
  releaseUnsavedGap: () => void;
};

export const createEngineGapTracker = (options: EngineGapTrackerOptions): EngineGapTracker => {
  const enqueueGapFill = (job: GapFillJob): void => {
    countCacheProbe('gapFillsEnqueued');
    options.enqueueGapFill(job);
  };
  const markDiscontinuity = options.markDiscontinuity ?? markRoomTailDiscontinuity;
  const loadDiscontinuity = options.loadDiscontinuity ?? loadRoomTailDiscontinuity;
  const loadCachedTail = options.loadCachedTail ?? loadLatestCachedRoomEvents;
  const now = options.now ?? (() => Date.now());
  const pendingMarks = new Map<string, PendingGapMark>();
  const inFlightMarks = new Set<string>();
  let stopped = false;

  const reportPersistenceError = (error: unknown, pending: PendingGapMark): void => {
    if (pending.reported) return;
    pending.reported = true;
    const normalizedError =
      error instanceof Error ? error : new Error('Tail-discontinuity marker persistence failed.');
    if (options.onPersistenceError) {
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

  // A room whose cache was cleared meanwhile has no hole left to record: its cache starts again.
  const dropClearedPendingMark = (roomId: string, pending: PendingGapMark): void => {
    if (stopped || pendingMarks.get(roomId) !== pending) return;
    pendingMarks.delete(roomId);
    pending.releaseUnsavedGap();
  };

  const attemptPendingMark = (roomId: string): void => {
    if (stopped || inFlightMarks.has(roomId)) return;
    const pending = pendingMarks.get(roomId);
    if (!pending) return;
    inFlightMarks.add(roomId);

    void pending.overlapEventIds
      .then((overlapEventIds) => {
        if (!isCacheStoreWriteLeaseCurrent(pending.writeLease)) {
          dropClearedPendingMark(roomId, pending);
          return undefined;
        }
        if (stopped || pendingMarks.get(roomId) !== pending) return undefined;
        return markDiscontinuity(options.sessionId, roomId, {
          ...pending.marker,
          overlapEventIds,
        });
      })
      .then((durableMarker) => {
        if (!durableMarker || stopped || pendingMarks.get(roomId) !== pending) return;
        pendingMarks.delete(roomId);
        pending.releaseUnsavedGap();
        enqueueGapFill({
          roomId,
          reason: 'limited-sync',
          markedAt: durableMarker.markedAt,
          prevBatch: durableMarker.nextToken ?? durableMarker.prevBatch,
          generation: getTailDiscontinuityGeneration(durableMarker),
        });
      })
      .catch((error: unknown) => {
        if (!isCacheStoreWriteLeaseCurrent(pending.writeLease)) {
          dropClearedPendingMark(roomId, pending);
          return;
        }
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

    if (options.sessionId) {
      const previous = pendingMarks.get(room.roomId);
      if (previous?.retryTimer) globalThis.clearTimeout(previous.retryTimer);
      const overlapEventIds =
        previous?.overlapEventIds ??
        loadCachedTail(options.sessionId, room.roomId, GAP_FILL_OVERLAP_TAIL_LIMIT)
          .then((cachedTail) => collectOverlapEventIds(cachedTail.events))
          // A failed boundary read must NOT be committed as the meaningful
          // "no cached boundary existed" [] state — leave the field unset so
          // the executor takes its own guarded snapshot (and defers, marker
          // intact, if that read fails too).
          .catch(() => undefined);
      pendingMarks.set(room.roomId, {
        releaseUnsavedGap: holdUnsavedRoomCacheGap(options.sessionId, room.roomId),
        writeLease: captureCacheStoreWriteLease(options.sessionId, room.roomId),
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
      previous?.releaseUnsavedGap();
      attemptPendingMark(room.roomId);
      return;
    }

    enqueueGapFill(job);
  };

  const handleSyncPrepared = async () => {
    if (stopped) return;
    const mx = options.mx;
    if (!mx) return;

    const rooms = mx.getRooms?.() ?? [];
    await Promise.all(
      rooms.map(async (room) => {
        // Membership filter: only joined rooms. Left rooms have no live
        // tail worth filling.
        const membership = room.getMyMembership?.();
        if (membership && membership !== 'join') return;

        const marker = await loadDiscontinuity(options.sessionId, room.roomId);
        if (stopped || !marker) return;
        enqueueGapFill({
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
    pendingMarks.forEach(({ retryTimer, releaseUnsavedGap }) => {
      if (retryTimer) globalThis.clearTimeout(retryTimer);
      releaseUnsavedGap();
    });
    pendingMarks.clear();
  };

  return {
    handleTimelineReset,
    handleSyncPrepared,
    stop,
  };
};
