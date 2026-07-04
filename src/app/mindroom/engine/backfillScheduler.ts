/**
 * CINNY-207 P4.1: BackfillScheduler.
 *
 * A single client-scoped queue that serializes every backfill-shaped
 * network fetch the app initiates: gap fills for the sync tail
 * discontinuities Phase 3 detected, thread-open backfills, thread-seed
 * warm-ups, and the room's own deep-history sweep. The scheduler
 * enforces two invariants that Phase 3 could not:
 *
 *   AC8: no duplicate in-flight jobs per (roomId, threadId, kind).
 *        Enqueuing while a job for the same key is queued or running
 *        returns the same promise identity — the caller gets the
 *        outcome of the in-flight job for free and never fires a
 *        second `/relations` or `/messages` request.
 *
 *   Priority + cap: bands 0-4 (0 = current-room / current-thread
 *        opened; 1 = my-server gap-fills on other rooms; 2 = recently-
 *        active my-server tails; 3 = thread inventory prewarm; 4 =
 *        current-room deep history sweep). Within a band, sort by
 *        `room.getLastActiveTimestamp()` descending so the most
 *        recently active work runs first. At most
 *        `MAX_CONCURRENT_BACKFILL_JOBS` (2) jobs run concurrently.
 *
 * The scheduler is purely a queue + dedup + cap; it does NOT know how
 * to fetch anything. Callers register executor functions when they
 * enqueue (the executor gets an AbortSignal for cooperative teardown)
 * and the scheduler drives them. That way P4.1 lands the invariant
 * before P4.2 wires the first real fetch path.
 *
 * Cooperative abort v1 (see plan §8 Deviations): the SDK's
 * `mx.fetchRelations` and `mx.createMessagesRequest` do NOT accept an
 * AbortSignal today. Executors receive the signal and MUST check
 * `signal.aborted` between batches (typically every 200 events) —
 * cancellation between requests, not mid-request. An `mx.http.
 * authedRequest({abortSignal})` migration is a recorded follow-up.
 *
 * The observability counters (`schedulerEnqueued`, `schedulerDeduped`,
 * `schedulerAborted`, `schedulerCompleted`, `schedulerFailed`) on
 * `window.__MINDROOM_CACHE_PROBE__` are the AC8 evidence handle. A
 * non-abort executor rejection increments `schedulerFailed` — added in
 * the P4 gate fix so a silent job failure is visible from a probe
 * snapshot rather than requiring log spelunking.
 */

import type { MatrixClient, Room } from 'matrix-js-sdk';
import { countCacheProbe } from '../threads/cacheProbe';

/**
 * Job kinds recognized by the scheduler. Only these four values are
 * accepted so priority and dedup logic stay pattern-matchable.
 */
export type BackfillJobKind =
  | 'gap-fill'
  | 'room-deep-history'
  | 'thread-backfill'
  | 'thread-seed';

/**
 * Priority bands (see module header). Lower number runs first. Within
 * a band, jobs are ordered by `room.getLastActiveTimestamp()`
 * descending — most recently active work first. When a room reference
 * cannot be resolved (room left, id typo) the activity tiebreaker
 * defaults to 0.
 */
export type BackfillJobPriority = 0 | 1 | 2 | 3 | 4;

export const MAX_CONCURRENT_BACKFILL_JOBS = 2;

/**
 * Executor callback the caller supplies at enqueue time. Receives the
 * scheduler's AbortSignal for cooperative cancellation between batches.
 * Return value flows through to the caller's awaited promise.
 */
export type BackfillJobExecutor<T = void> = (signal: AbortSignal) => Promise<T>;

/**
 * Public shape of an enqueued job. `signal` is exposed so the executor
 * or a test can observe abort state; callers should not construct this
 * type directly — use `enqueue()`.
 */
export type BackfillJob<T = unknown> = {
  readonly roomId: string;
  readonly threadId?: string;
  readonly kind: BackfillJobKind;
  readonly priority: BackfillJobPriority;
  readonly key: string;
  readonly promise: Promise<T>;
  readonly signal: AbortSignal;
};

export type EnqueueJobArgs<T = void> = {
  readonly roomId: string;
  readonly threadId?: string;
  readonly kind: BackfillJobKind;
  readonly priority: BackfillJobPriority;
  readonly execute: BackfillJobExecutor<T>;
};

export type BackfillScheduler = {
  /**
   * Enqueue a job. If a job with the same (roomId, threadId, kind) key
   * is already queued or in-flight, the existing promise is returned
   * unchanged — the executor supplied here is discarded. The dedup
   * counter (`schedulerDeduped`) is bumped on that path.
   *
   * The returned promise type is the intersection of what the executor
   * resolves; if the caller receives a deduped existing job they get
   * that job's resolved value, so callers relying on the return value
   * must be tolerant of "same value from earlier fetch".
   */
  enqueue<T>(args: EnqueueJobArgs<T>): Promise<T>;
  /**
   * Cancel a specific in-flight/queued job by key. Aborts the signal.
   * The executor's returned promise rejects with the abort reason once
   * it observes `signal.aborted` (or immediately if it hasn't started
   * running yet). Returns true when a matching job existed.
   */
  abort(roomId: string, threadId: string | undefined, kind: BackfillJobKind): boolean;
  /**
   * Cancel every queued and in-flight job. Used on engine `stop()` to
   * make sure no orphan fetches survive account switch / logout.
   */
  abortAll(): void;
  /**
   * Snapshot of scheduler state for tests and observability. Order is
   * not guaranteed except that queued jobs come before running jobs.
   */
  pendingJobs(): readonly BackfillJob[];
  /**
   * Test-only reset — clears jobs without dispatching aborts. Use
   * `abortAll()` in production teardown.
   */
  reset(): void;
};

/**
 * Compose the dedup key. Kept out of `enqueue` so the abort path can
 * reuse the exact same normalization.
 */
export const buildBackfillJobKey = (
  roomId: string,
  threadId: string | undefined,
  kind: BackfillJobKind
): string => `${roomId}|${threadId ?? ''}|${kind}`;

type QueueEntry<T = unknown> = {
  args: EnqueueJobArgs<T>;
  key: string;
  controller: AbortController;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  promise: Promise<T>;
};

type RunningEntry<T = unknown> = QueueEntry<T> & {
  runPromise: Promise<void>;
};

export type CreateBackfillSchedulerOptions = {
  /**
   * Optional Matrix client — required for the room activity tiebreaker
   * lookup. Tests can omit it, in which case within-band ordering
   * falls back to enqueue order.
   */
  mx?: MatrixClient;
  /**
   * Override the concurrency cap. Production always uses
   * `MAX_CONCURRENT_BACKFILL_JOBS`.
   */
  maxConcurrent?: number;
};

const resolveRoomActivityTs = (mx: MatrixClient | undefined, roomId: string): number => {
  if (!mx) return 0;
  const room: Room | null | undefined = mx.getRoom?.(roomId);
  if (!room) return 0;
  const ts = room.getLastActiveTimestamp?.();
  return typeof ts === 'number' && Number.isFinite(ts) ? ts : 0;
};

export const createBackfillScheduler = (
  options: CreateBackfillSchedulerOptions = {}
): BackfillScheduler => {
  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT_BACKFILL_JOBS;
  const mx = options.mx;

  // ONE map for both queued and running — AC8 requires dedup to hit
  // whether the same-key job is waiting for a slot or already
  // executing. Split states are represented by presence in `running`.
  const byKey = new Map<string, QueueEntry>();
  const queue: QueueEntry[] = [];
  const running = new Map<string, RunningEntry>();

  const pickNextIndex = (): number => {
    if (queue.length === 0) return -1;
    let bestIndex = 0;
    let bestPriority = queue[0].args.priority;
    let bestActivity = resolveRoomActivityTs(mx, queue[0].args.roomId);
    for (let i = 1; i < queue.length; i += 1) {
      const entry = queue[i];
      if (entry.args.priority < bestPriority) {
        bestIndex = i;
        bestPriority = entry.args.priority;
        bestActivity = resolveRoomActivityTs(mx, entry.args.roomId);
        continue;
      }
      if (entry.args.priority > bestPriority) continue;
      const activity = resolveRoomActivityTs(mx, entry.args.roomId);
      if (activity > bestActivity) {
        bestIndex = i;
        bestActivity = activity;
      }
    }
    return bestIndex;
  };

  const drain = (): void => {
    while (running.size < maxConcurrent && queue.length > 0) {
      const index = pickNextIndex();
      if (index < 0) return;
      const entry = queue.splice(index, 1)[0];
      if (entry.controller.signal.aborted) {
        // Consumer aborted before we picked it up — settle and continue.
        countCacheProbe('schedulerAborted');
        entry.reject(entry.controller.signal.reason ?? new Error('backfill aborted'));
        byKey.delete(entry.key);
        continue;
      }

      const runPromise = (async () => {
        try {
          const value = await entry.args.execute(entry.controller.signal);
          entry.resolve(value);
          if (entry.controller.signal.aborted) {
            countCacheProbe('schedulerAborted');
          } else {
            countCacheProbe('schedulerCompleted');
          }
        } catch (error) {
          entry.reject(error);
          if (entry.controller.signal.aborted) {
            countCacheProbe('schedulerAborted');
          } else {
            // P4 gate fix: previously we counted nothing on non-abort
            // errors, which made a silent createMessagesRequest /
            // saveRoomEventsToCache reject impossible to distinguish
            // from "job never ran" in an AC13 probe snapshot.
            countCacheProbe('schedulerFailed');
          }
        } finally {
          running.delete(entry.key);
          byKey.delete(entry.key);
          // Recurse via macrotask so a synchronous resolve doesn't
          // grow the stack when many jobs settle in a burst.
          Promise.resolve().then(drain);
        }
      })();

      const runningEntry: RunningEntry = { ...entry, runPromise };
      running.set(entry.key, runningEntry);
    }
  };

  const enqueue = <T>(args: EnqueueJobArgs<T>): Promise<T> => {
    const key = buildBackfillJobKey(args.roomId, args.threadId, args.kind);
    const existing = byKey.get(key);
    if (existing) {
      countCacheProbe('schedulerDeduped');
      return existing.promise as Promise<T>;
    }

    const controller = new AbortController();
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const entry: QueueEntry<T> = {
      args,
      key,
      controller,
      resolve,
      reject,
      promise,
    };
    byKey.set(key, entry as QueueEntry);
    queue.push(entry as QueueEntry);
    countCacheProbe('schedulerEnqueued');
    // Kick the drain on a microtask so callers can await the promise
    // without racing sync errors from the executor.
    Promise.resolve().then(drain);
    return promise;
  };

  const abort = (
    roomId: string,
    threadId: string | undefined,
    kind: BackfillJobKind
  ): boolean => {
    const key = buildBackfillJobKey(roomId, threadId, kind);
    const entry = byKey.get(key);
    if (!entry) return false;
    if (!entry.controller.signal.aborted) {
      entry.controller.abort(new Error('backfill aborted'));
    }
    // Running entries are cleaned up by the drain finally-block once
    // the executor observes the abort; queued entries are cleaned up
    // by the next drain pass (see the aborted-before-pickup branch).
    return true;
  };

  const abortAll = (): void => {
    // Snapshot first — abort() mutates queue/running via reject paths.
    const keys = Array.from(byKey.keys());
    keys.forEach((key) => {
      const entry = byKey.get(key);
      if (!entry) return;
      if (!entry.controller.signal.aborted) {
        entry.controller.abort(new Error('backfill scheduler stopped'));
      }
    });
  };

  const pendingJobs = (): readonly BackfillJob[] => {
    const toJob = (entry: QueueEntry): BackfillJob => ({
      roomId: entry.args.roomId,
      threadId: entry.args.threadId,
      kind: entry.args.kind,
      priority: entry.args.priority,
      key: entry.key,
      promise: entry.promise,
      signal: entry.controller.signal,
    });
    return [...queue.map(toJob), ...Array.from(running.values()).map(toJob)];
  };

  const reset = (): void => {
    byKey.clear();
    queue.length = 0;
    running.clear();
  };

  return {
    enqueue,
    abort,
    abortAll,
    pendingJobs,
    reset,
  };
};
