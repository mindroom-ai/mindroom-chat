import { MutableRefObject, useCallback, useMemo, useRef, useState } from 'react';
import { EventTimelineSet, MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import { aggregateCachedRelationEvents, hydrateCachedEvents } from './eventCacheEditUtils';
import {
  getThreadInitialRenderMode,
  mergeThreadRenderEvents,
  ThreadInitialRenderMode,
} from './threadRenderUtils';
import { eventBelongsToThread } from './threadUtils';

type UseThreadRenderStateOpts = {
  room: Room;
  roomTimelineSet: EventTimelineSet;
  threadTimelineSet?: EventTimelineSet;
  threadId?: string;
  thread: Thread | null;
  threadInitialCacheHydrated: boolean;
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

const buildThreadEvents = ({
  room,
  threadId,
  thread,
  fallbackEvents,
  threadInitialCacheHydrated,
}: {
  room: Room;
  threadId: string;
  thread: Thread | null;
  fallbackEvents: MatrixEvent[];
  threadInitialCacheHydrated: boolean;
}): {
  events: MatrixEvent[];
  indexMap: Map<string, number>;
} => {
  const collectedEvents: MatrixEvent[] = [];
  const initialRenderMode = getThreadInitialRenderMode({
    threadId,
    initialCacheHydrated: threadInitialCacheHydrated,
    fallbackEventCount: fallbackEvents.length,
  });

  const addThreadEvent = (mEvent?: MatrixEvent | null, requireThreadMatch = true) => {
    const eventId = mEvent?.getId();
    if (!eventId) return;
    if (requireThreadMatch && eventId !== threadId && !eventBelongsToThread(mEvent, threadId)) return;
    collectedEvents.push(mEvent);
  };

  if (initialRenderMode === 'live') {
    const threadModelReady = !!thread;
    addThreadEvent(thread?.rootEvent ?? room.findEventById(threadId), !threadModelReady);
    if (threadModelReady) {
      thread?.events.forEach((mEvent) => addThreadEvent(mEvent, false));
    }
  }

  if (fallbackEvents.length > 0) {
    fallbackEvents.forEach((mEvent) => addThreadEvent(mEvent, false));
  }

  const sortedEvents = mergeThreadRenderEvents([], collectedEvents);

  hydrateCachedEvents({
    room,
    events: sortedEvents,
  });

  const indexMap = new Map<string, number>();
  sortedEvents.forEach((mEvent, index) => {
    const eventId = mEvent.getId();
    if (eventId) indexMap.set(eventId, index);
  });

  return {
    events: sortedEvents,
    indexMap,
  };
};

export const useThreadRenderState = ({
  room,
  roomTimelineSet,
  threadTimelineSet,
  threadId,
  thread,
  threadInitialCacheHydrated,
}: UseThreadRenderStateOpts): {
  threadEventIndexMapRef: MutableRefObject<Map<string, number>>;
  threadEvents: MatrixEvent[];
  threadInitialRenderMode: ThreadInitialRenderMode;
  setSupplementalThreadEvents: (expectedThreadId: string, events: MatrixEvent[]) => void;
  resetThreadRenderState: (nextThreadId?: string) => void;
} => {
  const threadEventIndexMapRef = useRef<Map<string, number>>(new Map());
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

  const setSupplementalThreadEvents = useCallback(
    (expectedThreadId: string, events: MatrixEvent[]) => {
      const fallbackState = fallbackThreadEventsRef.current;
      const currentEvents = fallbackState.threadId === expectedThreadId ? fallbackState.events : [];
      const mergedEvents = mergeThreadRenderEvents(currentEvents, events);

      hydrateCachedEvents({
        room,
        events: mergedEvents,
      });

      const relationState = threadSupplementalRelationIdsRef.current;
      if (relationState.threadId !== expectedThreadId) {
        relationState.threadId = expectedThreadId;
        relationState.relationEventIds = new Set();
      }
      aggregateCachedRelationEvents(
        events,
        [threadTimelineSet, roomTimelineSet],
        relationState.relationEventIds
      );

      const nextFallbackState = {
        threadId: expectedThreadId,
        events: mergedEvents,
      };
      fallbackThreadEventsRef.current = nextFallbackState;
      setFallbackThreadEventsState(nextFallbackState);
    },
    [room, roomTimelineSet, threadTimelineSet]
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

  const fallbackEvents = useMemo(() => {
    if (!threadId || fallbackThreadEventsState.threadId !== threadId) {
      return EMPTY_THREAD_EVENTS;
    }
    return fallbackThreadEventsState.events;
  }, [fallbackThreadEventsState.events, fallbackThreadEventsState.threadId, threadId]);

  const threadEvents = useMemo(() => {
    if (!threadId) {
      threadEventIndexMapRef.current = new Map();
      return [];
    }

    const nextState = buildThreadEvents({
      room,
      threadId,
      thread,
      fallbackEvents,
      threadInitialCacheHydrated,
    });
    threadEventIndexMapRef.current = nextState.indexMap;
    return nextState.events;
  }, [fallbackEvents, room, thread, threadId, threadInitialCacheHydrated]);

  const threadInitialRenderMode = getThreadInitialRenderMode({
    threadId,
    initialCacheHydrated: threadInitialCacheHydrated,
    fallbackEventCount: fallbackEvents.length,
  });

  return {
    threadEventIndexMapRef,
    threadEvents,
    threadInitialRenderMode,
    setSupplementalThreadEvents,
    resetThreadRenderState,
  };
};
