import {
  MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  EventStatus,
  EventTimelineSet,
  MatrixEvent,
  RelationType,
  Room,
  RoomEvent,
  type RoomEventHandlerMap,
  Thread,
} from 'matrix-js-sdk';
import { aggregateCachedRelationEvents, hydrateCachedEvents } from '../event-store/cache/eventCacheEditUtils';
import { removeAggregatedReactionByEventId } from '../event-store/engine/redactionCacheLifecycle';
import { useThreadEventRefresh } from '../event-store/threads/useThreadEventRefresh';
import {
  buildResolveConfirmedEventId,
  getThreadInitialRenderMode,
  mergeThreadRenderEvents,
  ThreadInitialRenderMode,
} from '../event-store/threads/threadRenderUtils';
import { eventBelongsToThread } from '../event-store/threads/threadUtils';
import { logTimelineDebug } from '../diagnostics/timelineDebug';
import { isLocalEchoEventId } from '../event-store/threads/threadRouteUtils';
import { getPendingThreadEvents } from '../event-store/cache/pendingThreadEvents';
import { getThreadTimelineEvents } from '../event-store/timeline/linkedTimelines';
import { useLatestRef } from '../lib/hooks/useLatestRef';

type UseThreadRenderStateOpts = {
  room: Room;
  roomTimelineSet: EventTimelineSet;
  threadTimelineSet?: EventTimelineSet;
  threadId?: string;
  thread: Thread | null;
  threadInitialCacheHydrated: boolean;
  threadInitialSdkLoaded?: boolean;
  /** The open holds its first paint (`firstPaintHeld`): no rows yet, the loading state shows. */
  threadFirstPaintHeld?: boolean;
  timelineRevision?: number;
  debugTraceId?: string;
  /** A fork's parent messages up to its fork point (`useThreadForkPrefix`), shown before its own. */
  prefixEvents?: MatrixEvent[];
  /** A fork draft's fork point: the rows end there when it is one of the thread's own events. */
  forkAt?: string;
};

type ThreadRelationState = {
  threadId?: string;
  relationEventIds: Set<string>;
};

type ThreadFallbackState = {
  threadId?: string;
  events: MatrixEvent[];
};

const EMPTY_THREAD_EVENTS: MatrixEvent[] = [];

/**
 * The thread's rows: the root, the SDK thread's events, the supplemental ones and the local echoes,
 * in thread order. A fork's prefix goes before them once the thread has rows of its own; `ownEvents`
 * leaves it out. In a fork draft the rows end at the fork point (`forkPointIndex`), while
 * `ownEvents` keeps the whole thread.
 */
const buildThreadEvents = ({
  room,
  threadId,
  thread,
  fallbackEvents,
  prefixEvents,
  forkAt,
  threadInitialCacheHydrated,
  threadInitialSdkLoaded = false,
}: {
  room: Room;
  threadId: string;
  thread: Thread | null;
  fallbackEvents: MatrixEvent[];
  prefixEvents: MatrixEvent[];
  forkAt: string | undefined;
  threadInitialCacheHydrated: boolean;
  threadInitialSdkLoaded: boolean;
}): {
  events: MatrixEvent[];
  ownEvents: MatrixEvent[];
  forkPointIndex: number | undefined;
  indexMap: Map<string, number>;
  initialRenderMode: ThreadInitialRenderMode;
} => {
  const collectedEvents: MatrixEvent[] = [];
  const sdkEvents = thread ? getThreadTimelineEvents(thread) : [];
  const initializationComplete =
    threadInitialCacheHydrated || threadInitialSdkLoaded || isLocalEchoEventId(threadId);

  const addThreadEvent = (mEvent?: MatrixEvent | null, requireThreadMatch = true) => {
    if (!mEvent) return;
    const eventId = mEvent.getId();
    if (!eventId) return;
    if (requireThreadMatch && eventId !== threadId && !eventBelongsToThread(mEvent, threadId))
      return;
    collectedEvents.push(mEvent);
  };

  if (sdkEvents.length > 0 || initializationComplete) {
    const threadModelReady = !!thread;
    addThreadEvent(thread?.rootEvent ?? room.findEventById(threadId), !threadModelReady);
    if (threadModelReady) {
      sdkEvents.forEach((mEvent) => addThreadEvent(mEvent, false));
    }
  }

  if (fallbackEvents.length > 0) {
    fallbackEvents.forEach((mEvent) => addThreadEvent(mEvent, false));
  }

  getPendingThreadEvents(room, threadId).forEach((event) => addThreadEvent(event));

  // The parent's messages belong to the parent's thread; they sort before the fork's root.
  const prefixIds = new Set(prefixEvents.map((mEvent) => mEvent.getId()));
  if (collectedEvents.length > 0) prefixEvents.forEach((mEvent) => addThreadEvent(mEvent, false));

  const resolveConfirmedId = buildResolveConfirmedEventId(room, collectedEvents);
  const sortedEvents = mergeThreadRenderEvents([], collectedEvents, resolveConfirmedId);
  const ownEvents =
    prefixIds.size === 0
      ? sortedEvents
      : sortedEvents.filter((mEvent) => !prefixIds.has(mEvent.getId()));
  // A fork draft shows the thread up to its fork point, one of its own events, and nothing after.
  const cut =
    forkAt === undefined || prefixIds.has(forkAt)
      ? -1
      : sortedEvents.findIndex((mEvent) => mEvent.getId() === forkAt);
  const forkPointIndex = cut === -1 ? undefined : cut;
  const events = forkPointIndex === undefined ? sortedEvents : sortedEvents.slice(0, cut + 1);

  const indexMap = new Map<string, number>();
  events.forEach((mEvent, index) => {
    const eventId = mEvent.getId();
    if (eventId) indexMap.set(eventId, index);
  });

  return {
    events,
    ownEvents,
    forkPointIndex,
    indexMap,
    initialRenderMode: getThreadInitialRenderMode({
      initializationComplete,
      availableEventCount: ownEvents.length,
    }),
  };
};

export const useThreadRenderState = ({
  room,
  roomTimelineSet,
  threadTimelineSet,
  threadId,
  thread,
  threadInitialCacheHydrated,
  threadInitialSdkLoaded = false,
  threadFirstPaintHeld = false,
  timelineRevision = 0,
  debugTraceId,
  prefixEvents = EMPTY_THREAD_EVENTS,
  forkAt,
}: UseThreadRenderStateOpts): {
  threadEventIndexMapRef: MutableRefObject<Map<string, number>>;
  threadEventIndexMap: Map<string, number>;
  /** The rows: a fork's prefix, then the thread's own events. */
  threadEvents: MatrixEvent[];
  /** The thread's own events, without a fork's prefix: what it reads, counts and loads. */
  ownThreadEvents: MatrixEvent[];
  /** In a fork draft, the row of its fork point, the last of `threadEvents`. */
  forkPointIndex: number | undefined;
  threadInitialRenderMode: ThreadInitialRenderMode;
  setSupplementalThreadEvents: (expectedThreadId: string, events: MatrixEvent[]) => void;
  resetThreadRenderState: (nextThreadId?: string) => void;
  /** The thread's rows as they show once nothing holds them, read now (no render needed). */
  getThreadRenderEvents: (expectedThreadId: string) => MatrixEvent[];
} => {
  const threadEventIndexMapRef = useRef<Map<string, number>>(new Map());
  const openThreadRef = useLatestRef({ threadId, thread });
  const threadSupplementalRelationIdsRef = useRef<ThreadRelationState>({
    threadId: undefined,
    relationEventIds: new Set(),
  });
  const fallbackThreadEventsRef = useRef<ThreadFallbackState>({
    threadId: undefined,
    events: [],
  });
  const [fallbackThreadEventsState, setFallbackThreadEventsState] = useState<ThreadFallbackState>({
    threadId: undefined,
    events: [],
  });
  const [threadEventRefreshTick, setThreadEventRefreshTick] = useState(0);
  const refreshThreadEvents = useCallback(() => {
    setThreadEventRefreshTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    if (!thread) return undefined;
    // Thread.Update waits for metadata requests; timeline insertion/reset does not.
    thread.on(RoomEvent.Timeline, refreshThreadEvents);
    thread.on(RoomEvent.TimelineReset, refreshThreadEvents);
    // Capture arrivals between render and subscription.
    refreshThreadEvents();
    return () => {
      thread.removeListener(RoomEvent.Timeline, refreshThreadEvents);
      thread.removeListener(RoomEvent.TimelineReset, refreshThreadEvents);
    };
  }, [thread, refreshThreadEvents]);

  const setSupplementalThreadEvents = useCallback(
    (expectedThreadId: string, events: MatrixEvent[]) => {
      const fallbackState = fallbackThreadEventsRef.current;
      const currentEvents = fallbackState.threadId === expectedThreadId ? fallbackState.events : [];
      const cancelledEvents = events.filter((mEvent) => mEvent.status === EventStatus.CANCELLED);
      const cancelledEventIds = new Set(
        cancelledEvents
          .map((mEvent) => mEvent.getId())
          .filter((eventId): eventId is string => !!eventId)
      );
      const retainedCurrentEvents = currentEvents.filter(
        (candidate) =>
          !cancelledEvents.includes(candidate) &&
          (!candidate.getId() || !cancelledEventIds.has(candidate.getId()!))
      );
      const activeEvents = events.filter((mEvent) => mEvent.status !== EventStatus.CANCELLED);
      const resolveConfirmedId = buildResolveConfirmedEventId(room, [
        ...retainedCurrentEvents,
        ...activeEvents,
      ]);
      const mergedEvents = mergeThreadRenderEvents(
        retainedCurrentEvents,
        activeEvents,
        resolveConfirmedId
      );

      const redactedRelationTargets = hydrateCachedEvents({
        room,
        events: mergedEvents,
      });

      const relationState = threadSupplementalRelationIdsRef.current;
      if (relationState.threadId !== expectedThreadId) {
        relationState.threadId = expectedThreadId;
        relationState.relationEventIds = new Set();
      }
      aggregateCachedRelationEvents(
        activeEvents,
        [threadTimelineSet, roomTimelineSet],
        relationState.relationEventIds,
        redactedRelationTargets
      );

      // ISSUE-207 P1.2 (finding F6): homeservers can serve stale un-pruned
      // copies of redacted reactions for a while after the redaction
      // (observed on Tuwunel /relations and /messages), and the SDK's own
      // timeline ingestion aggregates them outside our pipelines. Scrub
      // aggregations by event id for every target our merged set knows is
      // redacted — instance-agnostic, so both SDK copies and cache clones go.
      const redactionTargetIds = Array.from(
        new Set([
          ...mergedEvents
            .filter((mEvent) => mEvent.isRedaction())
            .map((mEvent) => mEvent.getAssociatedId())
            .filter((eventId): eventId is string => !!eventId),
        ])
      );
      if (redactionTargetIds.length > 0) {
        const candidateParentIds = mergedEvents
          .map((mEvent) => mEvent.getId())
          .filter((eventId): eventId is string => !!eventId);
        redactionTargetIds.forEach((redactedEventId) => {
          removeAggregatedReactionByEventId({
            timelineSets: [threadTimelineSet, roomTimelineSet],
            candidateParentIds,
            redactedEventId,
          });
        });
      }

      const nextFallbackState = {
        threadId: expectedThreadId,
        events: mergedEvents,
      };
      fallbackThreadEventsRef.current = nextFallbackState;
      setFallbackThreadEventsState(nextFallbackState);
    },
    [room, roomTimelineSet, threadTimelineSet]
  );

  const getThreadRenderEvents = useCallback(
    (expectedThreadId: string) => {
      const fallback = fallbackThreadEventsRef.current;
      const open = openThreadRef.current;
      if (open.threadId !== expectedThreadId) return EMPTY_THREAD_EVENTS;
      return buildThreadEvents({
        room,
        threadId: expectedThreadId,
        thread: open.thread,
        fallbackEvents: fallback.threadId === expectedThreadId ? fallback.events : [],
        prefixEvents: EMPTY_THREAD_EVENTS,
        forkAt: undefined,
        threadInitialCacheHydrated: true,
        threadInitialSdkLoaded: true,
      }).ownEvents;
    },
    [openThreadRef, room]
  );

  const resetThreadRenderState = useCallback((nextThreadId?: string) => {
    threadEventIndexMapRef.current = new Map();
    threadSupplementalRelationIdsRef.current = {
      threadId: nextThreadId,
      relationEventIds: new Set(),
    };
    const nextFallbackState = {
      threadId: nextThreadId,
      events: [],
    };
    fallbackThreadEventsRef.current = nextFallbackState;
    setFallbackThreadEventsState(nextFallbackState);
  }, []);

  useEffect(() => {
    if (!threadId) return undefined;

    const handleLocalEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (
      mEvent,
      eventRoom
    ) => {
      if (eventRoom.roomId !== room.roomId) return;
      if (mEvent.getRelation()?.rel_type !== RelationType.Thread) return;
      if (!eventBelongsToThread(mEvent, threadId)) return;

      // The SDK waits for its background thread-metadata request before it
      // emits Thread.NewReply. Render the room's direct local echo immediately
      // so a slow root request cannot hide a newly sent first reply. The
      // supplemental sink also removes this event if cancellation arrives.
      setSupplementalThreadEvents(threadId, [mEvent]);
    };

    room.on(RoomEvent.LocalEchoUpdated, handleLocalEcho);
    return () => {
      room.removeListener(RoomEvent.LocalEchoUpdated, handleLocalEcho);
    };
  }, [room, setSupplementalThreadEvents, threadId]);

  const fallbackEvents = useMemo(() => {
    if (!threadId || fallbackThreadEventsState.threadId !== threadId) {
      return EMPTY_THREAD_EVENTS;
    }
    return fallbackThreadEventsState.events;
  }, [fallbackThreadEventsState.events, fallbackThreadEventsState.threadId, threadId]);

  const threadEventState = useMemo(() => {
    void threadEventRefreshTick;
    // SDK joins can change history without emitting a thread event.
    void timelineRevision;

    if (!threadId || threadFirstPaintHeld) {
      return {
        events: EMPTY_THREAD_EVENTS,
        ownEvents: EMPTY_THREAD_EVENTS,
        forkPointIndex: undefined,
        indexMap: new Map<string, number>(),
        initialRenderMode: threadFirstPaintHeld ? ('loading' as const) : ('live' as const),
      };
    }

    return buildThreadEvents({
      room,
      threadId,
      thread,
      fallbackEvents,
      prefixEvents,
      forkAt,
      threadInitialCacheHydrated,
      threadInitialSdkLoaded,
    });
  }, [
    fallbackEvents,
    forkAt,
    prefixEvents,
    room,
    thread,
    threadEventRefreshTick,
    timelineRevision,
    threadId,
    threadInitialCacheHydrated,
    threadInitialSdkLoaded,
    threadFirstPaintHeld,
  ]);
  const {
    events: threadEvents,
    ownEvents: ownThreadEvents,
    forkPointIndex,
    indexMap: threadEventIndexMap,
    initialRenderMode: threadInitialRenderMode,
  } = threadEventState;
  useLayoutEffect(() => {
    threadEventIndexMapRef.current = threadEventIndexMap;
  }, [threadEventIndexMap]);

  const handleThreadNewReply = useCallback(
    (mEvent: MatrixEvent) => {
      if (!threadId) return;
      setSupplementalThreadEvents(threadId, [mEvent]);
    },
    [setSupplementalThreadEvents, threadId]
  );

  useThreadEventRefresh(
    thread ?? undefined,
    threadEvents,
    refreshThreadEvents,
    handleThreadNewReply
  );

  useEffect(() => {
    if (!threadId) return;
    logTimelineDebug(debugTraceId, 'render-state', {
      fallbackCount: fallbackEvents.length,
      indexCount: threadEventIndexMapRef.current.size,
      initialCacheHydrated: threadInitialCacheHydrated,
      initialRenderMode: threadInitialRenderMode,
      mergedCount: threadEvents.length,
      sdkThreadCount: thread ? getThreadTimelineEvents(thread).length : 0,
    });
  }, [
    debugTraceId,
    fallbackEvents.length,
    thread,
    threadEvents.length,
    threadId,
    threadInitialCacheHydrated,
    threadInitialRenderMode,
  ]);

  return {
    threadEventIndexMapRef,
    threadEventIndexMap,
    threadEvents,
    ownThreadEvents,
    forkPointIndex,
    threadInitialRenderMode,
    setSupplementalThreadEvents,
    resetThreadRenderState,
    getThreadRenderEvents,
  };
};
