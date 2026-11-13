import { EventTimelineSet, MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import { getThreadCacheTargetId } from '../cache/eventRepository';

/**
 * ISSUE-207 P1.2: redaction lifecycle for the MindRoom event caches.
 *
 * Redaction events carry `redacts`, not `m.relates_to`, so the live-event
 * controller's relation-based thread checks never match them (finding F6-A).
 * This module plans the cache cleanup a redaction requires:
 *
 * - A redacted **reaction** must be deleted from the caches (a stale record
 *   otherwise resurrects the reaction chip on the next hydration) and removed
 *   from the SDK relation aggregation when the aggregated copy is a
 *   cache-mapped clone the SDK cannot redact by instance (finding F6-B).
 * - A redacted **message** keeps its record (tombstone) but must be
 *   re-persisted so the pruned content reaches the cache.
 * - An **unknown target** (not in SDK memory) cannot be classified; it is
 *   left to the reconcile pass (plan step P5). Deleting blindly could drop a
 *   message tombstone.
 */

export type RedactionCacheCleanupPlan = {
  redactedEventId: string;
  /** Thread root the redacted event's cache records live under, if any. */
  threadCacheTargetId?: string;
  /** Delete the redacted event's record from the caches (reactions only). */
  deleteRecords: boolean;
};

export const planRedactionCacheCleanup = ({
  room,
  redactionEvent,
  sdkThreadIdHint,
}: {
  room: Room;
  redactionEvent: MatrixEvent;
  /**
   * ISSUE-207 P3 gate re-fix (layer 2): the third arg of the
   * `RoomEvent.Redaction` emission (matrix-js-sdk 41.7.0). matrix-js-sdk
   * captures the target's `threadRootId` BEFORE calling `makeRedacted`
   * (see `applyEventAsRedaction` in room.js). That means this hint is
   * available even for reactions whose relation has since been stripped —
   * so it is authoritative attribution. Highest priority in the hint chain.
   */
  sdkThreadIdHint?: string;
}): RedactionCacheCleanupPlan | undefined => {
  if (!redactionEvent.isRedaction()) return undefined;
  const redactedEventId = redactionEvent.getAssociatedId();
  if (!redactedEventId) return undefined;

  const targetEvent = room.findEventById(redactedEventId);
  if (!targetEvent) {
    return { redactedEventId, deleteRecords: false };
  }

  // By the time RoomEvent.Redaction fires the target is already pruned, so
  // its `m.relates_to` (and often its thread association) is gone. Fall back
  // through every attribution signal we have; the engine has a further
  // cache-derived layer (layer 1) that covers the case where all of these
  // return undefined.
  const hintedThreadTargetId =
    sdkThreadIdHint ??
    getThreadCacheTargetId(room, targetEvent) ??
    targetEvent.threadRootId ??
    redactionEvent.threadRootId;
  return {
    redactedEventId,
    // The SDK thread scan covers a redacted event still threaded at fire time
    // (thread messages). For reactions the SDK has already called
    // `moveAllRelatedToMainTimeline`, so it finds nothing and the engine
    // falls through to layer 1 (cache-derived scopes).
    threadCacheTargetId:
      hintedThreadTargetId ?? findSingleSdkThreadContaining(room, redactedEventId),
    deleteRecords: targetEvent.getType() === 'm.reaction',
  };
};

/**
 * Return the thread id whose unfiltered timelineSet contains the given
 * event id, only when exactly one thread contains it. Multiple hits
 * (ambiguous) or zero hits both return undefined so the caller falls
 * through to its existing by-event-id scan + room-scope persist path
 * instead of guessing an attribution.
 *
 * Uses `EventTimelineSet.findEventById` (SDK's own event index) rather
 * than iterating live-timeline slices, so it stays O(threads).
 */
const findSingleSdkThreadContaining = (room: Room, redactedEventId: string): string | undefined => {
  const threads = room.getThreads?.() ?? [];
  let match: string | undefined;
  for (const thread of threads) {
    const found = thread.getUnfilteredTimelineSet().findEventById(redactedEventId);
    if (!found) continue;
    if (match) return undefined;
    match = thread.id;
  }
  return match;
};

type RelationsLike = {
  getRelations: () => MatrixEvent[];
  removeEvent: (mEvent: MatrixEvent) => unknown;
};

type TimelineSetLike = Pick<EventTimelineSet, 'relations'>;

/**
 * Remove a redacted reaction from relation aggregations by event id rather
 * than object identity. Needed when the aggregated copy is a cache-mapped
 * clone: the SDK's own redaction handling removes reactions by instance, so
 * a clone survives and keeps painting the chip (finding F6-B).
 *
 * A pruned reaction no longer knows its parent (`m.relates_to` is redacted
 * away), so callers pass candidate parent ids (e.g. the rendered thread
 * event ids) and every candidate's annotation container is scanned.
 *
 * Returns the parent event id the reaction was removed from, if any.
 */
export const removeAggregatedReactionByEventId = ({
  timelineSets,
  candidateParentIds,
  redactedEventId,
}: {
  timelineSets: Array<TimelineSetLike | undefined>;
  candidateParentIds: Iterable<string>;
  redactedEventId: string;
}): string | undefined => {
  const uniqueTimelineSets = Array.from(
    new Set(timelineSets.filter((timelineSet): timelineSet is TimelineSetLike => !!timelineSet))
  );
  if (uniqueTimelineSets.length === 0) return undefined;

  let removedFromParentId: string | undefined;
  const parentIds = Array.from(new Set(candidateParentIds));

  for (const parentId of parentIds) {
    // A reaction has exactly one parent, so stop scanning candidates once a
    // removal happened — but always sweep every timelineSet for that parent:
    // the same reaction aggregates in both the room and thread sets.
    uniqueTimelineSets.forEach((timelineSet) => {
      const relations = timelineSet.relations.getChildEventsForEvent(
        parentId,
        RelationType.Annotation,
        'm.reaction'
      ) as RelationsLike | undefined;
      if (!relations) return;

      const aggregatedReaction = relations
        .getRelations()
        .find((relationEvent) => relationEvent.getId() === redactedEventId);
      if (!aggregatedReaction) return;

      relations.removeEvent(aggregatedReaction);
      removedFromParentId = parentId;
    });
    if (removedFromParentId) break;
  }

  return removedFromParentId;
};
