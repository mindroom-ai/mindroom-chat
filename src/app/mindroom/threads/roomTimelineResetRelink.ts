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
 * Clobber race: a back-pagination that was already in flight when the reset
 * landed completes by REBUILDING timeline state from its captured (now
 * orphaned) chain (`recalibrateTimelinePagination` → setTimeline), undoing
 * the relink with no further reset event to recover from. The reset
 * therefore latches `resetPendingRef`, and a per-render self-heal effect
 * keeps re-linking until the chain contains the live timeline while no
 * back-pagination is in flight — only then is the latch cleared. The latch
 * (not an unconditional per-render check) is what keeps the heal from
 * hijacking legitimate live-timeline-less states, e.g. an event-focused
 * chain kept after `eventId` clears without a remount.
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
  roomPaginatingBackRef,
  onRelink,
}: {
  room: Room;
  threadIdRef: MutableRefObject<string | undefined>;
  eventId: string | undefined;
  timeline: Timeline;
  rebuildTimeline: () => Timeline;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  atBottomRef: MutableRefObject<boolean>;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  roomPaginatingBackRef: MutableRefObject<boolean>;
  /**
   * Fired on every re-link (handler and self-heal). The caller uses it to
   * refresh the compact coverage budget: the rebuilt chain is shallow, and
   * a budget spent before the gap must not block restoring depth after it.
   */
  onRelink: () => void;
}): void => {
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const resetPendingRef = useRef(false);

  useEffect(() => {
    resetPendingRef.current = false;
  }, [room.roomId]);

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

      resetPendingRef.current = true;
      if (atBottomRef.current) {
        scrollToBottomRef.current.count += 1;
        scrollToBottomRef.current.smooth = false;
      }
      setTimeline(rebuildTimeline());
      onRelink();
    };

    room.on(RoomEvent.TimelineReset, handleTimelineReset);
    return () => {
      room.removeListener(RoomEvent.TimelineReset, handleTimelineReset);
    };
  }, [room, eventId, rebuildTimeline, setTimeline, threadIdRef, atBottomRef, scrollToBottomRef, onRelink]);

  useEffect(() => {
    if (!resetPendingRef.current) return;
    if (threadIdRef.current || eventId) return;

    const liveTimeline = getLiveTimeline(room);
    if (timeline.linkedTimelines.includes(liveTimeline)) {
      if (!roomPaginatingBackRef.current) {
        // Linked and quiescent — no in-flight pagination can clobber the
        // chain with a pre-reset snapshot anymore.
        resetPendingRef.current = false;
      }
      return;
    }

    if (atBottomRef.current) {
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
    }
    setTimeline(rebuildTimeline());
    onRelink();
  }, [
    // Re-fires ride on `timeline` changes alone — the refs below are stable
    // objects read at each commit and can never trigger the effect
    // themselves; they are listed for lint-visible completeness.
    timeline,
    room,
    eventId,
    rebuildTimeline,
    setTimeline,
    threadIdRef,
    atBottomRef,
    scrollToBottomRef,
    roomPaginatingBackRef,
    onRelink,
  ]);
};
