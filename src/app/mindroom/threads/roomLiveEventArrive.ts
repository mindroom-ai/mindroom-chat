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

type TimelineListener = RoomEventHandlerMap[RoomEvent.Timeline];

/**
 * Hands every timeline event of `room`, including its threads' (the room re-emits their timeline
 * events), to the newest `listener`. The room listener itself stays registered until the room
 * changes, so it keeps its place among the room's listeners.
 */
const useRoomTimelineListener = (room: Room, listener: TimelineListener): void => {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    const handleTimeline: TimelineListener = (mEvent, eventRoom, ...rest) => {
      if (eventRoom && eventRoom.roomId !== room.roomId) return;
      listenerRef.current(mEvent, eventRoom, ...rest);
    };
    room.on(RoomEvent.Timeline, handleTimeline);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimeline);
    };
  }, [room]);
};

/**
 * Call `onArrive` for every event added to a timeline of `room`, including its threads.
 * Removals go to `useLiveEventRemove`.
 */
export const useLiveEventArrive = (
  room: Room,
  onArrive: (mEvent: MatrixEvent, meta: TimelineArriveMeta) => void
): void => {
  useRoomTimelineListener(room, (mEvent, _eventRoom, toStartOfTimeline, removed, data) => {
    if (removed) return;
    onArrive(mEvent, {
      liveEvent: !!data?.liveEvent,
      toStartOfTimeline: !!toStartOfTimeline,
      timeline: data?.timeline,
    });
  });
};

/**
 * Call `onRemove` for every event taken out of a timeline of `room` (a cancelled send, say), with
 * the timeline it left. Thread timelines and the room's thread lists report here too.
 */
export const useLiveEventRemove = (
  room: Room,
  onRemove: (mEvent: MatrixEvent, timeline: EventTimeline | undefined) => void
): void => {
  useRoomTimelineListener(room, (mEvent, _eventRoom, _toStartOfTimeline, removed, data) => {
    if (removed) onRemove(mEvent, data?.timeline);
  });
};
