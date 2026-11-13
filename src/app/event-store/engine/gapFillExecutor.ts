/** One committed gap page per scheduler turn. Durable overlap markers and
 * cursors survive policy pauses; only overlap or exhaustion clears the gap. */

import type { IEvent, MatrixClient, Room } from 'matrix-js-sdk';
import { Direction } from 'matrix-js-sdk';
import {
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  type CacheStoreWriteLease,
  checkpointRoomTailDiscontinuity,
  clearRoomTailDiscontinuity,
  getTailDiscontinuityGeneration,
  loadLatestCachedRoomEvents,
  loadRoomTailDiscontinuity,
} from '../cache/db';
import { persistRoomChunkWithPreferLive } from '../cache/eventRepository';
import type { ReserveHistoryPage } from './deepHistoryJob';
import type { BackfillScheduler } from './backfillScheduler';
import {
  collectOverlapEventIds,
  GAP_FILL_OVERLAP_TAIL_LIMIT,
  type GapFillJob,
  type GapFillScheduler,
} from './engineGapTracker';

// Batch size for the /messages page — matches the app's other backfill
// batches so the scheduler's cooperative abort granularity is
// consistent across job kinds.
const GAP_FILL_BATCH_SIZE = GAP_FILL_OVERLAP_TAIL_LIMIT;

export type GapFillExecutorOptions = {
  /** The offline controller owns eligibility as well as bandwidth: 0 defers the room. */
  readonly pageAllowance: (roomId: string) => number;
  readonly reservePage: ReserveHistoryPage;
  readonly canSavePage: (roomId: string) => Promise<boolean>;
  readonly mx: MatrixClient;
  readonly sessionId: string;
  readonly scheduler: BackfillScheduler;
  /** Priority band for gap-fills on rooms other than the focused one. */
  readonly priority?: 0 | 1 | 2;
  /** Test hook for proving cursor advancement follows a committed write. */
  readonly persistChunk?: typeof persistRoomChunkWithPreferLive;
  /** Test hook for controlling the pre-gap cached-tail snapshot. */
  readonly loadCachedTail?: typeof loadLatestCachedRoomEvents;
  /** Test hook for failing or controlling the durable marker read. */
  readonly loadDiscontinuity?: typeof loadRoomTailDiscontinuity;
  /** Cache invalidation for mounted readers; never fired before a successful commit. */
  readonly onRoomRecovered?: (roomId: string) => void;
};

/**
 * Wire the executor to a `GapFillScheduler` dispatch seam: every enqueue
 * from the gap tracker runs (or coalesces into) a fill immediately.
 * Returns a teardown that unsubscribes and blocks further enqueues.
 */
export type GapFillExecutor = {
  /** Retry policy-deferred or capped work after focus or prefetch scope changes. */
  recheckDeferred(roomId?: string): void;
  stop(): void;
};

export const createGapFillExecutor = (
  options: GapFillExecutorOptions,
  gapFillScheduler: GapFillScheduler
): GapFillExecutor => {
  const { mx, sessionId, scheduler } = options;
  const priority = options.priority ?? 1;
  const persistChunk = options.persistChunk ?? persistRoomChunkWithPreferLive;
  const loadCachedTail = options.loadCachedTail ?? loadLatestCachedRoomEvents;
  const loadDiscontinuity = options.loadDiscontinuity ?? loadRoomTailDiscontinuity;
  let stopped = false;
  const latestJobs = new Map<string, GapFillJob>();
  const deferredJobs = new Map<string, GapFillJob>();
  const activeRooms = new Set<string>();

  const runOnce = async (
    job: GapFillJob,
    signal: AbortSignal,
    writeLease: CacheStoreWriteLease,
    onCommitted: () => void,
    visited: Set<string>
  ): Promise<'policy-deferred' | 'continuation-deferred' | 'page-committed' | undefined> => {
    const room: Room | null | undefined = mx.getRoom?.(job.roomId);
    if (!room) return;
    let durableMarker;
    try {
      durableMarker = await loadDiscontinuity(sessionId, job.roomId);
    } catch {
      return 'continuation-deferred';
    }
    if (
      job.generation &&
      (!durableMarker || getTailDiscontinuityGeneration(durableMarker) !== job.generation)
    ) {
      // Generation-bearing jobs are projections of a durable marker. If that
      // marker is genuinely gone or superseded, the queued work is stale.
      return;
    }
    const generation =
      job.generation ??
      getTailDiscontinuityGeneration(
        durableMarker ?? { markedAt: job.markedAt, prevBatch: job.prevBatch }
      );

    const fromToken: string | null =
      durableMarker?.nextToken ?? job.prevBatch ?? durableMarker?.prevBatch ?? null;
    let overlapEventIds = durableMarker?.overlapEventIds;
    if (overlapEventIds === undefined) {
      let cachedTail;
      try {
        cachedTail = await loadCachedTail(sessionId, job.roomId, GAP_FILL_OVERLAP_TAIL_LIMIT);
      } catch {
        // Without a trustworthy boundary, preserve the marker and retry
        // instead of risking an unnecessary crawl to room genesis.
        return 'continuation-deferred';
      }
      overlapEventIds = collectOverlapEventIds(cachedTail.events);
      if (durableMarker) {
        if (signal.aborted || !isCacheStoreWriteLeaseCurrent(writeLease)) return 'policy-deferred';
        const boundaryCheckpointed = await checkpointRoomTailDiscontinuity(
          sessionId,
          job.roomId,
          generation,
          fromToken,
          overlapEventIds
        );
        if (!boundaryCheckpointed) return 'continuation-deferred';
      }
    }

    if (options.pageAllowance(job.roomId) === 0) return 'policy-deferred';

    const overlapEventIdSet = new Set(overlapEventIds);
    if (signal.aborted || !isCacheStoreWriteLeaseCurrent(writeLease)) return 'policy-deferred';
    if (!(await options.canSavePage(job.roomId))) return 'policy-deferred';
    const cursorKey = JSON.stringify([generation, fromToken]);
    if (visited.has(cursorKey)) return 'continuation-deferred';
    visited.add(cursorKey);
    const reservation = options.reservePage(job.roomId);
    if (!reservation) return 'policy-deferred';
    let committedCount = 0;
    try {
      let response;
      try {
        response = await mx.createMessagesRequest(
          job.roomId,
          fromToken,
          Math.min(GAP_FILL_BATCH_SIZE, reservation.limit),
          Direction.Backward
        );
      } catch (error) {
        // Keep intent for the next connection/focus change, without looping.
        return 'continuation-deferred';
      }
      if (signal.aborted) return 'policy-deferred';
      const chunk: Partial<IEvent>[] = Array.isArray(response?.chunk)
        ? (response.chunk as Partial<IEvent>[])
        : [];
      const overlapsCachedTail = chunk.some(
        (event) => typeof event.event_id === 'string' && overlapEventIdSet.has(event.event_id)
      );
      if (chunk.length > 0) {
        // ISSUE-207 P7.2 audit finding #3: chunks must funnel through
        // `createPreferLiveEventMapper` (see reconciler.ts header + I2)
        // — Tuwunel serves un-pruned copies of redacted events for
        // ~10s, and last-writer-wins on `eventStore.put` would let a
        // gap-fill overwrite a cached tombstone with pre-redaction
        // plaintext at rest. The shared helper maps every raw event
        // (either through the mapper to a fresh MatrixEvent, or to the
        // SDK's live instance with `unsigned.redacted_because` applied)
        // and persists via `persistRoomEventCacheSnapshot` — the same
        // serialize+save path the write-through uses. Ordering is
        // normalized inside `runSaveRoomEventsTxn` via
        // origin_server_ts sorting.
        try {
          // Writes must commit before the durable cursor advances.
          await persistChunk({
            mx,
            sessionId,
            room,
            chunk,
            beforeTokenForEarliest: response.end ?? null,
            writeLease,
            roomTailLoaded: true,
          });
        } catch {
          return 'continuation-deferred';
        }
        committedCount = chunk.length;
        onCommitted();
        if (signal.aborted || stopped) return 'policy-deferred';
      }
      if (signal.aborted || !isCacheStoreWriteLeaseCurrent(writeLease)) return 'policy-deferred';
      // Only committed overlap or exhaustion proves continuity.
      if (overlapsCachedTail || !response.end) {
        const cleared = await clearRoomTailDiscontinuity(sessionId, job.roomId, generation).catch(
          () => false
        );
        if (cleared) onCommitted();
        return cleared ? undefined : 'continuation-deferred';
      }
      // Same token twice is not proof of exhaustion. Preserve the
      // marker at its last committed cursor for a later retry.
      if (response.end === fromToken) {
        return 'continuation-deferred';
      }
      // The marker may have been superseded by a newer TimelineReset
      // while this request was in flight. Stop instead of overwriting
      // the new generation's cursor.
      const checkpointed = await checkpointRoomTailDiscontinuity(
        sessionId,
        job.roomId,
        generation,
        response.end
      );
      if (durableMarker && !checkpointed) return 'continuation-deferred';
      if (checkpointed) onCommitted();
    } finally {
      reservation.settle(committedCount);
    }
    return 'page-committed';
  };

  const runLatest = (roomId: string): void => {
    if (stopped || activeRooms.has(roomId)) return;
    activeRooms.add(roomId);
    void (async () => {
      try {
        const visited = new Set<string>();
        while (!stopped) {
          const job = latestJobs.get(roomId);
          if (!job) break;
          latestJobs.delete(roomId);
          let recovered = false;
          let result: 'policy-deferred' | 'continuation-deferred' | 'page-committed' | undefined;
          const writeLease = captureCacheStoreWriteLease(sessionId, roomId);
          // eslint-disable-next-line no-await-in-loop
          await scheduler
            .enqueue({
              roomId: job.roomId,
              kind: 'gap-fill',
              priority,
              execute: async (signal) => {
                result = await runOnce(
                  job,
                  signal,
                  writeLease,
                  () => {
                    recovered = true;
                  },
                  visited
                );
              },
            })
            .catch(() => {
              result = 'policy-deferred';
            });
          if (recovered && isCacheStoreWriteLeaseCurrent(writeLease))
            options.onRoomRecovered?.(roomId);
          if (result && !latestJobs.has(roomId) && isCacheStoreWriteLeaseCurrent(writeLease)) {
            if (result === 'page-committed' && options.pageAllowance(roomId) > 0)
              latestJobs.set(roomId, job);
            else deferredJobs.set(roomId, job);
          }
        }
      } finally {
        activeRooms.delete(roomId);
        if (!stopped && latestJobs.has(roomId)) runLatest(roomId);
      }
    })();
  };

  const enqueue = (job: GapFillJob): void => {
    if (stopped) return;
    deferredJobs.delete(job.roomId);
    const queued = latestJobs.get(job.roomId);
    if (!queued || job.markedAt >= queued.markedAt) latestJobs.set(job.roomId, job);
    runLatest(job.roomId);
  };

  const recheckDeferred = (roomId?: string): void => {
    if (stopped) return;
    const jobs = roomId
      ? [deferredJobs.get(roomId)].filter((job): job is GapFillJob => !!job)
      : Array.from(deferredJobs.values());
    jobs.forEach((job) => {
      if (deferredJobs.get(job.roomId) !== job) return;
      deferredJobs.delete(job.roomId);
      enqueue(job);
    });
  };

  const unsubscribe = gapFillScheduler.onEnqueue(enqueue);

  const stop = (): void => {
    stopped = true;
    latestJobs.clear();
    deferredJobs.clear();
    unsubscribe();
  };

  return { recheckDeferred, stop };
};
