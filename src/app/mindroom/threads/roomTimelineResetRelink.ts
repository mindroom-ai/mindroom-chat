import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { RoomEvent, type Room, type RoomEventHandlerMap } from 'matrix-js-sdk';
import { getLiveTimeline, type Timeline } from './timelinePagination';

type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

/**
 * Re-link the room view's render timeline after a gappy sync.
 *
 * On a `limited: true` sync the SDK forks a brand-new live timeline with no
 * neighbour link to the old chain (`EventTimelineSet.resetLiveTimeline`) and
 * fires `RoomEvent.TimelineReset`. The room view holds the OLD chain in
 * React state, and its render pipeline is keyed on the event count of that
 * chain — so every later live event lands in a timeline the view never
 * reads. Symptom: new standalone roots stop appearing as compact cards (and
 * classic-view messages stop appearing) until the room is re-entered.
 * `RoomEvent.TimelineRefresh` does not cover this: it only fires for the
 * MSC2716 history-refresh path, and its room branch is gated on
 * `liveTimelineLinked` — false exactly when a reset orphaned the chain.
 *
 * Scope: room view only (`threadId`/`eventId` views keep their own
 * lifecycles), unfiltered timeline set only (thread sets have their own
 * refresh machinery), and only when the live timeline is genuinely missing
 * from the linked chain — a reset that kept the chain intact must not yank
 * the window. After the rebuild the view sits at the (shallow) live end;
 * the compact coverage controller restores depth from cache/network.
 */
export const useRoomTimelineResetRelink = ({
  room,
  threadIdRef,
  eventId,
  timeline,
  rebuildTimeline,
  setTimeline,
  atBottomRef,
  scrollToBottomRef,
}: {
  room: Room;
  threadIdRef: MutableRefObject<string | undefined>;
  eventId: string | undefined;
  timeline: Timeline;
  rebuildTimeline: () => Timeline;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  atBottomRef: MutableRefObject<boolean>;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
}): void => {
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  useEffect(() => {
    const handleTimelineReset: RoomEventHandlerMap[RoomEvent.TimelineReset] = (
      eventRoom,
      timelineSet
    ) => {
      if (eventRoom?.roomId !== room.roomId) return;
      if (threadIdRef.current || eventId) return;
      if (timelineSet !== room.getUnfilteredTimelineSet()) return;

      const liveTimeline = getLiveTimeline(room);
      if (timelineRef.current.linkedTimelines.includes(liveTimeline)) return;

      if (atBottomRef.current) {
        scrollToBottomRef.current.count += 1;
        scrollToBottomRef.current.smooth = false;
      }
      setTimeline(rebuildTimeline());
    };

    room.on(RoomEvent.TimelineReset, handleTimelineReset);
    return () => {
      room.removeListener(RoomEvent.TimelineReset, handleTimelineReset);
    };
  }, [room, eventId, rebuildTimeline, setTimeline, threadIdRef, atBottomRef, scrollToBottomRef]);
};
