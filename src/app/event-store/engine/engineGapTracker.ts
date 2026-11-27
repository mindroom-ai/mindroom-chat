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
  loadAllRoomTailDiscontinuities,
  loadLatestCachedRoomEvents,
  type loadRoomTailDiscontinuity,
  markRoomTailDiscontinuity,
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  type CacheStoreWriteLease,
  holdUnsavedRoomCacheGap,
} from '../cache/db';
import type { TailDiscontinuityMarker } from '../cache/db/cacheStoreDiscontinuity';

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
  /** Test hook: swap the per-room durable marker reader. */
  loadDiscontinuity?: typeof loadRoomTailDiscontinuity;
  /** Test hook: swap the bulk durable marker reader used by handleSyncPrepared. */
  loadAllDiscontinuities?: typeof loadAllRoomTailDiscontinuities;
  /** Test hook: control the pre-reset cache boundary snapshot. */
  loadCachedTail?: typeof loadLatestCachedRoomEvents;
  /** Test hook: override the wall-clock time. */
  now?: () => number;
};

export type EngineGapTracker = {
  handleTimelineReset(
    room: Room | undefined,
    timelineSet: EventTimelineSet | undefined,
    resetAllTimelines?: boolean
  ): void;
  handleSyncPrepared(): Promise<void>;
  /** Resolves once a pending reset's pre-gap overlap snapshot has finished reading. */
  whenOverlapCaptured?(roomId: string): Promise<void> | undefined;
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

type PendingOverlapCapture = {
  done: Promise<void>;
  settled: boolean;
  resolve: () => void;
  promise?: Promise<string[] | undefined>;
};

const createOverlapCapture = (): PendingOverlapCapture => {
  let resolveDone!: () => void;
  const capture: PendingOverlapCapture = {
    done: new Promise<void>((resolve) => {
      resolveDone = resolve;
    }),
    settled: false,
    resolve: () => {
      if (capture.settled) return;
      capture.settled = true;
      resolveDone();
    },
  };
  return capture;
};

type PendingGapMark = {
  writeLease: CacheStoreWriteLease;
  marker: {
    markedAt: number;
    prevBatch?: string | null;
    generation: string;
    nextToken?: string | null;
    overlapEventIds?: string[];
  };
  overlap: PendingOverlapCapture;
  failureCount: number;
  reported: boolean;
  retryTimer?: ReturnType<typeof globalThis.setTimeout>;
  /** Keeps readers off the cache across this gap until its marker is durable. */
  releaseUnsavedGap: () => void;
};

export const createEngineGapTracker = (options: EngineGapTrackerOptions): EngineGapTracker => {
  const enqueueGapFill = (
    roomId: string,
    reason: GapFillReason,
    marker: Pick<TailDiscontinuityMarker, 'markedAt' | 'prevBatch' | 'generation' | 'nextToken'>
  ): void => {
    countCacheProbe('gapFillsEnqueued');
    options.enqueueGapFill({
      roomId,
      reason,
      markedAt: marker.markedAt,
      prevBatch: marker.nextToken ?? marker.prevBatch,
      generation: getTailDiscontinuityGeneration(marker),
    });
  };
  const markDiscontinuity = options.markDiscontinuity ?? markRoomTailDiscontinuity;
  const loadAllDiscontinuities = options.loadAllDiscontinuities ?? loadAllRoomTailDiscontinuities;
  const loadCachedTail = options.loadCachedTail ?? loadLatestCachedRoomEvents;
  const now = options.now ?? (() => Date.now());
  const pendingMarks = new Map<string, PendingGapMark>();
  const markQueue = new Set<string>();
  const prioritizedRoomIds = new Set<string>();
  let drainingMarks = false;
  let stopped = false;

  const reportPersistenceError = (error: unknown, pending: PendingGapMark): void => {
    if (pending.reported) return;
    pending.reported = true;
    const normalizedError =
      error instanceof Error ? error : new Error('Tail-discontinuity marker persistence failed.');
    // eslint-disable-next-line no-console
    console.error('[MindRoom gap tracker] Retrying an undurable timeline gap.', normalizedError);
  };

  // A room whose cache was cleared meanwhile has no hole left to record: its cache starts again.
  const dropClearedPendingMark = (roomId: string, pending: PendingGapMark): void => {
    if (stopped || pendingMarks.get(roomId) !== pending) return;
    if (pending.retryTimer) globalThis.clearTimeout(pending.retryTimer);
    pendingMarks.delete(roomId);
    markQueue.delete(roomId);
    prioritizedRoomIds.delete(roomId);
    pending.overlap.resolve();
    pending.releaseUnsavedGap();
  };

  const isPendingActive = (roomId: string, pending: PendingGapMark): boolean => {
    if (stopped) return false;
    if (!isCacheStoreWriteLeaseCurrent(pending.writeLease)) {
      dropClearedPendingMark(roomId, pending);
      return false;
    }
    return pendingMarks.get(roomId) === pending;
  };

  const captureOverlap = (
    roomId: string,
    pending: PendingGapMark
  ): Promise<string[] | undefined> => {
    if (!pending.overlap.promise) {
      pending.overlap.promise = loadCachedTail(
        options.sessionId,
        roomId,
        GAP_FILL_OVERLAP_TAIL_LIMIT
      )
        .then((cachedTail) => collectOverlapEventIds(cachedTail.events))
        // Leave failed boundary reads unset rather than committing an empty [] boundary.
        .catch(() => undefined)
        .finally(pending.overlap.resolve);
    }
    return pending.overlap.promise;
  };

  const takeNextRoomId = (): string | undefined => {
    for (const roomId of prioritizedRoomIds) {
      prioritizedRoomIds.delete(roomId);
      if (markQueue.delete(roomId)) return roomId;
    }
    const next = markQueue.values().next();
    if (next.done) return undefined;
    markQueue.delete(next.value);
    return next.value;
  };

  const drainMarkQueue = async (): Promise<void> => {
    if (drainingMarks) return;
    drainingMarks = true;
    try {
      while (!stopped) {
        const roomId = takeNextRoomId();
        if (!roomId) break;
        const pending = pendingMarks.get(roomId);
        if (!pending || pending.retryTimer || !isPendingActive(roomId, pending)) continue;

        const overlapEventIds = await captureOverlap(roomId, pending);
        if (!isPendingActive(roomId, pending)) continue;

        try {
          const durableMarker = await markDiscontinuity(options.sessionId, roomId, {
            ...pending.marker,
            overlapEventIds,
          });
          if (!durableMarker || !isPendingActive(roomId, pending)) continue;
          pendingMarks.delete(roomId);
          pending.releaseUnsavedGap();
          enqueueGapFill(roomId, 'limited-sync', durableMarker);
        } catch (error: unknown) {
          if (!isPendingActive(roomId, pending)) continue;
          pending.failureCount += 1;
          reportPersistenceError(error, pending);
          const retryDelay = Math.min(
            GAP_MARK_RETRY_BASE_MS * 2 ** (pending.failureCount - 1),
            GAP_MARK_RETRY_MAX_MS
          );
          pending.retryTimer = globalThis.setTimeout(() => {
            pending.retryTimer = undefined;
            enqueueMarkWork(roomId);
          }, retryDelay);
        }
      }
    } finally {
      drainingMarks = false;
      if (!stopped && markQueue.size > 0) void drainMarkQueue();
    }
  };

  const enqueueMarkWork = (roomId: string): void => {
    if (stopped) return;
    markQueue.add(roomId);
    void drainMarkQueue();
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

    const previous = pendingMarks.get(room.roomId);
    if (previous?.retryTimer) globalThis.clearTimeout(previous.retryTimer);
    const reusePreviousOverlap =
      previous !== undefined && isCacheStoreWriteLeaseCurrent(previous.writeLease);
    const overlap = reusePreviousOverlap ? previous.overlap : createOverlapCapture();
    if (previous && !reusePreviousOverlap) {
      previous.overlap.resolve();
    }
    pendingMarks.set(room.roomId, {
      releaseUnsavedGap: holdUnsavedRoomCacheGap(options.sessionId, room.roomId),
      writeLease: captureCacheStoreWriteLease(options.sessionId, room.roomId),
      marker: {
        ...marker,
        generation,
        nextToken: prevBatch,
      },
      overlap,
      failureCount: 0,
      reported: false,
    });
    previous?.releaseUnsavedGap();
    enqueueMarkWork(room.roomId);
  };

  const whenOverlapCaptured = (roomId: string): Promise<void> | undefined => {
    if (stopped) return undefined;
    const pending = pendingMarks.get(roomId);
    if (!pending || pending.overlap.settled) return undefined;
    if (!isCacheStoreWriteLeaseCurrent(pending.writeLease)) {
      dropClearedPendingMark(roomId, pending);
      return undefined;
    }
    if (markQueue.has(roomId)) {
      prioritizedRoomIds.add(roomId);
    }
    return pending.overlap.done;
  };

  const handleSyncPrepared = async () => {
    if (stopped) return;
    const rooms = options.mx.getRooms?.() ?? [];
    const joinedRooms = rooms.filter((room) => {
      // Membership filter: only joined rooms. Left rooms have no live
      // tail worth filling.
      const membership = room.getMyMembership?.();
      return !membership || membership === 'join';
    });
    if (joinedRooms.length === 0) return;

    if (options.loadDiscontinuity && !options.loadAllDiscontinuities) {
      for (const room of joinedRooms) {
        const marker = await options.loadDiscontinuity(options.sessionId, room.roomId);
        if (stopped) return;
        if (marker) enqueueGapFill(room.roomId, 'startup', marker);
      }
      return;
    }

    const markers = await loadAllDiscontinuities(options.sessionId);
    if (stopped) return;
    for (const room of joinedRooms) {
      const marker = markers.get(room.roomId);
      if (marker) enqueueGapFill(room.roomId, 'startup', marker);
    }
  };

  const stop = () => {
    stopped = true;
    markQueue.clear();
    prioritizedRoomIds.clear();
    pendingMarks.forEach(({ retryTimer, releaseUnsavedGap, overlap }) => {
      if (retryTimer) globalThis.clearTimeout(retryTimer);
      overlap.resolve();
      releaseUnsavedGap();
    });
    pendingMarks.clear();
  };

  return {
    handleTimelineReset,
    handleSyncPrepared,
    whenOverlapCaptured,
    stop,
  };
};
