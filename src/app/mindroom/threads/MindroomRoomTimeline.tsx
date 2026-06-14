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
import { Direction, EventTimelineSet, MatrixEvent, Room, MsgType } from 'matrix-js-sdk';
import { type Relations } from 'matrix-js-sdk/lib/models/relations';
import { HTMLReactParserOptions } from 'html-react-parser';
import classNames from 'classnames';
import { ReactEditor } from 'slate-react';
import { Editor } from 'slate';
import { type SessionMembershipData } from 'matrix-js-sdk/lib/matrixrtc/membershipData';
import { useVirtualizer } from '@tanstack/react-virtual';
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
import { MessageLayout, settingsAtom } from '../../state/settings';
import { useMatrixEventRenderer } from '../../hooks/useMatrixEventRenderer';
import { EncryptedContent } from '../../features/room/message/EncryptedContent';
import { Reactions } from '../../features/room/message/Reactions';
import { useMemberEventParser } from '../../hooks/useMemberEventParser';
import * as customHtmlCss from '../../styles/CustomHtml.css';
import { RoomIntro } from '../../components/room-intro';
import { getResizeObserverEntry, useResizeObserver } from '../../hooks/useResizeObserver';
import * as css from '../../features/room/RoomTimeline.css';
import { inSameDay, minuteDifference, timeDayMonthYear, today, yesterday } from '../../utils/time';
import { createMentionElement, isEmptyEditor, moveCursor } from '../../components/editor';
import { roomIdToReplyDraftAtomFamily } from '../../state/room/roomInputDrafts';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { GetContentCallback, MessageEvent, StateEvent } from '../../../types/matrix/room';
import { useKeyDown } from '../../hooks/useKeyDown';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import { VirtualTile } from '../../components/virtualizer';
import { CollapsibleMessage, expandAllMessages, collapseAllMessages } from './CollapsibleMessage';
import { Image } from '../../components/media';
import { ImageViewer } from '../../components/image-viewer';
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
import { useSpaceOptionally } from '../../hooks/useSpace';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useAccessiblePowerTagColors, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { useTheme } from '../../hooks/useTheme';
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';
import { Event, Message } from '../messages/MindroomMessage';
import { isPendingLocalEchoEvent } from '../messages/pendingSendIndicator';
import type { MindroomThreadSummaryInfo } from './threadSummaryStore';
import {
  consumeLiveExpandOnceId,
  getCollapsibleMessageMeasurementKey,
  getCollapsibleMessageMode,
  getHydratedLongTextExtrasCollapseKey,
  shouldForceCollapsibleMessageOverflow,
} from './threadCollapsibleMessages';
import { buildResolveConfirmedEventId, dedupeThreadRenderEventEntries } from './threadRenderUtils';
import {
  useTimelineDebugRangeController,
  useTimelineDebugTraceIds,
} from './timelineDebugController';
import { CompactRoomView } from './CompactRoomView';
import { RoomThreadOverview } from './RoomThreadOverview';
import {
  getRenderableEventEntries,
  mergeClassicRoomThreadReplyEntries,
} from './roomTimelineEvents';
import {
  getEmptyTimeline,
  getInitialTimeline,
  getLiveTimeline,
  getRoomUnreadInfo,
  getTimelinesEventsCount,
  type RecalibrateFilterOpts,
  type Timeline,
} from './timelinePagination';
import { useTimelinePagination } from './timelinePaginationController';
import { useThreadSummaryPublishController } from './threadSummaryPublishController';
import { useThreadOverviewRefreshCounter } from './threadOverviewRefreshCounter';
import { useThreadSortFreezeController } from './threadSortFreezeController';
import { useMindroomThreadIndex } from './useMindroomThreadIndex';
import {
  getMindroomRoomTimelineApprovalContentIfSupported,
  getMindroomRoomTimelineMessageRenderers,
  renderMindroomRoomTimelineThreadBadge,
} from './roomTimelineMessageExtensions';
import type { ThreadFilterKey } from './RoomThreadOverview';
import {
  type ThreadFilterState,
  type ThreadSortFreezeState,
  type FilterPreset,
} from './roomThreadOverviewModel';
import type { RoomViewMode } from './roomViewMode';
import { isTimelineAtLiveEnd, shouldRenderUnreadDividerAt } from './timelineScrollUtils';
import {
  resolveRoomTimelineViewState,
  THREAD_OVERVIEW_METADATA_CACHE_LIMIT,
} from './roomTimelineViewState';
import { useRoomThreadResolutionMap } from './useRoomThreadTags';
import { useRoomEagerPreload } from './preloadController';
import { ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE, sanitizePaginationLimit } from './preloadSettings';
import { mindroomSettingsAtom } from '../settings/mindroomSettings';
import { useThreadBackPaginationController } from './threadBackPaginationController';
import { type PendingThreadOpen } from './threadOpenTargetEvent';
import { useThreadSeedPrewarmController } from './threadSeedPrewarmController';
import { useThreadOpenCacheController } from './threadOpenCacheController';
import { useThreadAwareTimelineRefresh } from './useThreadAwareTimelineRefresh';
import { useThreadOverviewResumeController } from './threadOverviewResumeController';
import { useThreadCachePersistenceController } from './threadCachePersistenceController';
import { useCompactRootEditBackfillController } from './compactRootEditBackfillController';
import { useThreadPaginationCommandController } from './threadPaginationCommandController';
import { useThreadEditBackfillController } from './threadEditBackfillController';
import { useRoomPaginationCommandController } from './roomPaginationCommandController';
import { useRoomCacheLifecycleController } from './roomCacheLifecycleController';
import { useRoomCacheHydrationController } from './roomCacheHydrationController';
import { useRoomLiveEventController } from './roomLiveEventController';
import { useThreadOpenLifecycleController } from './threadOpenLifecycleController';
import { useRoomTimelineWindowController } from './roomTimelineWindowController';
import { useTimelineReadReceiptController } from './timelineReadReceiptController';
import {
  useRoomEventOpenController,
  useRoomEventRouteOpenController,
} from './roomEventOpenController';
import {
  useRoomFocusScrollController,
  type RoomTimelineFocusItem,
} from './roomFocusScrollController';
import { useRoomTimelineNavigationController } from './roomTimelineNavigationController';
import { buildMindroomRoomTimelineReplyDraft } from './roomTimelineReplyDraft';
import { useThreadTimelineState } from './useThreadTimelineState';

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

export type RoomTimelineProps = {
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
  viewMode = 'threaded',
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
  const {
    effectiveViewMode,
    focusedRoomOverviewRequested,
    requestedThreadFilterState,
    showRoomThreadOverviewControls,
  } = resolveRoomTimelineViewState({
    eventId,
    focusEventInRoom,
    threadFilterState,
    threadId,
    viewMode,
  });
  const showThreadRepliesInRoom = effectiveViewMode === 'classic';
  const roomEagerPreloadEnabled = !threadId && !eventId && effectiveViewMode !== 'classic';
  const showThreadBadgesInRoom = effectiveViewMode !== 'classic';
  const [hideMembershipEvents] = useSetting(settingsAtom, 'hideMembershipEvents');
  const [hideNickAvatarEvents] = useSetting(settingsAtom, 'hideNickAvatarEvents');
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [encUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
  const showUrlPreview = room.hasEncryptionStateEvent() ? encUrlPreview : urlPreview;
  const [showHiddenEvents] = useSetting(settingsAtom, 'showHiddenEvents');
  const [showDeveloperTools] = useSetting(settingsAtom, 'developerTools');
  const [paginationLimitSetting] = useSetting(mindroomSettingsAtom, 'paginationLimit');
  const safePaginationLimit = sanitizePaginationLimit(paginationLimitSetting);
  const interactivePaginationLimit = Math.min(
    safePaginationLimit,
    ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE
  );
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
  const [hydratedLongTextExtrasCollapseKeys, setHydratedLongTextExtrasCollapseKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());
  atBottomRef.current = atBottom;

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBottomRef = useRef({
    count: 0,
    smooth: true,
  });

  const [focusItem, setFocusItem] = useState<RoomTimelineFocusItem | undefined>();
  const [threadLoadError, setThreadLoadError] = useState(false);
  const [roomHasMoreCachedBack, setRoomHasMoreCachedBack] = useState(false);
  const [eagerPreloading, setEagerPreloading] = useState(roomEagerPreloadEnabled);
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
          showThreadRepliesInRoom,
        })
  );
  const prevShowThreadRepliesInRoomRef = useRef(showThreadRepliesInRoom);
  const eventsLength = getTimelinesEventsCount(timeline.linkedTimelines);
  const threadResolutionMap = useRoomThreadResolutionMap(room);
  useEffect(() => {
    liveExpandOnceIds.current.clear();
    setHydratedLongTextExtrasCollapseKeys((current) => (current.size === 0 ? current : new Set()));
  }, [room.roomId, threadId]);
  const markHydratedLongTextExtrasCollapsedExempt = useCallback((collapseKey: string) => {
    setHydratedLongTextExtrasCollapseKeys((current) => {
      if (current.has(collapseKey)) return current;

      const next = new Set(current);
      next.add(collapseKey);
      return next;
    });
  }, []);
  // Reset eagerPreloading when transitioning from event-focused view back to room
  // (component is reused since key is roomId:threadId, so useState initializer won't re-run)
  // useLayoutEffect so the reset fires before paint, preventing a single-frame skeleton flash
  useLayoutEffect(() => {
    if (!eventId && !threadId) {
      setEagerPreloading(roomEagerPreloadEnabled);
    }
  }, [eventId, roomEagerPreloadEnabled, threadId]);
  useLayoutEffect(() => {
    if (prevShowThreadRepliesInRoomRef.current === showThreadRepliesInRoom) return;
    prevShowThreadRepliesInRoomRef.current = showThreadRepliesInRoom;
    if (eventId || threadId) return;

    setTimeline(
      getInitialTimeline(room, safePaginationLimit, {
        threadId,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
        showThreadRepliesInRoom,
      })
    );
  }, [
    eventId,
    threadId,
    room,
    safePaginationLimit,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    showThreadRepliesInRoom,
  ]);
  const rawRenderableEventEntries = useMemo(
    () =>
      getRenderableEventEntries(
        timeline.linkedTimelines,
        room,
        threadId,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
        showThreadRepliesInRoom
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
      showThreadRepliesInRoom,
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
  const renderableEventEntries = useMemo(() => {
    if (threadId) return rawRenderableEventEntries;

    const classicRenderableEventEntries = showThreadRepliesInRoom
      ? mergeClassicRoomThreadReplyEntries({
          renderableEventEntries: rawRenderableEventEntries,
          room,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
        })
      : rawRenderableEventEntries;

    return dedupeThreadRenderEventEntries(
      classicRenderableEventEntries,
      resolveConfirmedRoomEventId
    );
  }, [
    threadId,
    rawRenderableEventEntries,
    showThreadRepliesInRoom,
    room,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    resolveConfirmedRoomEventId,
  ]);
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
    scheduledStatusMap,
    availableRoomTags,
    readUpToTs,
    roomThreadListThreads,
    refreshRoomThreadList,
    effectiveThreadFilterState,
    roomThreadFilterActive,
    liveThreadFilterState,
    filteredThreadRootIds,
    compactFilteredThreadRootIds,
    roomOverviewOrderActive,
    activeLiveOverviewThreadRootIds,
    overviewThreadRootIds,
    statusCounts,
    tagCounts,
    searchQuery: threadIndexSearchQuery,
    threadSortControlSignature,
    applyThreadOverviewRelationEvents,
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
    threadSortFreezeState,
    overviewRefreshCounter,
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

  const threadFilteredEventsRef = useRef<MatrixEvent[]>([]);
  const prevRoomThreadFilterActiveRef = useRef(roomThreadFilterActive);
  const liveTimelineLinked =
    timeline.linkedTimelines[timeline.linkedTimelines.length - 1] === getLiveTimeline(room);
  const canPaginateBack =
    typeof timeline.linkedTimelines[0]?.getPaginationToken(Direction.Backward) === 'string';
  const {
    canPaginateThreadBack,
    canPaginateThreadFront,
    roomTimelineSet,
    thread,
    threadBackwardPaginationToken,
    threadEventMap,
    threadEventIndexMapRef,
    threadEvents,
    threadInitialRenderMode,
    threadTimelineSet,
    setSupplementalThreadEvents,
    resetThreadRenderState,
  } = useThreadTimelineState({
    room,
    threadId,
    threadInitialCacheHydrated,
    debugTraceId: threadDebugTraceId,
  });
  const {
    activeTimelineRange,
    filteredLength,
    priorityThreadSeedPrewarmRoots,
    readUptoAbsoluteIndex,
    showThreadLoadOlderMessages,
    threadFilteredEventEntries,
    threadFilteredEvents,
    unreadScrollAnchorIndex,
    useSurfacePreloadTarget,
  } = useRoomTimelineWindowController({
    canPaginateThreadBack,
    effectiveViewMode,
    filteredRoomOverviewOrderActive: roomOverviewOrderActive,
    filteredRoomThreadActive: roomThreadFilterActive,
    lastThreadBackwardPaginationToken: threadBackwardPaginationToken,
    overviewRefreshCounter,
    overviewThreadRootIds,
    renderableEventEntries,
    renderableEvents,
    room,
    roomSurfaceEventEntries,
    roomThreadListThreads,
    safePaginationLimit,
    threadEventsLength: threadEvents.length,
    threadHasMoreCachedBack,
    threadId,
    threadReplyCountMap,
    threadResolutionMap,
    threadTailLoaded,
    timeline,
    unreadInfo,
  });
  threadFilteredEventsRef.current = threadFilteredEvents;
  const rangeAtStart = activeTimelineRange.start === 0;
  const rangeAtEnd = activeTimelineRange.end === filteredLength;

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
          showThreadRepliesInRoom,
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
    showThreadRepliesInRoom,
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
    showThreadRepliesInRoom,
  });
  recalibrateFilterOptsRef.current = {
    room,
    threadId,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    showThreadRepliesInRoom,
  };

  const handleTimelinePagination = useTimelinePagination(
    mx,
    timeline,
    setTimeline,
    interactivePaginationLimit,
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
    enabled: roomEagerPreloadEnabled,
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

  const { persistThreadCacheFromRoomEvents, persistThreadEventCache, queueRoomThreadCachePersist } =
    useThreadCachePersistenceController({
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
  const getTimelineItemElement = useCallback(
    (index: number) =>
      (scrollRef.current?.querySelector(`[data-message-item="${index}"]`) as HTMLElement) ??
      undefined,
    []
  );
  const roomVirtualPrependAnchorRef = useRef<{
    item: number;
    viewportOffset: number;
  }>();
  const captureRoomVirtualPrependAnchor = useCallback(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const scrollRect = scrollElement.getBoundingClientRect();
    const messageItems = Array.from(
      scrollElement.querySelectorAll<HTMLElement>('[data-message-item]')
    );
    const anchorElement = messageItems.find((element) => {
      const item = Number.parseInt(element.getAttribute('data-message-item') ?? '', 10);
      if (!Number.isFinite(item)) return false;

      const rect = element.getBoundingClientRect();
      return rect.bottom > scrollRect.top && rect.top < scrollRect.bottom;
    });
    if (!anchorElement) return;

    const item = Number.parseInt(anchorElement.getAttribute('data-message-item') ?? '', 10);
    if (!Number.isFinite(item)) return;

    roomVirtualPrependAnchorRef.current = {
      item,
      viewportOffset: anchorElement.getBoundingClientRect().top - scrollRect.top,
    };
  }, []);

  const {
    getItems,
    scrollToItem,
    scrollToElement,
    retryPagination,
    observeBackAnchor,
    observeFrontAnchor,
  } = useVirtualPaginator({
    count: threadId ? 0 : filteredLength,
    limit: interactivePaginationLimit,
    range: activeTimelineRange,
    onRangeChange: useCallback(
      (r) => {
        if (threadId || roomThreadFilterActive) return;
        if (r.start < activeTimelineRange.start) {
          captureRoomVirtualPrependAnchor();
        }
        setTimeline((cs) => ({ ...cs, range: r }));
      },
      [activeTimelineRange.start, captureRoomVirtualPrependAnchor, roomThreadFilterActive, threadId]
    ),
    getScrollElement,
    getItemElement: getTimelineItemElement,
    onEnd: handleRoomTimelinePagination,
    shouldSuppressPagination: useCallback(() => suppressFocusPaginationRef.current, []),
  });
  const timelineItems = getItems();
  const estimateRoomTimelineItemSize = useCallback(
    () => (messageLayout === MessageLayout.Compact ? 96 : 144),
    [messageLayout]
  );
  const roomTimelineVirtualizer = useVirtualizer({
    count: threadId ? 0 : timelineItems.length,
    getScrollElement,
    estimateSize: estimateRoomTimelineItemSize,
    overscan: 10,
    getItemKey: (index) => {
      const item = timelineItems[index];
      return threadFilteredEventEntries[item]?.event.getId() ?? item ?? index;
    },
  });
  useLayoutEffect(() => {
    const anchor = roomVirtualPrependAnchorRef.current;
    if (!anchor || threadId) return;

    if (anchor.item < activeTimelineRange.start || anchor.item >= activeTimelineRange.end) {
      roomVirtualPrependAnchorRef.current = undefined;
      return;
    }

    const virtualIndex = anchor.item - activeTimelineRange.start;
    const offset = Math.max(
      virtualIndex * estimateRoomTimelineItemSize() - anchor.viewportOffset,
      0
    );
    roomTimelineVirtualizer.scrollToOffset(offset, { behavior: 'auto' });
    roomVirtualPrependAnchorRef.current = undefined;

    requestAnimationFrame(() => {
      const scrollElement = scrollRef.current;
      const anchorElement = getTimelineItemElement(anchor.item);
      if (!scrollElement || !anchorElement) return;

      const expectedTop = scrollElement.getBoundingClientRect().top + anchor.viewportOffset;
      const delta = anchorElement.getBoundingClientRect().top - expectedTop;
      if (Math.abs(delta) <= 1) return;

      scrollElement.scrollBy({ top: delta, behavior: 'instant' });
    });
  }, [
    activeTimelineRange.end,
    activeTimelineRange.start,
    estimateRoomTimelineItemSize,
    getTimelineItemElement,
    roomTimelineVirtualizer,
    threadId,
  ]);
  const roomTimelineLatestVirtualIndex = useMemo(() => {
    if (timelineItems.length === 0) return -1;
    if (!roomOverviewOrderActive) return timelineItems.length - 1;

    let latestVirtualIndex = 0;
    let latestAbsoluteIndex = Number.NEGATIVE_INFINITY;
    timelineItems.forEach((item, virtualIndex) => {
      const absoluteIndex = threadFilteredEventEntries[item]?.absoluteIndex ?? item;
      if (absoluteIndex >= latestAbsoluteIndex) {
        latestAbsoluteIndex = absoluteIndex;
        latestVirtualIndex = virtualIndex;
      }
    });

    return latestVirtualIndex;
  }, [roomOverviewOrderActive, threadFilteredEventEntries, timelineItems]);
  const roomScrollToBottomCount = scrollToBottomRef.current.count;
  useLayoutEffect(() => {
    if (threadId || roomScrollToBottomCount <= 0 || roomTimelineLatestVirtualIndex < 0) return;

    roomTimelineVirtualizer.scrollToIndex(roomTimelineLatestVirtualIndex, {
      align: roomOverviewOrderActive ? 'start' : 'end',
      behavior: scrollToBottomRef.current.smooth ? 'smooth' : 'auto',
    });
    setAtBottom(true);
  }, [
    roomOverviewOrderActive,
    roomScrollToBottomCount,
    roomTimelineLatestVirtualIndex,
    roomTimelineVirtualizer,
    scrollToBottomRef,
    setAtBottom,
    threadId,
  ]);
  const scrollToTimelineItem = useCallback(
    (index: number, opts?: Parameters<typeof scrollToItem>[1]) => {
      if (threadId || index < activeTimelineRange.start || index >= activeTimelineRange.end) {
        return scrollToItem(index, opts);
      }

      if (getTimelineItemElement(index)) {
        return scrollToItem(index, opts);
      }

      roomTimelineVirtualizer.scrollToIndex(index - activeTimelineRange.start, {
        align: opts?.align ?? 'start',
        behavior: opts?.behavior === 'smooth' ? 'smooth' : 'auto',
      });
      return true;
    },
    [
      activeTimelineRange.end,
      activeTimelineRange.start,
      getTimelineItemElement,
      roomTimelineVirtualizer,
      scrollToItem,
      threadId,
    ]
  );

  const { handleOpenEvent, redirectRoomEventDeepLink } = useRoomEventOpenController({
    alive,
    effectiveViewMode,
    focusEventInRoom,
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    mx,
    room,
    navigateRoomThread,
    overviewThreadRootIds,
    pendingThreadOpenRef,
    readUpToTs,
    readUptoEventIdRef,
    recalibrateFilterOptsRef,
    roomOverviewOrderActive,
    roomThreadListThreads,
    safePaginationLimit,
    safePaginationLimitRef,
    scheduledStatusMap,
    scrollRef,
    scrollToBottomRef,
    scrollToElement,
    scrollToItem: scrollToTimelineItem,
    searchQuery: threadIndexSearchQuery,
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
  });

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
        showThreadRepliesInRoom: recalibrateFilterOptsRef.current?.showThreadRepliesInRoom,
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
          showThreadRepliesInRoom,
        })
      );
    }, [
      room,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      showThreadRepliesInRoom,
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

  const { handleMarkAsRead } = useTimelineReadReceiptController({
    atBottom,
    atBottomAnchorRef,
    atBottomRef,
    atLiveEndRef,
    getScrollElement,
    handleOpenEvent,
    hideActivity,
    mx,
    readUptoEventIdRef,
    room,
    setAtBottom,
    threadEventsLength: threadEvents.length,
    threadId,
    threadInitialRenderMode,
    threadTailLoaded,
    timelineAtLiveEnd,
    unreadInfo,
  });

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

  useRoomEventRouteOpenController({
    effectiveViewMode,
    eventId,
    focusEventInRoom,
    handleOpenEvent,
    redirectRoomEventDeepLink,
    roomId: room.roomId,
    roomOverviewOrderActive,
    threadId,
  });

  useThreadOpenLifecycleController({
    backfillThreadRelationsIntoCache,
    ensureThreadSeedPrewarm,
    eventId,
    forceTimelineUpdate,
    hydrateThreadFromCache,
    mx,
    onThreadLoadError,
    pendingThreadOpenRef,
    persistThreadEventCache,
    prewarmedThreadSeedIdsRef,
    prewarmingThreadSeedIdsRef,
    prewarmingThreadSeedPromisesRef,
    queuedThreadSeedIdsRef,
    refreshLatestThreadRelationsTail,
    refreshLatestThreadSlice,
    resetThreadBackPagination,
    resetThreadRenderState,
    room,
    roomTimelineSet,
    scrollToBottomRef,
    setAtBottom,
    setFocusItem,
    setPendingThreadOpenTick,
    setSupplementalThreadEvents,
    setThreadHasMoreCachedBack,
    setThreadInitialCacheHydrated,
    setThreadLatestOpenPending,
    setThreadLoadError,
    setThreadPaginatingFront,
    setThreadTailLoaded,
    setThreadTimelineTick,
    setTimeline,
    suppressThreadOpenBottomPinRef,
    threadDebugTraceId,
    threadEditFetchAttemptedRef,
    threadId,
    threadIdRef,
  });

  useRoomFocusScrollController({
    alive,
    atBottomAnchorRef,
    editId,
    focusItem,
    focusScrollResetToken: effectiveThreadFilterState,
    pendingThreadOpenRef,
    pendingThreadOpenTick,
    restorePendingThreadBackPaginationAnchor,
    retryPagination,
    roomId: room.roomId,
    scrollRef,
    scrollToBottomRef,
    scrollToElement,
    scrollToItem: scrollToTimelineItem,
    setAtBottom,
    setFocusItem,
    setPendingThreadOpenTick,
    suppressFocusPaginationRef,
    suppressThreadOpenBottomPinRef,
    threadEventIndexMapRef,
    threadEventsLength: threadEvents.length,
    threadFilteredEvents,
    threadFilteredEventsRef,
    threadId,
    threadInitialRenderMode,
    threadLatestOpenPending,
    threadTimelineTick,
    timelineAtLiveEnd,
    unreadInfo,
    unreadScrollAnchorIndex,
  });

  // Remove unreadInfo on mark as read
  useEffect(() => {
    if (!unread) {
      setUnreadInfo(undefined);
    }
  }, [unread]);

  const { handleJumpToLatest, handleJumpToUnread, handleOpenCompactThread, handleOpenReply } =
    useRoomTimelineNavigationController({
      classicRoomTimeline: showThreadRepliesInRoom,
      eventId,
      handleOpenEvent,
      hideMembershipEvents,
      hideNickAvatarEvents,
      ignoredUsersSet,
      navigateRoom,
      navigateRoomThread,
      refreshLatestThreadSlice,
      room,
      safePaginationLimit,
      scrollRef,
      scrollToBottomRef,
      setAtBottom,
      setTimeline,
      showHiddenEvents,
      showThreadRepliesInRoom,
      threadId,
      threadIdRef,
      unreadInfo,
    });

  const handleUserClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const userId = evt.currentTarget.getAttribute('data-user-id');
      if (!userId) {
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
        return;
      }
      const shouldStartThread = startThread && !showThreadRepliesInRoom;
      const replyDraft = buildMindroomRoomTimelineReplyDraft(room, replyId, shouldStartThread);
      if (replyDraft) {
        setReplyDraft(replyDraft.draft);
        if (shouldStartThread) {
          navigateRoomThread(room.roomId, replyDraft.threadRootId);
        }
        setTimeout(() => ReactEditor.focus(editor), 100);
      }
    },
    [room, showThreadRepliesInRoom, setReplyDraft, editor, navigateRoomThread]
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

  useThreadOverviewResumeController({
    alive,
    activeTimelineRange,
    compactFilteredThreadRootIds,
    compactViewRequested,
    debugTraceId: roomDebugTraceId,
    filteredThreadRootIds,
    limit: THREAD_OVERVIEW_METADATA_CACHE_LIMIT,
    mx,
    onApplyThreadRelations: applyThreadOverviewRelationEvents,
    onStoreThreadSummary,
    persistThreadEventCache,
    refreshCompactThreadList: refreshRoomThreadList,
    room,
    setOverviewRefreshCounter,
    showCompactRoomView,
    threadFilteredEventEntries,
    threadId,
    threadIdRef,
    threadReplyCountMap,
    threadResolutionMap,
  });

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
        const pendingSend = isPendingLocalEchoEvent(mEvent) || isPendingLocalEchoEvent(editedEvent);
        const resolvedContent = getLatestMessageContent(mEvent, editedEvent);
        const getContent = (() => resolvedContent) as GetContentCallback;
        const collapseMode = getCollapsibleMessageMode(
          mEventId,
          resolvedContent,
          liveExpandOnceIds.current,
          hydratedLongTextExtrasCollapseKeys
        );
        const hydratedLongTextExtrasCollapseKey = getHydratedLongTextExtrasCollapseKey(
          mEventId,
          resolvedContent
        );
        const forceCollapsibleOverflow = shouldForceCollapsibleMessageOverflow(resolvedContent);
        const onInitialExpandConsumed =
          collapseMode === 'initially-expanded'
            ? () => {
                consumeLiveExpandOnceId(liveExpandOnceIds.current, mEventId);
              }
            : undefined;

        const senderId = mEvent.getSender() ?? '';
        const senderDisplayName =
          getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
        const threadSummary = showThreadBadgesInRoom
          ? renderMindroomRoomTimelineThreadBadge({
              eventId: mEventId,
              event: mEvent,
              threadRecordMap,
              activeThreadId: threadId,
              room,
              onClick: handleOpenReply,
              includeRecentSummaryData: true,
            })
          : null;

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
                  hideThreadIndicator={!!threadId || showThreadRepliesInRoom}
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
              const renderContent = (hydrateLongText = true) => (
                <RenderMessageContent
                  displayName={senderDisplayName}
                  eventType={mEvent.getType()}
                  msgType={msgType ?? ''}
                  ts={mEvent.getTs()}
                  edited={!!editedEvent}
                  pendingSend={pendingSend}
                  getContent={getContent}
                  mediaAutoLoad={mediaAutoLoad}
                  urlPreview={showUrlPreview}
                  showMessageExtras
                  htmlReactParserOptions={htmlReactParserOptions}
                  linkifyOpts={linkifyOpts}
                  outlineAttachment={messageLayout === MessageLayout.Bubble}
                  hydrateLongText={hydrateLongText}
                  onLongTextHydratedMessageExtrasRendered={
                    hydratedLongTextExtrasCollapseKey
                      ? () =>
                          markHydratedLongTextExtrasCollapsedExempt(
                            hydratedLongTextExtrasCollapseKey
                          )
                      : undefined
                  }
                />
              );
              const content = renderContent();
              const measurementKey = getCollapsibleMessageMeasurementKey(
                mEvent,
                collapseMode,
                editedEvent
              );
              if (isVisualMedia) return content;
              return (
                <CollapsibleMessage
                  collapseMode={collapseMode}
                  forceOverflowing={forceCollapsibleOverflow}
                  measurementKey={measurementKey}
                  onInitialExpandConsumed={onInitialExpandConsumed}
                >
                  {({ expanded }) => renderContent(expanded)}
                </CollapsibleMessage>
              );
            })()}
          </Message>
        );
      },
      ...getMindroomRoomTimelineMessageRenderers(
        (mEventId, mEvent, item, timelineSet, collapse) => {
          const reactionRelations = getEventReactions(timelineSet, mEventId);
          const hasReactions = getActiveAnnotationsByKey(reactionRelations).length > 0;
          const { replyEventId, threadRootId } = mEvent;
          const highlighted = focusItem?.index === item && focusItem.highlight;
          const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
          const pendingSend =
            isPendingLocalEchoEvent(mEvent) || isPendingLocalEchoEvent(editedEvent);
          const approvalContent =
            getMindroomRoomTimelineApprovalContentIfSupported(mEvent, editedEvent) ??
            mEvent.getContent();
          const getContent = (() => approvalContent) as GetContentCallback;
          const senderId = mEvent.getSender() ?? '';
          const senderDisplayName =
            getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
          const threadSummary = showThreadBadgesInRoom
            ? renderMindroomRoomTimelineThreadBadge({
                eventId: mEventId,
                event: mEvent,
                threadRecordMap,
                activeThreadId: threadId,
                room,
                onClick: handleOpenReply,
              })
            : null;

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
                    hideThreadIndicator={!!threadId || showThreadRepliesInRoom}
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
                  msgType={
                    typeof approvalContent.msgtype === 'string' ? approvalContent.msgtype : ''
                  }
                  ts={mEvent.getTs()}
                  edited={!!editedEvent}
                  pendingSend={pendingSend}
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
        }
      ),
      [MessageEvent.RoomMessageEncrypted]: (mEventId, mEvent, item, timelineSet, collapse) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const hasReactions = getActiveAnnotationsByKey(reactionRelations).length > 0;
        const { replyEventId, threadRootId } = mEvent;
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
        const pendingSend = isPendingLocalEchoEvent(mEvent) || isPendingLocalEchoEvent(editedEvent);
        const resolvedContent = getLatestMessageContent(mEvent, editedEvent);
        const threadSummary = showThreadBadgesInRoom
          ? renderMindroomRoomTimelineThreadBadge({
              eventId: mEventId,
              event: mEvent,
              threadRecordMap,
              activeThreadId: threadId,
              room,
              onClick: handleOpenReply,
            })
          : null;

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
                  hideThreadIndicator={!!threadId || showThreadRepliesInRoom}
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
                const approvalContent = getMindroomRoomTimelineApprovalContentIfSupported(
                  mEvent,
                  editedEvent
                );
                if (approvalContent) {
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
                      pendingSend={pendingSend}
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
                    liveExpandOnceIds.current,
                    hydratedLongTextExtrasCollapseKeys
                  );
                  const hydratedLongTextExtrasCollapseKey = getHydratedLongTextExtrasCollapseKey(
                    mEventId,
                    resolvedContent
                  );
                  const forceCollapsibleOverflow =
                    shouldForceCollapsibleMessageOverflow(resolvedContent);
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
                  const renderMessageContent = (hydrateLongText = true) => (
                    <RenderMessageContent
                      displayName={senderDisplayName}
                      eventType={mEvent.getType()}
                      msgType={mEvent.getContent().msgtype ?? ''}
                      ts={mEvent.getTs()}
                      edited={!!editedEvent}
                      pendingSend={pendingSend}
                      getContent={getContent}
                      mediaAutoLoad={mediaAutoLoad}
                      urlPreview={showUrlPreview}
                      showMessageExtras
                      htmlReactParserOptions={htmlReactParserOptions}
                      linkifyOpts={linkifyOpts}
                      outlineAttachment={messageLayout === MessageLayout.Bubble}
                      hydrateLongText={hydrateLongText}
                      onLongTextHydratedMessageExtrasRendered={
                        hydratedLongTextExtrasCollapseKey
                          ? () =>
                              markHydratedLongTextExtrasCollapsedExempt(
                                hydratedLongTextExtrasCollapseKey
                              )
                          : undefined
                      }
                    />
                  );
                  const messageContent = renderMessageContent();

                  const encMsgType = mEvent.getContent().msgtype;
                  const isEncVisualMedia =
                    encMsgType === MsgType.Image || encMsgType === MsgType.Video;
                  if (isEncVisualMedia) return messageContent;
                  return (
                    <CollapsibleMessage
                      collapseMode={collapseMode}
                      forceOverflowing={forceCollapsibleOverflow}
                      measurementKey={measurementKey}
                      onInitialExpandConsumed={onInitialExpandConsumed}
                    >
                      {({ expanded }) => renderMessageContent(expanded)}
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
    if (
      !threadId &&
      !showThreadRepliesInRoom &&
      mEvent.threadRootId &&
      mEvent.threadRootId !== mEventId
    ) {
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

  const primeRoomTimelineRenderContextBefore = (item: number) => {
    for (let previousItem = item - 1; previousItem >= 0; previousItem -= 1) {
      const eventEntry = threadFilteredEventEntries[previousItem];
      const mEvent = eventEntry?.event;
      const mEventId = mEvent?.getId();
      if (!mEvent || !mEventId) continue;

      const eventSender = mEvent.getSender();
      if (eventSender && ignoredUsersSet.has(eventSender)) continue;
      if (!showThreadRepliesInRoom && mEvent.threadRootId && mEvent.threadRootId !== mEventId) {
        continue;
      }
      if (mEvent.isRedacted() && !showHiddenEvents) continue;
      if (reactionOrEditEvent(mEvent)) continue;

      prevEvent = mEvent;
      prevRenderedEventAbsoluteIndex = eventEntry.absoluteIndex;
      isPrevRendered = true;
      return;
    }
  };

  const renderVirtualRoomTimelineItems = () => {
    const virtualItems = roomTimelineVirtualizer.getVirtualItems();
    const firstVirtualItem = virtualItems[0];
    const firstItem =
      firstVirtualItem !== undefined ? timelineItems[firstVirtualItem.index] : undefined;
    if (firstItem !== undefined) {
      primeRoomTimelineRenderContextBefore(firstItem);
    }

    return (
      <div
        style={{
          height: roomTimelineVirtualizer.getTotalSize(),
          position: 'relative',
          width: '100%',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const item = timelineItems[virtualItem.index];
          if (item === undefined) return null;

          return (
            <VirtualTile
              key={virtualItem.key}
              ref={roomTimelineVirtualizer.measureElement}
              virtualItem={virtualItem}
            >
              {eventRenderer(item)}
            </VirtualTile>
          );
        })}
      </div>
    );
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
            <Scroll
              ref={scrollRef}
              visibility="Hover"
              style={{ overflowAnchor: threadId ? 'none' : 'auto' }}
            >
              <Box
                direction="Column"
                justifyContent="End"
                style={{
                  minHeight: '100%',
                  padding: `${config.space.S600} 0`,
                  position: 'relative',
                }}
              >
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
                  : renderVirtualRoomTimelineItems()}
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
