/* eslint-disable react/destructuring-assignment */
import React, {
  Dispatch,
  MouseEventHandler,
  RefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Direction,
  EventTimeline,
  EventTimelineSet,
  EventTimelineSetHandlerMap,
  IEvent,
  IContent,
  MatrixClient,
  MatrixEvent,
  RelationType,
  Room,
  RoomEvent,
  RoomEventHandlerMap,
  ThreadEvent,
  MsgType,
} from 'matrix-js-sdk';
import { type Relations } from 'matrix-js-sdk/lib/models/relations';
import { HTMLReactParserOptions } from 'html-react-parser';
import classNames from 'classnames';
import { ReactEditor } from 'slate-react';
import { Editor } from 'slate';
import { SessionMembershipData } from 'matrix-js-sdk/lib/matrixrtc/CallMembership';
import to from 'await-to-js';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  Badge,
  Box,
  Chip,
  ContainerColor,
  Icon,
  Icons,
  Line,
  Scroll,
  Text,
  as,
  color,
  config,
  toRem,
} from 'folds';
import { isKeyHotkey } from 'is-hotkey';
import { Opts as LinkifyOpts } from 'linkifyjs';
import { useTranslation } from 'react-i18next';
import { eventWithShortcode, factoryEventSentBy, getMxIdLocalPart } from '../../utils/matrix';
import {
  getActiveAnnotationsByKey,
  getActiveEventsForAnnotationKey,
} from '../../utils/reactionAnnotations';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useVirtualPaginator, ItemRange } from '../../hooks/useVirtualPaginator';
import { useAlive } from '../../hooks/useAlive';
import { editableActiveElement, scrollToBottom } from '../../utils/dom';
import {
  DefaultPlaceholder,
  CompactPlaceholder,
  Reply,
  MessageBase,
  MessageUnsupportedContent,
  Time,
  MessageNotDecryptedContent,
  RedactedContent,
  MSticker,
  ImageContent,
  EventContent,
} from '../../components/message';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../plugins/react-custom-html-parser';
import {
  canEditEvent,
  decryptAllTimelineEvent,
  getEditedEvent,
  getEventReactions,
  getLatestMessageContent,
  getLatestEditableEvt,
  getMemberDisplayName,
  getReactionContent,
  isMembershipChanged,
  reactionOrEditEvent,
} from '../../utils/room';
import { useSetting } from '../../state/hooks/settings';
import {
  MessageLayout,
  sanitizePaginationLimit,
  settingsAtom,
  THREAD_BATCH_SIZE,
} from '../../state/settings';
import { useMatrixEventRenderer } from '../../hooks/useMatrixEventRenderer';
import { Reactions, Message, Event, EncryptedContent } from './message';
import { useMemberEventParser } from '../../hooks/useMemberEventParser';
import * as customHtmlCss from '../../styles/CustomHtml.css';
import { RoomIntro } from '../../components/room-intro';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../hooks/useIntersectionObserver';
import {
  markMainTimelineAsRead,
  markRoomAndThreadsAsRead,
  markThreadAsRead,
} from '../../utils/notifications';
import { useDebounce } from '../../hooks/useDebounce';
import { getResizeObserverEntry, useResizeObserver } from '../../hooks/useResizeObserver';
import * as css from './RoomTimeline.css';
import { inSameDay, minuteDifference, timeDayMonthYear, today, yesterday } from '../../utils/time';
import { createMentionElement, isEmptyEditor, moveCursor } from '../../components/editor';
import { roomIdToReplyDraftAtomFamily } from '../../state/room/roomInputDrafts';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { GetContentCallback, MessageEvent, StateEvent } from '../../../types/matrix/room';
import { useKeyDown } from '../../hooks/useKeyDown';
import { useDocumentFocusChange } from '../../hooks/useDocumentFocusChange';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import {
  CollapsibleMessage,
  expandAllMessages,
  collapseAllMessages,
} from '../../components/CollapsibleMessage';
import { Image } from '../../components/media';
import { ImageViewer } from '../../components/image-viewer';
import {
  getToolApprovalRenderContent,
  MINDROOM_TOOL_APPROVAL_EVENT,
} from '../../components/message/mindroomToolApproval';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { useMentionClickHandler } from '../../hooks/useMentionClickHandler';
import { useSpoilerClickHandler } from '../../hooks/useSpoilerClickHandler';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useIgnoredUsers } from '../../hooks/useIgnoredUsers';
import { useInitialClientCatchup } from '../../hooks/useInitialClientCatchup';
import { useImagePackRooms } from '../../hooks/useImagePackRooms';
import { useIsDirectRoom } from '../../hooks/useRoom';
import { useOpenUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { createSessionId } from '../../state/sessions';
import { bumpRecentThread } from '../../state/recentThreads';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useAccessiblePowerTagColors, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { useTheme } from '../../hooks/useTheme';
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';
import {
  buildVisibleThreadParticipantMap,
  buildVisibleThreadReplyCountMap,
  eventBelongsToThread,
  isVisibleThreadTextMessageEventType,
} from './threadUtils';
import {
  buildThreadSummaryMap,
  getLatestThreadSummaryInfoFromEventSources,
  hasMindroomThreadSummary,
  isMindroomThreadSummaryEvent,
  MindroomThreadSummaryInfo,
} from '../../components/message/mindroomThreadSummary';
import {
  buildResolveConfirmedEventId,
  dedupeThreadRenderEventEntries,
  isThreadOnlyRoomActivity,
  shouldPinThreadToBottomOnOpen,
} from './threadRenderUtils';
import { useThreadRenderState } from './useThreadRenderState';
import { createTimelineDebugTrace, logTimelineDebug } from './timelineDebug';
import { shouldUseSurfacePreloadTarget } from './roomPreloadTarget';
import {
  buildCompactZeroReplyRootData,
  buildCompactThreadRootData,
  getCompactThreadRootBodyPreviewText,
  isZeroReplyStandaloneThreadRootEvent,
  mergeCompactThreadRootData,
} from './compactThreadRootData';
import { CompactRoomView } from './CompactRoomView';
import { RoomThreadOverview } from './RoomThreadOverview';
import {
  buildRoomSurfaceEventEntries,
  getLinkedTimelineEvents,
  getRenderableEventEntries,
  getRenderableEvents,
  isRenderableEvent,
  isVisibleThreadRootEvent,
  type TimelineEventEntry,
} from './roomTimelineEvents';
import {
  getFirstLinkedTimeline,
  getLinkedTimelines,
  getLiveTimeline,
  getTimelinesEventsCount,
  recalibrateTimelinePagination,
  timelineToEventsCount,
  type RecalibrateFilterOpts,
  type Timeline,
} from './timelinePagination';
import { buildThreadBadgeViewModelFromRecord } from '../../mindroom/threads/threadBadgeViewModel';
import { ThreadBadgeRenderer } from '../../mindroom/threads/ThreadBadgeRenderer';
import {
  getRoomEventFocusTarget,
  getThreadFilteredEvents,
  resolveOrderedRoomOverviewEvents,
} from '../../mindroom/threads/threadRoomFocus';
import { useMindroomThreadIndex } from '../../mindroom/threads/useMindroomThreadIndex';
import type { ThreadBadgeViewModel, ThreadRecord } from '../../mindroom/threads/types';
import type { ThreadFilterKey } from './RoomThreadOverview';
import {
  type ThreadFilterState,
  type ThreadSortFreezeState,
  type FilterPreset,
  getRoomScheduledTaskCounts,
  collectAvailableRoomTags,
} from './roomThreadOverviewModel';
import { applyParsedThreadFilterQuery, parseThreadFilterQuery } from './threadFilterDsl';
import {
  getTimelineEventById,
  resolveRoomEventThreadRedirect,
} from './roomDeepLink';
import type { RoomViewMode } from '../../state/room/roomViewMode';
import { useRoomThreadList } from './useRoomThreadList';
import { useStateEvents } from '../../hooks/useStateEvents';
import {
  getRoomCursorAnchor,
  getThreadCursorAnchor,
  getThreadCacheTargetId,
  getMainTimelineCacheEvents,
  findEarliestLoadedRoomEventByCacheOrder,
  getEarliestLoadedRoomEvent,
  loadRoomCachePersistenceState,
  loadThreadCachedSnapshot,
  loadLatestRoomCacheHydrationSnapshot,
  loadRoomCachedBackStateSnapshot,
  mapCachedThreadPageEvents,
  persistRoomEventCacheSnapshot,
} from '../../mindroom/threads/eventRepository';
import { compareCachedPaginationAnchors } from './eventCacheTokenUtils';
import {
  computeReconciliationToken,
  findEarliestLoadedThreadReplyByCacheOrder,
  reconcileThreadBackwardPagination,
} from './threadPaginationUtils';
import {
  aggregateCachedRelationEvents,
  hydrateCachedEvents,
} from './eventCacheEditUtils';
import {
  getEventElementById,
  isScrollNearBottom,
  isTimelineAtLiveEnd,
  shouldAutoScrollRoomOnLiveEvent,
  shouldAutoScrollThreadOnLiveEvent,
} from './timelineScrollUtils';
import { useRoomThreadResolutionMap } from './useRoomThreadTags';
import { getThreadOpenSeedSnapshot } from '../../mindroom/threads/threadOpenSeedCache';
import { isPendingLocalEchoThreadRoot } from './threadRouteUtils';
import { useRoomEagerPreload } from '../../mindroom/threads/preloadController';
import { useThreadBackPaginationController } from '../../mindroom/threads/threadBackPaginationController';
import { mergeThreadBackfillEvents } from '../../mindroom/threads/threadCacheSnapshot';
import {
  buildThreadCacheCoverage,
  hasUsableThreadCacheSnapshot,
  isCompleteThreadCacheCoverage,
  shouldBackfillThreadRelationsFromCoverage,
  shouldShowThreadLoadOlderFromCoverage,
} from '../../mindroom/threads/threadCacheCoverage';
import {
  collectPriorityThreadSeedPrewarmRoots,
  fetchAllThreadRelations,
  getLoadedRoomThreadEvents,
  getLoadedRoomThreadSeedEvents,
  getLoadedThreadModelSeedEvents,
  isThreadNotFoundError,
  MAX_THREAD_FETCH_EVENTS,
  MAX_THREAD_FETCH_ITERATIONS,
  shouldRefreshOverviewForTimelineEvent,
  THREAD_OPEN_PREWARM_WAIT_MS,
} from '../../mindroom/threads/threadBootstrap';
import { useThreadSeedPrewarmController } from '../../mindroom/threads/threadSeedPrewarmController';
import { useThreadOpenCacheController } from '../../mindroom/threads/threadOpenCacheController';
import { useThreadOverviewResumeController } from '../../mindroom/threads/threadOverviewResumeController';
import { useThreadCachePersistenceController } from '../../mindroom/threads/threadCachePersistenceController';
import { useCompactRootEditBackfillController } from '../../mindroom/threads/compactRootEditBackfillController';
import { useThreadPaginationCommandController } from '../../mindroom/threads/threadPaginationCommandController';
import { useThreadEditBackfillController } from '../../mindroom/threads/threadEditBackfillController';
import { useRoomPaginationCommandController } from '../../mindroom/threads/roomPaginationCommandController';

export { getRoomEventThreadOpenTarget } from './roomDeepLink';
export { getRoomEventFocusTarget, getThreadFilteredEvents };
export {
  collectPriorityThreadSeedPrewarmRoots,
  fetchAllThreadRelations,
  getLoadedRoomThreadEvents,
  getLoadedRoomThreadSeedEvents,
  MAX_THREAD_FETCH_EVENTS,
  shouldRefreshOverviewForTimelineEvent,
};

const TimelineFloat = as<'div', css.TimelineFloatVariants>(
  ({ position, className, ...props }, ref) => (
    <Box
      className={classNames(css.TimelineFloat({ position }), className)}
      justifyContent="Center"
      alignItems="Center"
      gap="200"
      {...props}
      ref={ref}
    />
  )
);

const TimelineDivider = as<'div', { variant?: ContainerColor | 'Inherit' }>(
  ({ variant, children, ...props }, ref) => (
    <Box gap="100" justifyContent="Center" alignItems="Center" {...props} ref={ref}>
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
      {children}
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
    </Box>
  )
);

export const getEventTimeline = (room: Room, eventId: string): EventTimeline | undefined => {
  const timelineSet = room.getUnfilteredTimelineSet();
  return timelineSet.getTimelineForEvent(eventId) ?? undefined;
};

const getEventEntryIndex = (entries: TimelineEventEntry[], eventId: string): number =>
  entries.findIndex(({ event }) => event.getId() === eventId);

const getLinkedTimelinesEventAbsoluteIndex = (
  linkedTimelines: EventTimeline[],
  eventId: string
): number | undefined => {
  let absoluteIndex = 0;

  for (const timeline of linkedTimelines) {
    const relativeIndex = timeline.getEvents().findIndex((mEvent) => mEvent.getId() === eventId);
    if (relativeIndex !== -1) {
      return absoluteIndex + relativeIndex;
    }

    absoluteIndex += timeline.getEvents().length;
  }

  return undefined;
};

const getVisibleAnchorCandidateIds = (mEvent: MatrixEvent): string[] => {
  const eventId = mEvent.getId();
  if (!eventId) return [];

  const candidateIds = new Set<string>();
  const associatedEventId = mEvent.getAssociatedId() ?? mEvent.getRelation()?.event_id;
  if (associatedEventId && associatedEventId !== eventId) {
    candidateIds.add(associatedEventId);
  }

  const threadRootId = mEvent.threadRootId;
  if (threadRootId && threadRootId !== eventId) {
    candidateIds.add(threadRootId);
  }

  return Array.from(candidateIds);
};

const getClosestRenderableEntryIndex = (
  entries: TimelineEventEntry[],
  absoluteIndex: number
): number | undefined => {
  if (entries.length === 0) return undefined;

  const nextIndex = entries.findIndex((entry) => entry.absoluteIndex > absoluteIndex);
  if (nextIndex === -1) return entries.length - 1;
  if (nextIndex === 0) return 0;

  const previousIndex = nextIndex - 1;
  const previousDistance = absoluteIndex - entries[previousIndex].absoluteIndex;
  const nextDistance = entries[nextIndex].absoluteIndex - absoluteIndex;

  return nextDistance < previousDistance ? nextIndex : previousIndex;
};

const getNextRenderableEntryIndex = (
  entries: TimelineEventEntry[],
  absoluteIndex: number
): number | undefined => {
  const nextIndex = entries.findIndex((entry) => entry.absoluteIndex > absoluteIndex);
  return nextIndex === -1 ? undefined : nextIndex;
};

const getEntryAnchor = (
  entries: TimelineEventEntry[],
  entryIndex: number
):
  | {
      eventId: string;
      index: number;
      absoluteIndex: number;
    }
  | undefined => {
  const entry = entries[entryIndex];
  const eventId = entry?.event.getId();
  if (!entry || !eventId) return undefined;

  return {
    eventId,
    index: entryIndex,
    absoluteIndex: entry.absoluteIndex,
  };
};

export const getTimelineTargetAnchor = ({
  linkedTimelines,
  renderableEntries,
  eventId,
  absoluteIndex,
}: {
  linkedTimelines: EventTimeline[];
  renderableEntries: TimelineEventEntry[];
  eventId: string;
  absoluteIndex: number;
}) => {
  const visibleIndex = getEventEntryIndex(renderableEntries, eventId);
  if (visibleIndex !== -1) {
    return getEntryAnchor(renderableEntries, visibleIndex);
  }

  const targetEvent = getTimelineEventById(linkedTimelines, eventId);
  if (targetEvent) {
    for (const candidateId of getVisibleAnchorCandidateIds(targetEvent)) {
      const candidateIndex = getEventEntryIndex(renderableEntries, candidateId);
      if (candidateIndex !== -1) {
        return getEntryAnchor(renderableEntries, candidateIndex);
      }
    }
  }

  const closestIndex = getClosestRenderableEntryIndex(renderableEntries, absoluteIndex);
  if (closestIndex === undefined) return undefined;

  return getEntryAnchor(renderableEntries, closestIndex);
};

export const getUnreadTargetAnchor = ({
  renderableEntries,
  eventId,
  absoluteIndex,
}: {
  renderableEntries: TimelineEventEntry[];
  eventId: string;
  absoluteIndex: number;
}) => {
  const visibleIndex = getEventEntryIndex(renderableEntries, eventId);
  if (visibleIndex !== -1) {
    return getEntryAnchor(renderableEntries, visibleIndex);
  }

  const nextIndex = getNextRenderableEntryIndex(renderableEntries, absoluteIndex);
  if (nextIndex !== undefined) {
    return getEntryAnchor(renderableEntries, nextIndex);
  }

  const closestIndex = getClosestRenderableEntryIndex(renderableEntries, absoluteIndex);
  if (closestIndex === undefined) return undefined;

  return getEntryAnchor(renderableEntries, closestIndex);
};

export const shouldRenderUnreadDividerAt = ({
  readUptoAbsoluteIndex,
  eventAbsoluteIndex,
  prevRenderedEventAbsoluteIndex,
}: {
  readUptoAbsoluteIndex: number | undefined;
  eventAbsoluteIndex: number | undefined;
  prevRenderedEventAbsoluteIndex: number | undefined;
}): boolean =>
  readUptoAbsoluteIndex !== undefined &&
  eventAbsoluteIndex !== undefined &&
  eventAbsoluteIndex > readUptoAbsoluteIndex &&
  (prevRenderedEventAbsoluteIndex === undefined ||
    prevRenderedEventAbsoluteIndex <= readUptoAbsoluteIndex);

export const getTimelineAndBaseIndex = (
  timelines: EventTimeline[],
  index: number
): [EventTimeline | undefined, number] => {
  let uptoTimelineLen = 0;
  const timeline = timelines.find((t) => {
    uptoTimelineLen += t.getEvents().length;
    if (index < uptoTimelineLen) return true;
    return false;
  });
  if (!timeline) return [undefined, 0];
  return [timeline, uptoTimelineLen - timeline.getEvents().length];
};

export const getTimelineRelativeIndex = (absoluteIndex: number, timelineBaseIndex: number) =>
  absoluteIndex - timelineBaseIndex;

export const getTimelineEvent = (timeline: EventTimeline, index: number): MatrixEvent | undefined =>
  timeline.getEvents()[index];

export const getEventIdAbsoluteIndex = (
  timelines: EventTimeline[],
  eventTimeline: EventTimeline,
  eventId: string
): number | undefined => {
  const timelineIndex = timelines.findIndex((t) => t === eventTimeline);
  if (timelineIndex === -1) return undefined;
  const eventIndex = eventTimeline.getEvents().findIndex((evt) => evt.getId() === eventId);
  if (eventIndex === -1) return undefined;
  const baseIndex = timelines
    .slice(0, timelineIndex)
    .reduce((accValue, timeline) => timeline.getEvents().length + accValue, 0);
  return baseIndex + eventIndex;
};

type RoomTimelineProps = {
  room: Room;
  eventId?: string;
  focusEventInRoom?: boolean;
  threadId?: string;
  summaryMap: Map<string, MindroomThreadSummaryInfo>;
  onStoreThreadSummary: (threadRootId: string, info: MindroomThreadSummaryInfo | undefined) => void;
  threadFilterState: ThreadFilterState;
  threadSortFreezeState: ThreadSortFreezeState | null;
  onToggle: (key: ThreadFilterKey) => void;
  onSortDirectionChange: () => void;
  onToggleThreadSortFreeze: () => void;
  setThreadSortFreezeState: Dispatch<SetStateAction<ThreadSortFreezeState | null>>;
  onCycleTag: (tag: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onReset: () => void;
  onApplyPreset: (preset: FilterPreset) => void;
  onSearchQueryChange: (query: string) => void;
  viewMode?: RoomViewMode;
  onViewModeChange?: (viewMode: RoomViewMode) => void;
  onThreadLoadError?: (threadId: string) => void;
  roomInputRef: RefObject<HTMLElement>;
  editor: Editor;
};

const ROOM_FOCUS_SCROLL_RETRY_MAX_ATTEMPTS = 10;
const ROOM_FOCUS_OBSERVER_IDLE_MS = 200;
const ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS = 2000;
const ROOM_FOCUS_NEAR_START_THRESHOLD = 5;
const ROOM_FOCUS_NEAR_END_THRESHOLD = 5;
const ROOM_FOCUS_START_MARGIN_PX = 32;
const ROOM_FOCUS_END_MARGIN_PX = 32;

type RoomFocusRetry = {
  eventId: string;
  attempts: number;
};

type PendingRoomFocus = {
  eventId: string;
};

export const getNextRoomFocusRetry = ({
  focusEventId,
  pendingRetry,
  scrolled,
  targetFound,
}: {
  focusEventId: string | undefined;
  pendingRetry: RoomFocusRetry | undefined;
  scrolled: boolean;
  targetFound: boolean;
}): RoomFocusRetry | undefined => {
  if (!focusEventId || targetFound || !scrolled) {
    return undefined;
  }

  const attempts = pendingRetry?.eventId === focusEventId ? pendingRetry.attempts + 1 : 1;

  if (attempts > ROOM_FOCUS_SCROLL_RETRY_MAX_ATTEMPTS) {
    return undefined;
  }

  return {
    eventId: focusEventId,
    attempts,
  };
};

export const isContinuingRoomFocusRetry = (
  focusEventId: string | undefined,
  pendingRetry: RoomFocusRetry | undefined
): boolean => !!focusEventId && pendingRetry?.eventId === focusEventId;

export const isRoomFocusNearTimelineStart = (
  focusIndex: number,
  threshold = ROOM_FOCUS_NEAR_START_THRESHOLD
): boolean => focusIndex < threshold;

export const isRoomFocusNearTimelineEnd = (
  focusIndex: number,
  itemCount: number,
  threshold = ROOM_FOCUS_NEAR_END_THRESHOLD
): boolean => itemCount - focusIndex <= threshold;

export const getRoomFocusScrollOptions = (focusIndex: number, itemCount: number) => {
  const nearStart = isRoomFocusNearTimelineStart(focusIndex);
  const nearEnd = isRoomFocusNearTimelineEnd(focusIndex, itemCount);

  if (nearStart) {
    return {
      behavior: 'instant' as const,
      align: 'start' as const,
      offset: ROOM_FOCUS_START_MARGIN_PX,
    };
  }

  if (nearEnd) {
    return {
      behavior: 'instant' as const,
      align: 'end' as const,
      offset: -ROOM_FOCUS_END_MARGIN_PX,
    };
  }

  return {
    behavior: 'instant' as const,
    align: 'center' as const,
    offset: undefined,
  };
};

export const getRoomFocusScrollToItemOptions = (focusIndex: number, itemCount: number) => ({
  ...getRoomFocusScrollOptions(focusIndex, itemCount),
  stopInView: false,
});

const DIRECT_ROOM_TIMELINE_FILTER_STATE: ThreadFilterState = {
  resolved: 'any',
  streaming: 'any',
  scheduled: 'any',
  unread: 'any',
  idle: 'any',
  sortBy: 'natural',
  sortDirection: 'desc',
  tags: new Map(),
  searchQuery: '',
  statusMode: 'and',
};

export const setupFocusObserver = (opts: {
  scrollContainer: HTMLElement;
  target: HTMLElement;
  onRecenter: () => void;
  onDone: () => void;
  idleMs?: number;
  hardMs?: number;
}): (() => void) => {
  if (typeof ResizeObserver === 'undefined') {
    opts.onDone();
    return () => undefined;
  }

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  let rafId: number | undefined;
  let done = false;

  let ro: ResizeObserver | undefined;

  const finish = () => {
    if (done) return;
    done = true;
    ro?.disconnect();
    if (idleTimer) clearTimeout(idleTimer);
    if (hardTimer) clearTimeout(hardTimer);
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    opts.onDone();
  };

  const scheduleRecenter = () => {
    if (done) return;
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      opts.onRecenter();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, opts.idleMs ?? ROOM_FOCUS_OBSERVER_IDLE_MS);
    });
  };

  ro = new ResizeObserver(scheduleRecenter);
  ro.observe(opts.target);
  ro.observe(opts.scrollContainer);

  idleTimer = setTimeout(finish, opts.idleMs ?? ROOM_FOCUS_OBSERVER_IDLE_MS);
  hardTimer = setTimeout(() => {
    opts.onRecenter();
    finish();
  }, opts.hardMs ?? ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS);

  return finish;
};

const isCollapsibleTextMessageEvent = (mEvent: MatrixEvent): boolean =>
  isVisibleThreadTextMessageEventType(mEvent.getType());

type ShouldTrackLiveCollapsibleMessage = {
  mEvent: MatrixEvent;
  room: Room;
  threadId: string | undefined;
  threadFilterState: ThreadFilterState;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
  threadRecordMap?: ReadonlyMap<string, ThreadRecord>;
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
};

export const shouldTrackLiveCollapsibleMessage = ({
  mEvent,
  room,
  threadId,
  threadFilterState,
  threadResolutionMap,
  threadRecordMap,
  ignoredUsersSet,
  showHiddenEvents,
  hideMembershipEvents,
  hideNickAvatarEvents,
}: ShouldTrackLiveCollapsibleMessage): boolean => {
  const mEventId = mEvent.getId();
  if (!mEventId || !isCollapsibleTextMessageEvent(mEvent)) return false;

  if (
    !isRenderableEvent(
      mEvent,
      room,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents
    )
  ) {
    return false;
  }

  if (threadId) {
    return mEventId === threadId || eventBelongsToThread(mEvent, threadId);
  }

  if (isThreadOnlyRoomActivity(room, mEvent)) {
    return false;
  }

  return (
    getThreadFilteredEvents(
      [mEvent],
      room,
      threadResolutionMap,
      threadId,
      threadFilterState,
      undefined,
      threadRecordMap
    ).length > 0
  );
};

export const getLiveCollapsibleMessageExpandId = (
  opts: ShouldTrackLiveCollapsibleMessage
): string | undefined => {
  const { mEvent, room } = opts;
  const mEventId = mEvent.getId();
  if (!mEventId || !isCollapsibleTextMessageEvent(mEvent)) return undefined;

  const relation = mEvent.getRelation();
  if (relation?.rel_type === RelationType.Replace) {
    const targetEventId = relation.event_id;
    if (!targetEventId) return undefined;

    const targetEvent = room.findEventById(targetEventId);
    if (
      targetEvent &&
      isCollapsibleTextMessageEvent(targetEvent) &&
      shouldTrackLiveCollapsibleMessage({
        ...opts,
        mEvent: targetEvent,
      })
    ) {
      return targetEventId;
    }

    return undefined;
  }

  return shouldTrackLiveCollapsibleMessage(opts) ? mEventId : undefined;
};

export const getCollapsibleMessageMode = (
  mEventId: string,
  resolvedContent: IContent,
  liveExpandOnceIds: Set<string>
) =>
  hasMindroomThreadSummary(resolvedContent as Record<string, unknown>)
    ? 'always-expanded'
    : liveExpandOnceIds.has(mEventId)
    ? 'initially-expanded'
    : 'default';

export const getCollapsibleMessageMeasurementKey = (
  mEvent: MatrixEvent,
  collapseMode: ReturnType<typeof getCollapsibleMessageMode>,
  editedEvent?: MatrixEvent
): string =>
  [
    mEvent.getId() ?? '',
    mEvent.isRedacted() ? 'redacted' : 'active',
    editedEvent?.getId() ?? '',
    collapseMode,
  ].join('|');

export const consumeLiveExpandOnceId = (liveExpandOnceIds: Set<string>, mEventId: string) => {
  liveExpandOnceIds.delete(mEventId);
};

export const isAnchorVisibleInScroll = (
  anchor: Element,
  scroll: Element,
  marginPx = 100
): boolean => {
  const anchorRect = anchor.getBoundingClientRect();
  const scrollRect = scroll.getBoundingClientRect();
  return anchorRect.top <= scrollRect.bottom + marginPx;
};

const OVERVIEW_THREAD_METADATA_CACHE_LIMIT = 64;

const useEventTimelineLoader = (
  mx: MatrixClient,
  room: Room,
  onLoad: (eventId: string, linkedTimelines: EventTimeline[], evtAbsIndex: number) => void,
  onError: (err: Error | null) => void
) => {
  const loadEventTimeline = useCallback(
    async (eventId: string): Promise<EventTimeline[] | undefined> => {
      const [err, replyEvtTimeline] = await to(
        mx.getEventTimeline(room.getUnfilteredTimelineSet(), eventId)
      );
      if (!replyEvtTimeline) {
        onError(err ?? null);
        return undefined;
      }
      const linkedTimelines = getLinkedTimelines(replyEvtTimeline);
      const absIndex = getEventIdAbsoluteIndex(linkedTimelines, replyEvtTimeline, eventId);

      if (absIndex === undefined) {
        onError(err ?? null);
        return undefined;
      }

      onLoad(eventId, linkedTimelines, absIndex);
      return linkedTimelines;
    },
    [mx, room, onLoad, onError]
  );

  return loadEventTimeline;
};

const useTimelinePagination = (
  mx: MatrixClient,
  timeline: Timeline,
  setTimeline: Dispatch<SetStateAction<Timeline>>,
  limit: number,
  filterOptsRef: RefObject<RecalibrateFilterOpts | undefined>
) => {
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const alive = useAlive();

  const handleTimelinePagination = useMemo(() => {
    let fetching = false;

    return async (backwards: boolean) => {
      if (fetching) return;
      const { linkedTimelines: lTimelines } = timelineRef.current;
      const timelinesEventsCount = lTimelines.map(timelineToEventsCount);
      const fOpts = filterOptsRef.current ?? undefined;
      const timelinesRenderableCounts = fOpts
        ? lTimelines.map(
            (tl) =>
              getRenderableEvents(
                [tl],
                fOpts.room,
                fOpts.threadId,
                fOpts.ignoredUsersSet,
                fOpts.showHiddenEvents,
                fOpts.hideMembershipEvents,
                fOpts.hideNickAvatarEvents
              ).length
          )
        : undefined;

      const timelineToPaginate = backwards ? lTimelines[0] : lTimelines[lTimelines.length - 1];
      if (!timelineToPaginate) return;

      const paginationToken = timelineToPaginate.getPaginationToken(
        backwards ? Direction.Backward : Direction.Forward
      );
      if (
        !paginationToken &&
        getTimelinesEventsCount(lTimelines) !==
          getTimelinesEventsCount(getLinkedTimelines(timelineToPaginate))
      ) {
        recalibrateTimelinePagination(
          setTimeline,
          lTimelines,
          timelinesEventsCount,
          backwards,
          fOpts,
          timelinesRenderableCounts
        );
        return;
      }

      fetching = true;
      try {
        const [err] = await to(
          mx.paginateEventTimeline(timelineToPaginate, {
            backwards,
            limit,
          })
        );
        if (err) {
          // TODO: handle pagination error.
          return;
        }
        const fetchedTimeline =
          timelineToPaginate.getNeighbouringTimeline(
            backwards ? Direction.Backward : Direction.Forward
          ) ?? timelineToPaginate;
        // Decrypt all event ahead of render cycle
        const roomId = fetchedTimeline.getRoomId();
        const room = roomId ? mx.getRoom(roomId) : null;

        if (room?.hasEncryptionStateEvent()) {
          await to(decryptAllTimelineEvent(mx, fetchedTimeline));
        }

        if (alive()) {
          recalibrateTimelinePagination(
            setTimeline,
            lTimelines,
            timelinesEventsCount,
            backwards,
            fOpts,
            timelinesRenderableCounts
          );
        }
      } finally {
        fetching = false;
      }
    };
  }, [mx, alive, setTimeline, limit, filterOptsRef]);
  return handleTimelinePagination;
};

type TimelineArriveMeta = {
  liveEvent: boolean;
  toStartOfTimeline: boolean;
};

const useLiveEventArrive = (
  room: Room,
  onArrive: (mEvent: MatrixEvent, meta: TimelineArriveMeta) => void
) => {
  useEffect(() => {
    const handleTimelineEvent: EventTimelineSetHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      eventRoom,
      toStartOfTimeline,
      removed,
      data
    ) => {
      if (eventRoom?.roomId !== room.roomId || removed) return;
      onArrive(mEvent, {
        liveEvent: data?.liveEvent === true,
        toStartOfTimeline: toStartOfTimeline === true,
      });
    };
    const handleRedaction: RoomEventHandlerMap[RoomEvent.Redaction] = (mEvent, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return;
      onArrive(mEvent, {
        liveEvent: true,
        toStartOfTimeline: false,
      });
    };

    room.on(RoomEvent.Timeline, handleTimelineEvent);
    room.on(RoomEvent.Redaction, handleRedaction);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimelineEvent);
      room.removeListener(RoomEvent.Redaction, handleRedaction);
    };
  }, [room, onArrive]);
};

const useLiveTimelineRefresh = (room: Room, onRefresh: () => void) => {
  useEffect(() => {
    const handleTimelineRefresh: RoomEventHandlerMap[RoomEvent.TimelineRefresh] = (r) => {
      if (r.roomId !== room.roomId) return;
      onRefresh();
    };

    room.on(RoomEvent.TimelineRefresh, handleTimelineRefresh);
    return () => {
      room.removeListener(RoomEvent.TimelineRefresh, handleTimelineRefresh);
    };
  }, [room, onRefresh]);
};

type UseThreadAwareTimelineRefresh = {
  room: Room;
  threadId?: string;
  liveTimelineLinked: boolean;
  refreshLatestThreadSlice: (threadId: string) => Promise<boolean>;
  onRoomRefresh: () => void;
};

export const useThreadAwareTimelineRefresh = ({
  room,
  threadId,
  liveTimelineLinked,
  refreshLatestThreadSlice,
  onRoomRefresh,
}: UseThreadAwareTimelineRefresh) => {
  const threadRefreshInFlightRef = useRef<string>();
  const pendingRefreshRef = useRef(false);
  const activeThreadIdRef = useRef(threadId);

  if (activeThreadIdRef.current !== threadId) {
    activeThreadIdRef.current = threadId;
    pendingRefreshRef.current = false;
  }

  useLiveTimelineRefresh(
    room,
    useCallback(() => {
      if (threadId) {
        if (threadRefreshInFlightRef.current === threadId) {
          pendingRefreshRef.current = true;
          return;
        }
        const runRefresh = (tid: string) => {
          threadRefreshInFlightRef.current = tid;
          pendingRefreshRef.current = false;
          void refreshLatestThreadSlice(tid).finally(() => {
            if (threadRefreshInFlightRef.current !== tid) return;
            if (pendingRefreshRef.current && activeThreadIdRef.current === tid) {
              runRefresh(tid);
            } else {
              pendingRefreshRef.current = false;
              threadRefreshInFlightRef.current = undefined;
            }
          });
        };
        runRefresh(threadId);
      } else if (liveTimelineLinked) {
        onRoomRefresh();
      }
    }, [liveTimelineLinked, onRoomRefresh, refreshLatestThreadSlice, threadId])
  );
};

const getInitialTimeline = (
  room: Room,
  paginationLimit: number,
  filterOpts?: {
    threadId: string | undefined;
    ignoredUsersSet: Set<string>;
    showHiddenEvents: boolean;
    hideMembershipEvents: boolean;
    hideNickAvatarEvents: boolean;
  }
) => {
  const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
  const count = filterOpts
    ? getRenderableEvents(
        linkedTimelines,
        room,
        filterOpts.threadId,
        filterOpts.ignoredUsersSet,
        filterOpts.showHiddenEvents,
        filterOpts.hideMembershipEvents,
        filterOpts.hideNickAvatarEvents
      ).length
    : getTimelinesEventsCount(linkedTimelines);
  return {
    linkedTimelines,
    range: {
      start: Math.max(count - paginationLimit, 0),
      end: count,
    },
  };
};

const getEmptyTimeline = () => ({
  range: { start: 0, end: 0 },
  linkedTimelines: [],
});

const getLatestTimelineRange = (count: number, paginationLimit: number): ItemRange => ({
  start: Math.max(count - paginationLimit, 0),
  end: count,
});

const getVisibleTimelineRange = (
  range: ItemRange,
  count: number,
  paginationLimit: number
): ItemRange => {
  if (count === 0) {
    return { start: 0, end: 0 };
  }

  if (range.start >= count || range.start >= range.end) {
    return getLatestTimelineRange(count, paginationLimit);
  }

  const start = Math.max(range.start, 0);
  const end = Math.min(Math.max(range.end, start + 1), count);

  return { start, end };
};

export const getActiveTimelineRange = (
  threadId: string | undefined,
  roomThreadOverviewActive: boolean,
  range: ItemRange,
  count: number,
  paginationLimit: number
): ItemRange => {
  if (threadId) {
    return { start: 0, end: 0 };
  }

  if (roomThreadOverviewActive) {
    return { start: 0, end: count };
  }

  return getVisibleTimelineRange(range, count, paginationLimit);
};

const getFocusedRoomEventIndex = (
  filteredEvents: MatrixEvent[],
  eventId: string | undefined,
  fallbackIndex: number
): number => {
  if (!eventId) return fallbackIndex;
  const filteredIndex = filteredEvents.findIndex((event) => event.getId() === eventId);
  return filteredIndex === -1 ? fallbackIndex : filteredIndex;
};

const getRoomUnreadInfo = (room: Room, scrollTo = false) => {
  const readUptoEventId = room.getEventReadUpTo(room.client.getUserId() ?? '');
  if (!readUptoEventId) return undefined;
  const evtTimeline = getEventTimeline(room, readUptoEventId);
  const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
  return {
    readUptoEventId,
    inLiveTimeline: latestTimeline === room.getLiveTimeline(),
    scrollTo,
  };
};

export function RoomTimeline({
  room,
  eventId,
  focusEventInRoom,
  threadId,
  summaryMap,
  onStoreThreadSummary,
  threadFilterState,
  threadSortFreezeState,
  onToggle,
  onSortDirectionChange,
  onToggleThreadSortFreeze,
  setThreadSortFreezeState,
  onCycleTag,
  onAddTag,
  onRemoveTag,
  onReset,
  onApplyPreset,
  onSearchQueryChange,
  viewMode = 'normal',
  onViewModeChange,
  onThreadLoadError,
  roomInputRef,
  editor,
}: RoomTimelineProps) {
  const mx = useMatrixClient();
  const initialClientCatchupInProgress = useInitialClientCatchup(mx);
  const sessionId = useMemo(() => createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()), [mx]);
  const useAuthentication = useMediaAuthentication();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const [messageLayout] = useSetting(settingsAtom, 'messageLayout');
  const [messageSpacing] = useSetting(settingsAtom, 'messageSpacing');
  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
  const direct = useIsDirectRoom();
  const showRoomThreadOverviewControls = !threadId && !direct;
  const focusedRoomOverviewRequested = Boolean(
    !direct && !threadId && focusEventInRoom && viewMode !== 'compact' && eventId
  );
  const requestedThreadFilterState = direct ? DIRECT_ROOM_TIMELINE_FILTER_STATE : threadFilterState;
  const liveParsedQuery = useMemo(
    () => parseThreadFilterQuery(requestedThreadFilterState.searchQuery ?? ''),
    [requestedThreadFilterState.searchQuery]
  );
  const liveThreadFilterState = useMemo(
    () => applyParsedThreadFilterQuery(requestedThreadFilterState, liveParsedQuery),
    [requestedThreadFilterState, liveParsedQuery]
  );
  const effectiveViewMode: RoomViewMode = direct ? 'normal' : viewMode;
  const [hideMembershipEvents] = useSetting(settingsAtom, 'hideMembershipEvents');
  const [hideNickAvatarEvents] = useSetting(settingsAtom, 'hideNickAvatarEvents');
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [encUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
  const showUrlPreview = room.hasEncryptionStateEvent() ? encUrlPreview : urlPreview;
  const [showHiddenEvents] = useSetting(settingsAtom, 'showHiddenEvents');
  const [showDeveloperTools] = useSetting(settingsAtom, 'developerTools');
  const [paginationLimitSetting] = useSetting(settingsAtom, 'paginationLimit');
  const safePaginationLimit = sanitizePaginationLimit(paginationLimitSetting);
  const safePaginationLimitRef = useRef(safePaginationLimit);
  safePaginationLimitRef.current = safePaginationLimit;

  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

  const ignoredUsersList = useIgnoredUsers();
  const ignoredUsersSet = useMemo(() => new Set(ignoredUsersList), [ignoredUsersList]);

  const setReplyDraft = useSetAtom(roomIdToReplyDraftAtomFamily(room.roomId));
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const creatorsTag = useRoomCreatorsTag();
  const powerLevelTags = usePowerLevelTags(room, powerLevels);
  const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);

  const theme = useTheme();
  const accessiblePowerTagColors = useAccessiblePowerTagColors(
    theme.kind,
    creatorsTag,
    powerLevelTags
  );

  const permissions = useRoomPermissions(creators, powerLevels);

  const canRedact = permissions.action('redact', mx.getSafeUserId());
  const canDeleteOwn = permissions.event(MessageEvent.RoomRedaction, mx.getSafeUserId());
  const canSendReaction = permissions.event(MessageEvent.Reaction, mx.getSafeUserId());
  const canPinEvent = permissions.stateEvent(StateEvent.RoomPinnedEvents, mx.getSafeUserId());
  const [editId, setEditId] = useState<string>();

  const roomToParents = useAtomValue(roomToParentsAtom);
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const mentionClickHandler = useMentionClickHandler(room.roomId);
  const spoilerClickHandler = useSpoilerClickHandler();
  const openUserRoomProfile = useOpenUserRoomProfile();
  const space = useSpaceOptionally();

  const imagePackRooms: Room[] = useImagePackRooms(room.roomId, roomToParents);

  const [unreadInfo, setUnreadInfo] = useState(() => getRoomUnreadInfo(room, true));
  const readUptoEventIdRef = useRef<string>();
  if (unreadInfo) {
    readUptoEventIdRef.current = unreadInfo.readUptoEventId;
  }

  const atBottomAnchorRef = useRef<HTMLElement>(null);
  const [atBottom, setAtBottom] = useState<boolean>(true);
  const [allExpanded, setAllExpanded] = useState(false);
  const atBottomRef = useRef(atBottom);
  const liveExpandOnceIds = useRef(new Set<string>());
  atBottomRef.current = atBottom;

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBottomRef = useRef({
    count: 0,
    smooth: true,
  });

  const [focusItem, setFocusItem] = useState<
    | {
        eventId?: string;
        index: number;
        scrollTo: boolean;
        highlight: boolean;
      }
    | undefined
  >();
  const [threadLoadError, setThreadLoadError] = useState(false);
  const [roomHasMoreCachedBack, setRoomHasMoreCachedBack] = useState(false);
  const [eagerPreloading, setEagerPreloading] = useState(!threadId && !eventId);
  const [roomInitialCacheHydratedKey, setRoomInitialCacheHydratedKey] = useState<
    string | undefined
  >();
  const [threadHasMoreCachedBack, setThreadHasMoreCachedBack] = useState(false);
  const [threadTailLoaded, setThreadTailLoaded] = useState(false);
  const [threadPaginatingFront, setThreadPaginatingFront] = useState(false);
  const [threadInitialCacheHydrated, setThreadInitialCacheHydrated] = useState(false);
  const [threadLatestOpenPending, setThreadLatestOpenPending] = useState(false);
  const [threadTimelineTick, setThreadTimelineTick] = useState(0);
  const [pendingThreadOpenTick, setPendingThreadOpenTick] = useState(0);
  const {
    isPaginatingBack: threadPaginatingBack,
    suppressOpenBottomPinRef: suppressThreadOpenBottomPinRef,
    reset: resetThreadBackPagination,
    begin: beginThreadBackPagination,
    finish: finishThreadBackPagination,
    restorePendingAnchor: restorePendingThreadBackPaginationAnchor,
  } = useThreadBackPaginationController();
  const roomIdRef = useRef(room.roomId);
  const roomPaginatingBackRef = useRef(false);
  const eagerPreloadDoneForRoomRef = useRef<string | null>(null);
  const threadIdRef = useRef(threadId);
  const threadFilterStateRef = useRef(requestedThreadFilterState);
  const roomDebugTraceRef = useRef({
    roomId: room.roomId,
    traceId: createTimelineDebugTrace('room-open', room.roomId),
  });
  const currentThreadTraceKey = threadId ? `${room.roomId}|${threadId}` : undefined;
  const threadDebugTraceRef = useRef<{ traceId?: string; traceKey?: string }>({
    traceId: currentThreadTraceKey
      ? createTimelineDebugTrace('thread-open', room.roomId, threadId)
      : undefined,
    traceKey: currentThreadTraceKey,
  });
  const threadEditFetchAttemptedRef = useRef<WeakMap<MatrixEvent, number>>(
    new WeakMap<MatrixEvent, number>()
  );
  const pendingThreadOpenRef = useRef<
    | {
        threadId: string;
        eventId: string;
        highlight: boolean;
        onScroll: ((scrolled: boolean) => void) | undefined;
        attempts: number;
      }
    | undefined
  >();
  const pendingRoomFocusRef = useRef<PendingRoomFocus | undefined>();
  const suppressFocusPaginationRef = useRef(false);
  const alive = useAlive();
  roomIdRef.current = room.roomId;
  threadIdRef.current = threadId;
  threadFilterStateRef.current = requestedThreadFilterState;
  if (roomDebugTraceRef.current.roomId !== room.roomId) {
    roomDebugTraceRef.current = {
      roomId: room.roomId,
      traceId: createTimelineDebugTrace('room-open', room.roomId),
    };
  }
  if (threadDebugTraceRef.current.traceKey !== currentThreadTraceKey) {
    threadDebugTraceRef.current = {
      traceId: currentThreadTraceKey
        ? createTimelineDebugTrace('thread-open', room.roomId, threadId)
        : undefined,
      traceKey: currentThreadTraceKey,
    };
  }
  const roomDebugTraceId = roomDebugTraceRef.current.traceId;
  const threadDebugTraceId = threadDebugTraceRef.current.traceId;

  useEffect(() => {
    logTimelineDebug(roomDebugTraceId, 'init', {
      eventId,
      roomId: room.roomId,
      threadId,
    });
  }, [eventId, room.roomId, roomDebugTraceId, threadId]);

  useEffect(() => {
    if (!threadId) return;
    logTimelineDebug(threadDebugTraceId, 'init', {
      eventId,
      roomId: room.roomId,
      threadId,
    });
  }, [eventId, room.roomId, threadDebugTraceId, threadId]);

  const linkifyOpts = useMemo<LinkifyOpts>(
    () => ({
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention((href) =>
        renderMatrixMention(mx, room.roomId, href, makeMentionCustomProps(mentionClickHandler))
      ),
    }),
    [mx, room, mentionClickHandler]
  );
  const htmlReactParserOptions = useMemo<HTMLReactParserOptions>(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, {
        linkifyOpts,
        useAuthentication,
        handleSpoilerClick: spoilerClickHandler,
        handleMentionClick: mentionClickHandler,
      }),
    [mx, room, linkifyOpts, spoilerClickHandler, mentionClickHandler, useAuthentication]
  );
  const parseMemberEvent = useMemberEventParser();
  const [timeline, setTimeline] = useState<Timeline>(() =>
    eventId
      ? getEmptyTimeline()
      : getInitialTimeline(room, safePaginationLimit, {
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
        })
  );
  const eventsLength = getTimelinesEventsCount(timeline.linkedTimelines);
  const threadResolutionMap = useRoomThreadResolutionMap(room);
  useEffect(() => {
    liveExpandOnceIds.current.clear();
  }, [room.roomId, threadId]);
  // Reset eagerPreloading when transitioning from event-focused view back to room
  // (component is reused since key is roomId:threadId, so useState initializer won't re-run)
  // useLayoutEffect so the reset fires before paint, preventing a single-frame skeleton flash
  useLayoutEffect(() => {
    if (!eventId && !threadId) {
      setEagerPreloading(true);
    }
  }, [eventId, threadId]);
  const rawRenderableEventEntries = useMemo(
    () =>
      getRenderableEventEntries(
        timeline.linkedTimelines,
        room,
        threadId,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      timeline.linkedTimelines,
      eventsLength,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
    ]
  );
  const resolveConfirmedRoomEventId = useMemo(
    () =>
      threadId
        ? undefined
        : buildResolveConfirmedEventId(
            room,
            rawRenderableEventEntries.map(({ event }) => event)
          ),
    [threadId, room, rawRenderableEventEntries]
  );
  const renderableEventEntries = useMemo(
    () =>
      threadId
        ? rawRenderableEventEntries
        : dedupeThreadRenderEventEntries(rawRenderableEventEntries, resolveConfirmedRoomEventId),
    [threadId, rawRenderableEventEntries, resolveConfirmedRoomEventId]
  );
  const renderableEvents = useMemo(
    () => renderableEventEntries.map(({ event }) => event),
    [renderableEventEntries]
  );
  const loadedTimelineEvents = useMemo(() => {
    if (threadId) return [] as MatrixEvent[];
    return getLinkedTimelineEvents(timeline.linkedTimelines);
  }, [threadId, timeline]);
  const threadReplyCountMap = useMemo(
    () =>
      threadId ? new Map<string, number>() : buildVisibleThreadReplyCountMap(loadedTimelineEvents),
    [threadId, loadedTimelineEvents]
  );
  const threadParticipantMap = useMemo(
    () =>
      threadId
        ? new Map<string, string[]>()
        : buildVisibleThreadParticipantMap(loadedTimelineEvents),
    [threadId, loadedTimelineEvents]
  );
  const threadSummaryInfoMap = useMemo(
    () =>
      threadId
        ? new Map<string, MindroomThreadSummaryInfo>()
        : buildThreadSummaryMap(loadedTimelineEvents),
    [threadId, loadedTimelineEvents]
  );
  // ── Scheduled task state events (batch) ──
  const scheduledTaskEvents = useStateEvents(room, StateEvent.MindRoomScheduledTask);
  const scheduledTaskCounts = useMemo(
    () => (threadId ? new Map<string, number>() : getRoomScheduledTaskCounts(scheduledTaskEvents)),
    [threadId, scheduledTaskEvents]
  );

  // ── Batch metadata reactivity ──
  // Bump a refresh counter on room-level events that affect overview metadata
  const [overviewRefreshCounter, setOverviewRefreshCounter] = useState(0);
  useEffect(() => {
    if (threadId) return undefined;
    const bumpRefresh = () => setOverviewRefreshCounter((c) => c + 1);
    const handleTimelineRefresh: RoomEventHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      eventRoom,
      _toStartOfTimeline,
      removed
    ) => {
      if (eventRoom?.roomId !== room.roomId || removed) return;
      if (!shouldRefreshOverviewForTimelineEvent(room, mEvent)) return;
      bumpRefresh();
    };
    const handleReceiptRefresh: RoomEventHandlerMap[RoomEvent.Receipt] = (_receipt, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return;
      bumpRefresh();
    };
    room.on(RoomEvent.Timeline, handleTimelineRefresh);
    room.on(RoomEvent.Receipt, handleReceiptRefresh);
    room.on(ThreadEvent.New, bumpRefresh);
    room.on(ThreadEvent.Update, bumpRefresh);
    room.on(ThreadEvent.NewReply, bumpRefresh);
    room.on(ThreadEvent.Delete, bumpRefresh);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimelineRefresh);
      room.removeListener(RoomEvent.Receipt, handleReceiptRefresh);
      room.removeListener(ThreadEvent.New, bumpRefresh);
      room.removeListener(ThreadEvent.Update, bumpRefresh);
      room.removeListener(ThreadEvent.NewReply, bumpRefresh);
      room.removeListener(ThreadEvent.Delete, bumpRefresh);
    };
  }, [room, threadId]);

  // ── Visible thread root IDs + absoluteIndex map ──
  const roomSurfaceEventEntries = useMemo(() => {
    if (threadId) return renderableEventEntries;
    return buildRoomSurfaceEventEntries({
      renderableEventEntries,
      linkedTimelines: timeline.linkedTimelines,
      room,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      threadReplyCountMap,
      threadResolutionMap,
    });
  }, [
    threadId,
    renderableEventEntries,
    timeline.linkedTimelines,
    room,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    threadReplyCountMap,
    threadResolutionMap,
    overviewRefreshCounter,
  ]);

  const visibleThreadRootData = useMemo(() => {
    const ids: string[] = [];
    const indexMap = new Map<string, number>();
    const bodyMap = new Map<string, string>();
    roomSurfaceEventEntries.forEach(({ event, absoluteIndex }) => {
      const evtId = event.getId();
      if (!evtId) return;
      if (isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)) {
        ids.push(evtId);
        indexMap.set(evtId, absoluteIndex);
        const body = getCompactThreadRootBodyPreviewText(event, {
          eventId: evtId,
          room,
        });
        if (body) bodyMap.set(evtId, body);
      }
    });
    return { ids, indexMap, bodyMap };
  }, [roomSurfaceEventEntries, room, threadResolutionMap, threadReplyCountMap]);
  const compactViewRequested = !threadId && effectiveViewMode === 'compact';
  const { threads: roomThreadListThreads, retry: refreshRoomThreadList } = useRoomThreadList(
    room,
    compactViewRequested
  );
  const compactThreadRootData = useMemo(() => {
    if (threadId || !compactViewRequested) {
      return visibleThreadRootData;
    }

    const baseCompactThreadRootData = buildCompactThreadRootData({
      room,
      visibleIds: visibleThreadRootData.ids,
      visibleIndexMap: visibleThreadRootData.indexMap,
      visibleBodyMap: visibleThreadRootData.bodyMap,
      threads: roomThreadListThreads,
    });
    const compactZeroReplyRootData = buildCompactZeroReplyRootData({
      room,
      roomSurfaceEntries: roomSurfaceEventEntries,
      knownThreadRootIds: baseCompactThreadRootData.ids,
    });

    return mergeCompactThreadRootData(baseCompactThreadRootData, compactZeroReplyRootData);
  }, [
    threadId,
    compactViewRequested,
    room,
    roomSurfaceEventEntries,
    visibleThreadRootData,
    roomThreadListThreads,
  ]);
  const roomInitialCacheHydrationKey = !threadId && !eventId ? room.roomId : undefined;
  const roomInitialCacheHydrated =
    !roomInitialCacheHydrationKey || roomInitialCacheHydratedKey === roomInitialCacheHydrationKey;
  const deferEmptyRoomOverview =
    !threadId &&
    (!roomInitialCacheHydrated || initialClientCatchupInProgress) &&
    visibleThreadRootData.ids.length === 0 &&
    compactThreadRootData.ids.length === 0;
  const shouldShowRoomThreadOverviewControls =
    showRoomThreadOverviewControls && !deferEmptyRoomOverview;

  // ── Read-up-to timestamp for unread heuristic ──
  const readUpToTs = useMemo(() => {
    if (threadId) return undefined;
    const readUpToId = room.getEventReadUpTo(mx.getSafeUserId());
    if (!readUpToId) return undefined;
    const readUpToEvent = room.findEventById(readUpToId);
    return readUpToEvent?.getTs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, room, mx, overviewRefreshCounter]);

  const {
    showCompactRoomView,
    normalThreadRecordMap,
    threadRecordMap,
    effectiveThreadFilterState,
    roomThreadFilterActive,
    filteredThreadRootIds,
    compactFilteredThreadRootIds,
    roomOverviewOrderActive,
    activeLiveOverviewThreadRootIds,
    overviewThreadRootIds,
    statusCounts,
    tagCounts,
    searchQuery: threadIndexSearchQuery,
    threadSortControlSignature,
  } = useMindroomThreadIndex({
    room,
    threadId,
    eventId,
    focusedRoomOverviewRequested,
    compactViewRequested,
    effectiveViewMode,
    roomSurfaceEventEntries,
    visibleThreadRootData,
    compactThreadRootData,
    summaryMap,
    fallbackSummaryMap: threadSummaryInfoMap,
    fallbackReplyCountMap: threadReplyCountMap,
    fallbackParticipantMap: threadParticipantMap,
    threadResolutionMap,
    currentUserId: mx.getSafeUserId(),
    readUpToTs,
    scheduledTaskEvents,
    scheduledTaskCounts,
    requestedThreadFilterState,
    liveThreadFilterState,
    fallbackThreadFilterState: DIRECT_ROOM_TIMELINE_FILTER_STATE,
    threadSortFreezeState,
    roomThreadListThreads,
    overviewRefreshCounter,
    overviewThreadMetadataCacheLimit: OVERVIEW_THREAD_METADATA_CACHE_LIMIT,
    sessionId,
    mx,
    onStoreThreadSummary,
  });
  threadFilterStateRef.current = effectiveThreadFilterState;

  useEffect(() => {
    if (threadId || !threadSortFreezeState) return;
    if (threadSortFreezeState.controlSignature === threadSortControlSignature) return;

    setThreadSortFreezeState((currentState) => {
      if (!currentState) return currentState;
      if (currentState.controlSignature === threadSortControlSignature) {
        return currentState;
      }

      return {
        controlSignature: threadSortControlSignature,
        orderedRootIds: activeLiveOverviewThreadRootIds,
      };
    });
  }, [
    threadId,
    threadSortFreezeState,
    threadSortControlSignature,
    activeLiveOverviewThreadRootIds,
    setThreadSortFreezeState,
  ]);

  const useSurfacePreloadTarget = shouldUseSurfacePreloadTarget({
    threadId,
    roomThreadFilterActive,
    viewMode: effectiveViewMode,
  });

  // Available tags from resolution map
  const availableRoomTags = useMemo(
    () => collectAvailableRoomTags(threadResolutionMap),
    [threadResolutionMap]
  );

  const threadFilteredEvents = useMemo(() => {
    if (threadId) return renderableEvents;
    if (roomOverviewOrderActive) {
      return resolveOrderedRoomOverviewEvents({
        orderedRootIds: overviewThreadRootIds,
        renderableEvents: roomSurfaceEventEntries.map(({ event }) => event),
        room,
        roomThreads: roomThreadListThreads,
      });
    }

    return renderableEvents;
  }, [
    overviewThreadRootIds,
    renderableEvents,
    room,
    roomOverviewOrderActive,
    roomSurfaceEventEntries,
    roomThreadListThreads,
    threadId,
  ]);

  const threadFilteredEventsRef = useRef(threadFilteredEvents);
  threadFilteredEventsRef.current = threadFilteredEvents;

  // Map-based entry construction: preserve entry metadata while allowing new display order
  const threadFilteredEventEntries = useMemo(() => {
    if (!roomOverviewOrderActive) {
      return renderableEventEntries;
    }

    const entryMap = new Map<string, TimelineEventEntry>();
    roomSurfaceEventEntries.forEach((entry) => {
      const entryEventId = entry.event.getId();
      if (entryEventId) entryMap.set(entryEventId, entry);
    });

    return threadFilteredEvents
      .map((event) => {
        const eventId = event.getId();
        return eventId ? entryMap.get(eventId) : undefined;
      })
      .filter((entry): entry is TimelineEventEntry => entry !== undefined);
  }, [
    renderableEventEntries,
    roomOverviewOrderActive,
    roomSurfaceEventEntries,
    threadFilteredEvents,
  ]);
  const readUptoAbsoluteIndex = useMemo(() => {
    if (threadId) return undefined;
    const currentReadUptoEventId = unreadInfo?.readUptoEventId;
    if (!currentReadUptoEventId) return undefined;

    return getLinkedTimelinesEventAbsoluteIndex(timeline.linkedTimelines, currentReadUptoEventId);
  }, [threadId, timeline.linkedTimelines, unreadInfo?.readUptoEventId]);
  const unreadScrollAnchorIndex = useMemo(() => {
    const currentReadUptoEventId = unreadInfo?.readUptoEventId;
    if (threadId || !currentReadUptoEventId) return undefined;

    const visibleIndex = getEventEntryIndex(threadFilteredEventEntries, currentReadUptoEventId);
    if (visibleIndex !== -1) {
      return visibleIndex;
    }

    if (readUptoAbsoluteIndex === undefined) return undefined;
    return getNextRenderableEntryIndex(threadFilteredEventEntries, readUptoAbsoluteIndex);
  }, [threadFilteredEventEntries, threadId, unreadInfo?.readUptoEventId, readUptoAbsoluteIndex]);
  const filteredLength = threadFilteredEvents.length;
  const activeTimelineRange = useMemo(
    () =>
      getActiveTimelineRange(
        threadId,
        roomThreadFilterActive,
        timeline.range,
        filteredLength,
        safePaginationLimit
      ),
    [threadId, roomThreadFilterActive, timeline.range, filteredLength, safePaginationLimit]
  );
  const priorityThreadSeedPrewarmRoots = useMemo(() => {
    return collectPriorityThreadSeedPrewarmRoots({
      room,
      threadFilteredEventEntries,
      threadId,
      threadReplyCountMap,
      threadResolutionMap,
      rangeEnd: activeTimelineRange.end,
      rangeStart: activeTimelineRange.start,
    });
  }, [
    activeTimelineRange.end,
    activeTimelineRange.start,
    overviewRefreshCounter,
    room,
    threadFilteredEventEntries,
    threadId,
    threadReplyCountMap,
    threadResolutionMap,
  ]);
  const prevRoomThreadFilterActiveRef = useRef(roomThreadFilterActive);
  const liveTimelineLinked =
    timeline.linkedTimelines[timeline.linkedTimelines.length - 1] === getLiveTimeline(room);
  const canPaginateBack =
    typeof timeline.linkedTimelines[0]?.getPaginationToken(Direction.Backward) === 'string';
  const rangeAtStart = activeTimelineRange.start === 0;
  const rangeAtEnd = activeTimelineRange.end === filteredLength;
  const thread = threadId ? room.getThread(threadId) : null;
  const roomTimelineSet = room.getUnfilteredTimelineSet();
  const threadTimelineSet = thread?.getUnfilteredTimelineSet();
  const threadLinkedTimelines = threadTimelineSet
    ? getLinkedTimelines(threadTimelineSet.getLiveTimeline())
    : [];
  const lastThreadTimeline = threadLinkedTimelines[threadLinkedTimelines.length - 1];
  const {
    threadEventIndexMapRef,
    threadEvents,
    threadInitialRenderMode,
    setSupplementalThreadEvents,
    resetThreadRenderState,
  } = useThreadRenderState({
    room,
    roomTimelineSet,
    threadTimelineSet,
    threadId,
    thread,
    threadInitialCacheHydrated,
    debugTraceId: threadDebugTraceId,
  });
  const threadEventMap = useMemo(() => {
    const eventMap = new Map<string, MatrixEvent>();
    threadEvents.forEach((mEvent) => {
      const eventId = mEvent.getId();
      if (eventId) eventMap.set(eventId, mEvent);
    });
    return eventMap;
  }, [threadEvents]);
  const threadBackwardPaginationToken =
    threadLinkedTimelines[0]?.getPaginationToken(Direction.Backward) ?? null;
  const canPaginateThreadBack = typeof threadBackwardPaginationToken === 'string';
  const canPaginateThreadFront =
    typeof lastThreadTimeline?.getPaginationToken(Direction.Forward) === 'string';
  const threadPaginationCoverage = useMemo(
    () =>
      buildThreadCacheCoverage({
        eventCount: threadEvents.length,
        backwardToken: canPaginateThreadBack
          ? threadBackwardPaginationToken
          : threadHasMoreCachedBack
          ? undefined
          : null,
        hasMoreBackward: threadHasMoreCachedBack || canPaginateThreadBack,
        relationSnapshotComplete: false,
        tailLoaded: threadTailLoaded,
      }),
    [
      canPaginateThreadBack,
      threadBackwardPaginationToken,
      threadEvents.length,
      threadHasMoreCachedBack,
      threadTailLoaded,
    ]
  );
  const showThreadLoadOlderMessages = shouldShowThreadLoadOlderFromCoverage({
    coverage: threadPaginationCoverage,
    sdkHasBackwardToken: canPaginateThreadBack,
  });

  useEffect(() => {
    if (threadId) return;
    logTimelineDebug(roomDebugTraceId, 'room-surface', {
      activeRangeEnd: activeTimelineRange.end,
      activeRangeStart: activeTimelineRange.start,
      cacheCount: eventsLength,
      eagerPreloading,
      preloadTarget: useSurfacePreloadTarget ? 'surface' : 'renderable',
      renderableCount: renderableEventEntries.length,
      surfaceCount: roomSurfaceEventEntries.length,
      threadOverviewCount: threadFilteredEvents.length,
      visibleCount: activeTimelineRange.end - activeTimelineRange.start,
    });
  }, [
    activeTimelineRange.end,
    activeTimelineRange.start,
    eagerPreloading,
    eventsLength,
    renderableEventEntries.length,
    useSurfacePreloadTarget,
    roomSurfaceEventEntries.length,
    threadFilteredEvents.length,
    threadId,
    roomDebugTraceId,
  ]);

  useEffect(() => {
    if (!threadId) return;
    logTimelineDebug(threadDebugTraceId, 'thread-range', {
      activeRangeEnd: activeTimelineRange.end,
      activeRangeStart: activeTimelineRange.start,
      canPaginateThreadBack,
      canPaginateThreadFront,
      filteredLength,
      initialCacheHydrated: threadInitialCacheHydrated,
      initialRenderMode: threadInitialRenderMode,
      renderedCount: activeTimelineRange.end - activeTimelineRange.start,
      threadEventCount: threadEvents.length,
      threadTailLoaded,
      threadTimelineTick,
    });
  }, [
    activeTimelineRange.end,
    activeTimelineRange.start,
    canPaginateThreadBack,
    canPaginateThreadFront,
    filteredLength,
    threadEvents.length,
    threadDebugTraceId,
    threadId,
    threadInitialCacheHydrated,
    threadInitialRenderMode,
    threadTailLoaded,
    threadTimelineTick,
  ]);

  useEffect(() => {
    const wasActive = prevRoomThreadFilterActiveRef.current;
    prevRoomThreadFilterActiveRef.current = roomThreadFilterActive;

    if (wasActive && !roomThreadFilterActive && !threadId) {
      setTimeline(
        getInitialTimeline(room, safePaginationLimit, {
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
        })
      );
    }
  }, [
    roomThreadFilterActive,
    threadId,
    room,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    safePaginationLimit,
  ]);

  const timelineAtLiveEnd = isTimelineAtLiveEnd({
    threadId,
    liveTimelineLinked,
    rangeAtEnd,
    canPaginateThreadFront,
    threadTailLoaded,
  });
  const atLiveEndRef = useRef(timelineAtLiveEnd);
  atLiveEndRef.current = timelineAtLiveEnd;

  const recalibrateFilterOptsRef = useRef<RecalibrateFilterOpts | undefined>({
    room,
    threadId,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
  });
  recalibrateFilterOptsRef.current = {
    room,
    threadId,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
  };

  const handleTimelinePagination = useTimelinePagination(
    mx,
    timeline,
    setTimeline,
    safePaginationLimit,
    recalibrateFilterOptsRef
  );

  const handleRoomTimelinePagination = useRoomPaginationCommandController({
    alive,
    handleTimelinePagination,
    mx,
    recalibrateFilterOptsRef,
    room,
    roomIdRef,
    roomPaginatingBackRef,
    safePaginationLimitRef,
    sessionId,
    setRoomHasMoreCachedBack,
    setTimeline,
    threadId,
    threadIdRef,
    timeline,
  });

  useRoomEagerPreload({
    alive,
    eventId,
    eagerPreloadDoneForRoomRef,
    mx,
    recalibrateFilterOptsRef,
    room,
    roomDebugTraceId,
    roomIdRef,
    roomPaginatingBackRef,
    safePaginationLimitRef,
    setEagerPreloading,
    setTimeline,
    threadId,
    threadIdRef,
    useSurfacePreloadTarget,
  });

  const {
    persistThreadCacheFromRoomEvents,
    persistThreadEventCache,
    queueRoomThreadCachePersist,
  } = useThreadCachePersistenceController({
    alive,
    room,
    roomDebugTraceId,
    roomIdRef,
    sessionId,
    threadDebugTraceId,
    threadIdRef,
  });

  const persistRoomEventCache = useCallback(
    (events: MatrixEvent[], beforeTokenForEarliest?: string | null) => {
      const snapshot = persistRoomEventCacheSnapshot({
        sessionId,
        room,
        events,
        beforeTokenForEarliest,
      });
      logTimelineDebug(roomDebugTraceId, 'room-cache-persist', {
        beforeTokenForEarliest: beforeTokenForEarliest ?? null,
        rawEventCount: snapshot.rawEvents.length,
        sourceEventCount: snapshot.sourceEventCount,
      });
    },
    [room, roomDebugTraceId, sessionId]
  );

  useCompactRootEditBackfillController({
    enabled: !threadId && showCompactRoomView,
    mx,
    overviewThreadRootIds,
    persistRoomEventCache,
    room,
    roomSurfaceEventEntries,
    roomThreadListThreads,
    setOverviewRefreshCounter,
  });

  const loadThreadOpenSeedSnapshotFromCache = useCallback(
    async (expectedThreadId: string): Promise<MatrixEvent[]> => {
      const mapper = mx.getEventMapper();
      const cachedSnapshot = await loadThreadCachedSnapshot({
        sessionId,
        roomId: room.roomId,
        threadId: expectedThreadId,
        limit: safePaginationLimitRef.current,
        maxPages: MAX_THREAD_FETCH_ITERATIONS,
        mapEvent: (rawEvent) => mapper(rawEvent),
      });
      return cachedSnapshot?.events ?? [];
    },
    [mx, room.roomId, sessionId]
  );

  const {
    ensureThreadSeedPrewarm,
    prewarmedThreadSeedIdsRef,
    prewarmingThreadSeedIdsRef,
    queuedThreadSeedIdsRef,
    prewarmingThreadSeedPromisesRef,
  } = useThreadSeedPrewarmController({
    room,
    activeThreadId: threadId,
    priorityTargets: priorityThreadSeedPrewarmRoots,
    loadThreadOpenSeedSnapshotFromCache,
    debugTraceId: roomDebugTraceId,
  });

  const forceTimelineUpdate = useCallback(() => {
    setTimeline((ct) => ({ ...ct }));
  }, []);

  const {
    backfillThreadRelationsIntoCache,
    hydrateThreadFromCache,
    refreshLatestThreadRelationsTail,
    refreshLatestThreadSlice,
  } = useThreadOpenCacheController({
    alive,
    debugTraceId: threadDebugTraceId,
    forceTimelineUpdate,
    mx,
    persistThreadEventCache,
    room,
    roomIdRef,
    roomTimelineSet,
    safePaginationLimitRef,
    sessionId,
    setSupplementalThreadEvents,
    setThreadHasMoreCachedBack,
    setThreadTailLoaded,
    setThreadTimelineTick,
    threadIdRef,
  });

  const getScrollElement = useCallback(() => scrollRef.current, []);

  const {
    getItems,
    scrollToItem,
    scrollToElement,
    retryPagination,
    observeBackAnchor,
    observeFrontAnchor,
  } = useVirtualPaginator({
    count: threadId ? 0 : filteredLength,
    limit: safePaginationLimit,
    range: activeTimelineRange,
    onRangeChange: useCallback(
      (r) => {
        if (threadId || roomThreadFilterActive) return;
        setTimeline((cs) => ({ ...cs, range: r }));
      },
      [threadId, roomThreadFilterActive]
    ),
    getScrollElement,
    getItemElement: useCallback(
      (index: number) =>
        (scrollRef.current?.querySelector(`[data-message-item="${index}"]`) as HTMLElement) ??
        undefined,
      []
    ),
    onEnd: handleRoomTimelinePagination,
    shouldSuppressPagination: useCallback(() => suppressFocusPaginationRef.current, []),
  });

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
      (evtId, lTimelines, evtAbsIndex) => {
        if (!alive()) return;
        if (redirectRoomEventDeepLink(evtId, lTimelines)) {
          return;
        }
        const renderableEntries = getRenderableEventEntries(
          lTimelines,
          room,
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents
        );
        const loadedRenderableEvents = renderableEntries.map(({ event }) => event);
        const loadedThreadReplyCountMap = buildVisibleThreadReplyCountMap(
          lTimelines.flatMap((timeline) => timeline.getEvents())
        );
        const anchor =
          evtId === readUptoEventIdRef.current
            ? getUnreadTargetAnchor({
                renderableEntries,
                eventId: evtId,
                absoluteIndex: evtAbsIndex,
              })
            : getTimelineTargetAnchor({
                linkedTimelines: lTimelines,
                renderableEntries,
                eventId: evtId,
                absoluteIndex: evtAbsIndex,
              });
        const {
          index: idx,
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
              searchQuery: threadIndexSearchQuery,
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
                index: idx,
                scrollTo: !threadId,
                highlight: evtId !== readUptoEventIdRef.current,
              }
            : undefined
        );
        setTimeline({
          linkedTimelines: lTimelines,
          range: {
            start: Math.max(idx - safePaginationLimitRef.current, 0),
            end: Math.min(idx + safePaginationLimitRef.current, count),
          },
        });
      },
      [
        alive,
        mx,
        threadId,
        threadResolutionMap,
        room,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
        scheduledTaskCounts,
        threadReplyCountMap,
        threadParticipantMap,
        threadSummaryInfoMap,
        readUpToTs,
        threadIndexSearchQuery,
        threadSortFreezeState,
        threadSortControlSignature,
        roomOverviewOrderActive,
        overviewThreadRootIds,
        roomThreadListThreads,
        redirectRoomEventDeepLink,
        effectiveViewMode,
      ]
    ),
    useCallback(() => {
      if (!alive()) return;
      setTimeline(
        getInitialTimeline(room, safePaginationLimit, {
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
        })
      );
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
    }, [
      alive,
      room,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      safePaginationLimit,
    ])
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
        const isThreadOnlyActivity = isThreadOnlyRoomActivity(room, mEvt);
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
            // Only add non-edit events to supplemental thread events.
            // m.replace edits modify existing events in-place (via makeReplaced)
            // and are filtered by reactionOrEditEvent() during rendering.
            // Adding them inflates threadEvents with non-renderable entries (CINNY-031).
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
                // Use only fresh scroll measurement, not debounced atBottomRef,
                // to prevent streaming edits from trapping user at bottom (CINNY-031).
                scrollToBottomRef.current.count += 1;
                scrollToBottomRef.current.smooth = false;
              }
            }
          }
          return;
        }

        // Ignore thread-only live activity in the main room timeline for auto-scroll.
        // These events are hidden there, so forcing bottom jumps is disruptive.
        // Only re-render when at bottom so thread previews update without causing
        // scroll jumps for users reading history.
        if (threadCacheTargetId) {
          persistThreadCacheFromRoomEvents([mEvt], {
            tailLoaded: true,
          });
        }
        if (isThreadOnlyActivity) {
          // Cache summary events arriving via sync for persistence across sessions
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

        // Use a fresh scroll-position measurement instead of the debounced
        // atBottomRef to decide whether to auto-follow.  The debounced state
        // can be stale-true for up to 1 s after the user scrolls away, which
        // causes streaming m.replace edits to trap the user at the bottom
        // (CINNY-031).
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
        mx,
        persistRoomEventCache,
        persistThreadCacheFromRoomEvents,
        persistThreadEventCache,
        queueRoomThreadCachePersist,
        room,
        roomDebugTraceId,
        setSupplementalThreadEvents,
        unreadInfo,
        hideActivity,
        threadId,
        timelineAtLiveEnd,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
        roomThreadFilterActive,
        effectiveThreadFilterState,
        onStoreThreadSummary,
        threadResolutionMap,
        normalThreadRecordMap,
        sessionId,
      ]
    )
  );

  useEffect(() => {
    if (threadId) return;
    let cancelled = false;

    const persistCurrentRoomCache = async () => {
      const currentLinkedTimelines = timeline.linkedTimelines;
      const cacheEvents = getMainTimelineCacheEvents(room, currentLinkedTimelines);
      const threadCacheEvents = currentLinkedTimelines.flatMap((timeline) =>
        timeline.getEvents().filter((mEvent) => !!getThreadCacheTargetId(room, mEvent))
      );
      const earliestLoadedEvent = findEarliestLoadedRoomEventByCacheOrder(cacheEvents);
      const firstTimeline = currentLinkedTimelines[0];
      const lastTimeline = currentLinkedTimelines[currentLinkedTimelines.length - 1];
      const currentBeforeToken = firstTimeline?.getPaginationToken(Direction.Backward);
      const roomCachePersistenceState = await loadRoomCachePersistenceState({
        sessionId,
        roomId: room.roomId,
        earliestLoadedEventId: earliestLoadedEvent?.getId(),
        currentBeforeToken,
      });

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      if (firstTimeline && roomCachePersistenceState.shouldClearBackwardToken) {
        firstTimeline.setPaginationToken(null, Direction.Backward);
        setTimeline((currentTimeline) =>
          currentTimeline.linkedTimelines === currentLinkedTimelines
            ? { ...currentTimeline }
            : currentTimeline
        );
      }

      persistRoomEventCache(cacheEvents, roomCachePersistenceState.beforeTokenForEarliest);
      persistThreadCacheFromRoomEvents(threadCacheEvents, {
        roomStartKnown: roomCachePersistenceState.roomStartKnown,
        roomTailLoaded: !lastTimeline?.getPaginationToken(Direction.Forward),
      });
    };

    persistCurrentRoomCache();

    return () => {
      cancelled = true;
    };
  }, [
    alive,
    eventsLength,
    persistRoomEventCache,
    persistThreadCacheFromRoomEvents,
    room,
    sessionId,
    threadId,
    timeline.linkedTimelines,
  ]);

  useEffect(() => {
    if (threadId || eventId) return undefined;

    let cancelled = false;
    const hydrateRoomFromCache = async () => {
      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-start', {
        limit: safePaginationLimit,
      });

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      const currentLinkedTimelines = getLinkedTimelines(getLiveTimeline(room));
      const loadedRoomEvents = getMainTimelineCacheEvents(room, currentLinkedTimelines);
      const mapper = mx.getEventMapper();
      const hydrationSnapshot = await loadLatestRoomCacheHydrationSnapshot({
        sessionId,
        roomId: room.roomId,
        limit: safePaginationLimit,
        loadedEvents: loadedRoomEvents,
        mapEvent: (rawEvent) => mapper(rawEvent),
      });

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-page', {
        cachedCount: hydrationSnapshot.cachedPage.events.length,
        hasMoreBefore: hydrationSnapshot.cachedPage.hasMoreBefore,
        loadedRoomCount: hydrationSnapshot.loadedRoomCount,
      });

      if (hydrationSnapshot.status === 'already-loaded') {
        logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-skip-latest-already-loaded', {
          cachedCount: hydrationSnapshot.cachedPage.events.length,
          loadedRoomCount: hydrationSnapshot.loadedRoomCount,
        });
        return;
      }

      const cachedEvents = hydrationSnapshot.events;
      if (cachedEvents.length === 0) {
        logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-empty-after-filter', {
          cachedCount: hydrationSnapshot.cachedPage.events.length,
          loadedRoomCount: hydrationSnapshot.loadedRoomCount,
        });
        return;
      }

      hydrateCachedEvents({
        room,
        events: cachedEvents,
      });

      const liveTimeline = getLiveTimeline(room);
      const timelineWasEmpty = liveTimeline.getEvents().length === 0;
      await room.addLiveEvents(cachedEvents, {
        fromCache: true,
        timelineWasEmpty,
        addToState: false,
      });
      mx.processAggregatedTimelineEvents(room, cachedEvents);

      if (room.hasEncryptionStateEvent()) {
        await to(decryptAllTimelineEvent(mx, liveTimeline));
      }

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;
      setTimeline(
        getInitialTimeline(room, safePaginationLimitRef.current, {
          threadId: undefined,
          ignoredUsersSet: recalibrateFilterOptsRef.current?.ignoredUsersSet ?? new Set(),
          showHiddenEvents: recalibrateFilterOptsRef.current?.showHiddenEvents ?? false,
          hideMembershipEvents: recalibrateFilterOptsRef.current?.hideMembershipEvents ?? false,
          hideNickAvatarEvents: recalibrateFilterOptsRef.current?.hideNickAvatarEvents ?? false,
        })
      );
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
      setAtBottom(true);
      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-complete', {
        hydratedCount: cachedEvents.length,
        timelineWasEmpty,
      });
    };

    hydrateRoomFromCache()
      .catch((error) => {
        console.error('Failed to hydrate latest room cache for', room.roomId, error);
      })
      .finally(() => {
        if (!cancelled && alive() && roomIdRef.current === room.roomId && !threadIdRef.current) {
          setRoomInitialCacheHydratedKey(room.roomId);
        }
        // On re-entry (preload already done for this room), clear eagerPreloading
        // regardless of whether cache hydration ran. On initial mount the preload
        // effect handles clearing it, so only clear when preload is already done.
        if (!cancelled && eagerPreloadDoneForRoomRef.current === room.roomId) {
          setEagerPreloading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [alive, eventId, mx, room, roomDebugTraceId, safePaginationLimit, sessionId, threadId]);

  useEffect(() => {
    if (threadId) {
      setRoomHasMoreCachedBack(false);
      return undefined;
    }

    let cancelled = false;
    const refreshRoomCachedBackState = async () => {
      const currentLinkedTimelines = timeline.linkedTimelines;
      const earliestLoadedEvent = getEarliestLoadedRoomEvent(room, currentLinkedTimelines);
      const cachedBackState = await loadRoomCachedBackStateSnapshot({
        sessionId,
        roomId: room.roomId,
        earliestLoadedEvent,
      });
      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      const firstTimeline = currentLinkedTimelines[0];
      if (firstTimeline && cachedBackState.cachedBeforeToken === null) {
        const currentBeforeToken = firstTimeline.getPaginationToken(Direction.Backward);
        if (currentBeforeToken !== null) {
          firstTimeline.setPaginationToken(null, Direction.Backward);
          setTimeline((currentTimeline) =>
            currentTimeline.linkedTimelines === currentLinkedTimelines
              ? { ...currentTimeline }
              : currentTimeline
          );
        }
      }

      setRoomHasMoreCachedBack(cachedBackState.hasCachedBack);
    };

    refreshRoomCachedBackState();
    return () => {
      cancelled = true;
    };
  }, [alive, eventId, eventsLength, room, sessionId, threadId, timeline.linkedTimelines]);

  const handleOpenEvent = useCallback(
    async (
      evtId: string,
      highlight = true,
      onScroll: ((scrolled: boolean) => void) | undefined = undefined
    ) => {
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

      const filteredIndex = threadFilteredEvents.findIndex((e) => e.getId() === evtId);

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
          setTimeline((ct) => ({ ...ct }));
          setThreadTimelineTick((val) => val + 1);
          setPendingThreadOpenTick((val) => val + 1);
          return;
        }
        setTimeline(getEmptyTimeline());
        await loadEventTimeline(evtId);
      }
    },
    [
      alive,
      mx,
      room,
      threadReplyCountMap,
      scrollToItem,
      scrollToElement,
      loadEventTimeline,
      threadId,
    ]
  );
  const handleOpenEventRef = useRef(handleOpenEvent);
  const handledRoomEventRouteRef = useRef<string>();

  useEffect(() => {
    handleOpenEventRef.current = handleOpenEvent;
  }, [handleOpenEvent]);

  useThreadAwareTimelineRefresh({
    room,
    threadId,
    liveTimelineLinked,
    refreshLatestThreadSlice,
    onRoomRefresh: useCallback(() => {
      setTimeline(
        getInitialTimeline(room, safePaginationLimit, {
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
        })
      );
    }, [
      room,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      safePaginationLimit,
    ]),
  });

  // Stay at bottom when room editor resize
  useResizeObserver(
    useMemo(() => {
      let mounted = false;
      return (entries) => {
        if (!mounted) {
          // skip initial mounting call
          mounted = true;
          return;
        }
        if (!roomInputRef.current) return;
        const editorBaseEntry = getResizeObserverEntry(roomInputRef.current, entries);
        const scrollElement = getScrollElement();
        if (!editorBaseEntry || !scrollElement) return;

        if (atBottomRef.current) {
          scrollToBottom(scrollElement);
        }
      };
    }, [getScrollElement, roomInputRef]),
    useCallback(() => roomInputRef.current, [roomInputRef])
  );

  const tryAutoMarkAsRead = useCallback(() => {
    const readUptoEventId = readUptoEventIdRef.current;
    if (!readUptoEventId) {
      requestAnimationFrame(() => markMainTimelineAsRead(mx, room.roomId, hideActivity));
      return;
    }
    const evtTimeline = getEventTimeline(room, readUptoEventId);
    const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
    if (latestTimeline === room.getLiveTimeline()) {
      requestAnimationFrame(() => markMainTimelineAsRead(mx, room.roomId, hideActivity));
    }
  }, [mx, room, hideActivity]);

  const tryAutoMarkThreadAsRead = useCallback(() => {
    if (
      !threadId ||
      threadTailLoaded === false ||
      threadInitialRenderMode === 'loading' ||
      threadEvents.length === 0
    ) {
      return;
    }

    requestAnimationFrame(() => markThreadAsRead(mx, room.roomId, threadId, hideActivity));
  }, [
    hideActivity,
    mx,
    room.roomId,
    threadEvents.length,
    threadId,
    threadInitialRenderMode,
    threadTailLoaded,
  ]);

  const debounceSetAtBottom = useDebounce(
    useCallback((entry: IntersectionObserverEntry) => {
      if (!entry.isIntersecting) setAtBottom(false);
    }, []),
    { wait: 1000 }
  );
  useIntersectionObserver(
    useCallback(
      (entries) => {
        const target = atBottomAnchorRef.current;
        if (!target) return;
        const targetEntry = getIntersectionObserverEntry(target, entries);
        if (targetEntry) debounceSetAtBottom(targetEntry);
        if (targetEntry?.isIntersecting && atLiveEndRef.current) {
          setAtBottom(true);
          if (document.hasFocus()) {
            if (threadId) {
              tryAutoMarkThreadAsRead();
            } else {
              tryAutoMarkAsRead();
            }
          }
        }
      },
      [debounceSetAtBottom, threadId, tryAutoMarkAsRead, tryAutoMarkThreadAsRead]
    ),
    useCallback(
      () => ({
        root: getScrollElement(),
        rootMargin: '100px',
      }),
      [getScrollElement]
    ),
    useCallback(() => atBottomAnchorRef.current, [])
  );

  useDocumentFocusChange(
    useCallback(
      (inFocus) => {
        if (inFocus && atBottomRef.current) {
          if (threadId) {
            if (atLiveEndRef.current) {
              tryAutoMarkThreadAsRead();
            }
            return;
          }
          if (unreadInfo?.inLiveTimeline) {
            handleOpenEvent(unreadInfo.readUptoEventId, false, (scrolled) => {
              // the unread event is already in view
              // so, try mark as read;
              if (!scrolled) {
                tryAutoMarkAsRead();
              }
            });
            return;
          }
          tryAutoMarkAsRead();
        }
      },
      [handleOpenEvent, threadId, tryAutoMarkAsRead, tryAutoMarkThreadAsRead, unreadInfo]
    )
  );

  useEffect(() => {
    if (
      !threadId ||
      !atBottom ||
      !timelineAtLiveEnd ||
      !threadTailLoaded ||
      threadInitialRenderMode === 'loading' ||
      threadEvents.length === 0 ||
      !document.hasFocus()
    ) {
      return;
    }

    tryAutoMarkThreadAsRead();
  }, [
    atBottom,
    threadEvents.length,
    threadId,
    threadInitialRenderMode,
    threadTailLoaded,
    timelineAtLiveEnd,
    tryAutoMarkThreadAsRead,
  ]);

  // Handle up arrow edit
  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (
          isKeyHotkey('arrowup', evt) &&
          editableActiveElement() &&
          document.activeElement?.getAttribute('data-editable-name') === 'RoomInput' &&
          isEmptyEditor(editor)
        ) {
          const editableEvt = getLatestEditableEvt(room.getLiveTimeline(), (mEvt) =>
            canEditEvent(mx, mEvt)
          );
          const editableEvtId = editableEvt?.getId();
          if (!editableEvtId) return;
          setEditId(editableEvtId);
          evt.preventDefault();
        }
      },
      [mx, room, editor]
    )
  );

  useEffect(() => {
    if (!eventId) {
      handledRoomEventRouteRef.current = undefined;
      return;
    }

    const routeKey = [
      room.roomId,
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

    handleOpenEventRef.current(eventId);
  }, [
    eventId,
    focusEventInRoom,
    room.roomId,
    threadId,
    redirectRoomEventDeepLink,
    effectiveViewMode,
    roomOverviewOrderActive,
  ]);

  useEffect(() => {
    if (!threadId) return;
    setFocusItem(undefined);
    setThreadLoadError(false);
    setThreadHasMoreCachedBack(false);
    setThreadInitialCacheHydrated(false);
    setThreadTailLoaded(false);
    setThreadTimelineTick(0);
    setPendingThreadOpenTick(0);
    threadEditFetchAttemptedRef.current = new WeakMap<MatrixEvent, number>();
    pendingThreadOpenRef.current = undefined;
    resetThreadBackPagination();
    resetThreadRenderState(threadId);
    const shouldScrollToLatestOnOpen = !eventId;
    const initialRoomThreadEvents = getLoadedRoomThreadEvents(room, threadId);
    const hasInitialRoomThreadVisibleEvents = initialRoomThreadEvents.length > 0;
    const initialThreadMemorySeedEvents = shouldScrollToLatestOnOpen
      ? getThreadOpenSeedSnapshot(room, threadId)
      : [];
    const initialThreadModelSeedEvents = shouldScrollToLatestOnOpen
      ? getLoadedThreadModelSeedEvents(room, threadId)
      : [];
    const initialRoomThreadSeedEvents = hasInitialRoomThreadVisibleEvents
      ? getLoadedRoomThreadSeedEvents(room, threadId)
      : [];
    const buildUntargetedThreadSeedEvents = (memorySeedEvents: MatrixEvent[]) =>
      shouldScrollToLatestOnOpen
        ? mergeThreadBackfillEvents(
            memorySeedEvents,
            mergeThreadBackfillEvents(initialThreadModelSeedEvents, initialRoomThreadSeedEvents)
          )
        : [];
    const initialUntargetedThreadSeedEvents = buildUntargetedThreadSeedEvents(
      initialThreadMemorySeedEvents
    );
    logTimelineDebug(threadDebugTraceId, 'thread-open-seed-scan', {
      localThreadMemorySeedCount: initialThreadMemorySeedEvents.length,
      localThreadModelSeedCount: initialThreadModelSeedEvents.length,
      mergedSeedVisibleCount: initialUntargetedThreadSeedEvents.filter(
        (mEvent) => !reactionOrEditEvent(mEvent) && !mEvent.isRedaction()
      ).length,
      mergedSeedCount: initialUntargetedThreadSeedEvents.length,
      seedRelationCount: Math.max(
        0,
        initialRoomThreadSeedEvents.length - initialRoomThreadEvents.length
      ),
      seedVisibleCount: initialRoomThreadEvents.length,
      threadId,
    });
    let untargetedThreadSeedApplied = false;
    let untargetedThreadSeedFallbackTimeout: ReturnType<typeof setTimeout> | undefined;
    const shouldAwaitRoomPrewarm =
      shouldScrollToLatestOnOpen &&
      (prewarmedThreadSeedIdsRef.current.has(threadId) ||
        prewarmingThreadSeedIdsRef.current.has(threadId) ||
        queuedThreadSeedIdsRef.current.has(threadId));
    const threadSeedPrewarmPromise = shouldAwaitRoomPrewarm
      ? prewarmingThreadSeedPromisesRef.current.get(threadId) ??
        ensureThreadSeedPrewarm(threadId, {
          allowWhileThreadOpen: true,
          logPrefix: 'thread-open-room-prewarm',
          traceId: threadDebugTraceId,
        })
      : undefined;
    const applyInitialUntargetedThreadSeed = (
      memorySeedEvents: MatrixEvent[],
      source: 'initial' | 'room-prewarm'
    ): boolean => {
      if (untargetedThreadSeedApplied) return true;
      if (hasInitialRoomThreadVisibleEvents) {
        hydrateCachedEvents({
          room,
          events: initialRoomThreadSeedEvents,
          timelineSets: [roomTimelineSet],
        });
      }
      const nextUntargetedThreadSeedEvents = buildUntargetedThreadSeedEvents(memorySeedEvents);
      if (nextUntargetedThreadSeedEvents.length === 0) return false;
      untargetedThreadSeedApplied = true;
      setSupplementalThreadEvents(threadId, nextUntargetedThreadSeedEvents);
      logTimelineDebug(threadDebugTraceId, 'thread-open-live-seed-applied', {
        memorySeedCount: memorySeedEvents.length,
        modelSeedVisibleCount: initialThreadModelSeedEvents.length,
        roomSeedVisibleCount: initialRoomThreadEvents.length,
        seedCount: nextUntargetedThreadSeedEvents.length,
        source,
        threadId,
      });
      return true;
    };
    const applyInitialRoomThreadSeed = () => {
      if (!hasInitialRoomThreadVisibleEvents) return;
      hydrateCachedEvents({
        room,
        events: initialRoomThreadSeedEvents,
        timelineSets: [roomTimelineSet],
      });
      setSupplementalThreadEvents(threadId, initialRoomThreadEvents);
      logTimelineDebug(threadDebugTraceId, 'thread-open-seed-applied', {
        seedRelationCount: Math.max(
          0,
          initialRoomThreadSeedEvents.length - initialRoomThreadEvents.length
        ),
        seedVisibleCount: initialRoomThreadEvents.length,
        threadId,
      });
    };
    let mounted = true;
    if (shouldScrollToLatestOnOpen) {
      const maybeApplyPrewarmedUntargetedThreadSeed = () => {
        const prewarmedMemorySeedEvents = getThreadOpenSeedSnapshot(room, threadId);
        if (prewarmedMemorySeedEvents.length > initialThreadMemorySeedEvents.length) {
          return applyInitialUntargetedThreadSeed(prewarmedMemorySeedEvents, 'room-prewarm');
        }
        return false;
      };
      if (threadSeedPrewarmPromise) {
        logTimelineDebug(threadDebugTraceId, 'thread-open-awaiting-room-prewarm', {
          threadId,
        });
        untargetedThreadSeedFallbackTimeout = setTimeout(() => {
          if (!mounted || threadIdRef.current !== threadId) return;
          if (maybeApplyPrewarmedUntargetedThreadSeed()) return;
          applyInitialUntargetedThreadSeed(initialThreadMemorySeedEvents, 'initial');
        }, THREAD_OPEN_PREWARM_WAIT_MS);
        void threadSeedPrewarmPromise.finally(() => {
          if (untargetedThreadSeedFallbackTimeout !== undefined) {
            clearTimeout(untargetedThreadSeedFallbackTimeout);
            untargetedThreadSeedFallbackTimeout = undefined;
          }
          if (!mounted || threadIdRef.current !== threadId) return;
          if (maybeApplyPrewarmedUntargetedThreadSeed()) return;
          applyInitialUntargetedThreadSeed(initialThreadMemorySeedEvents, 'initial');
        });
      } else {
        if (!maybeApplyPrewarmedUntargetedThreadSeed()) {
          applyInitialUntargetedThreadSeed(initialThreadMemorySeedEvents, 'initial');
        }
      }
    }
    if (!shouldScrollToLatestOnOpen) {
      applyInitialRoomThreadSeed();
    }
    setThreadLatestOpenPending(shouldScrollToLatestOnOpen);
    const loadThreadTimeline = async () => {
      const pinThreadToBottomOnOpen = () => {
        if (
          !mounted ||
          threadIdRef.current !== threadId ||
          suppressThreadOpenBottomPinRef.current
        ) {
          return;
        }
        scrollToBottomRef.current.count += 1;
        scrollToBottomRef.current.smooth = false;
        setAtBottom(true);
      };

      try {
        let hydratedCachedPage;
        try {
          hydratedCachedPage = await hydrateThreadFromCache(threadId);
        } catch {
          if (!mounted || threadIdRef.current !== threadId) return;
          hydratedCachedPage = undefined;
        }
        if (!mounted || threadIdRef.current !== threadId) return;
        const cachedThreadHasLocalSnapshot =
          !!hydratedCachedPage &&
          hasUsableThreadCacheSnapshot({
            eventCount: hydratedCachedPage.events.length,
            rootPresent: !!hydratedCachedPage.rootEvent,
          });
        if (shouldScrollToLatestOnOpen && !cachedThreadHasLocalSnapshot) {
          applyInitialUntargetedThreadSeed(initialThreadMemorySeedEvents, 'initial');
        }
        setThreadInitialCacheHydrated(true);
        const hasCompleteCachedThreadSnapshot =
          shouldScrollToLatestOnOpen &&
          !!hydratedCachedPage &&
          isCompleteThreadCacheCoverage({
            coverage: hydratedCachedPage.cacheCoverage,
            hasLocalSnapshot: cachedThreadHasLocalSnapshot,
          });

        if (hasCompleteCachedThreadSnapshot && hydratedCachedPage) {
          const firstThreadLiveTimeline = room
            .getThread(threadId)
            ?.getUnfilteredTimelineSet()
            .getLiveTimeline();
          const firstThreadTimeline = firstThreadLiveTimeline
            ? getLinkedTimelines(firstThreadLiveTimeline)[0]
            : undefined;
          firstThreadTimeline?.setPaginationToken(null, Direction.Backward);
          setThreadHasMoreCachedBack(false);
          setThreadTailLoaded(true);
          setTimeline((ct) => ({ ...ct }));
          setThreadTimelineTick((val) => val + 1);
          logTimelineDebug(threadDebugTraceId, 'thread-open-complete-cache-hit', {
            cachedCount: hydratedCachedPage.events.length,
            threadId,
          });
          logTimelineDebug(threadDebugTraceId, 'thread-open-complete', {
            shouldScrollToLatestOnOpen,
            skipNetworkBootstrap: true,
            threadId,
          });
          void refreshLatestThreadRelationsTail(threadId, hydratedCachedPage).catch(
            () => undefined
          );
          pinThreadToBottomOnOpen();
          return;
        }

        const canBackfillThreadRelations =
          shouldScrollToLatestOnOpen &&
          !!hydratedCachedPage &&
          shouldBackfillThreadRelationsFromCoverage({
            coverage: hydratedCachedPage.cacheCoverage,
            hasLocalSnapshot: cachedThreadHasLocalSnapshot,
          });
        if (canBackfillThreadRelations && hydratedCachedPage) {
          const mapper = mx.getEventMapper();
          const cachedSnapshotEvents = mapCachedThreadPageEvents({
            events: hydratedCachedPage.events,
            rootEvent: hydratedCachedPage.rootEvent,
            mapEvent: (rawEvent) => mapper(rawEvent),
          });
          const baselineBackfillEvents =
            initialRoomThreadSeedEvents.length > 0
              ? mergeThreadBackfillEvents(cachedSnapshotEvents, initialRoomThreadSeedEvents)
              : cachedSnapshotEvents;
          const relationBackfill = await backfillThreadRelationsIntoCache(
            threadId,
            hydratedCachedPage.rootEvent,
            baselineBackfillEvents,
            hydratedCachedPage.expectedReplyCount
          );
          if (!mounted || threadIdRef.current !== threadId) return;
          if (relationBackfill?.completed) {
            logTimelineDebug(threadDebugTraceId, 'thread-open-complete', {
              completedBy: 'relations-backfill',
              shouldScrollToLatestOnOpen,
              skipNetworkBootstrap: true,
              threadId,
            });
            pinThreadToBottomOnOpen();
            return;
          }
        }

        if (isPendingLocalEchoThreadRoot(room, threadId)) {
          setThreadTailLoaded(true);
          setTimeline((ct) => ({ ...ct }));
          setThreadTimelineTick((val) => val + 1);
          logTimelineDebug(threadDebugTraceId, 'thread-open-pending-local-echo-root', {
            threadId,
          });
          if (shouldScrollToLatestOnOpen) {
            pinThreadToBottomOnOpen();
          }
          return;
        }

        const zeroReplyStandaloneRootEvent = room.findEventById(threadId);
        if (
          !room.getThread(threadId) &&
          zeroReplyStandaloneRootEvent &&
          isZeroReplyStandaloneThreadRootEvent(zeroReplyStandaloneRootEvent)
        ) {
          setThreadTailLoaded(true);
          setTimeline((ct) => ({ ...ct }));
          setThreadTimelineTick((val) => val + 1);
          logTimelineDebug(threadDebugTraceId, 'thread-open-zero-reply-root-without-thread-model', {
            threadId,
          });
          if (shouldScrollToLatestOnOpen) {
            pinThreadToBottomOnOpen();
          }
          return;
        }

        // First, ensure the thread exists in the SDK.
        // room.getThread() may return null if the SDK hasn't seen the thread yet.
        // We need to fetch the root event and let the SDK create the Thread object.
        let threadModel = room.getThread(threadId);
        if (!threadModel) {
          // Fetch the thread root event to make the SDK aware of this thread
          const [ctxErr] = await to(mx.getEventTimeline(room.getUnfilteredTimelineSet(), threadId));
          if (!mounted) return;
          if (ctxErr) {
            logTimelineDebug(threadDebugTraceId, 'thread-sdk-bootstrap-context-error', {
              threadId,
            });
            setThreadLoadError(true);
            if (isThreadNotFoundError(ctxErr)) {
              onThreadLoadError?.(threadId);
            }
            return;
          }
          threadModel = room.getThread(threadId);
        }

        if (!threadModel) {
          // If the SDK still hasn't created a Thread object, try fetching
          // thread relations directly to populate it
          const [relErr, relData] = await to(
            mx.fetchRelations(room.roomId, threadId, 'm.thread' as any, null, {
              dir: Direction.Backward,
              limit: 50,
            })
          );
          if (!mounted) return;
          if (relErr) {
            logTimelineDebug(threadDebugTraceId, 'thread-sdk-bootstrap-relations-error', {
              threadId,
            });
            setThreadLoadError(true);
            if (isThreadNotFoundError(relErr)) {
              onThreadLoadError?.(threadId);
            }
            return;
          }
          // Check if SDK created a Thread from the fetched relations
          threadModel = room.getThread(threadId);
          if (!threadModel && relData?.chunk?.length) {
            // We need to render something even without a Thread model, so store
            // mapped relation events for thread view fallback rendering.
            const mapper = mx.getEventMapper();
            const mappedEvents = relData.chunk
              .slice()
              .reverse()
              .map((evt) => mapper(evt));
            setSupplementalThreadEvents(threadId, mappedEvents);
            persistThreadEventCache(
              threadId,
              mappedEvents,
              room.findEventById(threadId),
              relData.next_batch
            );
            // Reconcile backward pagination even without a Thread model so
            // stale cached threadHasMoreCachedBack doesn't show a bogus button.
            reconcileThreadBackwardPagination(
              undefined,
              relData.next_batch ?? null,
              setThreadHasMoreCachedBack
            );
            logTimelineDebug(threadDebugTraceId, 'thread-sdk-bootstrap-relations-fallback', {
              mappedCount: mappedEvents.length,
              nextBatchPresent: typeof relData.next_batch === 'string',
              threadId,
            });
          }
        }

        if (threadModel) {
          // Use the thread's own timeline set for getThreadTimeline
          const loadedThreadTimelineSet = threadModel.getUnfilteredTimelineSet();
          const [err] = await to(mx.getThreadTimeline(loadedThreadTimelineSet, threadId));
          if (!mounted) return;
          if (err) {
            // Fallback: even if getThreadTimeline fails, the thread events
            // may already be populated from the relations fetch above
            console.warn('getThreadTimeline failed, using fallback:', err);
            logTimelineDebug(threadDebugTraceId, 'thread-sdk-bootstrap-get-thread-timeline-error', {
              threadId,
            });
          }
          const firstThreadTimeline = getLinkedTimelines(
            loadedThreadTimelineSet.getLiveTimeline()
          )[0];
          const cachedEarliestAnchor = getThreadCursorAnchor(hydratedCachedPage?.events[0]);
          const earliestThreadReply = findEarliestLoadedThreadReplyByCacheOrder(
            threadModel.events,
            threadId
          );
          const threadTimelineAnchor = getThreadCursorAnchor(
            earliestThreadReply?.event as Partial<IEvent> | undefined
          );
          if (
            firstThreadTimeline &&
            hydratedCachedPage?.beforeToken !== undefined &&
            cachedEarliestAnchor &&
            (!threadTimelineAnchor ||
              compareCachedPaginationAnchors(threadTimelineAnchor, cachedEarliestAnchor) >= 0)
          ) {
            firstThreadTimeline.setPaginationToken(
              hydratedCachedPage.beforeToken ?? null,
              Direction.Backward
            );
          }
          if (threadModel.events.length === 0) {
            // Some servers return empty thread timelines even though relations exist.
            // Fetch relations and feed them into the thread so replies render.
            const [relErr, relData] = await to(
              mx.fetchRelations(room.roomId, threadId, 'm.thread' as any, null, {
                dir: Direction.Backward,
                limit: 50,
              })
            );
            if (!mounted) return;
            if (!relErr && relData?.chunk?.length) {
              const mapper = mx.getEventMapper();
              const mappedEvents = relData.chunk
                .slice()
                .reverse()
                .map((evt) => mapper(evt));
              threadModel.addEvents(mappedEvents, true);
              firstThreadTimeline?.setPaginationToken(
                relData.next_batch ?? null,
                Direction.Backward
              );
              logTimelineDebug(
                threadDebugTraceId,
                'thread-sdk-bootstrap-empty-thread-relations-fill',
                {
                  mappedCount: mappedEvents.length,
                  nextBatchPresent: typeof relData.next_batch === 'string',
                  threadId,
                }
              );
            }
          }
          logTimelineDebug(threadDebugTraceId, 'thread-sdk-bootstrap-ready', {
            rootPresent: !!threadModel.rootEvent,
            sdkEventCount: threadModel.events.length,
            threadId,
          });
          persistThreadEventCache(
            threadId,
            threadModel.events,
            threadModel.rootEvent,
            firstThreadTimeline?.getPaginationToken(Direction.Backward)
          );

          // Reconcile backward pagination using the SDK token directly,
          // avoiding the async race from persist→read-back through IndexedDB.
          if (firstThreadTimeline) {
            const sdkBackwardToken =
              firstThreadTimeline.getPaginationToken(Direction.Backward) ?? null;
            reconcileThreadBackwardPagination(
              firstThreadTimeline,
              sdkBackwardToken,
              setThreadHasMoreCachedBack
            );
          }
        } else {
          console.warn('Could not create thread object for', threadId);
          logTimelineDebug(threadDebugTraceId, 'thread-sdk-bootstrap-missing-thread-model', {
            threadId,
          });
        }

        if (shouldScrollToLatestOnOpen) {
          await refreshLatestThreadSlice(threadId);
          if (!mounted || threadIdRef.current !== threadId) return;
        } else {
          // Targeted open (permalink/search jump): fetch authoritative backward
          // pagination state from server to clear stale cached tokens on short
          // threads that would otherwise show a spurious "Load Older Messages".
          const currentThread = room.getThread(threadId);
          if (currentThread) {
            const [relErr, relData] = await to(
              mx.fetchRelations(room.roomId, threadId, 'm.thread' as any, null, {
                dir: Direction.Backward,
                limit: THREAD_BATCH_SIZE,
              })
            );
            if (!mounted || threadIdRef.current !== threadId) return;
            if (!relErr && relData) {
              // Merge fetched latest slice into the live thread before trusting
              // relData.next_batch, matching the refreshLatestThreadSlice flow.
              const mapper = mx.getEventMapper();
              const latestEvents = relData.chunk
                .slice()
                .reverse()
                .map((rawEvent: Parameters<typeof mapper>[0]) => mapper(rawEvent));
              if (latestEvents.length > 0) {
                currentThread.addEvents(latestEvents, false);
                setSupplementalThreadEvents(threadId, latestEvents);
              }

              const currentFirstTimeline = getLinkedTimelines(
                currentThread.getUnfilteredTimelineSet().getLiveTimeline()
              )[0];
              // Persist only the fetched slice (not full currentThread.events)
              // to avoid mis-keying the pagination token to an older reply.
              persistThreadEventCache(
                threadId,
                latestEvents,
                currentThread.rootEvent,
                relData.next_batch ?? null
              );

              // Reconcile using in-memory values directly, avoiding
              // the async race from persist→read-back through IndexedDB.
              if (currentFirstTimeline) {
                const reconcileToken = computeReconciliationToken(
                  relData.next_batch ?? null,
                  latestEvents,
                  currentThread.events,
                  threadId
                );
                reconcileThreadBackwardPagination(
                  currentFirstTimeline,
                  reconcileToken,
                  setThreadHasMoreCachedBack
                );
              }
            }
          }

          const hasForwardGap = !!room
            .getThread(threadId)
            ?.getUnfilteredTimelineSet()
            .getLiveTimeline()
            .getPaginationToken(Direction.Forward);
          if (!hasForwardGap) {
            setThreadTailLoaded(true);
          }
          logTimelineDebug(threadDebugTraceId, 'thread-open-forward-gap-check', {
            hasForwardGap,
            threadId,
          });
        }

        setTimeline((ct) => ({ ...ct }));
        setThreadTimelineTick((val) => val + 1);
        logTimelineDebug(threadDebugTraceId, 'thread-open-complete', {
          shouldScrollToLatestOnOpen,
          threadId,
        });
        if (shouldScrollToLatestOnOpen) {
          pinThreadToBottomOnOpen();
        }

        // When opening a thread with a specific eventId (e.g. from search),
        // load that event's context into the thread timeline and scroll to it.
        if (!shouldScrollToLatestOnOpen && eventId && eventId !== threadId) {
          const evtThreadTimelineSet = room.getThread(threadId)?.getUnfilteredTimelineSet();
          if (evtThreadTimelineSet) {
            const [evtErr] = await to(mx.getEventTimeline(evtThreadTimelineSet, eventId));
            if (!mounted || threadIdRef.current !== threadId) return;
            if (!evtErr) {
              setTimeline((ct) => ({ ...ct }));
              setThreadTimelineTick((val) => val + 1);
            }
          }
          pendingThreadOpenRef.current = {
            threadId,
            eventId,
            highlight: true,
            onScroll: undefined,
            attempts: 0,
          };
          setPendingThreadOpenTick((val) => val + 1);
        }
      } finally {
        if (mounted && threadIdRef.current === threadId) {
          setThreadLatestOpenPending(false);
        }
      }
    };

    loadThreadTimeline();

    return () => {
      mounted = false;
      if (untargetedThreadSeedFallbackTimeout !== undefined) {
        clearTimeout(untargetedThreadSeedFallbackTimeout);
      }
    };
  }, [
    ensureThreadSeedPrewarm,
    eventId,
    hydrateThreadFromCache,
    mx,
    backfillThreadRelationsIntoCache,
    persistThreadEventCache,
    resetThreadBackPagination,
    resetThreadRenderState,
    refreshLatestThreadRelationsTail,
    refreshLatestThreadSlice,
    room,
    setSupplementalThreadEvents,
    threadDebugTraceId,
    onThreadLoadError,
    threadId,
  ]);

  useEffect(() => {
    if (threadId) return;
    setThreadLoadError(false);
    setThreadHasMoreCachedBack(false);
    setThreadInitialCacheHydrated(false);
    setThreadTailLoaded(false);
    setThreadLatestOpenPending(false);
    setThreadTimelineTick(0);
    setThreadPaginatingFront(false);
    setPendingThreadOpenTick(0);
    threadEditFetchAttemptedRef.current = new WeakMap<MatrixEvent, number>();
    pendingThreadOpenRef.current = undefined;
    resetThreadBackPagination();
    resetThreadRenderState(undefined);
  }, [resetThreadBackPagination, resetThreadRenderState, threadId]);

  // Scroll to bottom on initial timeline load
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollToBottom(scrollEl);
    }
  }, []);

  // if live timeline is linked and unreadInfo change
  // Scroll to last read message
  useLayoutEffect(() => {
    if (threadId) return;
    const { readUptoEventId, inLiveTimeline, scrollTo } = unreadInfo ?? {};
    if (readUptoEventId && inLiveTimeline && scrollTo && unreadScrollAnchorIndex !== undefined) {
      scrollToItem(unreadScrollAnchorIndex, {
        behavior: 'instant',
        align: 'start',
        stopInView: true,
      });
    }
  }, [room, unreadInfo, unreadScrollAnchorIndex, scrollToItem, threadId]);

  useEffect(() => {
    if (threadId || !focusItem?.eventId) return;

    const nextIndex = threadFilteredEventsRef.current.findIndex(
      (event) => event.getId() === focusItem.eventId
    );
    if (nextIndex === -1 || nextIndex === focusItem.index) return;

    setFocusItem((currentItem) => {
      if (
        !currentItem ||
        currentItem.eventId !== focusItem.eventId ||
        currentItem.index === nextIndex
      ) {
        return currentItem;
      }

      return {
        ...currentItem,
        index: nextIndex,
      };
    });
  }, [focusItem, threadFilteredEvents, threadId]);

  // scroll to focused message
  useLayoutEffect(() => {
    let clearFocusTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let roomFocusObserver: MutationObserver | undefined;
    let roomFocusObserverTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let roomFocusResizeCleanup: (() => void) | undefined;
    let allowObserverPaginationHandoff = true;
    const focusEventId = focusItem?.eventId;
    const focusIndex =
      !threadId && focusItem
        ? getFocusedRoomEventIndex(threadFilteredEventsRef.current, focusEventId, focusItem.index)
        : focusItem?.index ?? 0;
    const focusItemCount = threadFilteredEventsRef.current.length;
    const focusScrollToItemOptions = getRoomFocusScrollToItemOptions(focusIndex, focusItemCount);
    const focusScrollOptions = getRoomFocusScrollOptions(focusIndex, focusItemCount);

    const clearPendingRoomFocus = (resumePagination: boolean) => {
      roomFocusObserver?.disconnect();
      roomFocusObserver = undefined;

      if (roomFocusObserverTimeoutId !== undefined) {
        clearTimeout(roomFocusObserverTimeoutId);
        roomFocusObserverTimeoutId = undefined;
      }

      if (pendingRoomFocusRef.current?.eventId === focusEventId) {
        pendingRoomFocusRef.current = undefined;
      }

      suppressFocusPaginationRef.current = false;

      if (resumePagination) {
        retryPagination({
          preserveAnchorIndex: focusIndex,
        });
      }
    };

    const startRoomFocusObserver = (target: HTMLElement) => {
      const scrollContainer = scrollRef.current;
      if (!scrollContainer) {
        clearPendingRoomFocus(true);
        return;
      }

      roomFocusResizeCleanup = setupFocusObserver({
        scrollContainer,
        target,
        onRecenter: () => {
          scrollToElement(target, focusScrollOptions);
        },
        onDone: () => {
          roomFocusResizeCleanup = undefined;
          if (!allowObserverPaginationHandoff) return;
          clearPendingRoomFocus(true);
        },
        idleMs: ROOM_FOCUS_OBSERVER_IDLE_MS,
        hardMs: ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS,
      });
    };

    if (!threadId && focusItem && focusItem.scrollTo) {
      suppressFocusPaginationRef.current = true;

      scrollToItem(focusIndex, focusScrollToItemOptions);
      const target = focusEventId ? getEventElementById(scrollRef.current, focusEventId) : null;

      if (target) {
        scrollToElement(target, focusScrollOptions);
        startRoomFocusObserver(target);
      } else if (focusEventId && scrollRef.current && typeof MutationObserver !== 'undefined') {
        pendingRoomFocusRef.current = {
          eventId: focusEventId,
        };
        roomFocusObserver = new MutationObserver(() => {
          if (!alive()) {
            clearPendingRoomFocus(false);
            return;
          }

          if (pendingRoomFocusRef.current?.eventId !== focusEventId) return;

          const observedTarget = getEventElementById(scrollRef.current, focusEventId);
          if (!observedTarget) return;

          scrollToElement(observedTarget, focusScrollOptions);
          roomFocusObserver?.disconnect();
          roomFocusObserver = undefined;
          if (roomFocusObserverTimeoutId !== undefined) {
            clearTimeout(roomFocusObserverTimeoutId);
            roomFocusObserverTimeoutId = undefined;
          }
          startRoomFocusObserver(observedTarget);
        });
        roomFocusObserver.observe(scrollRef.current, {
          childList: true,
          subtree: true,
        });
        roomFocusObserverTimeoutId = setTimeout(() => {
          if (pendingRoomFocusRef.current?.eventId !== focusEventId) return;
          clearPendingRoomFocus(false);
        }, ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS);
      } else {
        pendingRoomFocusRef.current = undefined;
        suppressFocusPaginationRef.current = false;
      }
    } else {
      pendingRoomFocusRef.current = undefined;
      suppressFocusPaginationRef.current = false;
    }

    if (focusItem) {
      clearFocusTimeoutId = setTimeout(() => {
        if (!alive()) return;
        setFocusItem((currentItem) => {
          if (currentItem === focusItem) return undefined;
          return currentItem;
        });
      }, 2000);
    }

    return () => {
      allowObserverPaginationHandoff = false;
      roomFocusResizeCleanup?.();
      roomFocusResizeCleanup = undefined;
      clearPendingRoomFocus(false);
      if (clearFocusTimeoutId !== undefined) {
        clearTimeout(clearFocusTimeoutId);
      }
    };
  }, [
    alive,
    focusItem,
    retryPagination,
    scrollToElement,
    scrollToItem,
    effectiveThreadFilterState,
    threadId,
  ]);

  useLayoutEffect(() => {
    if (!threadId) return;
    if (
      !shouldPinThreadToBottomOnOpen({
        threadId,
        threadLatestOpenPending,
        threadInitialRenderMode,
        threadEventCount: threadEvents.length,
      })
    ) {
      return;
    }
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    scrollToBottom(scrollEl, 'instant');
    setAtBottom(true);
  }, [threadEvents.length, threadId, threadInitialRenderMode, threadLatestOpenPending]);

  useLayoutEffect(() => {
    if (!threadId) return;
    const pendingOpen = pendingThreadOpenRef.current;
    if (!pendingOpen) return;
    if (pendingOpen.threadId !== threadId) {
      pendingThreadOpenRef.current = undefined;
      return;
    }

    const nextItemIndex = threadEventIndexMapRef.current.get(pendingOpen.eventId);
    if (typeof nextItemIndex === 'number') {
      setFocusItem({
        eventId: pendingOpen.eventId,
        index: nextItemIndex,
        scrollTo: false,
        highlight: pendingOpen.highlight,
      });
    }
    const target = getEventElementById(scrollRef.current, pendingOpen.eventId);
    if (target) {
      scrollToElement(target, {
        behavior: 'smooth',
        align: 'center',
        stopInView: true,
      });
      if (pendingOpen.onScroll) pendingOpen.onScroll(true);
      pendingThreadOpenRef.current = undefined;
      return;
    }

    if (pendingOpen.attempts >= 2) {
      if (pendingOpen.onScroll) pendingOpen.onScroll(false);
      pendingThreadOpenRef.current = undefined;
      return;
    }

    pendingThreadOpenRef.current = {
      ...pendingOpen,
      attempts: pendingOpen.attempts + 1,
    };
    requestAnimationFrame(() => {
      if (!pendingThreadOpenRef.current) return;
      setPendingThreadOpenTick((val) => val + 1);
    });
  }, [threadId, threadTimelineTick, pendingThreadOpenTick, scrollToElement]);

  // scroll to bottom of timeline
  const scrollToBottomCount = scrollToBottomRef.current.count;
  useLayoutEffect(() => {
    if (scrollToBottomCount > 0) {
      const scrollEl = scrollRef.current;
      if (scrollEl)
        scrollToBottom(scrollEl, scrollToBottomRef.current.smooth ? 'smooth' : 'instant');
    }
  }, [scrollToBottomCount]);

  useLayoutEffect(() => {
    restorePendingThreadBackPaginationAnchor(scrollRef.current, threadId);
  }, [restorePendingThreadBackPaginationAnchor, threadEvents.length, threadId, threadTimelineTick]);

  // Remove unreadInfo on mark as read
  useEffect(() => {
    if (!unread) {
      setUnreadInfo(undefined);
    }
  }, [unread]);

  // scroll out of view msg editor in view.
  useEffect(() => {
    if (editId) {
      const editMsgElement = getEventElementById(scrollRef.current, editId) ?? undefined;
      if (editMsgElement) {
        scrollToElement(editMsgElement, {
          align: 'center',
          behavior: 'smooth',
          stopInView: true,
        });
      }
    }
  }, [scrollToElement, editId]);

  useEffect(() => {
    if (!timelineAtLiveEnd) {
      setAtBottom(false);
    } else {
      // Recovery: when timelineAtLiveEnd becomes true and the bottom anchor
      // is already visible, restore atBottom so the jump-to-latest button hides.
      const anchor = atBottomAnchorRef.current;
      const scroll = scrollRef.current;
      if (anchor && scroll && isAnchorVisibleInScroll(anchor, scroll)) {
        setAtBottom(true);
      }
    }
  }, [timelineAtLiveEnd]);

  const handleJumpToLatest = useCallback(async () => {
    if (threadId) {
      if (eventId) {
        navigateRoomThread(room.roomId, threadId, undefined, { replace: true });
      }

      const didPaginateToLatest = await refreshLatestThreadSlice(threadId);
      if (threadIdRef.current !== threadId) return;
      if (didPaginateToLatest) {
        scrollToBottomRef.current.count += 1;
        scrollToBottomRef.current.smooth = false;
        setAtBottom(true);
        return;
      }

      const scrollEl = scrollRef.current;
      if (scrollEl) {
        scrollToBottom(scrollEl, 'instant');
        setAtBottom(true);
      }
      return;
    }

    if (eventId) {
      navigateRoom(room.roomId, undefined, { replace: true });
    }
    setTimeline(
      getInitialTimeline(room, safePaginationLimit, {
        threadId,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
      })
    );
    scrollToBottomRef.current.count += 1;
    scrollToBottomRef.current.smooth = false;
  }, [
    eventId,
    navigateRoom,
    navigateRoomThread,
    refreshLatestThreadSlice,
    room,
    threadId,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    safePaginationLimit,
  ]);

  const handleJumpToUnread = () => {
    if (unreadInfo?.readUptoEventId) {
      void handleOpenEvent(unreadInfo.readUptoEventId, false);
    }
  };

  const handleMarkAsRead = () => {
    if (threadId) {
      markThreadAsRead(mx, room.roomId, threadId, hideActivity);
      return;
    }
    markRoomAndThreadsAsRead(mx, room.roomId, hideActivity);
  };

  const handleOpenReply: MouseEventHandler = useCallback(
    async (evt) => {
      const threadRootId = evt.currentTarget.getAttribute('data-thread-root-id');
      const recentThreadSummaryText =
        evt.currentTarget.getAttribute('data-thread-summary')?.trim() || undefined;
      if (threadRootId) {
        bumpRecentThread(room.roomId, threadRootId, undefined, recentThreadSummaryText);
        navigateRoomThread(room.roomId, threadRootId);
        return;
      }
      const targetId = evt.currentTarget.getAttribute('data-event-id');
      if (!targetId) return;
      handleOpenEvent(targetId);
    },
    [handleOpenEvent, navigateRoomThread, room.roomId]
  );
  const handleOpenCompactThread = useCallback(
    (threadRootId: string, recentThreadSummaryText?: string) => {
      bumpRecentThread(room.roomId, threadRootId, undefined, recentThreadSummaryText);
      navigateRoomThread(room.roomId, threadRootId);
    },
    [navigateRoomThread, room.roomId]
  );

  const handleUserClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const userId = evt.currentTarget.getAttribute('data-user-id');
      if (!userId) {
        console.warn('Button should have "data-user-id" attribute!');
        return;
      }
      openUserRoomProfile(
        room.roomId,
        space?.roomId,
        userId,
        evt.currentTarget.getBoundingClientRect()
      );
    },
    [room, space, openUserRoomProfile]
  );
  const handleUsernameClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt) => {
      evt.preventDefault();
      const userId = evt.currentTarget.getAttribute('data-user-id');
      if (!userId) {
        console.warn('Button should have "data-user-id" attribute!');
        return;
      }
      const name = getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
      editor.insertNode(
        createMentionElement(
          userId,
          name.startsWith('@') ? name : `@${name}`,
          userId === mx.getUserId()
        )
      );
      ReactEditor.focus(editor);
      moveCursor(editor);
    },
    [mx, room, editor]
  );

  const handleReplyClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt, startThread = false) => {
      const replyId = evt.currentTarget.getAttribute('data-event-id');
      if (!replyId) {
        console.warn('Button should have "data-event-id" attribute!');
        return;
      }
      const replyEvt = room.findEventById(replyId);
      if (!replyEvt) return;
      const threadRootId = replyEvt.threadRootId ?? replyId;
      const editedReply = getEditedEvent(replyId, replyEvt, room.getUnfilteredTimelineSet());
      const content: IContent = editedReply?.getContent()['m.new_content'] ?? replyEvt.getContent();
      const { body, formatted_body: formattedBody } = content;
      const { 'm.relates_to': relation } = startThread
        ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadRootId } }
        : replyEvt.getWireContent();
      const senderId = replyEvt.getSender();
      if (senderId && typeof body === 'string') {
        setReplyDraft({
          userId: senderId,
          eventId: replyId,
          body,
          formattedBody,
          relation,
        });
        if (startThread) {
          navigateRoomThread(room.roomId, threadRootId);
        }
        setTimeout(() => ReactEditor.focus(editor), 100);
      }
    },
    [room, setReplyDraft, editor, navigateRoomThread]
  );

  const handleReactionToggle = useCallback(
    (targetEventId: string, key: string, shortcode?: string, currentRelations?: Relations) => {
      const reactionRelations =
        currentRelations ?? getEventReactions(room.getUnfilteredTimelineSet(), targetEventId);
      const reactions = getActiveEventsForAnnotationKey(reactionRelations, key);
      const myReaction = reactions.find(factoryEventSentBy(mx.getUserId()!));

      if (myReaction && !!myReaction?.isRelation()) {
        mx.redactEvent(room.roomId, myReaction.getId()!);
        return;
      }
      const rShortcode =
        shortcode ||
        (reactions.find(eventWithShortcode)?.getContent().shortcode as string | undefined);
      mx.sendEvent(
        room.roomId,
        MessageEvent.Reaction as any,
        getReactionContent(targetEventId, key, rShortcode)
      );
    },
    [mx, room]
  );
  const handleEdit = useCallback(
    (editEvtId?: string) => {
      if (editEvtId) {
        setEditId(editEvtId);
        return;
      }
      setEditId(undefined);
      ReactEditor.focus(editor);
    },
    [editor]
  );
  const { t } = useTranslation();

  const activeThreadSummaryInfo = useMemo(
    () =>
      threadId
        ? getLatestThreadSummaryInfoFromEventSources(threadEvents, thread?.events, thread?.timeline)
        : undefined,
    [thread?.events, thread?.timeline, threadEvents, threadId]
  );

  // Write-through: persist newly discovered summaries to IndexedDB
  useEffect(() => {
    if (threadId) return;
    threadSummaryInfoMap.forEach((info, threadRootId) => {
      onStoreThreadSummary(threadRootId, info);
    });
  }, [onStoreThreadSummary, threadId, threadSummaryInfoMap]);

  useEffect(() => {
    if (!threadId) return;
    onStoreThreadSummary(threadId, activeThreadSummaryInfo);
  }, [activeThreadSummaryInfo, onStoreThreadSummary, threadId]);

  const visibleThreadSummaryRefreshIds = useMemo(() => {
    if (threadId) return [] as string[];

    return threadFilteredEventEntries
      .slice(activeTimelineRange.start, activeTimelineRange.end)
      .map((entry) => entry.event)
      .filter((event) =>
        isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)
      )
      .map((event) => event.getId())
      .filter((eventId): eventId is string => !!eventId);
  }, [
    activeTimelineRange.end,
    activeTimelineRange.start,
    room,
    threadId,
    threadFilteredEventEntries,
    threadReplyCountMap,
    threadResolutionMap,
  ]);

  const overviewResumeRefreshIds = useMemo(() => {
    if (threadId) return [] as string[];

    const nextIds = new Set<string>();
    visibleThreadSummaryRefreshIds.forEach((rootId) => {
      nextIds.add(rootId);
    });
    (showCompactRoomView ? compactFilteredThreadRootIds : filteredThreadRootIds)
      .slice(0, OVERVIEW_THREAD_METADATA_CACHE_LIMIT)
      .forEach((rootId) => {
        nextIds.add(rootId);
      });

    return [...nextIds].slice(0, OVERVIEW_THREAD_METADATA_CACHE_LIMIT);
  }, [
    compactFilteredThreadRootIds,
    filteredThreadRootIds,
    showCompactRoomView,
    threadId,
    visibleThreadSummaryRefreshIds,
  ]);

  useThreadOverviewResumeController({
    alive,
    compactViewRequested,
    debugTraceId: roomDebugTraceId,
    mx,
    onStoreThreadSummary,
    persistThreadEventCache,
    refreshCompactThreadList: refreshRoomThreadList,
    room,
    setOverviewRefreshCounter,
    setSupplementalThreadEvents,
    targetThreadIds: overviewResumeRefreshIds,
    threadId,
    threadIdRef,
  });

  const getTimelineThreadBadgeModel = (
    mEventId: string,
    mEvent: MatrixEvent
  ): ThreadBadgeViewModel | undefined => {
    const record = threadRecordMap.get(mEventId);
    if (!record) return undefined;

    return buildThreadBadgeViewModelFromRecord({
      record,
      activeThreadId: threadId,
      eventThreadRootId: mEvent.threadRootId,
    });
  };

  const renderMatrixEvent = useMatrixEventRenderer<
    [string, MatrixEvent, number, EventTimelineSet, boolean]
  >(
    {
      [MessageEvent.RoomMessage]: (mEventId, mEvent, item, timelineSet, collapse) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const hasReactions = getActiveAnnotationsByKey(reactionRelations).length > 0;
        const { replyEventId, threadRootId } = mEvent;
        const highlighted = focusItem?.index === item && focusItem.highlight;

        const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
        const resolvedContent = getLatestMessageContent(mEvent, editedEvent);
        const getContent = (() => resolvedContent) as GetContentCallback;
        const collapseMode = getCollapsibleMessageMode(
          mEventId,
          resolvedContent,
          liveExpandOnceIds.current
        );
        const onInitialExpandConsumed =
          collapseMode === 'initially-expanded'
            ? () => {
                consumeLiveExpandOnceId(liveExpandOnceIds.current, mEventId);
              }
            : undefined;

        const senderId = mEvent.getSender() ?? '';
        const senderDisplayName =
          getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
        const threadBadgeModel = getTimelineThreadBadgeModel(mEventId, mEvent);
        const threadSummary = threadBadgeModel ? (
          <ThreadBadgeRenderer
            model={threadBadgeModel}
            room={room}
            onClick={handleOpenReply}
            includeRecentSummaryData
          />
        ) : null;

        return (
          <Message
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            resolvedMessageContent={resolvedContent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            highlight={highlighted}
            edit={editId === mEventId}
            canDelete={canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())}
            canSendReaction={canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUsernameClick}
            onReplyClick={handleReplyClick}
            onReactionToggle={handleReactionToggle}
            onEditId={handleEdit}
            reply={
              !(
                threadId &&
                replyEventId &&
                (replyEventId === prevEvent?.getId() || replyEventId === threadId)
              ) &&
              replyEventId && (
                <Reply
                  room={room}
                  timelineSet={timelineSet}
                  replyEventId={replyEventId}
                  threadRootId={threadRootId}
                  getLocally={threadId ? () => threadEventMap.get(replyEventId) : undefined}
                  hideThreadIndicator={!!threadId}
                  onClick={handleOpenReply}
                  getMemberPowerTag={getMemberPowerTag}
                  accessibleTagColors={accessiblePowerTagColors}
                  legacyUsernameColor={legacyUsernameColor || direct}
                />
              )
            }
            reactions={
              (threadSummary || reactionRelations) && (
                <>
                  {threadSummary}
                  {reactionRelations && (
                    <Reactions
                      style={{ marginTop: config.space.S200 }}
                      room={room}
                      relations={reactionRelations}
                      mEventId={mEventId}
                      canSendReaction={canSendReaction}
                      onReactionToggle={handleReactionToggle}
                    />
                  )}
                </>
              )
            }
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
            memberPowerTag={getMemberPowerTag(senderId)}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            {(() => {
              if (mEvent.isRedacted()) {
                return (
                  <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
                );
              }
              const msgType = mEvent.getContent().msgtype;
              const isVisualMedia = msgType === MsgType.Image || msgType === MsgType.Video;
              const content = (
                <RenderMessageContent
                  displayName={senderDisplayName}
                  eventType={mEvent.getType()}
                  msgType={msgType ?? ''}
                  ts={mEvent.getTs()}
                  edited={!!editedEvent}
                  getContent={getContent}
                  mediaAutoLoad={mediaAutoLoad}
                  urlPreview={showUrlPreview}
                  htmlReactParserOptions={htmlReactParserOptions}
                  linkifyOpts={linkifyOpts}
                  outlineAttachment={messageLayout === MessageLayout.Bubble}
                />
              );
              const measurementKey = getCollapsibleMessageMeasurementKey(
                mEvent,
                collapseMode,
                editedEvent
              );
              if (isVisualMedia) return content;
              return (
                <CollapsibleMessage
                  collapseMode={collapseMode}
                  measurementKey={measurementKey}
                  onInitialExpandConsumed={onInitialExpandConsumed}
                >
                  {content}
                </CollapsibleMessage>
              );
            })()}
          </Message>
        );
      },
      [MINDROOM_TOOL_APPROVAL_EVENT]: (mEventId, mEvent, item, timelineSet, collapse) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const hasReactions = getActiveAnnotationsByKey(reactionRelations).length > 0;
        const { replyEventId, threadRootId } = mEvent;
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
        const originalContent = mEvent.getContent() as Record<string, unknown>;
        const approvalContent = getToolApprovalRenderContent(
          originalContent,
          editedEvent?.getContent() as Record<string, unknown> | undefined
        );
        const getContent = (() => approvalContent) as GetContentCallback;
        const senderId = mEvent.getSender() ?? '';
        const senderDisplayName =
          getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
        const threadBadgeModel = getTimelineThreadBadgeModel(mEventId, mEvent);
        const threadSummary = threadBadgeModel ? (
          <ThreadBadgeRenderer model={threadBadgeModel} room={room} onClick={handleOpenReply} />
        ) : null;

        return (
          <Message
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            resolvedMessageContent={approvalContent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            highlight={highlighted}
            canDelete={canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())}
            canSendReaction={canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUsernameClick}
            onReplyClick={handleReplyClick}
            onReactionToggle={handleReactionToggle}
            reply={
              !(
                threadId &&
                replyEventId &&
                (replyEventId === prevEvent?.getId() || replyEventId === threadId)
              ) &&
              replyEventId && (
                <Reply
                  room={room}
                  timelineSet={timelineSet}
                  replyEventId={replyEventId}
                  threadRootId={threadRootId}
                  getLocally={threadId ? () => threadEventMap.get(replyEventId) : undefined}
                  hideThreadIndicator={!!threadId}
                  onClick={handleOpenReply}
                  getMemberPowerTag={getMemberPowerTag}
                  accessibleTagColors={accessiblePowerTagColors}
                  legacyUsernameColor={legacyUsernameColor || direct}
                />
              )
            }
            reactions={
              (threadSummary || reactionRelations) && (
                <>
                  {threadSummary}
                  {reactionRelations && (
                    <Reactions
                      style={{ marginTop: config.space.S200 }}
                      room={room}
                      relations={reactionRelations}
                      mEventId={mEventId}
                      canSendReaction={canSendReaction}
                      onReactionToggle={handleReactionToggle}
                    />
                  )}
                </>
              )
            }
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
            memberPowerTag={getMemberPowerTag(senderId)}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            {mEvent.isRedacted() ? (
              <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
            ) : (
              <RenderMessageContent
                displayName={senderDisplayName}
                eventType={mEvent.getType()}
                roomId={room.roomId}
                eventId={mEventId}
                threadId={mEvent.threadRootId ?? threadId}
                msgType={typeof approvalContent.msgtype === 'string' ? approvalContent.msgtype : ''}
                ts={mEvent.getTs()}
                edited={!!editedEvent}
                getContent={getContent}
                mediaAutoLoad={mediaAutoLoad}
                urlPreview={showUrlPreview}
                htmlReactParserOptions={htmlReactParserOptions}
                linkifyOpts={linkifyOpts}
                outlineAttachment={messageLayout === MessageLayout.Bubble}
              />
            )}
          </Message>
        );
      },
      [MessageEvent.RoomMessageEncrypted]: (mEventId, mEvent, item, timelineSet, collapse) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const hasReactions = getActiveAnnotationsByKey(reactionRelations).length > 0;
        const { replyEventId, threadRootId } = mEvent;
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
        const resolvedContent = getLatestMessageContent(mEvent, editedEvent);
        const threadBadgeModel = getTimelineThreadBadgeModel(mEventId, mEvent);
        const threadSummary = threadBadgeModel ? (
          <ThreadBadgeRenderer model={threadBadgeModel} room={room} onClick={handleOpenReply} />
        ) : null;

        return (
          <Message
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            resolvedMessageContent={resolvedContent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            highlight={highlighted}
            edit={editId === mEventId}
            canDelete={canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())}
            canSendReaction={canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUsernameClick}
            onReplyClick={handleReplyClick}
            onReactionToggle={handleReactionToggle}
            onEditId={handleEdit}
            reply={
              !(
                threadId &&
                replyEventId &&
                (replyEventId === prevEvent?.getId() || replyEventId === threadId)
              ) &&
              replyEventId && (
                <Reply
                  room={room}
                  timelineSet={timelineSet}
                  replyEventId={replyEventId}
                  threadRootId={threadRootId}
                  getLocally={threadId ? () => threadEventMap.get(replyEventId) : undefined}
                  hideThreadIndicator={!!threadId}
                  onClick={handleOpenReply}
                  getMemberPowerTag={getMemberPowerTag}
                  accessibleTagColors={accessiblePowerTagColors}
                  legacyUsernameColor={legacyUsernameColor || direct}
                />
              )
            }
            reactions={
              (threadSummary || reactionRelations) && (
                <>
                  {threadSummary}
                  {reactionRelations && (
                    <Reactions
                      style={{ marginTop: config.space.S200 }}
                      room={room}
                      relations={reactionRelations}
                      mEventId={mEventId}
                      canSendReaction={canSendReaction}
                      onReactionToggle={handleReactionToggle}
                    />
                  )}
                </>
              )
            }
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
            memberPowerTag={getMemberPowerTag(mEvent.getSender() ?? '')}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            <EncryptedContent mEvent={mEvent}>
              {() => {
                if (mEvent.isRedacted()) return <RedactedContent />;
                if (mEvent.getType() === MessageEvent.Sticker)
                  return (
                    <MSticker
                      content={mEvent.getContent()}
                      renderImageContent={(props) => (
                        <ImageContent
                          {...props}
                          autoPlay={mediaAutoLoad}
                          renderImage={(p) => <Image {...p} loading="lazy" />}
                          renderViewer={(p) => <ImageViewer {...p} />}
                        />
                      )}
                    />
                  );
                if (mEvent.getType() === MINDROOM_TOOL_APPROVAL_EVENT) {
                  const originalContent = mEvent.getContent() as Record<string, unknown>;
                  const approvalContent = getToolApprovalRenderContent(
                    originalContent,
                    editedEvent?.getContent() as Record<string, unknown> | undefined
                  );
                  const getContent = (() => approvalContent) as GetContentCallback;
                  const senderId = mEvent.getSender() ?? '';
                  const senderDisplayName =
                    getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;

                  return (
                    <RenderMessageContent
                      displayName={senderDisplayName}
                      eventType={mEvent.getType()}
                      roomId={room.roomId}
                      eventId={mEventId}
                      threadId={mEvent.threadRootId ?? threadId}
                      msgType={
                        typeof approvalContent.msgtype === 'string' ? approvalContent.msgtype : ''
                      }
                      ts={mEvent.getTs()}
                      edited={!!editedEvent}
                      getContent={getContent}
                      mediaAutoLoad={mediaAutoLoad}
                      urlPreview={showUrlPreview}
                      htmlReactParserOptions={htmlReactParserOptions}
                      linkifyOpts={linkifyOpts}
                      outlineAttachment={messageLayout === MessageLayout.Bubble}
                    />
                  );
                }
                if (mEvent.getType() === MessageEvent.RoomMessage) {
                  const getContent = (() => resolvedContent) as GetContentCallback;
                  const collapseMode = getCollapsibleMessageMode(
                    mEventId,
                    resolvedContent,
                    liveExpandOnceIds.current
                  );
                  const measurementKey = getCollapsibleMessageMeasurementKey(
                    mEvent,
                    collapseMode,
                    editedEvent
                  );
                  const onInitialExpandConsumed =
                    collapseMode === 'initially-expanded'
                      ? () => {
                          consumeLiveExpandOnceId(liveExpandOnceIds.current, mEventId);
                        }
                      : undefined;

                  const senderId = mEvent.getSender() ?? '';
                  const senderDisplayName =
                    getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
                  const messageContent = (
                    <RenderMessageContent
                      displayName={senderDisplayName}
                      eventType={mEvent.getType()}
                      msgType={mEvent.getContent().msgtype ?? ''}
                      ts={mEvent.getTs()}
                      edited={!!editedEvent}
                      getContent={getContent}
                      mediaAutoLoad={mediaAutoLoad}
                      urlPreview={showUrlPreview}
                      htmlReactParserOptions={htmlReactParserOptions}
                      linkifyOpts={linkifyOpts}
                      outlineAttachment={messageLayout === MessageLayout.Bubble}
                    />
                  );

                  const encMsgType = mEvent.getContent().msgtype;
                  const isEncVisualMedia =
                    encMsgType === MsgType.Image || encMsgType === MsgType.Video;
                  if (isEncVisualMedia) return messageContent;
                  return (
                    <CollapsibleMessage
                      collapseMode={collapseMode}
                      measurementKey={measurementKey}
                      onInitialExpandConsumed={onInitialExpandConsumed}
                    >
                      {messageContent}
                    </CollapsibleMessage>
                  );
                }
                if (mEvent.getType() === MessageEvent.RoomMessageEncrypted)
                  return (
                    <Text>
                      <MessageNotDecryptedContent />
                    </Text>
                  );
                return (
                  <Text>
                    <MessageUnsupportedContent />
                  </Text>
                );
              }}
            </EncryptedContent>
          </Message>
        );
      },
      [MessageEvent.Sticker]: (mEventId, mEvent, item, timelineSet, collapse) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const hasReactions = getActiveAnnotationsByKey(reactionRelations).length > 0;
        const highlighted = focusItem?.index === item && focusItem.highlight;

        return (
          <Message
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            highlight={highlighted}
            canDelete={canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())}
            canSendReaction={canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUsernameClick}
            onReplyClick={handleReplyClick}
            onReactionToggle={handleReactionToggle}
            reactions={
              reactionRelations && (
                <Reactions
                  style={{ marginTop: config.space.S200 }}
                  room={room}
                  relations={reactionRelations}
                  mEventId={mEventId}
                  canSendReaction={canSendReaction}
                  onReactionToggle={handleReactionToggle}
                />
              )
            }
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
            memberPowerTag={getMemberPowerTag(mEvent.getSender() ?? '')}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            {mEvent.isRedacted() ? (
              <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
            ) : (
              <MSticker
                content={mEvent.getContent()}
                renderImageContent={(props) => (
                  <ImageContent
                    {...props}
                    autoPlay={mediaAutoLoad}
                    renderImage={(p) => <Image {...p} loading="lazy" />}
                    renderViewer={(p) => <ImageViewer {...p} />}
                  />
                )}
              />
            )}
          </Message>
        );
      },
      [StateEvent.RoomMember]: (mEventId, mEvent, item) => {
        const membershipChanged = isMembershipChanged(mEvent);
        if (membershipChanged && hideMembershipEvents) return null;
        if (!membershipChanged && hideNickAvatarEvents) return null;

        const highlighted = focusItem?.index === item && focusItem.highlight;
        const parsed = parseMemberEvent(mEvent);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={parsed.icon}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    {parsed.body}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomName]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={Icons.Hash}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {t('Organisms.RoomCommon.changed_room_name')}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomTopic]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={Icons.Hash}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {' changed room topic'}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomAvatar]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={Icons.Hash}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {' changed room avatar'}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.GroupCallMemberPrefix]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const content = mEvent.getContent<SessionMembershipData>();
        const prevContent = mEvent.getPrevContent();

        const callJoined = content.application;
        if (callJoined && 'application' in prevContent) {
          return null;
        }

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={callJoined ? Icons.Phone : Icons.PhoneDown}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {callJoined ? ' joined the call' : ' ended the call'}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
    },
    (mEventId, mEvent, item) => {
      if (!showHiddenEvents) return null;
      const highlighted = focusItem?.index === item && focusItem.highlight;
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={mEvent.getId()}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
          hideReadReceipts={hideActivity}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={Icons.Code}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <b>{senderName}</b>
                  {' sent '}
                  <code className={customHtmlCss.Code}>{mEvent.getType()}</code>
                  {' state event'}
                </Text>
              </Box>
            }
          />
        </Event>
      );
    },
    (mEventId, mEvent, item) => {
      if (!showHiddenEvents) return null;
      if (Object.keys(mEvent.getContent()).length === 0) return null;
      if (mEvent.getRelation()) return null;
      if (mEvent.isRedaction()) return null;

      const highlighted = focusItem?.index === item && focusItem.highlight;
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={mEvent.getId()}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
          hideReadReceipts={hideActivity}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={Icons.Code}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <b>{senderName}</b>
                  {' sent '}
                  <code className={customHtmlCss.Code}>{mEvent.getType()}</code>
                  {' event'}
                </Text>
              </Box>
            }
          />
        </Event>
      );
    }
  );
  const timelineItems = getItems();

  useThreadEditBackfillController({
    atLiveEndRef,
    eventId,
    forceTimelineUpdate,
    mx,
    persistThreadEventCache,
    room,
    scrollRef,
    scrollToBottomRef,
    setThreadTimelineTick,
    threadEditFetchAttemptedRef,
    threadEvents,
    threadId,
    threadIdRef,
    threadTailLoaded,
  });

  const { handleThreadPaginateBack, handleThreadPaginateFront } =
    useThreadPaginationCommandController({
      beginThreadBackPagination,
      finishThreadBackPagination,
      forceTimelineUpdate,
      mx,
      persistThreadEventCache,
      room,
      scrollRef,
      sessionId,
      setSupplementalThreadEvents,
      setThreadHasMoreCachedBack,
      setThreadLatestOpenPending,
      setThreadPaginatingFront,
      setThreadTailLoaded,
      setThreadTimelineTick,
      thread,
      threadEvents,
      threadId,
      threadIdRef,
    });

  let prevEvent: MatrixEvent | undefined;
  let prevRenderedEventAbsoluteIndex: number | undefined;
  let isPrevRendered = false;
  let newDivider = false;
  let dayDivider = false;
  const renderResolvedEvent = (
    mEvent: MatrixEvent,
    item: number,
    timelineSet: EventTimelineSet,
    eventAbsoluteIndex?: number
  ) => {
    const mEventId = mEvent?.getId();

    if (!mEvent || !mEventId) return null;

    const eventSender = mEvent.getSender();
    if (eventSender && ignoredUsersSet.has(eventSender)) {
      return null;
    }
    if (!threadId && mEvent.threadRootId && mEvent.threadRootId !== mEventId) {
      return null;
    }
    if (mEvent.isRedacted() && !showHiddenEvents) {
      return null;
    }

    // Suppress dividers when overview is active — chronological constructs don't apply
    if (!roomThreadFilterActive) {
      if (!newDivider) {
        newDivider = shouldRenderUnreadDividerAt({
          readUptoAbsoluteIndex,
          eventAbsoluteIndex,
          prevRenderedEventAbsoluteIndex,
        });
      }
      if (!dayDivider) {
        dayDivider = prevEvent ? !inSameDay(prevEvent.getTs(), mEvent.getTs()) : false;
      }
    }

    const collapsed =
      isPrevRendered &&
      !dayDivider &&
      (!newDivider || eventSender === mx.getUserId()) &&
      prevEvent !== undefined &&
      prevEvent.getSender() === eventSender &&
      prevEvent.getType() === mEvent.getType() &&
      minuteDifference(prevEvent.getTs(), mEvent.getTs()) < 2;

    const eventJSX = reactionOrEditEvent(mEvent)
      ? null
      : renderMatrixEvent(
          mEvent.getType(),
          typeof mEvent.getStateKey() === 'string',
          mEventId,
          mEvent,
          item,
          timelineSet,
          collapsed
        );
    prevEvent = mEvent;
    isPrevRendered = !!eventJSX;
    if (eventJSX) {
      prevRenderedEventAbsoluteIndex = eventAbsoluteIndex;
    }

    const newDividerJSX =
      newDivider && eventJSX && eventSender !== mx.getUserId() ? (
        <MessageBase space={messageSpacing}>
          <TimelineDivider style={{ color: color.Success.Main }} variant="Inherit">
            <Badge as="span" size="500" variant="Success" fill="Solid" radii="300">
              <Text size="L400">New Messages</Text>
            </Badge>
          </TimelineDivider>
        </MessageBase>
      ) : null;

    const dayDividerJSX =
      dayDivider && eventJSX ? (
        <MessageBase space={messageSpacing}>
          <TimelineDivider variant="Surface">
            <Badge as="span" size="500" variant="Secondary" fill="None" radii="300">
              <Text size="L400">
                {(() => {
                  if (today(mEvent.getTs())) return 'Today';
                  if (yesterday(mEvent.getTs())) return 'Yesterday';
                  return timeDayMonthYear(mEvent.getTs());
                })()}
              </Text>
            </Badge>
          </TimelineDivider>
        </MessageBase>
      ) : null;

    if (eventJSX && (newDividerJSX || dayDividerJSX)) {
      if (newDividerJSX) newDivider = false;
      if (dayDividerJSX) dayDivider = false;

      return (
        <React.Fragment key={mEventId}>
          {newDividerJSX}
          {dayDividerJSX}
          {eventJSX}
        </React.Fragment>
      );
    }

    return eventJSX;
  };

  const eventRenderer = (item: number) => {
    const eventEntry = threadFilteredEventEntries[item];
    const mEvent = eventEntry?.event;
    if (!mEvent) return null;
    const mEventId = mEvent.getId();
    if (!mEventId) return null;
    const evtTimeline = room.getUnfilteredTimelineSet().getTimelineForEvent(mEventId);
    const timelineSet = evtTimeline?.getTimelineSet() ?? room.getUnfilteredTimelineSet();

    return renderResolvedEvent(mEvent, item, timelineSet, eventEntry.absoluteIndex);
  };

  return (
    <Box grow="Yes" direction="Column">
      {shouldShowRoomThreadOverviewControls && (
        <RoomThreadOverview
          threadCount={
            showCompactRoomView ? compactFilteredThreadRootIds.length : filteredThreadRootIds.length
          }
          totalThreadCount={
            showCompactRoomView
              ? compactThreadRootData.ids.length
              : visibleThreadRootData.ids.length
          }
          statusCounts={statusCounts}
          tagCounts={tagCounts}
          state={liveThreadFilterState}
          availableTags={availableRoomTags}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          isThreadSortFrozen={threadSortFreezeState !== null}
          onToggle={onToggle}
          onSortDirectionChange={onSortDirectionChange}
          onToggleThreadSortFreeze={onToggleThreadSortFreeze}
          onReset={onReset}
          onCycleTag={onCycleTag}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onApplyPreset={onApplyPreset}
          onSearchQueryChange={onSearchQueryChange}
        />
      )}
      <Box grow="Yes" style={{ position: 'relative' }}>
        {showCompactRoomView ? (
          <CompactRoomView
            room={room}
            threadRootIds={overviewThreadRootIds}
            threadRecordMap={threadRecordMap}
            onThreadClick={handleOpenCompactThread}
          />
        ) : (
          <>
            {!threadId && unreadInfo?.readUptoEventId && !unreadInfo?.inLiveTimeline && (
              <TimelineFloat position="Top">
                <Chip
                  variant="Primary"
                  radii="Pill"
                  outlined
                  before={<Icon size="50" src={Icons.MessageUnread} />}
                  onClick={handleJumpToUnread}
                >
                  <Text size="L400">Jump to Unread</Text>
                </Chip>

                <Chip
                  variant="SurfaceVariant"
                  radii="Pill"
                  outlined
                  before={<Icon size="50" src={Icons.CheckTwice} />}
                  onClick={handleMarkAsRead}
                >
                  <Text size="L400">Mark as Read</Text>
                </Chip>
              </TimelineFloat>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                if (allExpanded) {
                  collapseAllMessages();
                  setAllExpanded(false);
                } else {
                  expandAllMessages();
                  setAllExpanded(true);
                }
              }}
              style={{
                position: 'absolute',
                top: config.space.S200,
                right: config.space.S400,
                zIndex: 2,
                color: color.Primary.Main,
                cursor: 'pointer',
                fontSize: '0.75rem',
                fontFamily: 'monospace',
                opacity: 0.7,
                background: 'none',
                border: 'none',
                padding: 0,
              }}
            >
              {allExpanded ? '[-all]' : '[+all]'}
            </button>
            <Scroll ref={scrollRef} visibility="Hover" style={{ overflowAnchor: 'auto' }}>
              <Box
                direction="Column"
                justifyContent="End"
                style={{
                  minHeight: '100%',
                  padding: `${config.space.S600} 0`,
                  position: 'relative',
                }}
              >
                {threadId && (
                  <Box
                    style={{
                      position: 'absolute',
                      top: config.space.S600,
                      bottom: config.space.S600,
                      left: messageLayout === MessageLayout.Compact ? toRem(5) : toRem(7),
                      width: config.borderWidth.B300,
                      backgroundColor: color.Warning.ContainerLine,
                      opacity: 0.7,
                      pointerEvents: 'none',
                    }}
                  />
                )}
                {!threadId &&
                  !roomHasMoreCachedBack &&
                  !canPaginateBack &&
                  rangeAtStart &&
                  timelineItems.length > 0 && (
                    <div
                      style={{
                        padding: `${config.space.S700} ${config.space.S400} ${config.space.S600} ${
                          messageLayout === MessageLayout.Compact ? config.space.S400 : toRem(64)
                        }`,
                      }}
                    >
                      <RoomIntro room={room} />
                    </div>
                  )}
                {threadId && threadLoadError && (
                  <MessageBase space={messageSpacing}>
                    <TimelineDivider variant="Surface">
                      <Badge as="span" size="500" variant="Critical" fill="None" radii="300">
                        <Text size="L400">Failed to load this thread.</Text>
                      </Badge>
                    </TimelineDivider>
                  </MessageBase>
                )}
                {threadId && showThreadLoadOlderMessages && (
                  <MessageBase space={messageSpacing}>
                    <TimelineDivider variant="Surface">
                      <Chip
                        variant="SurfaceVariant"
                        radii="Pill"
                        outlined
                        before={<Icon size="50" src={Icons.ArrowTop} />}
                        onClick={handleThreadPaginateBack}
                      >
                        <Text size="L400">
                          {threadPaginatingBack ? 'Loading...' : 'Load Older Messages'}
                        </Text>
                      </Chip>
                    </TimelineDivider>
                  </MessageBase>
                )}
                {threadId &&
                  threadInitialRenderMode === 'loading' &&
                  !threadLoadError &&
                  (messageLayout === MessageLayout.Compact ? (
                    <>
                      <MessageBase>
                        <CompactPlaceholder />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder />
                      </MessageBase>
                    </>
                  ) : (
                    <>
                      <MessageBase>
                        <DefaultPlaceholder />
                      </MessageBase>
                      <MessageBase>
                        <DefaultPlaceholder />
                      </MessageBase>
                    </>
                  ))}
                {!threadId &&
                  !eagerPreloading &&
                  (roomHasMoreCachedBack || canPaginateBack || !rangeAtStart) &&
                  (messageLayout === MessageLayout.Compact ? (
                    <>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase ref={observeBackAnchor}>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                    </>
                  ) : (
                    <>
                      <MessageBase>
                        <DefaultPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <DefaultPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase ref={observeBackAnchor}>
                        <DefaultPlaceholder key={timelineItems.length} />
                      </MessageBase>
                    </>
                  ))}

                {threadId
                  ? threadEvents.map((mEvent, index) => {
                      const eventId = mEvent.getId();
                      if (!eventId) return null;
                      const threadTimeline = threadTimelineSet?.getTimelineForEvent(eventId);
                      const roomTimeline = roomTimelineSet.getTimelineForEvent(eventId);
                      const timelineSet =
                        threadTimeline?.getTimelineSet() ??
                        roomTimeline?.getTimelineSet() ??
                        threadTimelineSet ??
                        roomTimelineSet;
                      return renderResolvedEvent(mEvent, index, timelineSet);
                    })
                  : timelineItems.map(eventRenderer)}
                {threadId && canPaginateThreadFront && (
                  <MessageBase space={messageSpacing}>
                    <TimelineDivider variant="Surface">
                      <Chip
                        variant="SurfaceVariant"
                        radii="Pill"
                        outlined
                        before={<Icon size="50" src={Icons.ArrowBottom} />}
                        onClick={handleThreadPaginateFront}
                      >
                        <Text size="L400">
                          {threadPaginatingFront ? 'Loading...' : 'Load Newer Messages'}
                        </Text>
                      </Chip>
                    </TimelineDivider>
                  </MessageBase>
                )}

                {!threadId &&
                  (!liveTimelineLinked || !rangeAtEnd) &&
                  (messageLayout === MessageLayout.Compact ? (
                    <>
                      <MessageBase ref={observeFrontAnchor}>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <CompactPlaceholder key={timelineItems.length} />
                      </MessageBase>
                    </>
                  ) : (
                    <>
                      <MessageBase ref={observeFrontAnchor}>
                        <DefaultPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <DefaultPlaceholder key={timelineItems.length} />
                      </MessageBase>
                      <MessageBase>
                        <DefaultPlaceholder key={timelineItems.length} />
                      </MessageBase>
                    </>
                  ))}
                <span ref={atBottomAnchorRef} />
              </Box>
            </Scroll>
            {!atBottom && (
              <TimelineFloat position="Bottom">
                <Chip
                  variant="SurfaceVariant"
                  radii="Pill"
                  outlined
                  before={<Icon size="50" src={Icons.ArrowBottom} />}
                  onClick={handleJumpToLatest}
                >
                  <Text size="L400">Jump to Latest</Text>
                </Chip>
              </TimelineFloat>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
