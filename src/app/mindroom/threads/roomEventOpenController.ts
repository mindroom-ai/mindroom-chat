import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { NavigateOptions } from 'react-router-dom';
import type {
  EventTimeline,
  MatrixClient,
  MatrixEvent,
  Room,
  Thread,
} from 'matrix-js-sdk';
import to from 'await-to-js';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import type { ScrollToElement, ScrollToItem } from '../../hooks/useVirtualPaginator';
import type { RoomViewMode } from '../../state/room/roomViewMode';
import type {
  ThreadFilterState,
  ThreadSortFreezeState,
} from './roomThreadOverviewModel';
import {
  getRenderableEventEntries,
} from './roomTimelineEvents';
import {
  getEmptyTimeline,
  getInitialTimeline,
  type RecalibrateFilterOpts,
  type Timeline,
} from './timelinePagination';
import {
  getEventElementById,
  getTimelineTargetAnchor,
  getUnreadTargetAnchor,
} from './timelineScrollUtils';
import { useEventTimelineLoader } from './timelinePaginationController';
import { resolveRoomEventThreadRedirect } from './roomDeepLink';
import { getRoomEventFocusTarget } from './threadRoomFocus';
import {
  buildVisibleThreadReplyCountMap,
  eventBelongsToThread,
} from './threadUtils';
import type { PendingThreadOpen } from './threadOpenTargetEvent';
import type { ThreadResolutionState } from './useRoomThreadTags';

type FocusItemState = {
  eventId?: string;
  highlight: boolean;
  index: number;
  scrollTo: boolean;
};

export type OpenRoomEventHandler = (
  eventId: string,
  highlight?: boolean,
  onScroll?: (scrolled: boolean) => void
) => Promise<void>;

export const useRoomEventOpenController = ({
  alive,
  effectiveViewMode,
  focusEventInRoom,
  hideMembershipEvents,
  hideNickAvatarEvents,
  ignoredUsersSet,
  mx,
  navigateRoomThread,
  overviewThreadRootIds,
  pendingThreadOpenRef,
  readUpToTs,
  readUptoEventIdRef,
  recalibrateFilterOptsRef,
  room,
  roomOverviewOrderActive,
  roomThreadListThreads,
  safePaginationLimit,
  safePaginationLimitRef,
  scheduledTaskCounts,
  scrollRef,
  scrollToBottomRef,
  scrollToElement,
  scrollToItem,
  searchQuery,
  setFocusItem,
  setPendingThreadOpenTick,
  setThreadTimelineTick,
  setTimeline,
  showHiddenEvents,
  threadEventIndexMapRef,
  threadFilteredEvents,
  threadFilterStateRef,
  threadId,
  threadParticipantMap,
  threadReplyCountMap,
  threadResolutionMap,
  threadSortControlSignature,
  threadSortFreezeState,
  threadSummaryInfoMap,
}: {
  alive: () => boolean;
  effectiveViewMode: RoomViewMode;
  focusEventInRoom?: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  ignoredUsersSet: Set<string>;
  mx: MatrixClient;
  navigateRoomThread: (
    roomId: string,
    threadId: string,
    eventId?: string,
    opts?: NavigateOptions
  ) => void;
  overviewThreadRootIds: string[];
  pendingThreadOpenRef: MutableRefObject<PendingThreadOpen | undefined>;
  readUpToTs: number | undefined;
  readUptoEventIdRef: MutableRefObject<string | undefined>;
  recalibrateFilterOptsRef: MutableRefObject<RecalibrateFilterOpts | undefined>;
  room: Room;
  roomOverviewOrderActive: boolean;
  roomThreadListThreads: Thread[];
  safePaginationLimit: number;
  safePaginationLimitRef: MutableRefObject<number>;
  scheduledTaskCounts: Map<string, number>;
  scrollRef: RefObject<HTMLElement>;
  scrollToBottomRef: MutableRefObject<{ count: number; smooth: boolean }>;
  scrollToElement: ScrollToElement;
  scrollToItem: ScrollToItem;
  searchQuery: string;
  setFocusItem: Dispatch<SetStateAction<FocusItemState | undefined>>;
  setPendingThreadOpenTick: Dispatch<SetStateAction<number>>;
  setThreadTimelineTick: Dispatch<SetStateAction<number>>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  showHiddenEvents: boolean;
  threadEventIndexMapRef: MutableRefObject<Map<string, number>>;
  threadFilteredEvents: MatrixEvent[];
  threadFilterStateRef: MutableRefObject<ThreadFilterState>;
  threadId?: string;
  threadParticipantMap: Map<string, string[]>;
  threadReplyCountMap: Map<string, number>;
  threadResolutionMap: Map<string, ThreadResolutionState>;
  threadSortControlSignature: string;
  threadSortFreezeState: ThreadSortFreezeState | null;
  threadSummaryInfoMap: Map<string, MindroomThreadSummaryInfo>;
}): {
  handleOpenEvent: OpenRoomEventHandler;
  redirectRoomEventDeepLink: (eventId: string) => boolean;
} => {
  const redirectRoomEventDeepLink = useCallback(
    (targetEventId: string, linkedTimelines?: EventTimeline[]): boolean => {
      const threadTarget = resolveRoomEventThreadRedirect({
        eventId: targetEventId,
        room,
        linkedTimelines,
        roomThreads: roomThreadListThreads,
        roomOverviewOrderActive,
        threadId,
        focusEventInRoom,
      });
      if (!threadTarget) {
        return false;
      }

      navigateRoomThread(room.roomId, threadTarget.threadId, threadTarget.eventId, {
        replace: true,
      });
      return true;
    },
    [
      focusEventInRoom,
      navigateRoomThread,
      room,
      roomOverviewOrderActive,
      roomThreadListThreads,
      threadId,
    ]
  );

  const loadEventTimeline = useEventTimelineLoader(
    mx,
    room,
    useCallback(
      (evtId, linkedTimelines, eventAbsoluteIndex) => {
        if (!alive()) return;
        if (redirectRoomEventDeepLink(evtId, linkedTimelines)) {
          return;
        }
        const filterOpts = recalibrateFilterOptsRef.current;
        const renderableEntries = getRenderableEventEntries(
          linkedTimelines,
          room,
          threadId,
          filterOpts?.ignoredUsersSet ?? ignoredUsersSet,
          filterOpts?.showHiddenEvents ?? showHiddenEvents,
          filterOpts?.hideMembershipEvents ?? hideMembershipEvents,
          filterOpts?.hideNickAvatarEvents ?? hideNickAvatarEvents
        );
        const loadedRenderableEvents = renderableEntries.map(({ event }) => event);
        const loadedThreadReplyCountMap = buildVisibleThreadReplyCountMap(
          linkedTimelines.flatMap((timeline) => timeline.getEvents())
        );
        const anchor =
          evtId === readUptoEventIdRef.current
            ? getUnreadTargetAnchor({
                renderableEntries,
                eventId: evtId,
                absoluteIndex: eventAbsoluteIndex,
              })
            : getTimelineTargetAnchor({
                linkedTimelines,
                renderableEntries,
                eventId: evtId,
                absoluteIndex: eventAbsoluteIndex,
              });
        const {
          index: focusIndex,
          count,
          canFocus,
        } = anchor
          ? getRoomEventFocusTarget({
              eventId: anchor.eventId,
              renderableEvents: loadedRenderableEvents,
              room,
              threadResolutionMap,
              threadId,
              threadFilterState: threadFilterStateRef.current,
              threadReplyCountMap: loadedThreadReplyCountMap,
              scheduledTaskCounts,
              threadReplyCountMapForMeta: threadReplyCountMap,
              threadParticipantMap,
              summaryMap: threadSummaryInfoMap,
              currentUserId: mx.getSafeUserId(),
              readUpToTs,
              searchQuery,
              threadSortFreezeState,
              threadSortControlSignature,
              viewMode: effectiveViewMode,
              roomThreads: roomThreadListThreads,
              orderedRoomOverviewEventIds: roomOverviewOrderActive
                ? overviewThreadRootIds
                : undefined,
            })
          : {
              index: 0,
              count: loadedRenderableEvents.length,
              canFocus: false,
            };

        setFocusItem(
          anchor && canFocus
            ? {
                eventId: anchor.eventId,
                index: focusIndex,
                scrollTo: !threadId,
                highlight: evtId !== readUptoEventIdRef.current,
              }
            : undefined
        );
        setTimeline({
          linkedTimelines,
          range: {
            start: Math.max(focusIndex - safePaginationLimitRef.current, 0),
            end: Math.min(focusIndex + safePaginationLimitRef.current, count),
          },
        });
      },
      [
        alive,
        effectiveViewMode,
        hideMembershipEvents,
        hideNickAvatarEvents,
        ignoredUsersSet,
        mx,
        overviewThreadRootIds,
        readUpToTs,
        readUptoEventIdRef,
        recalibrateFilterOptsRef,
        redirectRoomEventDeepLink,
        room,
        roomOverviewOrderActive,
        roomThreadListThreads,
        safePaginationLimitRef,
        searchQuery,
        scheduledTaskCounts,
        setFocusItem,
        setTimeline,
        showHiddenEvents,
        threadFilterStateRef,
        threadId,
        threadParticipantMap,
        threadReplyCountMap,
        threadResolutionMap,
        threadSortControlSignature,
        threadSortFreezeState,
        threadSummaryInfoMap,
      ]
    ),
    useCallback(() => {
      if (!alive()) return;
      const filterOpts = recalibrateFilterOptsRef.current;
      setTimeline(
        getInitialTimeline(room, safePaginationLimit, {
          threadId,
          ignoredUsersSet: filterOpts?.ignoredUsersSet ?? ignoredUsersSet,
          showHiddenEvents: filterOpts?.showHiddenEvents ?? showHiddenEvents,
          hideMembershipEvents: filterOpts?.hideMembershipEvents ?? hideMembershipEvents,
          hideNickAvatarEvents: filterOpts?.hideNickAvatarEvents ?? hideNickAvatarEvents,
        })
      );
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
    }, [
      alive,
      hideMembershipEvents,
      hideNickAvatarEvents,
      ignoredUsersSet,
      recalibrateFilterOptsRef,
      room,
      safePaginationLimit,
      scrollToBottomRef,
      setTimeline,
      showHiddenEvents,
      threadId,
    ])
  );

  const handleOpenEvent = useCallback<OpenRoomEventHandler>(
    async (evtId, highlight = true, onScroll = undefined) => {
      if (threadId && evtId !== threadId) {
        const targetEvent = room.findEventById(evtId);
        if (!targetEvent || !eventBelongsToThread(targetEvent, threadId)) {
          return;
        }
      }

      if (threadId) {
        const threadItemIndex = threadEventIndexMapRef.current.get(evtId);
        if (typeof threadItemIndex === 'number') {
          const target = getEventElementById(scrollRef.current, evtId);
          setFocusItem({
            eventId: evtId,
            index: threadItemIndex,
            scrollTo: false,
            highlight,
          });
          if (target) {
            scrollToElement(target, {
              behavior: 'smooth',
              align: 'center',
              stopInView: true,
            });
            if (onScroll) onScroll(true);
            return;
          }
          if (onScroll) onScroll(false);
          return;
        }
      }

      const filteredIndex = threadFilteredEvents.findIndex((event) => event.getId() === evtId);

      if (filteredIndex !== -1) {
        const scrolled = scrollToItem(filteredIndex, {
          behavior: 'smooth',
          align: 'center',
          stopInView: true,
        });
        if (onScroll) onScroll(scrolled);
        setFocusItem({
          eventId: evtId,
          index: filteredIndex,
          scrollTo: false,
          highlight,
        });
      } else {
        if (threadId) {
          let currentThreadTimelineSet = room.getThread(threadId)?.getUnfilteredTimelineSet();
          const expectedThreadId = threadId;
          if (!currentThreadTimelineSet) {
            const [threadErr] = await to(
              mx.getThreadTimeline(room.getUnfilteredTimelineSet(), threadId)
            );
            if (threadErr) {
              if (onScroll) onScroll(false);
              return;
            }
            currentThreadTimelineSet =
              room.getThread(threadId)?.getUnfilteredTimelineSet() ??
              room.getUnfilteredTimelineSet();
          }
          const [err, threadEventTimeline] = await to(
            mx.getEventTimeline(currentThreadTimelineSet, evtId)
          );
          if (err || !threadEventTimeline) {
            if (onScroll) onScroll(false);
            return;
          }
          pendingThreadOpenRef.current = {
            threadId: expectedThreadId,
            eventId: evtId,
            highlight,
            onScroll,
            attempts: 0,
          };
          setTimeline((currentTimeline) => ({ ...currentTimeline }));
          setThreadTimelineTick((value) => value + 1);
          setPendingThreadOpenTick((value) => value + 1);
          return;
        }
        setTimeline(getEmptyTimeline());
        await loadEventTimeline(evtId);
      }
    },
    [
      loadEventTimeline,
      mx,
      pendingThreadOpenRef,
      room,
      scrollRef,
      scrollToElement,
      scrollToItem,
      setFocusItem,
      setPendingThreadOpenTick,
      setThreadTimelineTick,
      setTimeline,
      threadEventIndexMapRef,
      threadFilteredEvents,
      threadId,
    ]
  );

  return { handleOpenEvent, redirectRoomEventDeepLink };
};

export const useRoomEventRouteOpenController = ({
  effectiveViewMode,
  eventId,
  focusEventInRoom,
  handleOpenEvent,
  redirectRoomEventDeepLink,
  roomId,
  roomOverviewOrderActive,
  threadId,
}: {
  effectiveViewMode: RoomViewMode;
  eventId?: string;
  focusEventInRoom?: boolean;
  handleOpenEvent: OpenRoomEventHandler;
  redirectRoomEventDeepLink: (eventId: string) => boolean;
  roomId: string;
  roomOverviewOrderActive: boolean;
  threadId?: string;
}) => {
  const handleOpenEventRef = useRef(handleOpenEvent);
  const handledRoomEventRouteRef = useRef<string>();

  useEffect(() => {
    handleOpenEventRef.current = handleOpenEvent;
  }, [handleOpenEvent]);

  useEffect(() => {
    if (!eventId) {
      handledRoomEventRouteRef.current = undefined;
      return;
    }

    const routeKey = [
      roomId,
      threadId ?? '',
      eventId,
      focusEventInRoom ? '1' : '0',
      effectiveViewMode,
      roomOverviewOrderActive ? '1' : '0',
    ].join('|');

    if (handledRoomEventRouteRef.current === routeKey) {
      return;
    }

    handledRoomEventRouteRef.current = routeKey;

    if (redirectRoomEventDeepLink(eventId)) {
      return;
    }

    void handleOpenEventRef.current(eventId);
  }, [
    effectiveViewMode,
    eventId,
    focusEventInRoom,
    redirectRoomEventDeepLink,
    roomId,
    roomOverviewOrderActive,
    threadId,
  ]);
};
