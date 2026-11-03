import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
  type MutableRefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Direction, RoomEvent, ThreadEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { Box, Button, Scroll, Spinner, Text, config } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useIgnoredUsers } from '../../hooks/useIgnoredUsers';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { createSessionId } from '../../state/sessions';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import type { ScrollAnchorMemory } from '../scroll/scrollAnchorMemory';
import { CompactRoomView } from './CompactRoomView';
import { getThreadTimelineEvents } from './linkedTimelines';
import { useTimelineMessageFeature } from './message-rendering/useTimelineMessageFeature';
import type { TimelineMessageRow } from './message-rendering/types';
import { getRenderableEventEntries } from './roomTimelineEvents';
import { renderMindroomRoomTimelineThreadBadge } from './roomTimelineMessageExtensions';
import type { ThreadFilterState, ThreadSortFreezeState } from './roomThreadOverviewModel';
import type { RoomViewMode } from './roomViewMode';
import {
  getInitialTimeline,
  getLinkedTimelines,
  getLiveTimeline,
  type Timeline,
} from './timelinePagination';
import { useTimelinePagination } from './timelinePaginationController';
import { useRoomThreadResolutionMap } from './useRoomThreadTags';
import { useMindroomThreadIndex } from './useMindroomThreadIndex';
import { useThreadApprovalTimeline } from './useThreadApprovalTimeline';
import { planThreadSummaryTimeline } from './threadSummaryTimeline';
import type { ThreadSummaryWriter } from './threadSummaryState';

const PAGINATION_LIMIT = 30;

export type RoomTimelineProps = {
  room: Room;
  eventId?: string;
  threadId?: string;
  summaryMap: Map<string, MindroomThreadSummaryInfo>;
  onStoreThreadSummary: ThreadSummaryWriter;
  threadFilterState: ThreadFilterState;
  threadSortFreezeState: ThreadSortFreezeState | null;
  viewMode: RoomViewMode;
  compactRoomScrollStateRef: MutableRefObject<ScrollAnchorMemory>;
  editor: Editor;
  /** Called when the open thread's root cannot be loaded at all. */
  onThreadLoadError?: (threadId: string) => void;
};

/** Re-render on any timeline, thread, or redaction change of the room. */
const useRoomTimelineVersion = (room: Room): number => {
  const [version, bump] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const events = [
      RoomEvent.Timeline,
      RoomEvent.Redaction,
      RoomEvent.LocalEchoUpdated,
      RoomEvent.TimelineReset,
      ThreadEvent.New,
      ThreadEvent.Update,
      ThreadEvent.NewReply,
    ] as const;
    events.forEach((name) => room.on(name as RoomEvent.Timeline, bump));
    return () => {
      events.forEach((name) => room.removeListener(name as RoomEvent.Timeline, bump));
    };
  }, [room]);
  return version;
};

const dedupeById = (events: MatrixEvent[]): MatrixEvent[] => {
  const seen = new Set<string>();
  return events.filter((event) => {
    const id = event.getId();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

/**
 * The room's message list. Compact mode shows the room's threads as cards; Full mode shows the
 * room timeline with a thread badge under each thread root; inside a thread, the root and its
 * replies.
 */
export function RoomTimeline({
  room,
  eventId,
  threadId,
  summaryMap,
  onStoreThreadSummary,
  threadFilterState,
  threadSortFreezeState,
  viewMode,
  compactRoomScrollStateRef,
  editor,
  onThreadLoadError,




  const ignoredUsersSet = useMemo(() => new Set(ignoredUsers), [ignoredUsers]);
  const { navigateRoomThread } = useRoomNavigate();







  const version = useRoomTimelineVersion(room);
  const showThreadRepliesInRoom = viewMode === 'classic';
  const sessionId = useMemo(() => createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()), [mx]);

  const [timeline, setTimeline] = useState<Timeline>(() =>
    getInitialTimeline(room, PAGINATION_LIMIT)
  );
  useEffect(() => {
    setTimeline(getInitialTimeline(room, PAGINATION_LIMIT));
  }, [room]);
  // A limited sync swaps the live timeline; follow it.
  const liveTimeline = getLiveTimeline(room);
  // Pagination grows the chain in place; `timeline` changing is the signal to re-read it.
  const linkedTimelines = useMemo(
    () => getLinkedTimelines(liveTimeline),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveTimeline, timeline, version]
  );

  const filterOptsRef = useRef(undefined);
  const paginate = useTimelinePagination(
    mx,
    timeline,
    setTimeline,
    PAGINATION_LIMIT,
    filterOptsRef
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const canLoadOlder = !threadId && !!linkedTimelines[0]?.getPaginationToken(Direction.Backward);
  const loadOlder = useCallback(async () => {
    setLoadingOlder(true);
    try {
      await paginate(true);
    } finally {
      setLoadingOlder(false);
    }
  }, [paginate]);

  const renderableEventEntries = useMemo(() => {
    return getRenderableEventEntries(
      linkedTimelines,
      room,
      undefined,
      ignoredUsersSet,
      !!showHiddenEvents,
      !!hideMembershipEvents,
      !!hideNickAvatarEvents,
      showThreadRepliesInRoom
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    linkedTimelines,
    room,
    showHiddenEvents,
    showThreadRepliesInRoom,
    version,
  ]);

  const threadResolutionMap = useRoomThreadResolutionMap(room);
  const threadIndex = useMindroomThreadIndex({
    room,
    threadId,
    eventId,
    focusedRoomOverviewRequested: false,
    compactViewRequested: viewMode === 'compact',
    effectiveViewMode: viewMode,
    linkedTimelines,
    renderableEventEntries,
    ignoredUsersSet,
    showHiddenEvents: !!showHiddenEvents,
    hideMembershipEvents: !!hideMembershipEvents,
    hideNickAvatarEvents: !!hideNickAvatarEvents,
    summaryMap,
    threadResolutionMap,
    currentUserId: mx.getUserId() ?? undefined,
    requestedThreadFilterState: threadFilterState,
    threadSortFreezeState,
    overviewRefreshCounter: version,
    sessionId,
    mx,
    onStoreThreadSummary: onStoreThreadSummary as (
      threadRootId: string,
      info: MindroomThreadSummaryInfo | undefined
    ) => void,
  });

  const threadEvents = useMemo(() => {
    if (!threadId) return [];
    const thread = room.getThread(threadId);
    const root = thread?.rootEvent ?? room.findEventById(threadId);
    return dedupeById([
      ...(root ? [root] : []),
      ...(thread ? getThreadTimelineEvents(thread) : []),
    ]);
    // `version` changes whenever the thread's timelines do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, threadId, version]);

  // A thread whose root is neither loaded nor fetchable cannot open.
  useEffect(() => {
    if (!threadId || !onThreadLoadError) return undefined;
    if (room.getThread(threadId)?.rootEvent || room.findEventById(threadId)) return undefined;
    let cancelled = false;
    mx.fetchRoomEvent(room.roomId, threadId).catch(() => {
      if (!cancelled) onThreadLoadError(threadId);
    });
    return () => {
      cancelled = true;
    };
  }, [mx, onThreadLoadError, room, threadId]);

  const visibleEvents = threadId
    ? threadEvents
    : renderableEventEntries.map((entry) => entry.event);
  const approvalTimeline = useThreadApprovalTimeline(
    visibleEvents,
    ignoredUsersSet,
    threadId,
    eventId
  );
  const threadSummaryTimeline = useMemo(
    () =>
      planThreadSummaryTimeline(threadEvents, {
        history: {
          sdkLoaded: !!threadId && !!room.getThread(threadId),
          canPaginateBack: false,
          hasMoreCachedBack: false,
        },
        revealedEventIds: eventId ? new Set([eventId]) : undefined,
        ignoredUserIds: ignoredUsersSet,
      }),
    [eventId, ignoredUsersSet, room, threadEvents, threadId]
  );

  const feature = useTimelineMessageFeature({
    room,
    editor,
    threadId,
    scrollRef,
    showThreadRepliesInRoom,
    messageLayout,
    messageSpacing,
    hideActivity: !!hideActivity,
    hideMembershipEvents: !!hideMembershipEvents,
    hideNickAvatarEvents: !!hideNickAvatarEvents,
    showHiddenEvents: !!showHiddenEvents,
  });

  const handleOpenThread = useCallback(
    (evt: MouseEvent) => {
      const rootId = (evt.currentTarget as HTMLElement).getAttribute('data-thread-root-id');
      if (rootId) navigateRoomThread(room.roomId, rootId);
    },
    [navigateRoomThread, room.roomId]
  );
  const handleOpenReply = useCallback((evt: MouseEvent) => {
    const targetId = (evt.currentTarget as HTMLElement).getAttribute('data-event-id');
    if (!targetId) return;
    const element = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(targetId)}"]`);
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  // Keep the newest message in view as messages arrive, unless the reader scrolled up.
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && stickToBottomRef.current) scroller.scrollTop = scroller.scrollHeight;
  });

  if (viewMode === 'compact' && !threadId) {
    return (
      <CompactRoomView
        room={room}
        threadRootIds={threadIndex.compactFilteredThreadRootIds}
        threadRecordMap={threadIndex.compactThreadRecordMap}
        onThreadClick={(rootId) => navigateRoomThread(room.roomId, rootId)}
        compactRoomScrollStateRef={compactRoomScrollStateRef}
      />
    );
  }

  const data = {
    threadRecordMap: threadIndex.threadRecordMap,
    threadEventMap: new Map(visibleEvents.map((event) => [event.getId() ?? '', event])),
    approvalTimeline,
    threadSummaryTimeline,
    handleOpenReply,
  };

  let previousEventId: string | undefined;
  const rows = visibleEvents.map((event, index) => {
    const id = event.getId() ?? '';
    const previous = visibleEvents[index - 1];
    const row: TimelineMessageRow = {
      eventId: id,
      event,
      index,
      timelineSet: room.getUnfilteredTimelineSet(),
      collapse:
        !!previous &&
        previous.getSender() === event.getSender() &&
        event.getTs() - previous.getTs() < 5 * 60 * 1000 &&
        previous.getStateKey?.() === undefined,
      highlighted: id === eventId,
      previousEventId,
    };
    previousEventId = id;
    if (approvalTimeline.hiddenEventIds.has(id) || threadSummaryTimeline.hiddenEventIds.has(id)) {
      return null;
    }
    const rendered = feature.renderEvent(row, data);
    if (rendered === null) return null;
    return (
      <div key={id} data-timeline-event-id={id}>
        {rendered}
        {!threadId &&
          renderMindroomRoomTimelineThreadBadge({
            eventId: id,
            event,
            threadRecordMap: threadIndex.threadRecordMap,
            room,
            onClick: handleOpenThread,
          })}
      </div>
    );
  });

  return (
    <Box grow="Yes" direction="Column" style={{ minHeight: 0, position: 'relative' }}>
      <Scroll
        ref={scrollRef}
        visibility="Hover"
        size="300"
        onScroll={(evt: React.UIEvent<HTMLDivElement>) => {
          const target = evt.currentTarget;
          stickToBottomRef.current =
            target.scrollHeight - target.scrollTop - target.clientHeight < 48;
        }}
      >
        <Box
          direction="Column"
          justifyContent="End"
          style={{ minHeight: '100%', padding: `${config.space.S400} 0` }}
        >
          {canLoadOlder && (
            <Box justifyContent="Center" style={{ padding: config.space.S200 }}>
              <Button
                size="300"
                variant="Secondary"
                fill="Soft"
                radii="Pill"
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
              >
                {loadingOlder ? (
                  <Spinner size="100" />
                ) : (
                  <Text size="B300">
                    {t('mindroomUi.threads.mindroomRoomTimeline.loadOlderMessages')}
                  </Text>
                )}
              </Button>
            </Box>
          )}
          {threadId && threadEvents.length === 0 && (
            <Box justifyContent="Center" style={{ padding: config.space.S400 }}>
              <Spinner size="300" variant="Secondary" />
            </Box>
          )}
          {feature.wrapExpansion(<>{rows}</>)}
        </Box>
      </Scroll>
    </Box>
  );
}
