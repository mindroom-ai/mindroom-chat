import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  Direction,
  EventTimeline,
  THREAD_RELATION_TYPE,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import to from 'await-to-js';
import { decryptAllTimelineEvent } from '../../utils/room';
import { getRenderableEvents } from '../../features/room/roomTimelineEvents';
import {
  recalibrateTimelinePagination,
  timelineToEventsCount,
  type RecalibrateFilterOpts,
  type Timeline,
} from '../../features/room/timelinePagination';
import {
  getEarliestLoadedRoomEvent,
  loadRoomCachedPaginationSnapshot,
  resolveHydratedRoomBeforeToken,
} from './eventRepository';
import {
  hydrateCachedEvents,
  reconcileRelationEventsWithAggregation,
} from '../../features/room/eventCacheEditUtils';

type RoomTimelineState = Timeline;

export const useRoomPaginationCommandController = ({
  alive,
  handleTimelinePagination,
  mx,
  recalibrateFilterOptsRef,
  room,
  roomIdRef,
  roomPaginatingBackRef,
  safePaginationLimitRef,
  sessionId,
  setRoomHasMoreCachedBack,
  setTimeline,
  threadId,
  threadIdRef,
  timeline,
}: {
  alive: () => boolean;
  handleTimelinePagination: (backwards: boolean) => Promise<void>;
  mx: MatrixClient;
  recalibrateFilterOptsRef: RefObject<RecalibrateFilterOpts | undefined>;
  room: Room;
  roomIdRef: MutableRefObject<string>;
  roomPaginatingBackRef: MutableRefObject<boolean>;
  safePaginationLimitRef: MutableRefObject<number>;
  sessionId: string;
  setRoomHasMoreCachedBack: Dispatch<SetStateAction<boolean>>;
  setTimeline: Dispatch<SetStateAction<RoomTimelineState>>;
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
  timeline: RoomTimelineState;
}) =>
  useCallback(async (backwards: boolean) => {
    if (threadId) return;
    if (!backwards) {
      await handleTimelinePagination(false);
      return;
    }
    if (roomPaginatingBackRef.current) return;

    roomPaginatingBackRef.current = true;
    try {
      const currentLinkedTimelines = timeline.linkedTimelines;
      const firstTimeline = currentLinkedTimelines[0];
      if (!firstTimeline) return;

      const timelinesEventsCount = currentLinkedTimelines.map(timelineToEventsCount);
      const rFilterOpts = recalibrateFilterOptsRef.current;
      const timelinesRenderableCounts = rFilterOpts
        ? currentLinkedTimelines.map(
            (tl) =>
              getRenderableEvents(
                [tl],
                rFilterOpts.room,
                rFilterOpts.threadId,
                rFilterOpts.ignoredUsersSet,
                rFilterOpts.showHiddenEvents,
                rFilterOpts.hideMembershipEvents,
                rFilterOpts.hideNickAvatarEvents
              ).length
          )
        : undefined;
      const earliestLoadedEvent = getEarliestLoadedRoomEvent(room, currentLinkedTimelines);
      const mapper = mx.getEventMapper();
      const cachedPaginationSnapshot = await loadRoomCachedPaginationSnapshot({
        sessionId,
        roomId: room.roomId,
        earliestLoadedEvent,
        limit: safePaginationLimitRef.current,
        mapEvent: (rawEvent) => mapper(rawEvent),
      });

      if (!alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      if (cachedPaginationSnapshot.status === 'start-known') {
        if (firstTimeline.getPaginationToken(Direction.Backward) !== null) {
          firstTimeline.setPaginationToken(null, Direction.Backward);
          setTimeline((currentTimeline) =>
            currentTimeline.linkedTimelines === currentLinkedTimelines
              ? { ...currentTimeline }
              : currentTimeline
          );
        }
        setRoomHasMoreCachedBack(false);
        return;
      }

      if (cachedPaginationSnapshot.status === 'cache-hit') {
        const cachedEvents = cachedPaginationSnapshot.events;
        const redactedRelationTargets = hydrateCachedEvents({
          room,
          events: cachedEvents,
        });
        const paginationToken = firstTimeline.getPaginationToken(Direction.Backward);
        const [timelineEvents, , unknownRelations] = room.partitionThreadedEvents(cachedEvents);

        (
          room.addEventsToTimeline as (
            events: MatrixEvent[],
            toStartOfTimeline: boolean,
            addToState: boolean,
            timeline: EventTimeline,
            paginationToken?: string | null
          ) => void
        )(
          timelineEvents,
          true,
          false,
          firstTimeline,
          resolveHydratedRoomBeforeToken(cachedPaginationSnapshot.beforeToken, paginationToken)
        );
        mx.processAggregatedTimelineEvents(room, timelineEvents);
        room.processThreadRoots(
          timelineEvents.filter((mEvent) =>
            mEvent.getServerAggregatedRelation(THREAD_RELATION_TYPE.name)
          ),
          false
        );
        reconcileRelationEventsWithAggregation(
          unknownRelations,
          [{ relations: room.relations }],
          undefined,
          redactedRelationTargets
        );

        const fetchedTimeline =
          firstTimeline.getNeighbouringTimeline(Direction.Backward) ?? firstTimeline;
        if (room.hasEncryptionStateEvent()) {
          await to(decryptAllTimelineEvent(mx, fetchedTimeline));
        }

        if (alive() && roomIdRef.current === room.roomId && !threadIdRef.current) {
          recalibrateTimelinePagination(
            setTimeline,
            currentLinkedTimelines,
            timelinesEventsCount,
            true,
            recalibrateFilterOptsRef.current ?? undefined,
            timelinesRenderableCounts
          );
          setRoomHasMoreCachedBack(cachedPaginationSnapshot.hasMoreCachedBack);
        }
        return;
      }

      setRoomHasMoreCachedBack(false);
      await handleTimelinePagination(true);
    } finally {
      roomPaginatingBackRef.current = false;
    }
  }, [
    alive,
    handleTimelinePagination,
    mx,
    recalibrateFilterOptsRef,
    room,
    roomIdRef,
    roomPaginatingBackRef,
    safePaginationLimitRef,
    sessionId,
    setRoomHasMoreCachedBack,
    setTimeline,
    threadId,
    threadIdRef,
    timeline.linkedTimelines,
  ]);
