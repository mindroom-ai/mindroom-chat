/**
 * ISSUE-207 P3.3: room cached-back state refresh.
 *
 * Extracted verbatim from `roomCacheLifecycleController`'s second
 * effect (the read-only one). The persist half of that controller
 * moved into the engine's write-through in Commit 3; only this
 * cache-read effect remained render-side because it drives the
 * `hasCachedBack` UI state and clears a stale SDK backward token
 * when the cache proves the room start.
 *
 * A timeline that begins with the room's creation proves the start by
 * itself: nothing in a room is older than `m.room.create`. A sync hands
 * every timeline a token to page back with, also one that holds the room
 * from its creation on, and the server may mark it limited all the same.
 * Waiting for a page from that token to come back empty left a short
 * room without its start whenever no page was asked for.
 */

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Direction, EventType, type Room } from 'matrix-js-sdk';
import { getEarliestLoadedRoomEvent, loadRoomCachedBackStateSnapshot } from '../event-store/cache/eventRepository';
import type { Timeline } from '../event-store/timeline/timelinePagination';

export const useRoomCachedBackState = ({
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
  timeline,
}: {
  alive: () => boolean;
  eventId?: string;
  eventsLength: number;
  room: Room;
  roomIdRef: MutableRefObject<string>;
  sessionId: string;
  setRoomHasMoreCachedBack: Dispatch<SetStateAction<boolean>>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
  timeline: Timeline;
}): void => {
  useEffect(() => {
    if (threadId) {
      setRoomHasMoreCachedBack(false);
      return undefined;
    }

    const currentLinkedTimelines = timeline.linkedTimelines;
    const firstTimeline = currentLinkedTimelines[0];
    const markRoomStart = () => {
      if (!firstTimeline || firstTimeline.getPaginationToken(Direction.Backward) === null) return;
      firstTimeline.setPaginationToken(null, Direction.Backward);
      setTimeline((currentTimeline) =>
        currentTimeline.linkedTimelines === currentLinkedTimelines
          ? { ...currentTimeline }
          : currentTimeline
      );
    };
    if (firstTimeline?.getEvents()[0]?.getType() === EventType.RoomCreate) {
      markRoomStart();
      setRoomHasMoreCachedBack(false);
      return undefined;
    }

    let cancelled = false;
    const refreshRoomCachedBackState = async () => {
      const earliestLoadedEvent = getEarliestLoadedRoomEvent(room, currentLinkedTimelines);
      const cachedBackState = await loadRoomCachedBackStateSnapshot({
        sessionId,
        roomId: room.roomId,
        earliestLoadedEvent,
      });
      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      if (cachedBackState.cachedBeforeToken === null) markRoomStart();

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
};
