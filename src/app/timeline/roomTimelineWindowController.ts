import { useMemo } from 'react';
import type { MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import {
  getActiveTimelineRange,
  getLinkedTimelinesEventAbsoluteIndex,
  type Timeline,
} from '../event-store/timeline/timelinePagination';
import type { TimelineEventEntry } from '../event-store/timeline/roomTimelineEvents';
import { resolveOrderedRoomOverviewEvents } from '../threads/threadRoomFocus';
import {
  getEventEntryIndex,
  getNextRenderableEntryIndex,
} from '../event-store/timeline/timelineScrollUtils';
import { collectPriorityThreadSeedPrewarmRoots } from '../threads/open/threadBootstrap';
import {
  buildThreadCacheCoverage,
  shouldShowThreadLoadOlderFromCoverage,
} from '../event-store/cache/threadCacheCoverage';

/** Whether an open thread should render its leading "Load older messages" chip. */
export const useThreadLoadOlderMessages = (o: {
  canPaginateThreadBack: boolean;
  lastThreadBackwardPaginationToken: string | null;
  threadEventsLength: number;
  threadHasMoreCachedBack: boolean;
  threadTailLoaded: boolean;
}): boolean =>
  shouldShowThreadLoadOlderFromCoverage({
    coverage: buildThreadCacheCoverage({
      eventCount: o.threadEventsLength,
      backwardToken: o.canPaginateThreadBack
        ? o.lastThreadBackwardPaginationToken
        : o.threadHasMoreCachedBack
          ? undefined
          : null,
      hasMoreBackward: o.threadHasMoreCachedBack || o.canPaginateThreadBack,
      relationSnapshotComplete: false,
      tailLoaded: o.threadTailLoaded,
    }),
    sdkHasBackwardToken: o.canPaginateThreadBack,
  });

export const useRoomTimelineWindowController = (o: {
  filteredRoomThreadActive: boolean;
  filteredRoomOverviewOrderActive: boolean;
  overviewRefreshCounter: number;
  overviewThreadRootIds: string[];
  renderableEventEntries: TimelineEventEntry[];
  renderableEvents: MatrixEvent[];
  room: Room;
  roomSurfaceEventEntries: TimelineEventEntry[];
  roomThreadListThreads: Thread[];
  prefetchDepth: number;
  threadReplyCountMap: Map<string, number>;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
  timeline: Timeline;
  unreadInfo?: { readUptoEventId?: string };
}) => {
  const threadFilteredEvents = useMemo(
    () =>
      o.filteredRoomOverviewOrderActive
        ? resolveOrderedRoomOverviewEvents({
            orderedRootIds: o.overviewThreadRootIds,
            renderableEvents: o.roomSurfaceEventEntries.map(({ event }) => event),
            room: o.room,
            roomThreads: o.roomThreadListThreads,
          })
        : o.renderableEvents,
    [
      o.filteredRoomOverviewOrderActive,
      o.overviewThreadRootIds,
      o.renderableEvents,
      o.room,
      o.roomSurfaceEventEntries,
      o.roomThreadListThreads,
    ]
  );

  const threadFilteredEventEntries = useMemo(() => {
    if (!o.filteredRoomOverviewOrderActive) return o.renderableEventEntries;
    const byId = new Map(
      o.roomSurfaceEventEntries.flatMap((e) => {
        const id = e.event.getId();
        return id ? [[id, e] as const] : [];
      })
    );
    return threadFilteredEvents.flatMap((e) => {
      const entry = byId.get(e.getId() ?? '');
      return entry ? [entry] : [];
    });
  }, [
    o.filteredRoomOverviewOrderActive,
    o.renderableEventEntries,
    o.roomSurfaceEventEntries,
    threadFilteredEvents,
  ]);

  const readUptoEventId = o.unreadInfo?.readUptoEventId;
  const readUptoAbsoluteIndex = useMemo(
    () =>
      readUptoEventId
        ? getLinkedTimelinesEventAbsoluteIndex(o.timeline.linkedTimelines, readUptoEventId)
        : undefined,
    [o.timeline.linkedTimelines, readUptoEventId]
  );

  const unreadScrollAnchorIndex = useMemo(() => {
    if (!readUptoEventId) return undefined;
    const visibleIndex = getEventEntryIndex(threadFilteredEventEntries, readUptoEventId);
    if (visibleIndex !== -1) return visibleIndex;
    return readUptoAbsoluteIndex === undefined
      ? undefined
      : getNextRenderableEntryIndex(threadFilteredEventEntries, readUptoAbsoluteIndex);
  }, [threadFilteredEventEntries, readUptoEventId, readUptoAbsoluteIndex]);

  const activeTimelineRange = useMemo(
    () =>
      getActiveTimelineRange(
        undefined,
        o.filteredRoomThreadActive,
        o.timeline.range,
        threadFilteredEvents.length,
        o.prefetchDepth
      ),
    [o.filteredRoomThreadActive, o.timeline.range, threadFilteredEvents.length, o.prefetchDepth]
  );

  const priorityThreadSeedPrewarmRoots = useMemo(() => {
    void o.overviewRefreshCounter;
    return collectPriorityThreadSeedPrewarmRoots({
      room: o.room,
      threadFilteredEventEntries,
      threadId: undefined,
      threadReplyCountMap: o.threadReplyCountMap,
      threadResolutionMap: o.threadResolutionMap,
      rangeEnd: activeTimelineRange.end,
      rangeStart: activeTimelineRange.start,
    });
  }, [
    activeTimelineRange.end,
    activeTimelineRange.start,
    o.overviewRefreshCounter,
    o.room,
    threadFilteredEventEntries,
    o.threadReplyCountMap,
    o.threadResolutionMap,
  ]);

  return {
    activeTimelineRange,
    priorityThreadSeedPrewarmRoots,
    readUptoAbsoluteIndex,
    threadFilteredEventEntries,
    threadFilteredEvents,
    unreadScrollAnchorIndex,
  };
};
