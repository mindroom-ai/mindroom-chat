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
import { getRenderableEvents } from './roomTimelineEvents';
import {
  recalibrateTimelinePagination,
  timelineToEventsCount,
  type RecalibrateFilterOpts,
  type Timeline,
} from './timelinePagination';
import {
  createPreferLiveEventMapper,
  getEarliestLoadedRoomEvent,
  loadRoomCachedPaginationSnapshot,
  resolveHydratedRoomBeforeToken,
} from './eventRepository';
import { hydrateCachedEvents, reconcileRelationEventsWithAggregation } from './eventCacheEditUtils';
import { ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE } from './preloadSettings';
import type { PersistRoomEventCache } from '../engine/enginePersistFacade';

type RoomTimelineState = Timeline;

export const useRoomPaginationCommandController = ({
  alive,
  handleTimelinePagination,
  mx,
  persistRoomEventCache,
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
  persistRoomEventCache: PersistRoomEventCache;
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
  useCallback(
    async (backwards: boolean) => {
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
                  rFilterOpts.hideNickAvatarEvents,
                  rFilterOpts.showThreadRepliesInRoom
                ).length
            )
          : undefined;
        const earliestLoadedEvent = getEarliestLoadedRoomEvent(room, currentLinkedTimelines);
        const mapper = mx.getEventMapper();
        const cachePageLimit = Math.min(
          safePaginationLimitRef.current,
          ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE
        );
        const cachedPaginationSnapshot = await loadRoomCachedPaginationSnapshot({
          sessionId,
          roomId: room.roomId,
          earliestLoadedEvent,
          limit: cachePageLimit,
          mapEvent: createPreferLiveEventMapper(room, mapper),
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
          const [timelineEvents, , unknownRelations] = rFilterOpts?.showThreadRepliesInRoom
            ? [cachedEvents, [], []]
            : room.partitionThreadedEvents(cachedEvents);

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
        // Capture the earliest loaded id BEFORE the network paginate
        // so we can compare after and know which events are new.
        const preFetchEarliestId = getEarliestLoadedRoomEvent(
          room,
          currentLinkedTimelines
        )?.getId();
        await handleTimelinePagination(true);
        if (!alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

        // CINNY-207 P3.3 (explicit-persist-point, option b): backward
        // pagination delivers events with `toStartOfTimeline=true`,
        // which the engine's live write-through deliberately skips.
        // Batch-persist the newly-fetched slice here per pagination
        // completion (not per event) so paginated history survives
        // the deletion of the P1.1 sweep.
        const afterFirstTimeline = timeline.linkedTimelines[0] ?? firstTimeline;
        const backfilledTimeline =
          afterFirstTimeline.getNeighbouringTimeline(Direction.Backward) ??
          afterFirstTimeline;
        const backfilledEvents = backfilledTimeline.getEvents();
        // Newly fetched events are OLDER than the pre-fetch earliest: the
        // SDK either prepends them into the same timeline (walk from the
        // oldest end and stop when the pre-fetch earliest is reached) or
        // places them in a separate backward neighbour timeline (the
        // pre-fetch earliest is absent and the whole slice is new).
        const eventsToPersist: MatrixEvent[] = [];
        for (let idx = 0; idx < backfilledEvents.length; idx += 1) {
          const mEvent = backfilledEvents[idx];
          if (mEvent.getId() === preFetchEarliestId) break;
          eventsToPersist.push(mEvent);
        }
        if (eventsToPersist.length > 0) {
          // The batch contains the new overall-earliest cached event, so the
          // timeline's backward token is its continuity proof — the deleted
          // P1.1 sweep used to write exactly this pairing; without it a
          // reload cannot trust cached back-pagination past this point.
          // `null` is meaningful (room-start proof) and must flow through.
          const backwardToken = backfilledTimeline.getPaginationToken(Direction.Backward);
          persistRoomEventCache(eventsToPersist, backwardToken);
        }
      } finally {
        roomPaginatingBackRef.current = false;
      }
    },
    [
      alive,
      handleTimelinePagination,
      mx,
      persistRoomEventCache,
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
    ]
  );
