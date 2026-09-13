import { EventTimeline, type Room } from 'matrix-js-sdk';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import {
  aggregateThreadTagEvents,
  getDisplayTags,
  isThreadResolved,
  MINDROOM_THREAD_TAGS_EVENT,
  type ThreadTagsContent,
} from './threadTags';

export type ThreadTagSnapshot = {
  content: ThreadTagsContent;
  isResolved: boolean;
  displayTags: string[];
};

export const buildThreadTagSnapshot = (content: ThreadTagsContent): ThreadTagSnapshot => ({
  content,
  isResolved: isThreadResolved(content),
  displayTags: getDisplayTags(content),
});

export const buildThreadTagSnapshotMap = (
  events: MatrixEvent[]
): Map<string, ThreadTagSnapshot> => {
  const snapshots = new Map<string, ThreadTagSnapshot>();

  aggregateThreadTagEvents(events).forEach((content, threadRootId) => {
    snapshots.set(threadRootId, buildThreadTagSnapshot(content));
  });

  return snapshots;
};

export const getRoomThreadTagSnapshotMap = (room: Room): Map<string, ThreadTagSnapshot> => {
  const stateEvents =
    room
      .getLiveTimeline()
      .getState(EventTimeline.FORWARDS)
      ?.getStateEvents(MINDROOM_THREAD_TAGS_EVENT) ?? [];

  return Array.isArray(stateEvents) ? buildThreadTagSnapshotMap(stateEvents) : new Map();
};
