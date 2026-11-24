import type { Room } from 'matrix-js-sdk';
import { isVisibleThreadRootEvent, type TimelineEventEntry } from '../../event-store/timeline/roomTimelineEvents';

type TimelineRangeLike = {
  start: number;
  end: number;
};

export const resolveThreadOverviewRefreshTargets = ({
  activeTimelineRange,
  compactFilteredThreadRootIds,
  filteredThreadRootIds,
  limit,
  room,
  showCompactRoomView,
  threadFilteredEventEntries,
  threadId,
  threadReplyCountMap,
  threadResolutionMap,
}: {
  activeTimelineRange: TimelineRangeLike;
  compactFilteredThreadRootIds: string[];
  filteredThreadRootIds: string[];
  limit: number;
  room: Room;
  showCompactRoomView: boolean;
  threadFilteredEventEntries: TimelineEventEntry[];
  threadId: string | undefined;
  threadReplyCountMap: Map<string, number>;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
}): string[] => {
  if (threadId) {
    return [];
  }

  const visibleThreadRootIds = threadFilteredEventEntries
    .slice(activeTimelineRange.start, activeTimelineRange.end)
    .map((entry) => entry.event)
    .filter((event) =>
      isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)
    )
    .map((event) => event.getId())
    .filter((eventId): eventId is string => !!eventId);

  const overviewResumeRefreshIdSet = new Set(visibleThreadRootIds);
  (showCompactRoomView ? compactFilteredThreadRootIds : filteredThreadRootIds)
    .slice(0, limit)
    .forEach((threadRootId) => {
      overviewResumeRefreshIdSet.add(threadRootId);
    });

  return [...overviewResumeRefreshIdSet].slice(0, limit);
};
