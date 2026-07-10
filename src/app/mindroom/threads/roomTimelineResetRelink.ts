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
 *
 * Pagination completions are guarded at `recalibrateTimelinePagination`:
 * work captured against an older linked-array identity cannot replace this
 * newly installed chain. That shared choke point covers both pagination
 * directions without a render-side recovery latch.
 */
export const useRoomTimelineResetRelink = ({
  room,
  threadId,
  eventId,
  timeline,
  rebuildTimeline,
  setTimeline,
  isViewportAtBottomNow,
  scrollToBottomRef,
  onRelink,
}: {
  room: Room;
  threadId: string | undefined;
  eventId: string | undefined;
  timeline: Timeline;
  rebuildTimeline: () => Timeline;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  isViewportAtBottomNow: () => boolean;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  /**
   * Fired on every re-link. The caller uses it to
   * refresh the compact coverage budget: the rebuilt chain is shallow, and
   * a budget spent before the gap must not block restoring depth after it.
   */
  onRelink: () => void;
}): void => {
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;

  useEffect(() => {
    const relinkIfOrphaned = () => {
      if (threadIdRef.current || eventIdRef.current) return;

      const liveTimeline = getLiveTimeline(room);
      if (timelineRef.current.linkedTimelines.includes(liveTimeline)) return;

      const rebuiltTimeline = rebuildTimeline();
      // Publish synchronously to close the subscribe/check and duplicate-reset
      // windows before React commits the state update.
      timelineRef.current = rebuiltTimeline;
      if (isViewportAtBottomNow()) {
        scrollToBottomRef.current.count += 1;
        scrollToBottomRef.current.smooth = false;
      }
      setTimeline(rebuiltTimeline);
      onRelink();
    };

    const handleTimelineReset: RoomEventHandlerMap[RoomEvent.TimelineReset] = (
      eventRoom,
      timelineSet
    ) => {
      if (eventRoom?.roomId !== room.roomId) return;
      if (timelineSet !== room.getUnfilteredTimelineSet()) return;
      relinkIfOrphaned();
    };

    room.on(RoomEvent.TimelineReset, handleTimelineReset);
    // Subscribe first, then compare current chain. A one-shot reset between
    // render and this passive effect is therefore recovered without a gap.
    relinkIfOrphaned();
    return () => {
      room.removeListener(RoomEvent.TimelineReset, handleTimelineReset);
    };
  }, [
    room,
    rebuildTimeline,
    setTimeline,
    isViewportAtBottomNow,
    scrollToBottomRef,
    onRelink,
  ]);
};
