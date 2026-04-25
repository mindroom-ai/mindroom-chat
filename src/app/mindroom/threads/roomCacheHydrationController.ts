import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { type MatrixClient, type Room } from 'matrix-js-sdk';
import to from 'await-to-js';
import { decryptAllTimelineEvent } from '../../utils/room';
import { hydrateCachedEvents } from '../../features/room/eventCacheEditUtils';
import { logTimelineDebug } from './timelineDebug';
import {
  getLinkedTimelines,
  getLiveTimeline,
  type Timeline,
} from './timelinePagination';
import {
  getMainTimelineCacheEvents,
  loadLatestRoomCacheHydrationSnapshot,
} from './eventRepository';

type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

export const useRoomCacheHydrationController = ({
  alive,
  buildInitialTimeline,
  eagerPreloadDoneForRoomRef,
  eventId,
  mx,
  room,
  roomDebugTraceId,
  roomIdRef,
  safePaginationLimit,
  scrollToBottomRef,
  sessionId,
  setAtBottom,
  setEagerPreloading,
  setRoomInitialCacheHydratedKey,
  setTimeline,
  threadId,
  threadIdRef,
}: {
  alive: () => boolean;
  buildInitialTimeline: () => Timeline;
  eagerPreloadDoneForRoomRef: MutableRefObject<string | null>;
  eventId?: string;
  mx: MatrixClient;
  room: Room;
  roomDebugTraceId: string;
  roomIdRef: MutableRefObject<string>;
  safePaginationLimit: number;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  sessionId: string;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  setEagerPreloading: Dispatch<SetStateAction<boolean>>;
  setRoomInitialCacheHydratedKey: Dispatch<SetStateAction<string | undefined>>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
}): void => {
  useEffect(() => {
    if (threadId || eventId) return undefined;

    let cancelled = false;
    const hydrateRoomFromCache = async () => {
      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-start', {
        limit: safePaginationLimit,
      });

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      const currentLinkedTimelines = getLinkedTimelines(getLiveTimeline(room));
      const loadedRoomEvents = getMainTimelineCacheEvents(room, currentLinkedTimelines);
      const mapper = mx.getEventMapper();
      const hydrationSnapshot = await loadLatestRoomCacheHydrationSnapshot({
        sessionId,
        roomId: room.roomId,
        limit: safePaginationLimit,
        loadedEvents: loadedRoomEvents,
        mapEvent: (rawEvent) => mapper(rawEvent),
      });

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-page', {
        cachedCount: hydrationSnapshot.cachedPage.events.length,
        hasMoreBefore: hydrationSnapshot.cachedPage.hasMoreBefore,
        loadedRoomCount: hydrationSnapshot.loadedRoomCount,
      });

      if (hydrationSnapshot.status === 'already-loaded') {
        logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-skip-latest-already-loaded', {
          cachedCount: hydrationSnapshot.cachedPage.events.length,
          loadedRoomCount: hydrationSnapshot.loadedRoomCount,
        });
        return;
      }

      const cachedEvents = hydrationSnapshot.events;
      if (cachedEvents.length === 0) {
        logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-empty-after-filter', {
          cachedCount: hydrationSnapshot.cachedPage.events.length,
          loadedRoomCount: hydrationSnapshot.loadedRoomCount,
        });
        return;
      }

      hydrateCachedEvents({
        room,
        events: cachedEvents,
      });

      const liveTimeline = getLiveTimeline(room);
      const timelineWasEmpty = liveTimeline.getEvents().length === 0;
      await room.addLiveEvents(cachedEvents, {
        fromCache: true,
        timelineWasEmpty,
        addToState: false,
      });
      mx.processAggregatedTimelineEvents(room, cachedEvents);

      if (room.hasEncryptionStateEvent()) {
        await to(decryptAllTimelineEvent(mx, liveTimeline));
      }

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;
      setTimeline(buildInitialTimeline());
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
      setAtBottom(true);
      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-complete', {
        hydratedCount: cachedEvents.length,
        timelineWasEmpty,
      });
    };

    hydrateRoomFromCache()
      .catch((error) => {
        console.error('Failed to hydrate latest room cache for', room.roomId, error);
      })
      .finally(() => {
        if (!cancelled && alive() && roomIdRef.current === room.roomId && !threadIdRef.current) {
          setRoomInitialCacheHydratedKey(room.roomId);
        }
        // On re-entry (preload already done for this room), clear eagerPreloading
        // regardless of whether cache hydration ran. On initial mount the preload
        // effect handles clearing it, so only clear when preload is already done.
        if (!cancelled && eagerPreloadDoneForRoomRef.current === room.roomId) {
          setEagerPreloading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    alive,
    buildInitialTimeline,
    eagerPreloadDoneForRoomRef,
    eventId,
    mx,
    room,
    roomDebugTraceId,
    roomIdRef,
    safePaginationLimit,
    scrollToBottomRef,
    sessionId,
    setAtBottom,
    setEagerPreloading,
    setRoomInitialCacheHydratedKey,
    setTimeline,
    threadId,
    threadIdRef,
  ]);
};
