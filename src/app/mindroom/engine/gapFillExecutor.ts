/**
 * CINNY-207 P4.2: gap-fill executor.
 *
 * Phase 3.2 planted a `GapFillScheduler` interface with an in-memory
 * queue and a `gapFillsEnqueued` probe counter — that gave AC13 a
 * detection signal but no execution. This module is the executor: it
 * hands each enqueued gap-fill job to the P4.1 `BackfillScheduler` (so
 * we get dedup + priority + concurrency cap for free), fetches the
 * missing tail via `mx.createMessagesRequest`, persists the returned
 * raw events through `saveRoomEventsToCache`, and clears the durable
 * `tailDiscontinuity` marker when done.
 *
 * Contract with the durable marker:
 *   - On success (any events persisted OR the SDK confirmed there is
 *     nothing left to fetch): clear the marker so the next boot skips
 *     the retry.
 *   - On abort: leave the marker in place — the next boot will retry.
 *   - On error: leave the marker in place. We swallow the error so the
 *     scheduler slot frees; the next `RoomEvent.TimelineReset` or
 *     `Sync -> PREPARED` will re-enqueue.
 *
 * Ordering: the scheduler already runs my-server-room work at bands 1
 * (`gap-fill` on other rooms) and 0 (jobs targeting the current room),
 * so the same `BackfillJobKind = 'gap-fill'` is used for both — the
 * caller controls priority. Federated rooms are skipped entirely per
 * the prefetch policy.
 */

import type { IEvent, MatrixClient, Room } from 'matrix-js-sdk';
import { Direction } from 'matrix-js-sdk';
import { saveRoomEventsToCache } from '../threads/cacheStore';
import { clearRoomTailDiscontinuity } from '../threads/cacheStore';
import type { BackfillScheduler } from './backfillScheduler';
import type { GapFillJob, GapFillScheduler } from './engineGapTracker';
import { isRoomEligibleForRawFetch, resolveRoomPrefetchTier } from './prefetchPolicy';

// Batch size for the /messages page — matches the app's other backfill
// batches so the scheduler's cooperative abort granularity is
// consistent across job kinds.
const GAP_FILL_BATCH_SIZE = 200;

// Cap on iterations per gap-fill job. Guards against pathological
// homeservers that stream tokens forever. In practice a gap-fill
// terminates when the SDK returns `end === undefined` (no more
// history) or when we've reached the current live tail.
const GAP_FILL_MAX_ITERATIONS = 20;

export type GapFillExecutorOptions = {
  readonly mx: MatrixClient;
  readonly sessionId: string;
  readonly scheduler: BackfillScheduler;
  /** Priority band for gap-fills on rooms other than the focused one. */
  readonly priority?: 0 | 1 | 2;
};

/**
 * Wire the executor to a `GapFillScheduler` (the Phase 3.2 queue).
 * On wire we drain any jobs already queued (typically zero, since the
 * gap tracker only enqueues after Sync->PREPARED and TimelineReset),
 * and subscribe to future enqueues so a fresh limited-sync reset
 * dispatches a fill immediately. Returns a teardown that unsubscribes
 * and blocks further enqueues.
 */
export type GapFillExecutor = {
  drainNow(): void;
  stop(): void;
};

export const createGapFillExecutor = (
  options: GapFillExecutorOptions,
  gapFillScheduler: GapFillScheduler
): GapFillExecutor => {
  const { mx, sessionId, scheduler } = options;
  const priority = options.priority ?? 1;
  let stopped = false;

  const runOnce = async (job: GapFillJob, signal: AbortSignal): Promise<void> => {
    const room: Room | null | undefined = mx.getRoom?.(job.roomId);
    if (!room) return;
    // Policy gate — federated / encrypted rooms are skipped entirely.
    // The gap-fill queue holds them because the P4 gate fix removed
    // the enqueue-time short-circuit (so `gapFillsEnqueued` and
    // `schedulerEnqueued` stay in lockstep for observability); this is
    // where they actually get filtered out.
    if (!isRoomEligibleForRawFetch(mx, room)) {
      // Encrypted-own rooms: clear the marker — we've explicitly
      // declined to fill them (ciphertext is unusable without
      // decryption context) so a stale marker would otherwise
      // accumulate. Federated rooms: preserve the marker per
      // Deviations §8 (federated rooms are handled by user attention,
      // not background sweeps; a later user-triggered fill will pick
      // the marker up).
      if (resolveRoomPrefetchTier(mx, room) === 'own') {
        await clearRoomTailDiscontinuity(sessionId, room.roomId).catch(
          () => undefined
        );
      }
      return;
    }

    let fromToken: string | null = job.prevBatch ?? null;
    let iterations = 0;
    let persistedAnyBatch = false;
    let reachedEnd = false;
    while (iterations < GAP_FILL_MAX_ITERATIONS) {
      if (signal.aborted) return;
      iterations += 1;
      let response;
      try {
        response = await mx.createMessagesRequest(
          job.roomId,
          fromToken,
          GAP_FILL_BATCH_SIZE,
          Direction.Backward
        );
      } catch (error) {
        // Homeserver error — bail without clearing the marker so the
        // next boot re-attempts. Swallow so the scheduler slot frees.
        return;
      }
      if (signal.aborted) return;
      const chunk: Partial<IEvent>[] = Array.isArray(response?.chunk)
        ? (response.chunk as Partial<IEvent>[])
        : [];
      if (chunk.length > 0) {
        // The SDK returns chunk from newest to oldest for backward
        // pagination; saveRoomEventsToCache normalizes ordering
        // internally via origin_server_ts sorting.
        // eslint-disable-next-line no-await-in-loop
        await saveRoomEventsToCache(sessionId, job.roomId, chunk, response.end ?? null);
        persistedAnyBatch = true;
      }
      // `end === undefined` (or an empty end string) means the SDK has
      // no more history to fetch in this direction.
      if (!response.end) {
        reachedEnd = true;
        break;
      }
      // Same token twice in a row means the SDK is stuck — bail.
      if (response.end === fromToken) {
        reachedEnd = true;
        break;
      }
      fromToken = response.end;
      // Empty chunk after the first iteration indicates we've walked
      // past the useful range — stop persisting nothing.
      if (chunk.length === 0 && iterations > 1) {
        reachedEnd = true;
        break;
      }
    }

    if (persistedAnyBatch || reachedEnd) {
      await clearRoomTailDiscontinuity(sessionId, job.roomId).catch(() => undefined);
    }
  };

  const enqueue = (job: GapFillJob): void => {
    if (stopped) return;
    // P4 gate fix: NO tier short-circuit here. Every tracker enqueue
    // must produce a scheduler enqueue so `gapFillsEnqueued` and
    // `schedulerEnqueued` stay in lockstep — otherwise a probe snapshot
    // showing `gapFillsEnqueued>=1, schedulerCompleted=0` is ambiguous
    // (silent policy skip vs. real execution failure). The runOnce
    // policy gate (`isRoomEligibleForRawFetch`) still rejects federated
    // and encrypted rooms; those runs resolve fast (marker cleared for
    // encrypted-own, marker preserved for federated per Deviations §8)
    // and count as `schedulerCompleted`.
    scheduler
      .enqueue({
        roomId: job.roomId,
        kind: 'gap-fill',
        priority,
        execute: (signal) => runOnce(job, signal),
      })
      .catch(() => undefined);
  };

  const drainNow = (): void => {
    if (stopped) return;
    const pending = gapFillScheduler.pendingJobs();
    if (pending.length === 0) return;
    pending.forEach(enqueue);
    gapFillScheduler.clear();
  };

  // Drain everything already queued (usually nothing on wire), then
  // subscribe so future enqueues dispatch immediately.
  drainNow();
  const unsubscribe = gapFillScheduler.onEnqueue((job) => enqueue(job));

  const stop = (): void => {
    stopped = true;
    unsubscribe();
  };

  return { drainNow, stop };
};
