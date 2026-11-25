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
import {
  RelationType,
  type EventTimeline,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type Thread,
} from 'matrix-js-sdk';
import to from 'await-to-js';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import type { ScrollToElement, ScrollToItem } from './useVirtualPaginator';
import type { RoomViewMode } from '../navigation/roomViewMode';
import type {
  ThreadFilterState,
  ThreadSortFreezeState,
} from '../event-store/threads/roomThreadOverviewModel';
import { getRenderableEventEntries } from '../event-store/timeline/roomTimelineEvents';
import {
  getEmptyTimeline,
  getInitialTimeline,
  type RecalibrateFilterOpts,
  type Timeline,
} from '../event-store/timeline/timelinePagination';
import {
  getEventElementById,
  getTimelineTargetAnchor,
  getUnreadTargetAnchor,
} from '../event-store/timeline/timelineScrollUtils';
import { useEventTimelineLoader } from './timelinePaginationController';
import {
  fetchRoomEventThreadTarget,
  isRoomEventThreadRedirectActive,
  resolveRoomEventThreadRedirect,
} from '../routes/roomDeepLink';
import { getRoomEventFocusTarget } from '../threads/threadRoomFocus';
import {
  buildVisibleThreadReplyCountMap,
  eventBelongsToThread,
} from '../event-store/threads/threadUtils';
import type { ThreadTargetCommands } from '../threads/open/threadSessionTypes';
import type { ThreadScheduledStatus } from '../event-store/threads/threadScheduledStatus';
import type { ThreadResolutionState } from '../threads/tags/useRoomThreadTags';
import { DIRECT_ROOM_TIMELINE_FILTER_STATE } from '../event-store/timeline/roomTimelineViewState';
import { countsRoomRows } from './roomTimelineClassicRows';

type FocusItemState = {
  eventId?: string;
  highlight: boolean;
  index: number;
  scrollTo: boolean;
};

export type OpenRoomEventOptions = {
  behavior?: ScrollBehavior;
  stopInView?: boolean;
  updateFocus?: boolean;
};

export type OpenRoomEventHandler = (
  eventId: string,
  highlight?: boolean,
  onScroll?: (scrolled: boolean) => void,
  options?: OpenRoomEventOptions
) => Promise<void>;

/**
 * Opens the event a room's address names. `returned`: the entry is a return to the room
 * (`RETURN_TO_ROOM_STATE`), which stays the room: its event would open the thread that was left.
 */
export type OpenRoomEventRoute = (
  eventId: string,
  isCurrentRoute: () => boolean,
  returned: boolean
) => Promise<void>;
type OpenRoomEventArgs = [...Parameters<OpenRoomEventHandler>, returned?: boolean];

const EMPTY_LIST: never[] = [];
const EMPTY_MAP = new Map<never, never>();
const EMPTY_REF: RefObject<undefined> = { current: undefined };

export const useRoomEventOpenController = (opts: {
  alive: () => boolean;
  cancelThreadBottomSettle?: () => void;
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
  overviewThreadRootIds?: string[];
  threadTargets?: ThreadTargetCommands;
  readUptoEventIdRef?: RefObject<string | undefined>;
  recalibrateFilterOptsRef?: RefObject<RecalibrateFilterOpts | undefined>;
  room: Room;
  roomOverviewOrderActive?: boolean;
  roomThreadListThreads?: Thread[];
  prefetchDepth?: number;
  prefetchDepthRef?: MutableRefObject<number>;
  scheduledStatusMap?: Map<string, ThreadScheduledStatus>;
  scrollRef: RefObject<HTMLElement | null>;
  scrollThreadEventIntoView?: (eventId: string) => boolean;
  scrollToBottomRef: MutableRefObject<{ count: number; smooth: boolean }>;
  scrollToElement: ScrollToElement;
  scrollToItem?: ScrollToItem;
  searchQuery?: string;
  setFocusItem: Dispatch<SetStateAction<FocusItemState | undefined>>;
  notifyThreadEventsChanged?: () => void;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  showHiddenEvents: boolean;
  threadEventIndexMapRef?: MutableRefObject<Map<string, number>>;
  threadFilteredEvents?: MatrixEvent[];
  /** Live ref to the current room rows, when provided by a mounted rows viewport bridge. */
  threadFilteredEventsRef?: MutableRefObject<MatrixEvent[]>;
  /**
   * The row of each loaded event that a closed fold of the room's rows holds, by event ID
   * (`RoomRowProjection`). A jump to any of them unfolds the run instead of scrolling to a row.
   */
  foldedRows?: ReadonlyMap<string, number>;
  /** Live ref to `foldedRows`, when provided by a mounted rows viewport bridge. */
  foldedRowsRef?: MutableRefObject<ReadonlyMap<string, number> | undefined>;
  threadFilterStateRef?: MutableRefObject<ThreadFilterState>;
  threadId?: string;
  threadParticipantMap?: Map<string, string[]>;
  threadReplyCountMap?: Map<string, number>;
  threadResolutionMap?: Map<string, ThreadResolutionState>;
  threadSortControlSignature?: string;
  threadSortFreezeState?: ThreadSortFreezeState | null;
  threadSummaryInfoMap?: Map<string, ThreadSummaryInfo>;
}): {
  handleOpenEvent: OpenRoomEventHandler;
  openRoomEventRoute: OpenRoomEventRoute;
} => {
  const optsRef = useLatestRef(opts);
  const threadJumpGenerationRef = useRef(0);

  const redirectRoomEventDeepLink = useCallback(
    (targetEventId: string, linkedTimelines?: EventTimeline[]): boolean => {
      const o = optsRef.current;
      if (o.effectiveViewMode === 'classic') return false;
      const threadTarget = resolveRoomEventThreadRedirect({
        eventId: targetEventId,
        room: o.room,
        linkedTimelines,
        roomThreads: o.roomThreadListThreads ?? EMPTY_LIST,
        roomOverviewOrderActive: o.roomOverviewOrderActive ?? false,
        threadId: o.threadId,
        focusEventInRoom: o.focusEventInRoom,
      });
      if (!threadTarget) return false;
      o.navigateRoomThread(o.room.roomId, threadTarget.threadId, threadTarget.eventId, {
        replace: true,
      });
      return true;
    },
    [optsRef]
  );

  const loadEventTimeline = useEventTimelineLoader(
    opts.mx,
    opts.room,
    (evtId, linkedTimelines, eventAbsoluteIndex, returned) => {
      const o = optsRef.current;
      if (!o.alive()) return;
      if (!returned && redirectRoomEventDeepLink(evtId, linkedTimelines)) return;
      const filterOpts = o.recalibrateFilterOptsRef?.current;
      const renderableEntries = getRenderableEventEntries(
        linkedTimelines,
        o.room,
        o.threadId,
        filterOpts?.ignoredUsersSet ?? o.ignoredUsersSet,
        filterOpts?.showHiddenEvents ?? o.showHiddenEvents,
        filterOpts?.hideMembershipEvents ?? o.hideMembershipEvents,
        filterOpts?.hideNickAvatarEvents ?? o.hideNickAvatarEvents,
        filterOpts?.showThreadRepliesInRoom ?? o.effectiveViewMode === 'classic'
      );
      const loadedRenderableEvents = renderableEntries.map(({ event }) => event);
      const loadedThreadReplyCountMap = buildVisibleThreadReplyCountMap(
        linkedTimelines.flatMap((timeline) => timeline.getEvents())
      );
      const readUptoId = o.readUptoEventIdRef?.current;
      const anchor =
        evtId === readUptoId
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
            room: o.room,
            threadResolutionMap: o.threadResolutionMap ?? EMPTY_MAP,
            threadId: o.threadId,
            threadFilterState: o.threadFilterStateRef?.current ?? DIRECT_ROOM_TIMELINE_FILTER_STATE,
            threadReplyCountMap: loadedThreadReplyCountMap,
            scheduledStatusMap: o.scheduledStatusMap ?? EMPTY_MAP,
            threadReplyCountMapForMeta: o.threadReplyCountMap ?? EMPTY_MAP,
            threadParticipantMap: o.threadParticipantMap ?? EMPTY_MAP,
            summaryMap: o.threadSummaryInfoMap ?? EMPTY_MAP,
            currentUserId: o.mx.getSafeUserId(),
            searchQuery: o.searchQuery ?? '',
            threadSortFreezeState: o.threadSortFreezeState ?? null,
            threadSortControlSignature: o.threadSortControlSignature ?? '',
            viewMode: o.effectiveViewMode,
            roomThreads: o.roomThreadListThreads ?? EMPTY_LIST,
            orderedRoomOverviewEventIds: o.roomOverviewOrderActive
              ? (o.overviewThreadRootIds ?? EMPTY_LIST)
              : undefined,
          })
        : { index: 0, count: loadedRenderableEvents.length, canFocus: false };

      o.setFocusItem(
        anchor && canFocus
          ? {
              eventId: anchor.eventId,
              index: focusIndex,
              scrollTo: !o.threadId,
              highlight: evtId !== readUptoId,
            }
          : undefined
      );
      const depth = o.prefetchDepthRef?.current ?? 0;
      o.setTimeline({
        linkedTimelines,
        range: { start: Math.max(focusIndex - depth, 0), end: Math.min(focusIndex + depth, count) },
      });
    },
    () => {
      const o = optsRef.current;
      if (!o.alive()) return;
      const filterOpts = o.recalibrateFilterOptsRef?.current;
      o.setTimeline(
        countsRoomRows(
          getInitialTimeline(o.room, o.prefetchDepth ?? 0, {
            threadId: o.threadId,
            ignoredUsersSet: filterOpts?.ignoredUsersSet ?? o.ignoredUsersSet,
            showHiddenEvents: filterOpts?.showHiddenEvents ?? o.showHiddenEvents,
            hideMembershipEvents: filterOpts?.hideMembershipEvents ?? o.hideMembershipEvents,
            hideNickAvatarEvents: filterOpts?.hideNickAvatarEvents ?? o.hideNickAvatarEvents,
            showThreadRepliesInRoom:
              filterOpts?.showThreadRepliesInRoom ?? o.effectiveViewMode === 'classic',
          })
        )
      );
      o.scrollToBottomRef.current.count += 1;
      o.scrollToBottomRef.current.smooth = false;
    },
    opts.recalibrateFilterOptsRef ?? EMPTY_REF
  );

  const handleOpenEvent = useCallback(
    async (...[evtId, highlight = true, onScroll, options, returned]: OpenRoomEventArgs) => {
      const o = optsRef.current;
      const { threadId, room, mx, setFocusItem, setTimeline } = o;
      if (threadId && evtId !== threadId) {
        // The render index map is authoritative thread membership: events loaded through the
        // MindRoom thread cache may be absent from the SDK room/thread structures.
        if (!o.threadEventIndexMapRef?.current.has(evtId)) {
          const targetEvent = room.findEventById(evtId);
          if (!targetEvent || !eventBelongsToThread(targetEvent, threadId)) {
            onScroll?.(false);
            return;
          }
        }
      }

      if (threadId) {
        const threadItemIndex = o.threadEventIndexMapRef?.current.get(evtId);
        if (typeof threadItemIndex === 'number') {
          o.cancelThreadBottomSettle?.();
          // Every jump supersedes any prior jump's retry chain, including mounted-target jumps.
          threadJumpGenerationRef.current += 1;
          const behavior = options?.behavior ?? 'smooth';
          const stopInView = options?.stopInView ?? true;
          const target = getEventElementById(o.scrollRef.current, evtId);
          if (options?.updateFocus ?? true) {
            setFocusItem({ eventId: evtId, index: threadItemIndex, scrollTo: false, highlight });
          }
          if (target) {
            o.scrollToElement(target, { behavior, align: 'center', stopInView });
            onScroll?.(true);
            return;
          }
          // Under thread virtualization a loaded-but-distant row is unmounted; scroll its virtual
          // index into view and retry until the row mounts and measures.
          if (o.scrollThreadEventIntoView?.(evtId)) {
            const generation = threadJumpGenerationRef.current;
            let attempts = 0;
            const retryScrollToMountedTarget = () => {
              const cur = optsRef.current;
              if (!cur.alive() || threadJumpGenerationRef.current !== generation) return;
              const retryTarget = getEventElementById(cur.scrollRef.current, evtId);
              if (retryTarget) {
                cur.scrollToElement(retryTarget, { behavior, align: 'center', stopInView });
                onScroll?.(true);
                return;
              }
              attempts += 1;
              if (attempts < 12) {
                cur.scrollThreadEventIntoView?.(evtId);
                requestAnimationFrame(retryScrollToMountedTarget);
                return;
              }
              onScroll?.(false);
            };
            requestAnimationFrame(retryScrollToMountedTarget);
            return;
          }
          onScroll?.(false);
          return;
        }
      }

      const activeFoldedRows = o.foldedRowsRef ? o.foldedRowsRef.current : o.foldedRows;
      const foldedRow = threadId ? undefined : activeFoldedRows?.get(evtId);
      if (foldedRow !== undefined) {
        // Loaded, inside a closed fold: the focus keeps its run unfolded from the next render on.
        setFocusItem({ eventId: evtId, index: foldedRow, scrollTo: true, highlight });
        onScroll?.(true);
        return;
      }

      const activeFilteredEvents =
        (o.threadFilteredEventsRef ? o.threadFilteredEventsRef.current : o.threadFilteredEvents) ??
        EMPTY_LIST;
      const filteredIndex = activeFilteredEvents.findIndex((event) => event.getId() === evtId);
      if (filteredIndex !== -1) {
        const scrolled =
          o.scrollToItem?.(filteredIndex, {
            behavior: 'smooth',
            align: 'center',
            stopInView: true,
          }) ?? false;
        onScroll?.(scrolled);
        setFocusItem({ eventId: evtId, index: filteredIndex, scrollTo: false, highlight });
        return;
      }

      if (threadId) {
        let currentThreadTimelineSet = room.getThread(threadId)?.getUnfilteredTimelineSet();
        if (!currentThreadTimelineSet) {
          const [threadErr] = await to(
            mx.getThreadTimeline(room.getUnfilteredTimelineSet(), threadId)
          );
          if (threadErr) {
            onScroll?.(false);
            return;
          }
          currentThreadTimelineSet =
            room.getThread(threadId)?.getUnfilteredTimelineSet() ?? room.getUnfilteredTimelineSet();
        }
        const [err, threadEventTimeline] = await to(
          mx.getEventTimeline(currentThreadTimelineSet, evtId)
        );
        if (err || !threadEventTimeline) {
          onScroll?.(false);
          return;
        }
        optsRef.current.threadTargets?.queue({ threadId, eventId: evtId, highlight, onScroll });
        setTimeline((currentTimeline) => ({ ...currentTimeline }));
        optsRef.current.notifyThreadEventsChanged?.();
        return;
      }
      setTimeline(getEmptyTimeline());
      await loadEventTimeline(evtId, returned);
    },
    [loadEventTimeline, optsRef]
  );

  // The SDK loads no room timeline at a thread reply, so a route to a reply that is not loaded
  // asks the server for its thread before anything replaces the room timeline.
  const openRoomEventRoute = useCallback<OpenRoomEventRoute>(
    async (targetEventId, isCurrentRoute, returned) => {
      if (returned) {
        await handleOpenEvent(targetEventId, true, undefined, undefined, true);
        return;
      }
      if (redirectRoomEventDeepLink(targetEventId)) return;
      const o = optsRef.current;
      // An edit that is loaded without the event it replaces says nothing of its thread either.
      const loaded = o.room.findEventById(targetEventId);
      if (
        o.effectiveViewMode !== 'classic' &&
        isRoomEventThreadRedirectActive({
          focusEventInRoom: o.focusEventInRoom,
          threadId: o.threadId,
          roomOverviewOrderActive: o.roomOverviewOrderActive ?? false,
        }) &&
        (!loaded || loaded.getRelation()?.rel_type === RelationType.Replace)
      ) {
        const target = await fetchRoomEventThreadTarget(o.mx, o.room, targetEventId);
        if (!o.alive() || !isCurrentRoute()) return;
        if (target) {
          o.navigateRoomThread(o.room.roomId, target.threadId, target.eventId, { replace: true });
          return;
        }
      }
      await handleOpenEvent(targetEventId);
    },
    [handleOpenEvent, optsRef, redirectRoomEventDeepLink]
  );

  return { handleOpenEvent, openRoomEventRoute };
};

export const useRoomEventRouteOpenController = ({
  effectiveViewMode,
  entryReturned = false,
  eventId,
  focusEventInRoom,
  openRoomEventRoute,
  roomId,
  roomOverviewOrderActive,
  threadId,
}: {
  effectiveViewMode: RoomViewMode;
  /** Whether the app's Back put the entry in a thread's place: `OpenRoomEventRoute`. */
  entryReturned?: boolean;
  eventId?: string;
  focusEventInRoom?: boolean;
  openRoomEventRoute: OpenRoomEventRoute;
  roomId: string;
  roomOverviewOrderActive: boolean;
  threadId?: string;
}) => {
  const openRoomEventRouteRef = useLatestRef(openRoomEventRoute);
  // One object per open, so a route that leaves and comes back starts a new open.
  const handledRoomEventRouteRef = useRef<{ key: string }>(undefined);

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
      // A link followed to the address Back returned to is a new open, which leads into the thread.
      entryReturned ? '1' : '0',
      effectiveViewMode,
      roomOverviewOrderActive ? '1' : '0',
    ].join('|');
    if (handledRoomEventRouteRef.current?.key === routeKey) return;
    const routeOpen = { key: routeKey };
    handledRoomEventRouteRef.current = routeOpen;
    void openRoomEventRouteRef.current(
      eventId,
      () => handledRoomEventRouteRef.current === routeOpen,
      entryReturned
    );
  }, [
    effectiveViewMode,
    entryReturned,
    eventId,
    focusEventInRoom,
    openRoomEventRouteRef,
    roomId,
    roomOverviewOrderActive,
    threadId,
  ]);
};
