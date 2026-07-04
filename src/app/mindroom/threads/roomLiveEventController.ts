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
} from '../messages/threadSummary';
import { markMainTimelineAsRead } from '../notifications/readReceipts';
import { getLiveCollapsibleMessageExpandId } from './threadCollapsibleMessages';
import {
  deleteRoomEventsFromCache,
  deleteThreadEventFromCacheByEventId,
  deleteThreadEventsFromCache,
  getThreadCacheTargetId,
} from './eventRepository';
import {
  planRedactionCacheCleanup,
  removeAggregatedReactionByEventId,
} from './redactionCacheLifecycle';
import { useLiveEventArrive, type TimelineArriveMeta } from './roomLiveEventArrive';
import { isZeroReplyStandaloneThreadRootEvent } from './compactThreadRootData';
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
import { useRoomLocalEchoRefresh } from './roomLocalEchoRefresh';

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
  sessionId,
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
  onStoreThreadSummary: (threadRootId: string, info: MindroomThreadSummaryInfo | undefined) => void;
  persistRoomEventCache: PersistRoomEventCache;
  persistThreadCacheFromRoomEvents: ThreadCachePersistenceController['persistThreadCacheFromRoomEvents'];
  persistThreadEventCache: PersistThreadEventCache;
  queueRoomThreadCachePersist: ThreadCachePersistenceController['queueRoomThreadCachePersist'];
  room: Room;
  roomDebugTraceId: string;
  roomThreadFilterActive: boolean;
  scrollRef: RefObject<HTMLDivElement>;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  sessionId: string;
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
  useRoomLocalEchoRefresh(
    room,
    useCallback(() => {
      setTimeline((current) => ({ ...current }));
    }, [setTimeline])
  );

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

        // CINNY-207 P1.2 (finding F6): redaction events carry `redacts`, not
        // `m.relates_to`, so the relation-based thread checks below never
        // match them. Handle their cache lifecycle explicitly: delete
        // redacted reaction records, drop clone aggregations by event id,
        // re-persist pruned message targets, and repaint.
        if (timelineMeta.liveEvent && mEvt.isRedaction()) {
          const cleanupPlan = planRedactionCacheCleanup({
            room,
            redactionEvent: mEvt,
            fallbackThreadId: threadId,
          });
          if (cleanupPlan) {
            if (cleanupPlan.deleteRecords) {
              if (cleanupPlan.threadCacheTargetId) {
                deleteThreadEventsFromCache(
                  sessionId,
                  room.roomId,
                  cleanupPlan.threadCacheTargetId,
                  [cleanupPlan.redactedEventId]
                ).catch(() => undefined);
              } else {
                // Pruned reactions can lose every thread hint; fall back to a
                // room-scoped scan by event id.
                deleteThreadEventFromCacheByEventId(
                  sessionId,
                  room.roomId,
                  cleanupPlan.redactedEventId
                ).catch(() => undefined);
              }
              deleteRoomEventsFromCache(sessionId, room.roomId, [
                cleanupPlan.redactedEventId,
              ]).catch(() => undefined);

              const threadTimelineSet = cleanupPlan.threadCacheTargetId
                ? room.getThread(cleanupPlan.threadCacheTargetId)?.getUnfilteredTimelineSet()
                : undefined;
              const candidateParentIds = new Set<string>(threadEventIndexMapRef.current.keys());
              room
                .getLiveTimeline()
                .getEvents()
                .forEach((timelineEvent) => {
                  const timelineEventId = timelineEvent.getId();
                  if (timelineEventId) candidateParentIds.add(timelineEventId);
                });
              removeAggregatedReactionByEventId({
                timelineSets: [threadTimelineSet, room.getUnfilteredTimelineSet()],
                candidateParentIds,
                redactedEventId: cleanupPlan.redactedEventId,
              });
            }

            // Persist the redaction event itself in every case. Homeservers
            // can serve stale un-pruned copies of the redacted event for a
            // while (observed on Tuwunel /relations), so the cached redaction
            // record is what lets hydration re-apply the redaction locally
            // when such a copy arrives later (I2: server truth converges via
            // our own record of it).
            if (cleanupPlan.threadCacheTargetId) {
              persistThreadEventCache(
                cleanupPlan.threadCacheTargetId,
                [mEvt],
                room.getThread(cleanupPlan.threadCacheTargetId)?.rootEvent ??
                  room.findEventById(cleanupPlan.threadCacheTargetId),
                undefined,
                // Only the open thread's live-end state is a meaningful tail
                // signal; anything else must not downgrade the cached flag.
                threadId && cleanupPlan.threadCacheTargetId === threadId
                  ? atLiveEndRef.current
                  : undefined
              );
            }
            if (!cleanupPlan.threadCacheTargetId || cleanupPlan.threadTargetFromFallback) {
              // Room-level target, unknown target, or ambiguous fallback
              // attribution: the redaction record plus the pruned target
              // reach the room cache via collectStateTargetEvents in the
              // serializer.
              persistRoomEventCache([mEvt]);
            }
          }

          // Repaint so redaction-driven state (reaction chips, pruned
          // content) leaves the screen without waiting for an unrelated
          // event (finding F6-C).
          if (threadId) {
            setThreadTimelineTick((val) => val + 1);
          } else {
            setTimeline((ct) => ({ ...ct }));
          }
          return;
        }

        if (!timelineMeta.liveEvent) {
          if (threadId && mEvt.isSending() && isVisibleThreadActivity) {
            if (relation?.rel_type !== RelationType.Replace) {
              setSupplementalThreadEvents(threadId, [mEvt]);
            }
            setThreadTimelineTick((val) => val + 1);
            return;
          }

          if (!threadId && threadCacheTargetId) {
            queueRoomThreadCachePersist(mEvt);
            logTimelineDebug(roomDebugTraceId, 'room-thread-cache-persist-paginated', {
              eventId: mEventId ?? null,
              threadId: threadCacheTargetId,
              toStartOfTimeline: timelineMeta.toStartOfTimeline,
            });
          }

          // CINNY-088: pending local echoes (e.g. a freshly-sent voice message)
          // arrive with `liveEvent: false` before the server confirmation re-fires
          // with `liveEvent: true`. Without driving a re-render here, the compact
          // view's useMindroomThreadIndex memo chain doesn't recompute and the
          // "0 replies" card never appears until the second arrival. Scoped
          // narrowly to sent-but-not-yet-confirmed standalone roots in the room
          // view, so paginated history and thread-only arrivals are unaffected.
          if (!threadId && mEvt.isSending() && isZeroReplyStandaloneThreadRootEvent(mEvt)) {
            setTimeline((ct) => ({ ...ct }));
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
        sessionId,
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
