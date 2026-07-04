import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Direction, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { logTimelineDebug } from './timelineDebug';
import { type Timeline } from './timelinePagination';
import {
  findEarliestLoadedRoomEventByCacheOrder,
  getEarliestLoadedRoomEvent,
  getMainTimelineCacheEvents,
  getThreadCacheTargetId,
  groupThreadCacheEvents,
  loadRoomCachePersistenceState,
  loadRoomCachedBackStateSnapshot,
  persistRoomEventCacheSnapshot,
} from './eventRepository';
import type { ThreadCachePersistenceController } from './threadCachePersistenceController';
import { ROOM_CACHE_PERSIST_DEBOUNCE_MS } from './preloadSettings';

const getEventId = (mEvent: MatrixEvent): string | undefined => mEvent.getId() ?? undefined;

export type PersistRoomEventCache = (
  events: MatrixEvent[],
  beforeTokenForEarliest?: string | null
) => void;

export const useRoomCacheLifecycleController = ({
  alive,
  eventId,
  eventsLength,
  persistThreadCacheFromRoomEvents,
  room,
  roomDebugTraceId,
  roomIdRef,
  sessionId,
  setRoomHasMoreCachedBack,
  setTimeline,
  threadId,
  threadIdRef,
  timeline,
}: {
  alive: () => boolean;
  eventId?: string;
  eventsLength: number;
  persistThreadCacheFromRoomEvents: ThreadCachePersistenceController['persistThreadCacheFromRoomEvents'];
  room: Room;
  roomDebugTraceId: string;
  roomIdRef: MutableRefObject<string>;
  sessionId: string;
  setRoomHasMoreCachedBack: Dispatch<SetStateAction<boolean>>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
  timeline: Timeline;
}): { persistRoomEventCache: PersistRoomEventCache } => {
  const persistRoomEventCache = useCallback<PersistRoomEventCache>(
    (events, beforeTokenForEarliest) => {
      const snapshot = persistRoomEventCacheSnapshot({
        sessionId,
        room,
        events,
        beforeTokenForEarliest,
      });
      logTimelineDebug(roomDebugTraceId, 'room-cache-persist', {
        beforeTokenForEarliest: beforeTokenForEarliest ?? null,
        rawEventCount: snapshot.rawEvents.length,
        sourceEventCount: snapshot.sourceEventCount,
      });
    },
    [room, roomDebugTraceId, sessionId]
  );

  const persistedRoomCacheEventIdsRef = useRef<Set<string>>(new Set());
  const persistedThreadCacheEventIdsRef = useRef<Set<string>>(new Set());
  const persistedCacheRoomIdRef = useRef<string>(room.roomId);
  const lastSweepTokenStateRef = useRef<
    { backwardToken: string | null | undefined; roomTailLoaded: boolean } | undefined
  >(undefined);

  useEffect(() => {
    if (threadId) return undefined;
    if (persistedCacheRoomIdRef.current !== room.roomId) {
      persistedCacheRoomIdRef.current = room.roomId;
      persistedRoomCacheEventIdsRef.current = new Set();
      persistedThreadCacheEventIdsRef.current = new Set();
      lastSweepTokenStateRef.current = undefined;
    }
    let cancelled = false;

    const persistCurrentRoomCache = async () => {
      const currentLinkedTimelines = timeline.linkedTimelines;
      const cacheEvents = getMainTimelineCacheEvents(room, currentLinkedTimelines);
      const threadCacheEvents = currentLinkedTimelines.flatMap((timelineItem) =>
        timelineItem.getEvents().filter((mEvent) => !!getThreadCacheTargetId(room, mEvent))
      );
      const firstTimeline = currentLinkedTimelines[0];
      const lastTimeline = currentLinkedTimelines[currentLinkedTimelines.length - 1];
      const currentBeforeToken = firstTimeline?.getPaginationToken(Direction.Backward);
      const roomTailLoaded = !lastTimeline?.getPaginationToken(Direction.Forward);
      // Token/tail transitions (e.g. backward pagination discovering the room
      // start) must be persisted even when they arrive with no unseen events,
      // and they change the per-thread derived flags for every group. The
      // undefined initial state deliberately makes the first sweep of a room
      // mount a full one: it re-derives per-thread flags from current token
      // state and captures events that arrived while the room was unmounted
      // (finding F1). The delta guard targets the per-live-event repeat
      // sweeps (finding F2), not this once-per-open baseline.
      const lastTokenState = lastSweepTokenStateRef.current;
      const tokenStateChanged =
        !lastTokenState ||
        lastTokenState.backwardToken !== currentBeforeToken ||
        lastTokenState.roomTailLoaded !== roomTailLoaded;

      // Delta pass: events already persisted by an earlier sweep (or the
      // incremental live path re-serializing them as relation targets) are
      // skipped, so a sweep costs O(new events), not O(loaded timeline).
      // Marking happens after the fire-and-forget save is issued; a failed
      // write therefore stays unnoticed for the session (accepted: counted by
      // the probe, cache is rebuildable per D8, surfacing lands in P1.5).
      const seenRoomEventIds = persistedRoomCacheEventIdsRef.current;
      const seenThreadEventIds = persistedThreadCacheEventIdsRef.current;
      const unseenRoomEvents = cacheEvents.filter((mEvent) => {
        const eventId = getEventId(mEvent);
        return !!eventId && !seenRoomEventIds.has(eventId);
      });
      const affectedThreadEvents: MatrixEvent[] = [];
      groupThreadCacheEvents(room, threadCacheEvents).forEach((groupEvents) => {
        // Persist full groups (not just unseen events) so per-thread derived
        // metadata (expectedReplyCount, completeness flags) stays computed
        // from the whole loaded thread slice.
        const groupHasUnseenEvent = groupEvents.some((mEvent) => {
          const eventId = getEventId(mEvent);
          return !!eventId && !seenThreadEventIds.has(eventId);
        });
        if (tokenStateChanged || groupHasUnseenEvent) {
          affectedThreadEvents.push(...groupEvents);
        }
      });

      if (
        unseenRoomEvents.length === 0 &&
        affectedThreadEvents.length === 0 &&
        !tokenStateChanged
      ) {
        return;
      }

      const earliestLoadedEvent = findEarliestLoadedRoomEventByCacheOrder(cacheEvents);
      const roomCachePersistenceState = await loadRoomCachePersistenceState({
        sessionId,
        roomId: room.roomId,
        earliestLoadedEventId: earliestLoadedEvent?.getId(),
        currentBeforeToken,
      });

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      if (firstTimeline && roomCachePersistenceState.shouldClearBackwardToken) {
        firstTimeline.setPaginationToken(null, Direction.Backward);
        setTimeline((currentTimeline) =>
          currentTimeline.linkedTimelines === currentLinkedTimelines
            ? { ...currentTimeline }
            : currentTimeline
        );
      }

      const persistableRoomEvents = [...unseenRoomEvents];
      const earliestLoadedEventId = earliestLoadedEvent?.getId();
      // A token proof that differs from the cached one (typically the → null
      // room-start transition) must reach the meta record even when the
      // earliest event itself was already persisted: re-include it so the
      // token stays keyed to the overall-earliest event.
      const tokenProofChanged =
        roomCachePersistenceState.beforeTokenForEarliest !==
        roomCachePersistenceState.cachedBeforeToken;
      if (
        tokenProofChanged &&
        earliestLoadedEvent &&
        earliestLoadedEventId &&
        !persistableRoomEvents.some((mEvent) => mEvent.getId() === earliestLoadedEventId)
      ) {
        persistableRoomEvents.push(earliestLoadedEvent);
      }

      if (persistableRoomEvents.length > 0) {
        // The cached backward token is keyed to the earliest persisted event;
        // only pass it when this delta actually contains that event (i.e.
        // after a backward pagination or a forced token-proof refresh),
        // otherwise the token map would key the room-start proof to the
        // wrong event.
        const deltaContainsEarliest =
          !!earliestLoadedEventId &&
          persistableRoomEvents.some((mEvent) => mEvent.getId() === earliestLoadedEventId);
        persistRoomEventCache(
          persistableRoomEvents,
          deltaContainsEarliest ? roomCachePersistenceState.beforeTokenForEarliest : undefined
        );
        persistableRoomEvents.forEach((mEvent) => {
          const eventId = getEventId(mEvent);
          if (eventId) seenRoomEventIds.add(eventId);
        });
      }

      if (affectedThreadEvents.length > 0) {
        persistThreadCacheFromRoomEvents(affectedThreadEvents, {
          roomStartKnown: roomCachePersistenceState.roomStartKnown,
          roomTailLoaded,
        });
        affectedThreadEvents.forEach((mEvent) => {
          const eventId = getEventId(mEvent);
          if (eventId) seenThreadEventIds.add(eventId);
        });
      }

      lastSweepTokenStateRef.current = {
        backwardToken: currentBeforeToken,
        roomTailLoaded,
      };
    };

    const persistTimer = setTimeout(() => {
      persistCurrentRoomCache();
    }, ROOM_CACHE_PERSIST_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(persistTimer);
    };
  }, [
    alive,
    eventId,
    eventsLength,
    persistRoomEventCache,
    persistThreadCacheFromRoomEvents,
    room,
    roomIdRef,
    sessionId,
    setTimeline,
    threadId,
    threadIdRef,
    timeline.linkedTimelines,
  ]);

  useEffect(() => {
    if (threadId) {
      setRoomHasMoreCachedBack(false);
      return undefined;
    }

    let cancelled = false;
    const refreshRoomCachedBackState = async () => {
      const currentLinkedTimelines = timeline.linkedTimelines;
      const earliestLoadedEvent = getEarliestLoadedRoomEvent(room, currentLinkedTimelines);
      const cachedBackState = await loadRoomCachedBackStateSnapshot({
        sessionId,
        roomId: room.roomId,
        earliestLoadedEvent,
      });
      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      const firstTimeline = currentLinkedTimelines[0];
      if (firstTimeline && cachedBackState.cachedBeforeToken === null) {
        const currentBeforeToken = firstTimeline.getPaginationToken(Direction.Backward);
        if (currentBeforeToken !== null) {
          firstTimeline.setPaginationToken(null, Direction.Backward);
          setTimeline((currentTimeline) =>
            currentTimeline.linkedTimelines === currentLinkedTimelines
              ? { ...currentTimeline }
              : currentTimeline
          );
        }
      }

      setRoomHasMoreCachedBack(cachedBackState.hasCachedBack);
    };

    refreshRoomCachedBackState();
    return () => {
      cancelled = true;
    };
  }, [
    alive,
    eventId,
    eventsLength,
    room,
    roomIdRef,
    sessionId,
    setRoomHasMoreCachedBack,
    setTimeline,
    threadId,
    threadIdRef,
    timeline.linkedTimelines,
  ]);

  return { persistRoomEventCache };
};
