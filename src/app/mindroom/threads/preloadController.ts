import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Direction, type MatrixClient, type Room } from 'matrix-js-sdk';
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
        logTimelineDebug(roomDebugTraceId, 'eager-preload-cancelled-before-start');
        setEagerPreloading(false);
        return;
      }

      logTimelineDebug(roomDebugTraceId, 'eager-preload-start', {
        limit: safePaginationLimitRef.current,
        savedTokenPresent: !!savedPaginationToken,
      });

      let iterations = 0;
      let stalledBatches = 0;
      let preloadSucceeded = false;
      while (!cancelled && alive()) {
        if (roomIdRef.current !== room.roomId || threadIdRef.current) {
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
          logTimelineDebug(roomDebugTraceId, 'eager-preload-missing-filter-opts', {
            iterations,
          });
          break;
        }

        const counts = getRoomPreloadCounts(linkedTimelines, filterOpts.room, filterOpts);
        const surfacedCount = useSurfacePreloadTarget
          ? counts.surfaceCount
          : counts.renderableCount;

        if (surfacedCount >= safePaginationLimitRef.current) {
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
          logTimelineDebug(roomDebugTraceId, 'eager-preload-no-first-timeline', {
            iterations,
          });
          preloadSucceeded = true;
          break;
        }

        let backwardToken = firstTimeline.getPaginationToken(Direction.Backward);
        if (!backwardToken && savedPaginationToken && iterations === 0) {
          logTimelineDebug(roomDebugTraceId, 'eager-preload-restore-saved-token');
          firstTimeline.setPaginationToken(savedPaginationToken, Direction.Backward);
          backwardToken = savedPaginationToken;
        }
        if (!backwardToken) {
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
            logTimelineDebug(roomDebugTraceId, 'eager-preload-pagination-error', {
              error: err,
              iterations,
            });
            break;
          }
          if (didPaginate === false) {
            logTimelineDebug(roomDebugTraceId, 'eager-preload-pagination-returned-false', {
              iterations,
            });
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
            logTimelineDebug(roomDebugTraceId, 'eager-preload-batch-stalled', {
              cacheCount: refreshedCounts.cacheCount,
              iterations: iterations + 1,
              renderableCount: refreshedCounts.renderableCount,
              stalledBatches,
              surfaceCount: refreshedCounts.surfaceCount,
            });
            if (stalledBatches >= MAX_STALLED_BATCHES) {
              logTimelineDebug(roomDebugTraceId, 'eager-preload-stalled-limit-reached', {
                iterations: iterations + 1,
                stalledBatches,
              });
              break;
            }
          } else {
            stalledBatches = 0;
          }

          iterations++;
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
