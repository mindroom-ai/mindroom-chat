import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { type MatrixClient, type MatrixEvent, RelationType, type Room } from 'matrix-js-sdk';
import type { QueueRoomThreadCachePersist } from '../engine/enginePersistFacade';
import {
  getLatestThreadSummaryInfoFromEventSources,
  isMindroomThreadSummaryEvent,
  type MindroomThreadSummaryInfo,
} from '../messages/threadSummary';
import { markMainTimelineAsRead } from '../notifications/readReceipts';
import { getLiveCollapsibleMessageExpandId } from './threadCollapsibleMessages';
import { getThreadCacheTargetId } from './eventRepository';
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
import { useRoomLocalEchoRefresh } from './roomLocalEchoRefresh';

type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

type RoomUnreadInfo = ReturnType<typeof getRoomUnreadInfo>;

/**
 * CINNY-207 P3.3: render-only room live controller.
 *
 * Persistence, edit compaction, and the redaction cache lifecycle
 * moved into `MindroomSyncEngine`'s write-through
 * (`engine/engineWriteThrough.ts`) in Commit 3 — this controller no
 * longer touches the cache directly. What remains is the UI-visible
 * arrival wiring: local-echo refresh, expand-once ids, supplemental
 * thread events + timeline ticks, thread-tail flag, auto-scroll,
 * read-receipt marking, unread info, thread-summary store, timeline
 * range bumps, and the F6-C redaction repaint tick.
 *
 * The one persist call that stays here is
 * `queueRoomThreadCachePersist` for `!liveEvent` room-thread events
 * (backward-paginated in-room thread events). The engine's live
 * guard deliberately skips `toStartOfTimeline=true` events, so those
 * still need an explicit persist point on the pagination path. It is
 * satisfied here via `engine.persist.queueRoomThreadCachePersist`
 * (see MindroomRoomTimeline wiring; the pagination-batch persist for
 * generic room events is at `roomPaginationCommandController`).
 */
export const useRoomLiveRenderController = ({
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
  onStoreThreadSummary: (threadRootId: string, info: MindroomThreadSummaryInfo | undefined) => void;
  queueRoomThreadCachePersist: QueueRoomThreadCachePersist;
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

        // Redactions: the engine owns the cache side (delete + reaction
        // aggregation cleanup + I2 record persist); the component only
        // needs to force a repaint so the UI drops the reaction chip /
        // pruned content immediately (finding F6-C).
        if (timelineMeta.liveEvent && mEvt.isRedaction()) {
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
            // Paginated (toStartOfTimeline) thread-attributed events in
            // a room-view — the engine's live guard deliberately skips
            // these, so persistence goes through the microtask-batched
            // queue on the persist facade.
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
            //
            // F5 (2026-07-04): this sink call can arrive with an
            // UNREPAIRED sync-delivered instance for the same target
            // id the reconciler's onRepaired just landed a repaired
            // instance for (the AC2 race: reply-through-thread fires
            // a NewReply overlap that overlaps the reconciler's
            // hydrated batch). The overlap is absorbed by
            // `pickPreferredThreadRenderEvent`'s same-id merge
            // preference (RG5-fix2, commit 3fbe8afd): when both sides
            // share an eventId key, the raw `.replacingEvent()`-carrying
            // instance wins over the sibling that lacks it. So the
            // unrepaired instance never displaces the repaired one at
            // the render layer, and this sink call remains a no-op for
            // the overlap case — no explicit guard needed here.
            if (relation?.rel_type !== RelationType.Replace) {
              setSupplementalThreadEvents(threadId, [mEvt]);
            }
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

        // Room-view thread-attributed live event: no persist here — the
        // engine's write-through owns it — but the UI still needs the
        // arrival to flow through the summary store / unread info /
        // auto-follow paths below.
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
