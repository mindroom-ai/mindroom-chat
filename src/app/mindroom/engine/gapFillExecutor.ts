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
 *   - Snapshot the pre-gap cached tail before fetching and keep those
 *     event ids on the marker across cursor checkpoints.
 *   - Clear only after a committed page overlaps that cached tail, or
 *     the SDK confirms there is no more history to fetch.
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
import {
  checkpointRoomTailDiscontinuity,
  clearRoomTailDiscontinuity,
  getTailDiscontinuityGeneration,
  loadLatestCachedRoomEvents,
  loadRoomTailDiscontinuity,
} from '../threads/cacheStore';
import { persistRoomChunkWithPreferLive } from '../threads/eventRepository';
import type { BackfillScheduler } from './backfillScheduler';
import {
  GAP_FILL_OVERLAP_TAIL_LIMIT,
  type GapFillJob,
  type GapFillScheduler,
} from './engineGapTracker';
import {
  DEFAULT_PREFETCH_SCOPE,
  isRoomEligibleForBackgroundPrefetch,
  isRoomEligibleForRawFetch,
  resolveRoomPrefetchTier,
  type PrefetchConfig,
} from './prefetchPolicy';

export { GAP_FILL_OVERLAP_TAIL_LIMIT } from './engineGapTracker';

// Batch size for the /messages page — matches the app's other backfill
// batches so the scheduler's cooperative abort granularity is
// consistent across job kinds.
const GAP_FILL_BATCH_SIZE = GAP_FILL_OVERLAP_TAIL_LIMIT;

// The startup/ongoing sync filter is capped at 20 timeline events
// (STARTUP_SYNC_TIMELINE_LIMIT in client/initMatrix.ts). Keeping ten
// such windows ensures the snapshot taken for a limited-sync reset
// still contains the pre-reset side of the gap. A contract test ties
// these independently-owned constants together without making the
// engine depend on client startup code. The ids are persisted on the
// marker before any /messages page is written, so later capped runs
// cannot displace this original boundary.
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
  /**
   * CINNY-207 P7.2 audit finding #5: supplies the live user
   * `PrefetchConfig` on every runOnce. The executor consults
   * `config.scope` via `isRoomEligibleForBackgroundPrefetch` before
   * fetching, so a user switching to `current-room-only` immediately
   * suppresses background gap-fills on non-focused rooms.
   * Optional to preserve back-compat for existing test constructors.
   * When absent, the executor falls back to the default `my-server`
   * policy — the historical behavior.
   */
  readonly getPrefetchConfig?: () => PrefetchConfig;
  /**
   * CINNY-207 P7.2 audit finding #5: returns the currently-focused
   * room id (populated by `MindroomSyncEngine.noteRoomFocused`). Only
   * consulted when `config.scope === 'current-room-only'`. Optional
   * for the same back-compat reason as `getPrefetchConfig`.
   */
  readonly getFocusedRoomId?: () => string | undefined;
  /** Test hook for proving cursor advancement follows a committed write. */
  readonly persistChunk?: typeof persistRoomChunkWithPreferLive;
  /** Test hook for controlling the pre-gap cached-tail snapshot. */
  readonly loadCachedTail?: typeof loadLatestCachedRoomEvents;
  /** Test hook for failing or controlling the durable marker read. */
  readonly loadDiscontinuity?: typeof loadRoomTailDiscontinuity;
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
  const getPrefetchConfig = options.getPrefetchConfig;
  const getFocusedRoomId = options.getFocusedRoomId ?? (() => undefined);
  const persistChunk = options.persistChunk ?? persistRoomChunkWithPreferLive;
  const loadCachedTail = options.loadCachedTail ?? loadLatestCachedRoomEvents;
  const loadDiscontinuity = options.loadDiscontinuity ?? loadRoomTailDiscontinuity;
  let stopped = false;
  const latestJobs = new Map<string, GapFillJob>();
  const deferredJobs = new Map<string, GapFillJob>();
  const activeRooms = new Set<string>();

  const runOnce = async (
    job: GapFillJob,
    signal: AbortSignal
  ): Promise<'policy-deferred' | 'continuation-deferred' | undefined> => {
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

    let fromToken: string | null =
      durableMarker?.nextToken ?? job.prevBatch ?? durableMarker?.prevBatch ?? null;
    let overlapEventIds = durableMarker?.overlapEventIds;
    if (overlapEventIds === undefined) {
      let cachedTail;
      try {
        cachedTail = await loadCachedTail(sessionId, job.roomId, GAP_FILL_OVERLAP_TAIL_LIMIT);
      } catch {
        // Without a trustworthy boundary, preserve the marker and retry
        // instead of risking an unnecessary crawl to room genesis.
        return;
      }
      overlapEventIds = [
        ...new Set(
          cachedTail.events.flatMap((event) =>
            typeof event.event_id === 'string' && event.event_id.length > 0 ? [event.event_id] : []
          )
        ),
      ];
      if (durableMarker) {
        const boundaryCheckpointed = await checkpointRoomTailDiscontinuity(
          sessionId,
          job.roomId,
          generation,
          fromToken,
          overlapEventIds
        );
        if (!boundaryCheckpointed) return;
      }
    }

    // CINNY-207 P7.2 audit finding #5: scope-aware gate. Under
    // `my-server` (default) this collapses to the historical
    // `isRoomEligibleForRawFetch` policy (own-tier + not encrypted).
    // Under `all-rooms` federated rooms become eligible. Under
    // `current-room-only` only the currently-focused room passes.
    //
    // Encrypted rooms are always blocked by the helper — ciphertext is
    // unusable without decryption context. The marker-clearing branch
    // below still runs the historical own-tier check because that's
    // the shape it was designed for (encrypted-own clears, federated
    // preserves per Deviations §8); scope only affects the gating,
    // not the marker semantics for skipped rooms.
    const scope = getPrefetchConfig ? getPrefetchConfig().scope : DEFAULT_PREFETCH_SCOPE;
    const eligible = isRoomEligibleForBackgroundPrefetch({
      mx,
      room,
      scope,
      focusedRoomId: getFocusedRoomId(),
    });
    // Policy gate — federated / encrypted rooms are skipped entirely.
    // The gap-fill queue holds them because the P4 gate fix removed
    // the enqueue-time short-circuit (so `gapFillsEnqueued` and
    // `schedulerEnqueued` stay in lockstep for observability); this is
    // where they actually get filtered out.
    if (!eligible) {
      // Marker semantics preserved from the pre-#5 shape: encrypted-
      // own rooms clear their marker (we've declined to fill them
      // permanently — ciphertext is unusable), federated preserves
      // per Deviations §8. When `current-room-only` blocks a normally-
      // eligible room, preserve the marker so a scope-widen later
      // picks the work back up.
      if (isRoomEligibleForRawFetch(mx, room)) {
        // Only reachable under `current-room-only` for a non-focused
        // eligible room. Marker preserved.
        return 'policy-deferred';
      }
      if (resolveRoomPrefetchTier(mx, room) === 'own') {
        await clearRoomTailDiscontinuity(sessionId, room.roomId, generation).catch(() => undefined);
      } else {
        // A federated/background room can become eligible when the user
        // widens the live scope to all-rooms.
        return 'policy-deferred';
      }
      return;
    }

    const overlapEventIdSet = new Set(overlapEventIds);
    let iterations = 0;
    let reachedBoundary = false;
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
      const overlapsCachedTail = chunk.some(
        (event) => typeof event.event_id === 'string' && overlapEventIdSet.has(event.event_id)
      );
      if (chunk.length > 0) {
        // CINNY-207 P7.2 audit finding #3: chunks must funnel through
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
          // eslint-disable-next-line no-await-in-loop
          await persistChunk({
            mx,
            sessionId,
            room,
            chunk,
            beforeTokenForEarliest: response.end ?? null,
          });
        } catch {
          return;
        }
      }
      // The overlap page must commit before the marker is cleared. It
      // is safe (and useful for edit/redaction healing) to persist the
      // whole page, including the already-cached boundary event.
      if (overlapsCachedTail) {
        reachedBoundary = true;
        break;
      }
      // `end === undefined` (or an empty end string) means the SDK has
      // no more history to fetch in this direction.
      if (!response.end) {
        reachedBoundary = true;
        break;
      }
      // Same token twice is not proof of exhaustion. Preserve the
      // marker at its last committed cursor for a later retry.
      if (response.end === fromToken) {
        return;
      }
      // The marker may have been superseded by a newer TimelineReset
      // while this request was in flight. Stop instead of overwriting
      // the new generation's cursor.
      // eslint-disable-next-line no-await-in-loop
      const checkpointed = await checkpointRoomTailDiscontinuity(
        sessionId,
        job.roomId,
        generation,
        response.end
      );
      if (durableMarker && !checkpointed) return;
      fromToken = response.end;
      // Empty chunk after the first iteration indicates we've walked
      // past the useful range — stop persisting nothing.
      if (chunk.length === 0 && iterations > 1) {
        return;
      }
    }

    // CINNY-207 P5 review (greptile P1: gap marker clears early):
    // only clear the marker when the server has signaled "no more
    // history in this direction" or a committed page overlaps the
    // durable pre-gap tail. Previously we cleared
    // as soon as ANY batch persisted, which meant a gap larger than
    // GAP_FILL_MAX_ITERATIONS × GAP_FILL_BATCH_SIZE (= 4,000 events)
    // dropped the marker while the tail was still incomplete —
    // removing the only durable retry signal for the remaining gap.
    //
    // With this contract, if we hit the iteration cap with more
    // history still available (response.end still present after
    // batch 20), the marker survives and a subsequent boot / focus-
    // triggered run picks up from `nextToken`. The overlap ids remain
    // attached to the marker across checkpoints, so a later run still
    // recognizes the original cached tail even after many committed
    // gap pages have changed the cache's newest-event window.
    if (reachedBoundary) {
      await clearRoomTailDiscontinuity(sessionId, job.roomId, generation).catch(() => undefined);
      return;
    }
    return 'continuation-deferred';
  };

  const runLatest = (roomId: string): void => {
    if (stopped || activeRooms.has(roomId)) return;
    activeRooms.add(roomId);
    void (async () => {
      try {
        while (!stopped) {
          const job = latestJobs.get(roomId);
          if (!job) break;
          latestJobs.delete(roomId);
          let shouldDefer = false;
          // eslint-disable-next-line no-await-in-loop
          await scheduler
            .enqueue({
              roomId: job.roomId,
              kind: 'gap-fill',
              priority,
              execute: async (signal) => {
                shouldDefer = (await runOnce(job, signal)) !== undefined;
              },
            })
            .catch(() => undefined);
          if (shouldDefer && !latestJobs.has(roomId)) {
            deferredJobs.set(roomId, job);
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
    // P4 gate fix: NO tier short-circuit here. Every tracker enqueue
    // must produce a scheduler enqueue so `gapFillsEnqueued` and
    // `schedulerEnqueued` stay in lockstep — otherwise a probe snapshot
    // showing `gapFillsEnqueued>=1, schedulerCompleted=0` is ambiguous
    // (silent policy skip vs. real execution failure). The runOnce
    // policy gate (`isRoomEligibleForRawFetch`) still rejects federated
    // and encrypted rooms; those runs resolve fast (marker cleared for
    // encrypted-own, marker preserved for federated per Deviations §8)
    // and count as `schedulerCompleted`.
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

  const drainNow = (): void => {
    if (stopped) return;
    const pending = gapFillScheduler.pendingJobs();
    if (pending.length === 0) return;
    pending.forEach((job) => {
      gapFillScheduler.remove(job.roomId);
      enqueue(job);
    });
  };

  // Drain everything already queued (usually nothing on wire), then
  // subscribe so future enqueues dispatch immediately.
  drainNow();
  const unsubscribe = gapFillScheduler.onEnqueue((job) => {
    gapFillScheduler.remove(job.roomId);
    enqueue(job);
  });

  const stop = (): void => {
    stopped = true;
    latestJobs.clear();
    deferredJobs.clear();
    unsubscribe();
  };

  return { drainNow, recheckDeferred, stop };
};
