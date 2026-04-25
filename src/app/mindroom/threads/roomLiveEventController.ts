import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { type MatrixClient, type MatrixEvent, RelationType, type Room } from 'matrix-js-sdk';
import {
  getLatestThreadSummaryInfoFromEventSources,
  isMindroomThreadSummaryEvent,
  type MindroomThreadSummaryInfo,
} from '../../components/message/mindroomThreadSummary';
import { markMainTimelineAsRead } from '../../utils/notifications';
import { getLiveCollapsibleMessageExpandId } from './threadCollapsibleMessages';
import { getThreadCacheTargetId } from './eventRepository';
import { useLiveEventArrive, type TimelineArriveMeta } from './roomLiveEventArrive';
import { isRenderableEvent } from './roomTimelineEvents';
import type { ThreadFilterState } from './roomThreadOverviewModel';
import { isThreadOnlyRoomActivity } from './threadRenderUtils';
import {
  isScrollNearBottom,
  shouldAutoScrollRoomOnLiveEvent,
  shouldAutoScrollThreadOnLiveEvent,
} from './timelineScrollUtils';
import { getRoomUnreadInfo, type Timeline } from './timelinePagination';
import { eventBelongsToThread } from './threadUtils';
import type { ThreadRecord } from './types';
import { logTimelineDebug } from './timelineDebug';
import type {
  PersistThreadEventCache,
  ThreadCachePersistenceController,
} from './threadCachePersistenceController';
import type { PersistRoomEventCache } from './roomCacheLifecycleController';

type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

type RoomUnreadInfo = ReturnType<typeof getRoomUnreadInfo>;

export const useRoomLiveEventController = ({
  atBottomRef,
  atLiveEndRef,
  effectiveThreadFilterState,
  hideActivity,
  hideMembershipEvents,
  hideNickAvatarEvents,
  ignoredUsersSet,
  liveExpandOnceIds,
  mx,
  normalThreadRecordMap,
  onStoreThreadSummary,
  persistRoomEventCache,
  persistThreadCacheFromRoomEvents,
  persistThreadEventCache,
  queueRoomThreadCachePersist,
  room,
  roomDebugTraceId,
  roomThreadFilterActive,
  scrollRef,
  scrollToBottomRef,
  setSupplementalThreadEvents,
  setThreadTailLoaded,
  setThreadTimelineTick,
  setTimeline,
  setUnreadInfo,
  showHiddenEvents,
  threadEventIndexMapRef,
  threadId,
  threadResolutionMap,
  timelineAtLiveEnd,
  unreadInfo,
}: {
  atBottomRef: MutableRefObject<boolean>;
  atLiveEndRef: MutableRefObject<boolean>;
  effectiveThreadFilterState: ThreadFilterState;
  hideActivity: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  ignoredUsersSet: Set<string>;
  liveExpandOnceIds: MutableRefObject<Set<string>>;
  mx: MatrixClient;
  normalThreadRecordMap: ReadonlyMap<string, ThreadRecord>;
  onStoreThreadSummary: (
    threadRootId: string,
    info: MindroomThreadSummaryInfo | undefined
  ) => void;
  persistRoomEventCache: PersistRoomEventCache;
  persistThreadCacheFromRoomEvents: ThreadCachePersistenceController['persistThreadCacheFromRoomEvents'];
  persistThreadEventCache: PersistThreadEventCache;
  queueRoomThreadCachePersist: ThreadCachePersistenceController['queueRoomThreadCachePersist'];
  room: Room;
  roomDebugTraceId: string;
  roomThreadFilterActive: boolean;
  scrollRef: RefObject<HTMLDivElement>;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  setSupplementalThreadEvents: (expectedThreadId: string, events: MatrixEvent[]) => void;
  setThreadTailLoaded: Dispatch<SetStateAction<boolean>>;
  setThreadTimelineTick: Dispatch<SetStateAction<number>>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  setUnreadInfo: Dispatch<SetStateAction<RoomUnreadInfo>>;
  showHiddenEvents: boolean;
  threadEventIndexMapRef: MutableRefObject<Map<string, number>>;
  threadId: string | undefined;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
  timelineAtLiveEnd: boolean;
  unreadInfo: RoomUnreadInfo;
}) => {
  useLiveEventArrive(
    room,
    useCallback(
      (mEvt: MatrixEvent, timelineMeta: TimelineArriveMeta) => {
        const mEventId = mEvt.getId();
        const relation = mEvt.getRelation();
        const relationTargetId = relation?.event_id;
        const liveExpandOnceId = getLiveCollapsibleMessageExpandId({
          mEvent: mEvt,
          room,
          threadId,
          threadFilterState: effectiveThreadFilterState,
          threadResolutionMap,
          threadRecordMap: normalThreadRecordMap,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
        });
        const threadOnlyRoomActivity = isThreadOnlyRoomActivity(room, mEvt);
        const threadCacheTargetId = getThreadCacheTargetId(room, mEvt);
        const isVisibleThreadActivity =
          mEventId === threadId ||
          eventBelongsToThread(mEvt, threadId ?? '') ||
          !!(relationTargetId && threadEventIndexMapRef.current.has(relationTargetId));
        if (liveExpandOnceId) {
          liveExpandOnceIds.current.add(liveExpandOnceId);
        }

        if (!timelineMeta.liveEvent) {
          if (!threadId && threadCacheTargetId) {
            queueRoomThreadCachePersist(mEvt);
            logTimelineDebug(roomDebugTraceId, 'room-thread-cache-persist-paginated', {
              eventId: mEventId ?? null,
              threadId: threadCacheTargetId,
              toStartOfTimeline: timelineMeta.toStartOfTimeline,
            });
          }
          return;
        }

        if (threadId) {
          if (isVisibleThreadActivity) {
            // m.replace edits mutate their target in-place and are filtered during rendering.
            if (relation?.rel_type !== RelationType.Replace) {
              setSupplementalThreadEvents(threadId, [mEvt]);
            }
            persistThreadEventCache(
              threadId,
              [mEvt],
              room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId),
              undefined,
              atLiveEndRef.current
            );
            if (
              (mEventId === threadId || eventBelongsToThread(mEvt, threadId)) &&
              atLiveEndRef.current
            ) {
              setThreadTailLoaded(true);
            }

            setThreadTimelineTick((val) => val + 1);

            const scrollElement = scrollRef.current;
            if (scrollElement) {
              const isNearBottom = isScrollNearBottom({
                scrollHeight: scrollElement.scrollHeight,
                scrollTop: scrollElement.scrollTop,
                clientHeight: scrollElement.clientHeight,
              });
              if (
                shouldAutoScrollThreadOnLiveEvent({
                  relationType: relation?.rel_type,
                  isNearBottom,
                  isTimelineAtLiveEnd: timelineAtLiveEnd,
                })
              ) {
                scrollToBottomRef.current.count += 1;
                scrollToBottomRef.current.smooth = true;
              } else if (atLiveEndRef.current && isNearBottom) {
                // Fresh scroll measurement avoids trapping users at bottom during streaming edits.
                scrollToBottomRef.current.count += 1;
                scrollToBottomRef.current.smooth = false;
              }
            }
          }
          return;
        }

        if (threadCacheTargetId) {
          persistThreadCacheFromRoomEvents([mEvt], {
            tailLoaded: true,
          });
        }
        if (threadOnlyRoomActivity) {
          if (isMindroomThreadSummaryEvent(mEvt)) {
            const rootId = mEvt.threadRootId;
            if (rootId) {
              const info = getLatestThreadSummaryInfoFromEventSources([mEvt]);
              if (info?.summaryText) {
                onStoreThreadSummary(rootId, info);
              }
            }
          }
          if (atBottomRef.current) {
            setTimeline((ct) => ({ ...ct }));
          }
          if (!unreadInfo) {
            setUnreadInfo(getRoomUnreadInfo(room));
          }
          return;
        }

        persistRoomEventCache([mEvt]);

        const shouldAutoFollow = shouldAutoScrollRoomOnLiveEvent({
          scrollElement: scrollRef.current,
          isTimelineAtLiveEnd: atLiveEndRef.current,
        });

        if (shouldAutoFollow) {
          if (document.hasFocus() && (!unreadInfo || mEvt.getSender() === mx.getUserId())) {
            requestAnimationFrame(() =>
              markMainTimelineAsRead(mx, mEvt.getRoomId()!, hideActivity)
            );
          }

          if (!document.hasFocus() && !unreadInfo) {
            setUnreadInfo(getRoomUnreadInfo(room));
          }

          scrollToBottomRef.current.count += 1;
          scrollToBottomRef.current.smooth = true;

          const renderableLiveEvent = isRenderableEvent(
            mEvt,
            room,
            threadId,
            ignoredUsersSet,
            showHiddenEvents,
            hideMembershipEvents,
            hideNickAvatarEvents
          );

          if (renderableLiveEvent) {
            if (roomThreadFilterActive) {
              setTimeline((ct) => ({ ...ct }));
            } else {
              setTimeline((ct) => ({
                ...ct,
                range: {
                  start: ct.range.start + 1,
                  end: ct.range.end + 1,
                },
              }));
            }
          } else {
            setTimeline((ct) => ({ ...ct }));
          }
          return;
        }
        setTimeline((ct) => ({ ...ct }));
        if (!unreadInfo) {
          setUnreadInfo(getRoomUnreadInfo(room));
        }
      },
      [
        atBottomRef,
        atLiveEndRef,
        effectiveThreadFilterState,
        hideActivity,
        hideMembershipEvents,
        hideNickAvatarEvents,
        ignoredUsersSet,
        liveExpandOnceIds,
        mx,
        normalThreadRecordMap,
        onStoreThreadSummary,
        persistRoomEventCache,
        persistThreadCacheFromRoomEvents,
        persistThreadEventCache,
        queueRoomThreadCachePersist,
        room,
        roomDebugTraceId,
        roomThreadFilterActive,
        scrollRef,
        scrollToBottomRef,
        setSupplementalThreadEvents,
        setThreadTailLoaded,
        setThreadTimelineTick,
        setTimeline,
        setUnreadInfo,
        showHiddenEvents,
        threadEventIndexMapRef,
        threadId,
        threadResolutionMap,
        timelineAtLiveEnd,
        unreadInfo,
      ]
    )
  );
};
