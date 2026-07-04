/**
 * CINNY-207 P5.1 Commit 2: thread-backfill scheduler job producer.
 *
 * Routes the `/relations` fetch that the pre-P5
 * `backfillThreadRelationsIntoCache` used to fire directly through the
 * P4.1 BackfillScheduler. Same `'thread-backfill'` kind P4.4 already
 * uses for the overview-resume producer — same dedup domain — so a
 * user-triggered thread open and a background overview resume for the
 * same thread coalesce into one round-trip, and both get the
 * scheduler's concurrency cap + cooperative abort for free.
 *
 * The React-side render-state work (setSupplementalThreadEvents,
 * saveThreadOpenSeedSnapshot, persistThreadEventCache,
 * setThreadTailLoaded, forceTimelineUpdate, tick) stays in the
 * controller — this producer is purely the network side of the fetch
 * so the arch guard for `/relations` can tighten (defined + imported
 * only within engine/**). A reconcile job on the same thread coexists
 * (different kind, different dedup domain, in-place divergence
 * checks) — both may run against the same thread but not the same
 * (kind, thread) key.
 */

import type { MatrixClient, Room } from 'matrix-js-sdk';
import {
  fetchAllThreadRelations,
  type ThreadRelationPageResult,
} from './threadRelationsFetcher';
import type { BackfillJobPriority, BackfillScheduler } from './backfillScheduler';

const THREAD_BACKFILL_BATCH_SIZE = 200;

export type EnqueueThreadBackfillArgs = {
  readonly mx: MatrixClient;
  readonly scheduler: BackfillScheduler;
  readonly room: Room;
  readonly threadId: string;
  /**
   * Priority band. Callers that open a thread the user is looking at
   * pass 0; background resume-style callers pass a higher band (P4.4
   * overview-resume uses band 2).
   */
  readonly priority?: BackfillJobPriority;
  /**
   * Optional predicate the executor polls between iterations —
   * complements the scheduler's AbortSignal. A component unmount can
   * short-circuit before the scheduler's abort propagates.
   */
  readonly shouldContinue?: () => boolean;
};

/**
 * Enqueue a thread-backfill fetch. Returns the scheduler's promise;
 * production callers await it to read `events` + `nextBatchToken`.
 * `null` is returned when the fetch aborted, failed on the first
 * page, or the shouldContinue predicate flipped false — same shape
 * `fetchAllThreadRelations` returns to its callers.
 */
export type ThreadBackfillResult = ThreadRelationPageResult | null;

export const enqueueThreadBackfillJob = (
  args: EnqueueThreadBackfillArgs
): Promise<ThreadBackfillResult> => {
  const { mx, scheduler, room, threadId, priority = 0, shouldContinue } = args;
  return scheduler.enqueue<ThreadBackfillResult>({
    roomId: room.roomId,
    threadId,
    kind: 'thread-backfill',
    priority,
    execute: async (signal) => {
      if (signal.aborted) return null;
      return fetchAllThreadRelations(
        mx,
        room.roomId,
        threadId,
        THREAD_BACKFILL_BATCH_SIZE,
        () => signal.aborted || (shouldContinue ? !shouldContinue() : false)
      );
    },
  });
};
