import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Direction, type EventTimeline, type MatrixClient, type Room } from 'matrix-js-sdk';
import to from 'await-to-js';
import { decryptAllTimelineEvent } from '../../utils/room';
import {
  getRoomPreloadCounts,
  getRenderableEvents,
} from './roomTimelineEvents';
import { logTimelineDebug } from './timelineDebug';
import {
  getLinkedTimelines,
  getLiveTimeline,
  getTimelinesEventsCount,
  recalibrateTimelinePagination,
  timelineToEventsCount,
  type RecalibrateFilterOpts,
  type Timeline,
} from './timelinePagination';

type RoomEagerPreloadOptions = {
  alive: () => boolean;
  eventId?: string;
  eagerPreloadDoneForRoomRef: MutableRefObject<string | null>;
  mx: MatrixClient;
  recalibrateFilterOptsRef: MutableRefObject<RecalibrateFilterOpts | undefined>;
  room: Room;
  roomDebugTraceId: string;
  roomIdRef: MutableRefObject<string>;
  roomPaginatingBackRef: MutableRefObject<boolean>;
  safePaginationLimitRef: MutableRefObject<number>;
  setEagerPreloading: (eagerPreloading: boolean) => void;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  threadId?: string;
  threadIdRef: MutableRefObject<string | undefined>;
  useSurfacePreloadTarget: boolean;
};

export const useRoomEagerPreload = ({
  alive,
  eventId,
  eagerPreloadDoneForRoomRef,
  mx,
  recalibrateFilterOptsRef,
  room,
  roomDebugTraceId,
  roomIdRef,
  roomPaginatingBackRef,
  safePaginationLimitRef,
  setEagerPreloading,
  setTimeline,
  threadId,
  threadIdRef,
  useSurfacePreloadTarget,
}: RoomEagerPreloadOptions): void => {
  useEffect(() => {
    if (threadId || eventId) return undefined;
    if (eagerPreloadDoneForRoomRef.current === room.roomId) {
      // Cache hydration still needs to reset timeline.range before the loading flag clears.
      return undefined;
    }

    let cancelled = false;
    const BATCH_SIZE = 200;
    const MAX_STALLED_BATCHES = 3;

    const initialLiveTimeline = getLiveTimeline(room);
    const savedPaginationToken = initialLiveTimeline.getPaginationToken(Direction.Backward);

    const preload = async () => {
      setEagerPreloading(true);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
      if (cancelled || !alive()) {
        console.log('[eager-preload] cancelled or unmounted before starting loop');
        logTimelineDebug(roomDebugTraceId, 'eager-preload-cancelled-before-start');
        setEagerPreloading(false);
        return;
      }

      console.log(
        `[eager-preload] starting for room ${room.roomId}, limit=${safePaginationLimitRef.current}, savedToken=${savedPaginationToken ? 'yes' : 'no'}`
      );
      logTimelineDebug(roomDebugTraceId, 'eager-preload-start', {
        limit: safePaginationLimitRef.current,
        savedTokenPresent: !!savedPaginationToken,
      });

      let iterations = 0;
      let stalledBatches = 0;
      let preloadSucceeded = false;
      while (true) {
        if (cancelled || !alive()) {
          console.log(`[eager-preload] cancelled or unmounted at iteration ${iterations}`);
          logTimelineDebug(roomDebugTraceId, 'eager-preload-cancelled', {
            iterations,
          });
          break;
        }
        if (roomIdRef.current !== room.roomId || threadIdRef.current) {
          console.log(`[eager-preload] room/thread changed at iteration ${iterations}`);
          logTimelineDebug(roomDebugTraceId, 'eager-preload-abort-room-change', {
            iterations,
            currentThreadId: threadIdRef.current,
          });
          break;
        }

        if (roomPaginatingBackRef.current) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 50);
          });
          continue;
        }

        const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
        const filterOpts = recalibrateFilterOptsRef.current;
        if (!filterOpts) {
          console.log('[eager-preload] missing filter opts, breaking');
          break;
        }

        const counts = getRoomPreloadCounts(linkedTimelines, filterOpts.room, filterOpts);
        const surfacedCount = useSurfacePreloadTarget
          ? counts.surfaceCount
          : counts.renderableCount;

        if (surfacedCount >= safePaginationLimitRef.current) {
          console.log(
            `[eager-preload] done: surfaceCount=${surfacedCount} >= limit=${safePaginationLimitRef.current}`
          );
          logTimelineDebug(roomDebugTraceId, 'eager-preload-target-reached', {
            cacheCount: counts.cacheCount,
            iterations,
            renderableCount: counts.renderableCount,
            surfaceCount: counts.surfaceCount,
            target: safePaginationLimitRef.current,
          });
          preloadSucceeded = true;
          break;
        }

        const firstTimeline = linkedTimelines[0];
        if (!firstTimeline) {
          console.log('[eager-preload] no first timeline, breaking');
          preloadSucceeded = true;
          break;
        }

        let backwardToken = firstTimeline.getPaginationToken(Direction.Backward);
        if (!backwardToken && savedPaginationToken && iterations === 0) {
          console.log('[eager-preload] pagination token was cleared, restoring saved token');
          firstTimeline.setPaginationToken(savedPaginationToken, Direction.Backward);
          backwardToken = savedPaginationToken;
        }
        if (!backwardToken) {
          console.log('[eager-preload] no backward pagination token, breaking');
          logTimelineDebug(roomDebugTraceId, 'eager-preload-no-backward-token', {
            cacheCount: counts.cacheCount,
            iterations,
            renderableCount: counts.renderableCount,
          });
          preloadSucceeded = true;
          break;
        }

        const timelinesEventsCount = linkedTimelines.map(timelineToEventsCount);
        const timelinesRenderableCounts = linkedTimelines.map(
          (timeline) =>
            getRenderableEvents(
              [timeline],
              filterOpts.room,
              filterOpts.threadId,
              filterOpts.ignoredUsersSet,
              filterOpts.showHiddenEvents,
              filterOpts.hideMembershipEvents,
              filterOpts.hideNickAvatarEvents
            ).length
        );

        roomPaginatingBackRef.current = true;
        try {
          const [err, didPaginate] = await to(
            mx.paginateEventTimeline(firstTimeline, {
              backwards: true,
              limit: BATCH_SIZE,
            })
          );
          if (err) {
            console.log(`[eager-preload] pagination error at iteration ${iterations}:`, err);
            break;
          }
          if (didPaginate === false) {
            console.log(
              `[eager-preload] paginateEventTimeline returned false at iteration ${iterations}`
            );
            preloadSucceeded = true;
            break;
          }

          const fetchedTimeline =
            firstTimeline.getNeighbouringTimeline(Direction.Backward) ?? firstTimeline;
          if (room.hasEncryptionStateEvent()) {
            await to(decryptAllTimelineEvent(mx, fetchedTimeline));
          }

          if (!cancelled && alive() && roomIdRef.current === room.roomId && !threadIdRef.current) {
            recalibrateTimelinePagination(
              setTimeline,
              linkedTimelines,
              timelinesEventsCount,
              true,
              filterOpts,
              timelinesRenderableCounts
            );
          }

          const refreshedLinkedTimelines = getLinkedTimelines(getLiveTimeline(room));
          const refreshedCounts = getRoomPreloadCounts(
            refreshedLinkedTimelines,
            filterOpts.room,
            filterOpts
          );
          const refreshedBackwardToken =
            refreshedLinkedTimelines[0]?.getPaginationToken(Direction.Backward) ?? null;

          const progressed =
            refreshedCounts.cacheCount > counts.cacheCount ||
            refreshedCounts.renderableCount > counts.renderableCount ||
            refreshedCounts.surfaceCount > counts.surfaceCount ||
            refreshedBackwardToken !== backwardToken;

          if (!progressed) {
            stalledBatches += 1;
            console.log(
              `[eager-preload] batch ${iterations + 1}: no progress (cached=${refreshedCounts.cacheCount}, renderable=${refreshedCounts.renderableCount}, surface=${refreshedCounts.surfaceCount}, stalled=${stalledBatches}/${MAX_STALLED_BATCHES})`
            );
            if (stalledBatches >= MAX_STALLED_BATCHES) {
              console.log('[eager-preload] pagination stalled, breaking');
              break;
            }
          } else {
            stalledBatches = 0;
          }

          iterations++;
          console.log(
            `[eager-preload] batch ${iterations}: cached ${refreshedCounts.cacheCount} room events, renderable ${refreshedCounts.renderableCount}, surface ${refreshedCounts.surfaceCount} / ${safePaginationLimitRef.current}`
          );
          logTimelineDebug(roomDebugTraceId, 'eager-preload-batch', {
            backwardTokenChanged: refreshedBackwardToken !== backwardToken,
            cacheCount: refreshedCounts.cacheCount,
            iterations,
            renderableCount: refreshedCounts.renderableCount,
            surfaceCount: refreshedCounts.surfaceCount,
            stalledBatches,
            target: safePaginationLimitRef.current,
          });
        } finally {
          roomPaginatingBackRef.current = false;
        }
      }

      if (!cancelled) {
        setEagerPreloading(false);
        if (preloadSucceeded) {
          eagerPreloadDoneForRoomRef.current = room.roomId;
        }
        const finalLinkedTimelines = getLinkedTimelines(getLiveTimeline(room));
        setTimeline((current) => ({
          ...current,
          linkedTimelines: finalLinkedTimelines,
        }));
        const finalFilterOpts = recalibrateFilterOptsRef.current;
        const finalCounts = finalFilterOpts
          ? getRoomPreloadCounts(finalLinkedTimelines, finalFilterOpts.room, finalFilterOpts)
          : {
              cacheCount: getTimelinesEventsCount(finalLinkedTimelines),
              renderableCount: getTimelinesEventsCount(finalLinkedTimelines),
              surfaceCount: getTimelinesEventsCount(finalLinkedTimelines),
            };
        console.log(
          `[eager-preload] complete for room ${room.roomId}: ${iterations} batches, ${finalCounts.cacheCount} cached room events, ${finalCounts.renderableCount} renderable events, ${finalCounts.surfaceCount} surface entries`
        );
        logTimelineDebug(roomDebugTraceId, 'eager-preload-complete', {
          cacheCount: finalCounts.cacheCount,
          iterations,
          preloadSucceeded,
          renderableCount: finalCounts.renderableCount,
          surfaceCount: finalCounts.surfaceCount,
        });
      }
    };

    preload();

    return () => {
      cancelled = true;
      setEagerPreloading(false);
    };
  }, [
    alive,
    eventId,
    eagerPreloadDoneForRoomRef,
    mx,
    recalibrateFilterOptsRef,
    room,
    roomDebugTraceId,
    roomIdRef,
    roomPaginatingBackRef,
    safePaginationLimitRef,
    setEagerPreloading,
    setTimeline,
    threadId,
    threadIdRef,
    useSurfacePreloadTarget,
  ]);
};

export type { RoomEagerPreloadOptions };
