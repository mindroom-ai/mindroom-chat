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
  IContent,
  MatrixEvent,
  Room,
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
import { useVirtualPaginator } from '../../hooks/useVirtualPaginator';
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
  buildVisibleThreadReplyCountMap,
  eventBelongsToThread,
} from '../../mindroom/threads/threadUtils';
import { MindroomThreadSummaryInfo } from '../../components/message/mindroomThreadSummary';
import {
  consumeLiveExpandOnceId,
  getCollapsibleMessageMeasurementKey,
  getCollapsibleMessageMode,
} from '../../mindroom/threads/threadCollapsibleMessages';
import {
  buildResolveConfirmedEventId,
  dedupeThreadRenderEventEntries,
  shouldPinThreadToBottomOnOpen,
} from '../../mindroom/threads/threadRenderUtils';
import { useThreadRenderState } from '../../mindroom/threads/useThreadRenderState';
import { logTimelineDebug } from '../../mindroom/threads/timelineDebug';
import {
  useTimelineDebugRangeController,
  useTimelineDebugTraceIds,
} from '../../mindroom/threads/timelineDebugController';
import { shouldUseSurfacePreloadTarget } from '../../mindroom/threads/roomPreloadTarget';
import { CompactRoomView } from '../../mindroom/threads/CompactRoomView';
import { RoomThreadOverview } from '../../mindroom/threads/RoomThreadOverview';
import {
  getRenderableEventEntries,
  type TimelineEventEntry,
} from '../../mindroom/threads/roomTimelineEvents';
import {
  getEventTimeline,
  getFirstLinkedTimeline,
  getLinkedTimelines,
  getLinkedTimelinesEventAbsoluteIndex,
  getActiveTimelineRange,
  getEmptyTimeline,
  getFocusedRoomEventIndex,
  getInitialTimeline,
  getLiveTimeline,
  getRoomUnreadInfo,
  getTimelinesEventsCount,
  type RecalibrateFilterOpts,
  type Timeline,
} from '../../mindroom/threads/timelinePagination';
import {
  useEventTimelineLoader,
  useTimelinePagination,
} from '../../mindroom/threads/timelinePaginationController';
import { useThreadSummaryPublishController } from '../../mindroom/threads/threadSummaryPublishController';
import { useThreadOverviewRefreshCounter } from '../../mindroom/threads/threadOverviewRefreshCounter';
import { useThreadSortFreezeController } from '../../mindroom/threads/threadSortFreezeController';
import { buildThreadBadgeViewModelFromRecord } from '../../mindroom/threads/threadBadgeViewModel';
import { ThreadBadgeRenderer } from '../../mindroom/threads/ThreadBadgeRenderer';
import {
  getRoomEventFocusTarget,
  getThreadFilteredEvents,
  resolveOrderedRoomOverviewEvents,
} from '../../mindroom/threads/threadRoomFocus';
import { useMindroomThreadIndex } from '../../mindroom/threads/useMindroomThreadIndex';
import type { ThreadBadgeViewModel } from '../../mindroom/threads/types';
import type { ThreadFilterKey } from '../../mindroom/threads/RoomThreadOverview';
import {
  type ThreadFilterState,
  type ThreadSortFreezeState,
  type FilterPreset,
} from '../../mindroom/threads/roomThreadOverviewModel';
import {
  applyParsedThreadFilterQuery,
  parseThreadFilterQuery,
} from '../../mindroom/threads/threadFilterDsl';
import { resolveRoomEventThreadRedirect } from '../../mindroom/threads/roomDeepLink';
import type { RoomViewMode } from '../../state/room/roomViewMode';
import {
  getEventElementById,
  getEventEntryIndex,
  getRoomFocusScrollOptions,
  getRoomFocusScrollToItemOptions,
  getNextRenderableEntryIndex,
  getTimelineTargetAnchor,
  getUnreadTargetAnchor,
  isAnchorVisibleInScroll,
  isTimelineAtLiveEnd,
  ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS,
  ROOM_FOCUS_OBSERVER_IDLE_MS,
  setupFocusObserver,
  shouldRenderUnreadDividerAt,
} from '../../mindroom/threads/timelineScrollUtils';
import { useRoomThreadResolutionMap } from '../../mindroom/threads/useRoomThreadTags';
import { useRoomEagerPreload } from '../../mindroom/threads/preloadController';
import { useThreadBackPaginationController } from '../../mindroom/threads/threadBackPaginationController';
import {
  buildThreadCacheCoverage,
  shouldShowThreadLoadOlderFromCoverage,
} from '../../mindroom/threads/threadCacheCoverage';
import {
  collectPriorityThreadSeedPrewarmRoots,
  fetchAllThreadRelations,
  getLoadedRoomThreadEvents,
  getLoadedRoomThreadSeedEvents,
  MAX_THREAD_FETCH_EVENTS,
  shouldRefreshOverviewForTimelineEvent,
} from '../../mindroom/threads/threadBootstrap';
import { createThreadOpenSeedSession } from '../../mindroom/threads/threadOpenSeedController';
import { runThreadOpenCacheFirst } from '../../mindroom/threads/threadOpenCacheFirst';
import { runThreadOpenSdkBootstrap } from '../../mindroom/threads/threadOpenSdkBootstrap';
import { runThreadOpenPostBootstrapRefresh } from '../../mindroom/threads/threadOpenPostBootstrapRefresh';
import {
  runThreadOpenTargetEvent,
  type PendingThreadOpen,
} from '../../mindroom/threads/threadOpenTargetEvent';
import { useThreadSeedPrewarmController } from '../../mindroom/threads/threadSeedPrewarmController';
import { useThreadOpenCacheController } from '../../mindroom/threads/threadOpenCacheController';
import { useThreadAwareTimelineRefresh } from '../../mindroom/threads/useThreadAwareTimelineRefresh';
import { useThreadOverviewResumeController } from '../../mindroom/threads/threadOverviewResumeController';
import { useThreadCachePersistenceController } from '../../mindroom/threads/threadCachePersistenceController';
import { useCompactRootEditBackfillController } from '../../mindroom/threads/compactRootEditBackfillController';
import { useThreadPaginationCommandController } from '../../mindroom/threads/threadPaginationCommandController';
import { useThreadEditBackfillController } from '../../mindroom/threads/threadEditBackfillController';
import { useRoomPaginationCommandController } from '../../mindroom/threads/roomPaginationCommandController';
import { useRoomCacheLifecycleController } from '../../mindroom/threads/roomCacheLifecycleController';
import { useRoomCacheHydrationController } from '../../mindroom/threads/roomCacheHydrationController';
import { resolveThreadOverviewRefreshTargets } from '../../mindroom/threads/threadOverviewRefreshTargets';
import { useRoomLiveEventController } from '../../mindroom/threads/roomLiveEventController';

export { getRoomEventThreadOpenTarget } from '../../mindroom/threads/roomDeepLink';
export { getRoomEventFocusTarget, getThreadFilteredEvents };
export { useThreadAwareTimelineRefresh } from '../../mindroom/threads/useThreadAwareTimelineRefresh';
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

type PendingRoomFocus = {
  eventId: string;
};

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

const OVERVIEW_THREAD_METADATA_CACHE_LIMIT = 64;

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
  const threadEditFetchAttemptedRef = useRef<WeakMap<MatrixEvent, number>>(
    new WeakMap<MatrixEvent, number>()
  );
  const pendingThreadOpenRef = useRef<PendingThreadOpen | undefined>();
  const pendingRoomFocusRef = useRef<PendingRoomFocus | undefined>();
  const suppressFocusPaginationRef = useRef(false);
  const alive = useAlive();
  roomIdRef.current = room.roomId;
  threadIdRef.current = threadId;
  threadFilterStateRef.current = requestedThreadFilterState;
  const { roomDebugTraceId, threadDebugTraceId } = useTimelineDebugTraceIds({
    eventId,
    room,
    threadId,
  });

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

  const { overviewRefreshCounter, setOverviewRefreshCounter } = useThreadOverviewRefreshCounter(
    room,
    threadId
  );

  const compactViewRequested = !threadId && effectiveViewMode === 'compact';

  const {
    showCompactRoomView,
    roomSurfaceEventEntries,
    visibleThreadRootData,
    compactThreadRootData,
    normalThreadRecordMap,
    threadRecordMap,
    threadReplyCountMap,
    threadParticipantMap,
    threadSummaryInfoMap,
    scheduledTaskCounts,
    availableRoomTags,
    readUpToTs,
    roomThreadListThreads,
    refreshRoomThreadList,
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
    linkedTimelines: timeline.linkedTimelines,
    renderableEventEntries,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    summaryMap,
    threadResolutionMap,
    currentUserId: mx.getSafeUserId(),
    requestedThreadFilterState,
    liveThreadFilterState,
    fallbackThreadFilterState: DIRECT_ROOM_TIMELINE_FILTER_STATE,
    threadSortFreezeState,
    overviewRefreshCounter,
    overviewThreadMetadataCacheLimit: OVERVIEW_THREAD_METADATA_CACHE_LIMIT,
    sessionId,
    mx,
    onStoreThreadSummary,
  });
  threadFilterStateRef.current = effectiveThreadFilterState;
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

  useThreadSortFreezeController({
    activeLiveOverviewThreadRootIds,
    setThreadSortFreezeState,
    threadId,
    threadSortFreezeState,
    threadSortControlSignature,
  });

  const useSurfacePreloadTarget = shouldUseSurfacePreloadTarget({
    threadId,
    roomThreadFilterActive,
    viewMode: effectiveViewMode,
  });

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

  useTimelineDebugRangeController({
    activeTimelineRange,
    canPaginateThreadBack,
    canPaginateThreadFront,
    eagerPreloading,
    eventsLength,
    filteredLength,
    renderableEventCount: renderableEventEntries.length,
    roomDebugTraceId,
    roomSurfaceEventCount: roomSurfaceEventEntries.length,
    threadDebugTraceId,
    threadEventCount: threadEvents.length,
    threadId,
    threadInitialCacheHydrated,
    threadInitialRenderMode,
    threadOverviewCount: threadFilteredEvents.length,
    threadTailLoaded,
    threadTimelineTick,
    useSurfacePreloadTarget,
  });

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

  const { persistRoomEventCache } = useRoomCacheLifecycleController({
    alive,
    eventId,
    eventsLength,
    persistThreadCacheFromRoomEvents,
    room,
    roomDebugTraceId,
    roomIdRef,
    sessionId,
    setRoomHasMoreCachedBack,
    setTimeline,
    threadId,
    threadIdRef,
    timeline,
  });

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

  const {
    ensureThreadSeedPrewarm,
    prewarmedThreadSeedIdsRef,
    prewarmingThreadSeedIdsRef,
    queuedThreadSeedIdsRef,
    prewarmingThreadSeedPromisesRef,
  } = useThreadSeedPrewarmController({
    room,
    mx,
    sessionId,
    safePaginationLimitRef,
    activeThreadId: threadId,
    priorityTargets: priorityThreadSeedPrewarmRoots,
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

  useRoomLiveEventController({
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
  });

  const buildRoomCacheHydratedTimeline = useCallback(
    () =>
      getInitialTimeline(room, safePaginationLimitRef.current, {
        threadId: undefined,
        ignoredUsersSet: recalibrateFilterOptsRef.current?.ignoredUsersSet ?? new Set(),
        showHiddenEvents: recalibrateFilterOptsRef.current?.showHiddenEvents ?? false,
        hideMembershipEvents: recalibrateFilterOptsRef.current?.hideMembershipEvents ?? false,
        hideNickAvatarEvents: recalibrateFilterOptsRef.current?.hideNickAvatarEvents ?? false,
      }),
    [room]
  );

  useRoomCacheHydrationController({
    alive,
    buildInitialTimeline: buildRoomCacheHydratedTimeline,
    eagerPreloadDoneForRoomRef,
    eventId,
    mx,
    room,
    roomDebugTraceId,
    roomIdRef,
    safePaginationLimit,
    scrollToBottomRef,
    sessionId,
    setAtBottom,
    setEagerPreloading,
    setRoomInitialCacheHydratedKey,
    setTimeline,
    threadId,
    threadIdRef,
  });

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
    const threadOpenSeedSession = createThreadOpenSeedSession({
      debugTraceId: threadDebugTraceId,
      ensureThreadSeedPrewarm,
      prewarmedThreadSeedIdsRef,
      prewarmingThreadSeedIdsRef,
      queuedThreadSeedIdsRef,
      prewarmingThreadSeedPromisesRef,
      room,
      roomTimelineSet,
      setSupplementalThreadEvents,
      shouldScrollToLatestOnOpen,
      threadId,
    });
    let mounted = true;
    threadOpenSeedSession.startUntargetedSeedPrewarmWait(
      () => mounted && threadIdRef.current === threadId
    );
    if (!shouldScrollToLatestOnOpen) {
      threadOpenSeedSession.applyInitialRoomThreadSeed();
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
        const cacheFirstResult = await runThreadOpenCacheFirst({
          backfillThreadRelationsIntoCache,
          debugTraceId: threadDebugTraceId,
          forceTimelineUpdate,
          hydrateThreadFromCache,
          isCurrentThreadOpen: () => mounted && threadIdRef.current === threadId,
          mx,
          pinThreadToBottomOnOpen,
          refreshLatestThreadRelationsTail,
          room,
          setThreadHasMoreCachedBack,
          setThreadInitialCacheHydrated,
          setThreadTailLoaded,
          setThreadTimelineTick,
          shouldScrollToLatestOnOpen,
          threadId,
          threadOpenSeedSession,
        });
        if (!cacheFirstResult.shouldContinue) return;

        const shouldContinueAfterSdkBootstrap = await runThreadOpenSdkBootstrap({
          debugTraceId: threadDebugTraceId,
          hydratedCachedPage: cacheFirstResult.hydratedCachedPage,
          isMounted: () => mounted,
          mx,
          onThreadLoadError,
          persistThreadEventCache,
          pinThreadToBottomOnOpen,
          room,
          setSupplementalThreadEvents,
          setThreadHasMoreCachedBack,
          setThreadLoadError,
          setThreadTailLoaded,
          setThreadTimelineTick,
          setTimeline,
          shouldScrollToLatestOnOpen,
          threadId,
        });
        if (!shouldContinueAfterSdkBootstrap) return;

        const shouldContinueAfterPostBootstrapRefresh = await runThreadOpenPostBootstrapRefresh({
          debugTraceId: threadDebugTraceId,
          isCurrentThreadOpen: () => mounted && threadIdRef.current === threadId,
          mx,
          persistThreadEventCache,
          refreshLatestThreadSlice,
          room,
          setSupplementalThreadEvents,
          setThreadHasMoreCachedBack,
          setThreadTailLoaded,
          shouldScrollToLatestOnOpen,
          threadId,
        });
        if (!shouldContinueAfterPostBootstrapRefresh) return;

        setTimeline((ct) => ({ ...ct }));
        setThreadTimelineTick((val) => val + 1);
        logTimelineDebug(threadDebugTraceId, 'thread-open-complete', {
          shouldScrollToLatestOnOpen,
          threadId,
        });
        if (shouldScrollToLatestOnOpen) {
          pinThreadToBottomOnOpen();
        }

        const shouldContinueAfterTargetEvent = await runThreadOpenTargetEvent({
          eventId,
          forceTimelineUpdate,
          isCurrentThreadOpen: () => mounted && threadIdRef.current === threadId,
          mx,
          room,
          setPendingThreadOpen: (pending) => {
            pendingThreadOpenRef.current = pending;
          },
          setPendingThreadOpenTick,
          setThreadTimelineTick,
          shouldScrollToLatestOnOpen,
          threadId,
        });
        if (!shouldContinueAfterTargetEvent) return;
      } finally {
        if (mounted && threadIdRef.current === threadId) {
          setThreadLatestOpenPending(false);
        }
      }
    };

    loadThreadTimeline();

    return () => {
      mounted = false;
      threadOpenSeedSession.cleanup();
    };
  }, [
    ensureThreadSeedPrewarm,
    eventId,
    forceTimelineUpdate,
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

  useThreadSummaryPublishController({
    onStoreThreadSummary,
    thread,
    threadEvents,
    threadId,
    threadSummaryInfoMap,
  });

  const { overviewResumeRefreshIds } = useMemo(
    () =>
      resolveThreadOverviewRefreshTargets({
        activeTimelineRange,
        compactFilteredThreadRootIds,
        filteredThreadRootIds,
        limit: OVERVIEW_THREAD_METADATA_CACHE_LIMIT,
        room,
        showCompactRoomView,
        threadFilteredEventEntries,
        threadId,
        threadReplyCountMap,
        threadResolutionMap,
      }),
    [
      activeTimelineRange,
      compactFilteredThreadRootIds,
      filteredThreadRootIds,
      room,
      showCompactRoomView,
      threadFilteredEventEntries,
      threadId,
      threadReplyCountMap,
      threadResolutionMap,
    ]
  );

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
