/**
 * Eager thread cache (2026-07-06): shared fetch→persist→seed pipeline
 * for proactively downloading a thread's full content.
 *
 * Extracted from `threadOverviewResumeController`'s
 * `refreshOverviewThreadCacheFromRelations` so the resume path (page
 * focus / online / visibility) and the thread-seed prewarm band share
 * ONE implementation of "drain this thread's `/relations`, then record
 * an honest snapshot". Both producers route the network side through
 * the engine scheduler's `'thread-backfill'` kind, so a user-triggered
 * thread open, a resume refresh, and a prewarm prefetch for the same
 * thread coalesce into a single round-trip (AC8 dedup).
 */

import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import {
  enqueueThreadBackfillJob,
  type BackfillJobPriority,
  type BackfillScheduler,
} from '../engine';
import {
  getLatestThreadSummaryInfoFromEventSources,
  type MindroomThreadSummaryInfo,
} from '../messages/threadSummary';
import { isCompleteCachedThreadSnapshot } from './threadCacheSnapshot';
import { saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';
import { getKnownThreadReplyCount } from './threadRecord';
import type { FetchedRelationOverviewUpdateOptions } from './threadOverviewCacheHydration';

type PersistThreadEventCache = (
  expectedThreadId: string,
  events: MatrixEvent[],
  rootEvent?: MatrixEvent | null,
  beforeTokenForEarliest?: string | null,
  tailLoaded?: boolean,
  snapshotComplete?: boolean,
  expectedReplyCount?: number,
  relationSnapshotComplete?: boolean
) => void;

export type FetchAndPersistThreadContentResult = {
  fetchedCount: number;
  snapshotComplete: boolean;
  relationSnapshotComplete: boolean;
};

export const fetchAndPersistThreadContent = async ({
  mx,
  scheduler,
  room,
  threadId,
  priority,
  shouldContinue,
  shouldApply,
  persistThreadEventCache,
  onApplyThreadRelations,
  onStoreThreadSummary,
}: {
  mx: MatrixClient;
  scheduler: BackfillScheduler;
  room: Room;
  threadId: string;
  priority: BackfillJobPriority;
  /**
   * Polled between fetch batches (cooperative abort) — see
   * `enqueueThreadBackfillJob`.
   */
  shouldContinue?: () => boolean;
  /**
   * Checked once after the fetch settles, BEFORE any state is written.
   * Callers use it for staleness guards (unmount, thread switch).
   */
  shouldApply?: () => boolean;
  persistThreadEventCache: PersistThreadEventCache;
  onApplyThreadRelations?: (options: FetchedRelationOverviewUpdateOptions) => void;
  onStoreThreadSummary?: (
    threadRootId: string,
    info: MindroomThreadSummaryInfo | undefined
  ) => void;
}): Promise<FetchAndPersistThreadContentResult | undefined> => {
  const rootEvent = room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId);
  if (!rootEvent) return undefined;

  const relationPageResult = await enqueueThreadBackfillJob({
    mx,
    scheduler,
    room,
    threadId,
    priority,
    shouldContinue,
  });
  if (!relationPageResult || (shouldApply && !shouldApply())) {
    return undefined;
  }

  const relationEvents = relationPageResult.events;
  const relationSnapshotComplete = typeof relationPageResult.nextBatchToken !== 'string';
  const expectedReplyCount = getKnownThreadReplyCount(rootEvent);
  const snapshotComplete = isCompleteCachedThreadSnapshot({
    room,
    threadId,
    rootEvent,
    cachedRootEvent: rootEvent,
    cachedEvents: rootEvent ? [rootEvent, ...relationEvents] : relationEvents,
    beforeToken: relationPageResult.nextBatchToken ?? null,
    hasMoreBefore: typeof relationPageResult.nextBatchToken === 'string',
    expectedReplyCount,
    snapshotComplete: relationSnapshotComplete,
    tailLoaded: true,
  });

  if (relationEvents.length > 0) {
    saveThreadOpenSeedSnapshot(room, threadId, relationEvents);
  }

  onApplyThreadRelations?.({
    rootId: threadId,
    room,
    events: relationEvents,
    rootEvent,
    beforeToken: relationPageResult.nextBatchToken ?? null,
    tailLoaded: true,
    snapshotComplete,
    expectedReplyCount,
    relationSnapshotComplete,
  });

  persistThreadEventCache(
    threadId,
    relationEvents,
    rootEvent,
    relationPageResult.nextBatchToken ?? null,
    true,
    snapshotComplete,
    expectedReplyCount,
    relationSnapshotComplete
  );

  if (onStoreThreadSummary) {
    const summaryInfo = getLatestThreadSummaryInfoFromEventSources(relationEvents);
    if (summaryInfo?.summaryText) {
      onStoreThreadSummary(threadId, summaryInfo);
    }
  }

  return {
    fetchedCount: relationEvents.length,
    snapshotComplete,
    relationSnapshotComplete,
  };
};
