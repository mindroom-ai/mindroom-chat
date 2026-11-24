import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { type MatrixClient, type Room } from 'matrix-js-sdk';
import { insertCachedRoomTimeline, prependCachedRoomTimeline } from '../event-store/sdk/roomTimelineSdk';
import { markCacheHydrateEnd, markCacheHydrateStart } from '../event-store/cache/cacheProbe';
import { logTimelineDebug } from '../diagnostics/timelineDebug';
import { ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE } from '../event-store/cache/preloadSettings';
import {
  getLiveTimeline,
  type RecalibrateFilterOpts,
  type Timeline,
} from '../event-store/timeline/timelinePagination';
import { keepCachedHistoryReplies } from '../event-store/cache/cachedHistoryReplies';
import { getLinkedTimelines } from '../event-store/timeline/linkedTimelines';
import {
  createPreferLiveEventMapper,
  findEarliestLoadedRoomEventByCacheOrder,
  getEarliestLoadedRoomEvent,
  getMainTimelineCacheEvents,
  getRoomCursorAnchor,
  loadLatestRoomCacheHydrationSnapshot,
  shouldHydrateLatestRoomCache,
} from '../event-store/cache/eventRepository';
import type { RoomTimelineFocusItem } from './roomFocusScrollController';

type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

export const useRoomCacheHydrationController = ({
  alive,
  buildInitialTimeline,
  eventId,
  focusItemRef,
  mx,
  recalibrateFilterOptsRef,
  room,
  roomDebugTraceId,
  roomIdRef,
  scrollToBottomRef,
  sessionId,
  setAtBottom,
  setFocusItem,
  setRoomInitialCacheHydratedKey,
  setTimeline,
  threadId,
  threadIdRef,
}: {
  alive: () => boolean;
  buildInitialTimeline: () => Timeline;
  eventId?: string;
  /** The jump to an event the timeline last made, if any. */
  focusItemRef: MutableRefObject<RoomTimelineFocusItem | undefined>;
  mx: MatrixClient;
  recalibrateFilterOptsRef: RefObject<RecalibrateFilterOpts | undefined>;
  room: Room;
  roomDebugTraceId: string;
  roomIdRef: MutableRefObject<string>;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  sessionId: string;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  setFocusItem: Dispatch<SetStateAction<RoomTimelineFocusItem | undefined>>;
  setRoomInitialCacheHydratedKey: Dispatch<SetStateAction<string | undefined>>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
}): void => {
  useEffect(() => {
    if (threadId || eventId) return undefined;

    let cancelled = false;
    const hydrateRoomFromCache = async () => {
      const jumpAtOpen = focusItemRef.current?.eventId;
      markCacheHydrateStart('room');
      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-start', {
        limit: ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE,
      });

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      const currentLinkedTimelines = getLinkedTimelines(getLiveTimeline(room));
      const loadedRoomEvents = getMainTimelineCacheEvents(room, currentLinkedTimelines);
      const mapper = mx.getEventMapper();
      const mapCachedEvent = createPreferLiveEventMapper(room, mapper);
      const hydrationSnapshot = await loadLatestRoomCacheHydrationSnapshot({
        sessionId,
        roomId: room.roomId,
        // ISSUE-207 PR #72 review (greptile P2): paint-time hydration
        // reads the interactive bound, not `prefetchDepth` (default
        // 10_000, which scanned/materialized thousands of IDB records
        // before first paint). Background depth belongs to the
        // deep-history job alone.
        limit: ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE,
        loadedEvents: loadedRoomEvents,
        mapEvent: mapCachedEvent,
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

      const { events: cachedEvents, prependEvents } = hydrationSnapshot;
      if (cachedEvents.length === 0 && prependEvents.length === 0) {
        logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-empty-after-filter', {
          cachedCount: hydrationSnapshot.cachedPage.events.length,
          loadedRoomCount: hydrationSnapshot.loadedRoomCount,
        });
        return;
      }

      // A limited sync may replace the live chain while IndexedDB is reading.
      // Never apply a cached overlap/token decision to a different chain.
      if (getLiveTimeline(room) !== currentLinkedTimelines[currentLinkedTimelines.length - 1]) {
        return;
      }
      const timelineWasEmpty = getLiveTimeline(room).getEvents().length === 0;
      if (prependEvents.length > 0) {
        const currentRoomEvents = getMainTimelineCacheEvents(
          room,
          getLinkedTimelines(getLiveTimeline(room))
        );
        if (
          findEarliestLoadedRoomEventByCacheOrder(currentRoomEvents)?.getId() !==
          findEarliestLoadedRoomEventByCacheOrder(loadedRoomEvents)?.getId()
        ) {
          return;
        }
        await prependCachedRoomTimeline({
          mx,
          room,
          events: [...prependEvents].reverse(),
          firstTimeline: currentLinkedTimelines[0]!,
          beforeToken: hydrationSnapshot.cachedPage.beforeToken,
          showThreadRepliesInRoom: false,
        });
      }
      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;
      if (getLiveTimeline(room) !== currentLinkedTimelines[currentLinkedTimelines.length - 1]) {
        return;
      }
      // Decryption during prepend can yield to newer live events on the same
      // timeline. Only append missing events beyond its current tail, while
      // retaining cached revisions and reusing any newly arrived live copies.
      const currentRoomEvents = getMainTimelineCacheEvents(
        room,
        getLinkedTimelines(getLiveTimeline(room))
      );
      const currentLatestEvent = currentRoomEvents[currentRoomEvents.length - 1];
      const currentEventIds = new Set(currentRoomEvents.map((event) => event.getId()));
      const eventsToInsert = cachedEvents
        .filter(
          (event) =>
            currentEventIds.has(event.getId()) ||
            shouldHydrateLatestRoomCache(currentLatestEvent, event.event)
        )
        .map((event) => mapCachedEvent(event.event));
      if (eventsToInsert.length > 0) {
        await insertCachedRoomTimeline({ mx, room, events: eventsToInsert });
      }
      // The Classic view also shows the thread replies of what the room now holds, which the
      // cache keeps apart: from the oldest saved event put before the room's events (the room's
      // timeline may not take it, such as an edit of an older reply), else from its earliest.
      const hydratedChain = getLinkedTimelines(getLiveTimeline(room));
      const earliestHydrated = getRoomCursorAnchor(
        (prependEvents[0] ?? getEarliestLoadedRoomEvent(room, hydratedChain))?.event
      );
      if (
        recalibrateFilterOptsRef.current?.showThreadRepliesInRoom &&
        earliestHydrated &&
        hydratedChain[0]
      ) {
        await keepCachedHistoryReplies({
          mx,
          sessionId,
          room,
          timeline: hydratedChain[0],
          from: earliestHydrated,
        });
      }

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;
      setTimeline(buildInitialTimeline());
      // A jump made while the cache was read (Jump to Unread right after the room opened) owns the
      // position: it goes to its row again in the rebuilt rows. Otherwise the room still opens at
      // its newest row.
      const jump = focusItemRef.current;
      if (jump?.eventId && jump.eventId !== jumpAtOpen) {
        setFocusItem({ ...jump, scrollTo: true });
      } else {
        setAtBottom(true);
        scrollToBottomRef.current.count++;
        scrollToBottomRef.current.smooth = false;
      }
      markCacheHydrateEnd('room');
      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-complete', {
        hydratedCount: eventsToInsert.length + prependEvents.length,
        timelineWasEmpty,
      });
    };

    hydrateRoomFromCache()
      .catch((error) => {
        logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-error', {
          error,
          roomId: room.roomId,
        });
      })
      .finally(() => {
        if (!cancelled && alive() && roomIdRef.current === room.roomId && !threadIdRef.current) {
          setRoomInitialCacheHydratedKey(room.roomId);
        }
        // ISSUE-207 P4.3: the old preload-done bookkeeping (used to
        // clear the eagerPreloading state when re-entering a room)
        // is gone with `useRoomEagerPreload`. Deep history now runs
        // in the engine's scheduler and does not gate rendering.
      });
    return () => {
      cancelled = true;
    };
  }, [
    alive,
    buildInitialTimeline,
    eventId,
    focusItemRef,
    mx,
    recalibrateFilterOptsRef,
    room,
    roomDebugTraceId,
    roomIdRef,
    scrollToBottomRef,
    sessionId,
    setAtBottom,
    setFocusItem,
    setRoomInitialCacheHydratedKey,
    setTimeline,
    threadId,
    threadIdRef,
  ]);
};
