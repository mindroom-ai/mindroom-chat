import React, { MouseEventHandler } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { EventTimelineSet } from 'matrix-js-sdk/lib/models/event-timeline-set';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { ThreadIndicator } from '../threads/ThreadIndicator';
import { useRoomEvent } from '../threads/useRoomEvent';

export const useMindroomReplyEvent = (
  room: Room,
  replyEventId: string,
  getFromLocalTimeline: () => MatrixEvent | undefined,
  threadRootId?: string
): MatrixEvent | undefined =>
  useRoomEvent(room, replyEventId, getFromLocalTimeline, {
    threadId: threadRootId,
  }) ?? undefined;

type MindroomReplyThreadIndicatorProps = {
  room: Room;
  timelineSet?: EventTimelineSet;
  threadRootId?: string;
  hide?: boolean;
  onClick?: MouseEventHandler;
};

export function MindroomReplyThreadIndicator({
  room,
  timelineSet,
  threadRootId,
  hide,
  onClick,
}: MindroomReplyThreadIndicatorProps) {
  if (!threadRootId || hide) return null;

  return (
    <ThreadIndicator
      as="button"
      data-thread-root-id={threadRootId}
      threadRootId={threadRootId}
      timelineSet={timelineSet}
      data-event-id={threadRootId}
      room={room}
      onClick={onClick}
    />
  );
}
