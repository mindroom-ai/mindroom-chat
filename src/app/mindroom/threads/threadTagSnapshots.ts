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

// Keyed by the aggregation result, which aggregateThreadTagEvents reuses while
// the tag state is unchanged, so repeated reads share one read-only map.
const snapshotMapCache = new WeakMap<
  ReadonlyMap<string, ThreadTagsContent>,
  ReadonlyMap<string, ThreadTagSnapshot>
>();

export const buildThreadTagSnapshotMap = (
  events: MatrixEvent[]
): ReadonlyMap<string, ThreadTagSnapshot> => {
  const aggregated = aggregateThreadTagEvents(events);
  const cached = snapshotMapCache.get(aggregated);
  if (cached) return cached;

  const snapshots = new Map<string, ThreadTagSnapshot>();
  aggregated.forEach((content, threadRootId) => {
    snapshots.set(threadRootId, buildThreadTagSnapshot(content));
  });

  snapshotMapCache.set(aggregated, snapshots);
  return snapshots;
};

export const getRoomThreadTagSnapshotMap = (room: Room): ReadonlyMap<string, ThreadTagSnapshot> => {
  const stateEvents =
    room
      .getLiveTimeline()
      .getState(EventTimeline.FORWARDS)
      ?.getStateEvents(MINDROOM_THREAD_TAGS_EVENT) ?? [];

  return Array.isArray(stateEvents) ? buildThreadTagSnapshotMap(stateEvents) : new Map();
};
