import { useEffect, useRef } from 'react';
import {
  RoomEvent,
  type EventTimeline,
  type MatrixEvent,
  type Room,
  type RoomEventHandlerMap,
} from 'matrix-js-sdk';

export type TimelineArriveMeta = {
  /** Appended to the live end of a live timeline by sync, as opposed to backfill or a cache restore. */
  liveEvent: boolean;
  /** Added at the start of its timeline (back pagination). */
  toStartOfTimeline: boolean;
  /** The timeline the event was added to; room and thread timelines both report here. */
  timeline?: EventTimeline;
};

/**
 * Call `onArrive` for every event added to a timeline of `room`, including its threads (the
 * room re-emits their timeline events). Removals are ignored.
 */
export const useLiveEventArrive = (
  room: Room,
  onArrive: (mEvent: MatrixEvent, meta: TimelineArriveMeta) => void
): void => {
  const onArriveRef = useRef(onArrive);
  onArriveRef.current = onArrive;

  useEffect(() => {
    const handleTimeline: RoomEventHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      eventRoom,
      toStartOfTimeline,
      removed,
      data
    ) => {
      if (removed) return;
      if (eventRoom && eventRoom.roomId !== room.roomId) return;
      onArriveRef.current(mEvent, {
        liveEvent: !!data?.liveEvent,
        toStartOfTimeline: !!toStartOfTimeline,
        timeline: data?.timeline,
      });
    };
    room.on(RoomEvent.Timeline, handleTimeline);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimeline);
    };
  }, [room]);
};
