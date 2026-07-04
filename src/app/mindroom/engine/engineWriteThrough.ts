/**
 * CINNY-207 P3.1 (Commit 3): global Tier-1 write-through.
 *
 * The engine's write-through owns every live cache write. It is called
 * once per live event delivered by the client-level listeners in
 * `mindroomSyncEngine.ts`, and it covers EVERY joined room — not just
 * the room currently mounted in the UI. That's the fix for finding F1
 * (background room cache freshness): a live message in a background
 * room now reaches the cache immediately, so switching to that room
 * later renders from a cache that already knows about it.
 *
 * Semantics preserved verbatim from the previous
 * `roomLiveEventController` write path:
 *   - scheduleReplaceCompaction: arm-time cross-sender direct persist,
 *     D12-latest pending map (isEventOrderedAfter), fire-time
 *     target-miss standalone fallback with editCompactionTargetMisses
 *     probe, fire-time cross-sender [target, replace] pair emit,
 *     thread attribution captured at schedule time.
 *   - Redaction lifecycle: planRedactionCacheCleanup +
 *     removeAggregatedReactionByEventId over both timelineSets, with
 *     candidateParentIds derived from the room's live timeline event
 *     ids plus every thread timelineSet's live event ids.
 *
 * Semantic changes (product-owner-accepted, recorded in Deviations):
 *   - Live thread appends persist `tailLoaded: true` always. Today
 *     the component controller passes `atLiveEndRef.current`; the
 *     engine has no atLiveEnd notion because it isn't the UI. This
 *     is safe because `mergeThreadCacheFlag` never downgrades true
 *     to false; a live event by definition IS at the tail.
 *   - Redaction persists use `tailLoaded: undefined` (no-downgrade)
 *     regardless of which thread is open — same as today except we
 *     no longer key off "the currently open thread".
 */

import type { EventTimelineSet, MatrixEvent, Room } from 'matrix-js-sdk';
import { RelationType } from 'matrix-js-sdk';
import { isEventOrderedAfter } from '../../utils/room';
import { countCacheProbe } from '../threads/cacheProbe';
import {
  deleteRoomEventsFromCache,
  deleteThreadEventFromCacheByEventId,
  deleteThreadEventsFromCache,
  getThreadCacheTargetId,
  persistRoomEventCacheSnapshot,
  persistThreadEventCacheSnapshot,
} from '../threads/eventRepository';
import { THREAD_EDIT_COMPACTION_DEBOUNCE_MS } from '../threads/preloadSettings';
import {
  createEditCompactionScheduler,
  type EditCompactionScheduler,
} from './editCompactionScheduler';
import {
  planRedactionCacheCleanup,
  removeAggregatedReactionByEventId,
} from './redactionCacheLifecycle';
import type { EngineLiveEventHandler, EngineLiveEventMeta } from './types';

export type EngineWriteThroughOptions = {
  sessionId: string;
  /**
   * Test hook: override the scheduler (e.g. to use a shorter debounce
   * or to inspect internal state). Production always uses the default.
   */
  scheduler?: EditCompactionScheduler;
};

export type EngineWriteThrough = {
  handleLiveEvent: EngineLiveEventHandler;
  /**
   * Flush any pending compaction work to the cache. Called by the
   * engine on stop() and on window pagehide / document
   * visibilitychange→hidden.
   */
  flush(): void;
};

/**
 * Persist a single thread event via the snapshot writer. Wraps
 * `persistThreadEventCacheSnapshot` so the call sites stay short and
 * always agree on the tailLoaded default (true — see file header).
 */
const persistThreadEvents = (
  sessionId: string,
  room: Room,
  threadId: string,
  events: MatrixEvent[],
  tailLoaded: boolean | undefined = true
): void => {
  const rootEvent = room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId);
  persistThreadEventCacheSnapshot({
    sessionId,
    room,
    threadId,
    events,
    rootEvent,
    tailLoaded,
  });
};

const persistRoomEvents = (sessionId: string, room: Room, events: MatrixEvent[]): void => {
  persistRoomEventCacheSnapshot({ sessionId, room, events });
};

/**
 * Collect the ids of every event the SDK currently has in memory for
 * this room, across the room's live timeline and every thread's
 * unfiltered timelineSet. This is the same set the component
 * controller used to build `candidateParentIds` for the redaction
 * cleanup — reactions can hang off any of these.
 */
const collectRoomEventIds = (room: Room): Set<string> => {
  const ids = new Set<string>();
  room
    .getLiveTimeline()
    .getEvents()
    .forEach((mEvent) => {
      const id = mEvent.getId();
      if (id) ids.add(id);
    });
  const threads = room.getThreads?.() ?? [];
  threads.forEach((thread) => {
    thread
      .getUnfilteredTimelineSet()
      .getLiveTimeline()
      .getEvents()
      .forEach((mEvent) => {
        const id = mEvent.getId();
        if (id) ids.add(id);
      });
  });
  return ids;
};

/**
 * Collect the timelineSets the redaction cleanup should scan for
 * aggregated reactions on the redacted target. Includes the room's
 * unfiltered timelineSet plus the thread timelineSet of the redacted
 * target if we have a thread attribution.
 */
const collectRedactionTimelineSets = (
  room: Room,
  threadCacheTargetId: string | undefined
): (EventTimelineSet | undefined)[] => {
  const threadTimelineSet = threadCacheTargetId
    ? room.getThread(threadCacheTargetId)?.getUnfilteredTimelineSet()
    : undefined;
  return [threadTimelineSet, room.getUnfilteredTimelineSet()];
};

export const createEngineWriteThrough = (
  options: EngineWriteThroughOptions
): EngineWriteThrough => {
  const { sessionId } = options;
  const scheduler =
    options.scheduler ?? createEditCompactionScheduler(THREAD_EDIT_COMPACTION_DEBOUNCE_MS);
  const pendingCompactionReplace = new Map<string, MatrixEvent>();

  /**
   * Shared compaction scheduling. Returns false when the replace must
   * persist directly (no scheduler — impossible in production, kept
   * for parity — or a cross-sender arm-time replace: the serializer
   * only bundles same-sender replacements onto the target, so
   * compacting a cross-sender replace would drop it from cache
   * entirely). Fire-time misses persist the replace standalone via
   * the durability fallback (also counted in the probe).
   */
  const scheduleReplaceCompaction = (
    key: string,
    targetEventId: string,
    replaceEvent: MatrixEvent,
    room: Room,
    persistEvents: (events: MatrixEvent[]) => void
  ): boolean => {
    if (!scheduler) return false;
    const knownTarget = room.findEventById(targetEventId);
    if (knownTarget && knownTarget.getSender() !== replaceEvent.getSender()) {
      return false;
    }
    const previousReplace = pendingCompactionReplace.get(key);
    const capturedReplace =
      previousReplace && isEventOrderedAfter(previousReplace, replaceEvent)
        ? previousReplace
        : replaceEvent;
    pendingCompactionReplace.set(key, capturedReplace);

    scheduler.scheduleTargetUpsert(key, () => {
      const pendingReplace = pendingCompactionReplace.get(key) ?? capturedReplace;
      pendingCompactionReplace.delete(key);
      const targetEvent = room.findEventById(targetEventId);
      countCacheProbe('editCompactions');
      if (!targetEvent) {
        countCacheProbe('editCompactionTargetMisses');
        persistEvents([pendingReplace]);
        return;
      }
      if (targetEvent.getSender() !== pendingReplace.getSender()) {
        persistEvents([targetEvent, pendingReplace]);
        return;
      }
      persistEvents([targetEvent]);
    });
    return true;
  };

  const handleRedactionLive = (event: MatrixEvent, room: Room) => {
    const cleanupPlan = planRedactionCacheCleanup({
      room,
      redactionEvent: event,
      // Engine has no notion of an "open thread"; the cleanup plan
      // must derive its thread attribution from the redacted target
      // itself (SDK state) rather than from a UI context.
      fallbackThreadId: undefined,
    });
    if (!cleanupPlan) return;

    if (cleanupPlan.deleteRecords) {
      if (cleanupPlan.threadCacheTargetId) {
        deleteThreadEventsFromCache(
          sessionId,
          room.roomId,
          cleanupPlan.threadCacheTargetId,
          [cleanupPlan.redactedEventId]
        ).catch(() => undefined);
      } else {
        deleteThreadEventFromCacheByEventId(
          sessionId,
          room.roomId,
          cleanupPlan.redactedEventId
        ).catch(() => undefined);
      }
      deleteRoomEventsFromCache(sessionId, room.roomId, [cleanupPlan.redactedEventId]).catch(
        () => undefined
      );

      const candidateParentIds = collectRoomEventIds(room);
      removeAggregatedReactionByEventId({
        timelineSets: collectRedactionTimelineSets(room, cleanupPlan.threadCacheTargetId),
        candidateParentIds,
        redactedEventId: cleanupPlan.redactedEventId,
      });
    }

    // Persist the redaction event itself in every case (see the
    // I2 comment in the component code we absorbed: homeservers can
    // serve stale un-pruned copies of the redacted event, so the
    // cached redaction record lets hydration re-apply it locally).
    if (cleanupPlan.threadCacheTargetId) {
      persistThreadEvents(
        sessionId,
        room,
        cleanupPlan.threadCacheTargetId,
        [event],
        // No-downgrade: redactions must not assert tail state either
        // way (the redaction can arrive without any tail context).
        undefined
      );
    }
    if (!cleanupPlan.threadCacheTargetId || cleanupPlan.threadTargetFromFallback) {
      persistRoomEvents(sessionId, room, [event]);
    }
  };

  const handleTimelineLive = (event: MatrixEvent, room: Room) => {
    const relation = event.getRelation();
    const relationTargetId = relation?.event_id;
    const threadCacheTargetId = getThreadCacheTargetId(room, event);

    // Thread-attributed live event.
    if (threadCacheTargetId) {
      const scheduled =
        relation?.rel_type === RelationType.Replace && relationTargetId
          ? scheduleReplaceCompaction(
              `thread|${room.roomId}|${threadCacheTargetId}|${relationTargetId}`,
              relationTargetId,
              event,
              room,
              (events) =>
                persistThreadEvents(sessionId, room, threadCacheTargetId, events, true)
            )
          : false;
      if (!scheduled) {
        persistThreadEvents(sessionId, room, threadCacheTargetId, [event], true);
      }
      return;
    }

    // Room-level (non-thread) replace: coalesce onto the target's
    // room cache record.
    if (relation?.rel_type === RelationType.Replace && relationTargetId) {
      const scheduled = scheduleReplaceCompaction(
        `room|${room.roomId}|${relationTargetId}`,
        relationTargetId,
        event,
        room,
        (events) => persistRoomEvents(sessionId, room, events)
      );
      if (scheduled) return;
    }

    // Plain room-level append.
    persistRoomEvents(sessionId, room, [event]);
  };

  const handleLiveEvent: EngineLiveEventHandler = (
    event: MatrixEvent,
    room: Room,
    meta: EngineLiveEventMeta
  ) => {
    countCacheProbe('engineLiveWrites');

    if (meta.kind === 'redaction') {
      handleRedactionLive(event, room);
      return;
    }

    // Timeline dispatch: redactions can also arrive through the
    // Timeline channel (the SDK re-emits them). Route via the
    // redaction lifecycle so the two entry points share cleanup.
    if (event.isRedaction()) {
      handleRedactionLive(event, room);
      return;
    }

    handleTimelineLive(event, room);
  };

  const flush = () => {
    scheduler.flushAll();
  };

  return { handleLiveEvent, flush };
};
