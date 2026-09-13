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
import {
  CollapsibleMessage,
  ExpandAllInitContext,
  expandAllMessages,
  collapseAllMessages,
} from './CollapsibleMessage';
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
import { isPendingLocalEchoEvent } from '../messages/pendingLocalEcho';
import type { MindroomThreadSummaryInfo } from './threadSummaryStore';
import {
  consumeLiveExpandOnceId,
  getCollapsibleMessageMeasurementKey,
  getCollapsibleMessageMode,
  shouldForceCollapsibleMessageOverflow,
} from './threadCollapsibleMessages';
import {
  buildResolveConfirmedEventId,
  dedupeThreadRenderEventEntries,
  buildMeasurementScrollCorrectionHook,
  estimateThreadEventRowHeight,
  isThreadFallbackReply,
  primeTimelineRenderContextBefore,
  shouldAutoPaginateThreadBack,
  shouldSettleLedgerAtBoundary,
} from './threadRenderUtils';
import { installRideTraceRecorder, isRideTraceEnabled } from './rideTraceRecorder';
import {
  isIOSWebKitDevice,
  waitForScrollQuiescence,
} from './scrollQuiescence';
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
import {
  getEventElementById,
  isScrollNearBottom,
  isTimelineAtLiveEnd,
  shouldRenderUnreadDividerAt,
} from './timelineScrollUtils';
import {
  resolveRoomTimelineViewState,
  THREAD_OVERVIEW_METADATA_CACHE_LIMIT,
} from './roomTimelineViewState';
import { useRoomThreadResolutionMap } from './useRoomThreadTags';
// CINNY-207 P4.3: the eager preload hook was deleted. Deep-history
// sweep is now a band-4 job on the engine's BackfillScheduler (see
// engine/deepHistoryJob.ts) and never touches the SDK live timeline.
import {
  ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE,
  THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS,
} from './preloadSettings';
import { countCacheProbe } from './cacheProbe';
import { sanitizePrefetchDepth,
  sanitizePrefetchScope } from '../engine/prefetchPolicy';
import { mindroomSettingsAtom } from '../settings/mindroomSettings';
import { useThreadBackPaginationController } from './threadBackPaginationController';
import { type PendingThreadOpen } from './threadOpenTargetEvent';
import { useThreadSeedPrewarmController } from './threadSeedPrewarmController';
import { useThreadOpenCacheController } from './threadOpenCacheController';
import { useThreadAwareTimelineRefresh } from './useThreadAwareTimelineRefresh';
import { useThreadOverviewResumeController } from './threadOverviewResumeController';
import {
  enqueueRoomDeepHistoryJob,
  scheduleReconcile as scheduleEngineReconcile,
  useMindroomSyncEngine,
} from '../engine';
import type { ScheduleReconcileFn } from './threadOpenCacheFirst';
import { useCompactRootEditBackfillController } from './compactRootEditBackfillController';
import { useThreadPaginationCommandController } from './threadPaginationCommandController';
import { useThreadEditBackfillController } from './threadEditBackfillController';
import { useRoomPaginationCommandController } from './roomPaginationCommandController';
import { useRoomCachedBackState } from './useRoomCachedBackState';
import { useRoomCacheHydrationController } from './roomCacheHydrationController';
import { useRoomLiveRenderController } from './roomLiveRenderController';
import { useThreadOpenLifecycleController } from './threadOpenLifecycleController';
import { useRoomTimelineWindowController } from './roomTimelineWindowController';
import { useTimelineReadReceiptController } from './timelineReadReceiptController';
import { TimelineMinimap, useTimelineMinimapInView } from './TimelineMinimap';
import { TimelineMinimapItem, deriveTimelineMinimapItems } from './timelineMinimapViewModel';
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
  const [prefetchDepthSetting] = useSetting(mindroomSettingsAtom, 'prefetchDepth');
  const prefetchDepth = sanitizePrefetchDepth(prefetchDepthSetting);
  const [prefetchScopeSetting] = useSetting(mindroomSettingsAtom, 'prefetchScope');
  const prefetchScope = sanitizePrefetchScope(prefetchScopeSetting);
  const interactivePaginationLimit = Math.min(
    prefetchDepth,
    ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE
  );
  const prefetchDepthRef = useRef(prefetchDepth);
  prefetchDepthRef.current = prefetchDepth;

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
  // `undefined` = no expand/collapse-all override; the timeline is keyed by
  // room:thread, so this state (and the context derived from it) resets on
  // navigation via remount.
  const [expandAllOverride, setExpandAllOverride] = useState<boolean | undefined>(undefined);
  const atBottomRef = useRef(atBottom);
  const liveExpandOnceIds = useRef(new Set<string>());
  atBottomRef.current = atBottom;

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBottomRef = useRef({
    count: 0,
    smooth: true,
  });

  const [focusItem, setFocusItem] = useState<RoomTimelineFocusItem | undefined>();
  const [threadLoadError, setThreadLoadError] = useState(false);
  const [roomHasMoreCachedBack, setRoomHasMoreCachedBack] = useState(false);
  const [roomInitialCacheHydratedKey, setRoomInitialCacheHydratedKey] = useState<
    string | undefined
  >();
  const [threadHasMoreCachedBack, setThreadHasMoreCachedBack] = useState(false);
  const [threadTailLoaded, setThreadTailLoaded] = useState(false);
  const [threadPaginatingFront, setThreadPaginatingFront] = useState(false);
  const [threadInitialCacheHydrated, setThreadInitialCacheHydrated] = useState(false);
  const [threadLatestOpenPending, setThreadLatestOpenPending] = useState(false);
  // First real scroll gesture in this thread view; also ends the
  // open-at-latest bottom pin (the reader owns the position from then on).
  const [threadUserScrolled, setThreadUserScrolled] = useState(false);
  // Latched once an open-at-latest began for this thread: hydration bands
  // land long after the open chain completes (background prefetch /
  // reconciler), and the pin must hold for them until the first gesture.
  // Render-time keying (greptile P1 on PR #83): the reset must happen in
  // the SAME render that switches room/thread — a useEffect reset runs
  // after the pin layout effect, letting one commit of the next thread
  // see the previous thread's latch. On the switch render itself the
  // stale threadLatestOpenPending (cleared only by the next open effect)
  // must not re-latch, hence the else.
  const threadOpenedAtLatestRef = useRef(false);
  const threadOpenLatchKeyRef = useRef(`${room.roomId}|${threadId ?? ''}`);
  if (threadOpenLatchKeyRef.current !== `${room.roomId}|${threadId ?? ''}`) {
    threadOpenLatchKeyRef.current = `${room.roomId}|${threadId ?? ''}`;
    threadOpenedAtLatestRef.current = false;
  } else if (threadLatestOpenPending) {
    threadOpenedAtLatestRef.current = true;
  }
  const [threadTimelineTick, setThreadTimelineTick] = useState(0);
  const [pendingThreadOpenTick, setPendingThreadOpenTick] = useState(0);
  const {
    isPaginatingBack: threadPaginatingBack,
    isPaginatingBackRef: threadPaginatingBackRef,
    suppressOpenBottomPinRef: suppressThreadOpenBottomPinRef,
    reset: resetThreadBackPagination,
    begin: beginThreadBackPagination,
    finish: finishThreadBackPagination,
    clearPendingAnchor: clearPendingThreadBackPaginationAnchor,
    getPendingAnchorEventId: getPendingThreadBackPaginationAnchorEventId,
    getPendingAnchorSeq: getPendingThreadBackPaginationAnchorSeq,
    recaptureAnchor: recaptureThreadBackPaginationAnchor,
  } = useThreadBackPaginationController();
  const roomIdRef = useRef(room.roomId);
  const roomPaginatingBackRef = useRef(false);
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
      : getInitialTimeline(room, prefetchDepth, {
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
  }, [room.roomId, threadId]);
  // CINNY-207 P4.3: the eagerPreloading reset layout-effect is gone.
  // The band-4 deep-history job runs entirely in the engine and does
  // not gate any rendering signal — the skeleton logic below relies on
  // cache/live counts alone.
  useLayoutEffect(() => {
    if (prevShowThreadRepliesInRoomRef.current === showThreadRepliesInRoom) return;
    prevShowThreadRepliesInRoomRef.current = showThreadRepliesInRoom;
    if (eventId || threadId) return;

    setTimeline(
      getInitialTimeline(room, prefetchDepth, {
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
    prefetchDepth,
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
    prefetchDepth,
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
        getInitialTimeline(room, prefetchDepth, {
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
    prefetchDepth,
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

  // CINNY-207 P3.3: persistence moved into the MindroomSyncEngine
  // write-through (client-level, all rooms). The component reads the
  // room-bound persist facade off the engine and hands the fns down
  // to the fetch controllers (same shapes as the pre-strip props).
  const syncEngine = useMindroomSyncEngine();
  const enginePersistForRoom = useMemo(
    () => syncEngine.persist.forRoom(room),
    [syncEngine, room]
  );
  const {
    persistRoomEventCache,
    persistThreadEventCache,
    queueRoomThreadCachePersist,
  } = enginePersistForRoom;

  // CINNY-207 P4.2: whenever the mounted room (or the currently open
  // thread) changes, tell the engine so it can stamp the ledger
  // federation flag, protect this room from eviction, and bump the
  // meta lastOpenedTs for both the room and thread scopes. Idempotent
  // per-call — safe to fire on every render-relevant change.
  useEffect(() => {
    syncEngine.noteRoomFocused(room.roomId, threadId);
  }, [syncEngine, room.roomId, threadId]);

  const handleRoomTimelinePagination = useRoomPaginationCommandController({
    alive,
    handleTimelinePagination,
    mx,
    persistRoomEventCache,
    recalibrateFilterOptsRef,
    room,
    roomIdRef,
    roomPaginatingBackRef,
    prefetchDepthRef,
    sessionId,
    setRoomHasMoreCachedBack,
    setTimeline,
    threadId,
    threadIdRef,
    timeline,
  });

  // CINNY-207 P4.3: enqueue the band-4 room-deep-history job once per
  // mounted (roomId, threadId=undefined). The scheduler dedupes by
  // (roomId, undefined, 'room-deep-history') so remounts (view mode
  // flips, thread open/close) don't fire redundant sweeps. The engine
  // scheduler's abortAll on stop() tears it down on account switch.
  // CINNY-207 P6.1 / D4: `prefetchDepth` — the user-facing "current
  // room history depth" setting — is threaded through as the job's
  // `targetEventCount`. Snapshot at the effect fire (not via ref)
  // because the dedup key does not include the depth: a mid-focus
  // depth change won't reset the running job, but the next mount
  // (room switch, view mode flip) picks up the new value.
  useEffect(() => {
    if (!roomEagerPreloadEnabled) return undefined;
    if (eventId || threadId) return undefined;
    enqueueRoomDeepHistoryJob({
      mx,
      sessionId,
      scheduler: syncEngine.scheduler,
      roomId: room.roomId,
      targetEventCount: prefetchDepth,
      scope: prefetchScope,
    }).catch(() => undefined);
    // CINNY-207 P4.3 review (gemini PR #70 high): abort the deep
    // history job on room switch / unmount. Without this, opening a
    // different room, opening a thread, or unmounting leaves the
    // previous room's job draining in the background (up to
    // CURRENT_ROOM_DEEP_HISTORY_TARGET events fetched, one batch at
    // a time), clogging the scheduler's concurrent slots and
    // delaying higher-priority tasks for the newly focused room. The
    // executor already checks `signal.aborted` between batches (see
    // `deepHistoryJob.ts`), so aborting here is cooperative and
    // ends the sweep at the next batch boundary.
    return () => {
      syncEngine.scheduler.abort(room.roomId, undefined, 'room-deep-history');
    };
  }, [
    eventId,
    mx,
    prefetchDepth,
    prefetchScope,
    room.roomId,
    roomEagerPreloadEnabled,
    sessionId,
    syncEngine,
    threadId,
  ]);

  useRoomCachedBackState({
    alive,
    eventId,
    eventsLength,
    room,
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
    prefetchDepthRef,
    activeThreadId: threadId,
    priorityTargets: priorityThreadSeedPrewarmRoots,
    debugTraceId: roomDebugTraceId,
  });

  const forceTimelineUpdate = useCallback(() => {
    setTimeline((ct) => ({ ...ct }));
  }, []);

  const {
    hydrateThreadFromCache,
    refreshLatestThreadSlice,
  } = useThreadOpenCacheController({
    alive,
    debugTraceId: threadDebugTraceId,
    forceTimelineUpdate,
    mx,
    persistThreadEventCache,
    room,
    roomIdRef,
    sessionId,
    setSupplementalThreadEvents,
    setThreadHasMoreCachedBack,
    setThreadTailLoaded,
    setThreadTimelineTick,
    threadIdRef,
  });

  // CINNY-207 P5.1 (D7 / AC9): bound `scheduleReconcile` binding for
  // the thread-open flow. Every open (complete or partial coverage)
  // schedules exactly one reconcile against server truth — the
  // scheduler dedups so an open followed immediately by a re-focus
  // does not fire duplicate `/relations` fetches.
  const scheduleReconcile = useCallback<ScheduleReconcileFn>(
    (args) =>
      scheduleEngineReconcile({
        mx,
        sessionId: syncEngine.sessionId,
        scheduler: syncEngine.scheduler,
        debugTraceId: threadDebugTraceId,
        ...args,
      }),
    [mx, syncEngine, threadDebugTraceId]
  );

  const getScrollElement = useCallback(() => scrollRef.current, []);
  // Live viewport-bottom reading for SCROLL-BEHAVIOR decisions. Deliberately
  // not the atBottom state: its false-transition is debounced ~1s for
  // read-receipt/UI stability, which is exactly wrong for anything that
  // moves the viewport — a user who just left the bottom must never be
  // treated as pinned (device round 5 / the ios-momentum-invariants e2e).
  // `slackPx` lets a caller allow for a layout change it KNOWS just
  // happened (e.g. the composer growing moves the bottom away by its own
  // delta for a user who was pinned).
  const isViewportAtBottomNow = useCallback(
    (slackPx = 0) => {
      const scrollElement = getScrollElement();
      if (!scrollElement) return false;
      return isScrollNearBottom({
        scrollHeight: scrollElement.scrollHeight,
        scrollTop: scrollElement.scrollTop,
        clientHeight: scrollElement.clientHeight,
        thresholdPx: 24 + slackPx,
      });
    },
    [getScrollElement]
  );
  const getTimelineItemElement = useCallback(
    (index: number) =>
      (scrollRef.current?.querySelector(`[data-message-item="${index}"]`) as HTMLElement) ??
      undefined,
    []
  );
  // Per-row estimates from event CONTENT (estimateThreadEventRowHeight).
  // Thread rows are bimodal — one-liners vs fold-capped long messages — so
  // any single learned mean mis-sizes every row by hundreds of px, and each
  // mount then corrects scrollHeight by that error mid-scroll: the shrink
  // bursts that let the browser clamp a scrolled-up reader back to the
  // bottom (traced by the ios-momentum-invariants e2e). Content-based
  // estimates are deterministic and stateless — no learned mean, no
  // adoption step, nothing to teleport.
  //
  // Mechanics on virtual-core 3.17.3: estimateSize is NOT a virtualizer
  // memo dependency; fresh estimates reach unmeasured rows because the
  // inline getItemKey arrow below invalidates memoOptions ->
  // getMeasurements every render — a full rebuild that consults
  // estimateSize for unmeasured items while measured heights persist in
  // itemSizeCache. Do NOT memoize getItemKey: a stable identity would stop
  // estimate updates from reaching the unvisited region above the viewport
  // (getMeasurements then only recomputes from the min measured index up).
  // The rebuild's per-render cost is one O(count) pass — microseconds at
  // current sizes.
  const defaultRowEstimate = messageLayout === MessageLayout.Compact ? 96 : 144;
  const compactRowLayout = messageLayout === MessageLayout.Compact;
  const estimateRoomTimelineItemSize = useCallback(
    (index?: number) => {
      if (!threadId) return defaultRowEstimate;
      const mEvent = index === undefined ? undefined : threadEvents[index];
      if (!mEvent) return defaultRowEstimate;
      return estimateThreadEventRowHeight(mEvent, { compact: compactRowLayout });
    },
    [compactRowLayout, defaultRowEstimate, threadEvents, threadId]
  );

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
          // ROOM LEDGER FOLD (port of the thread key-diff fold; replaces
          // the coarse-scrollTo + rAF rect-correction restore, whose two
          // writes raced virtual-core's reconcile loop). The paginator
          // hands us the exact prepended span, so ΔH is direct
          // arithmetic: measured cache by event-id key for rows seen
          // before, flat room estimate otherwise. The ref mutates BEFORE
          // setTimeline so the commit that renders the new range reads
          // the matching scrollMargin — margin, window math and tile
          // tops land in one paint, and the shared settle/boundary
          // machinery repays the debt at rest exactly as in threads.
          let foldPx = 0;
          for (let item = r.start; item < activeTimelineRange.start; item += 1) {
            const key = threadFilteredEventEntries[item]?.event.getId() ?? item;
            foldPx +=
              ledgerFoldSizeCacheRef.current?.get(key) ?? estimateRoomTimelineItemSize();
          }
          if (foldPx > 0) {
            scrollCompensationPxRef.current += foldPx;
            ledgerSettleWantedRef.current = true;
          }
        }
        setTimeline((cs) => ({ ...cs, range: r }));
      },
      [
        activeTimelineRange.start,
        estimateRoomTimelineItemSize,
        roomThreadFilterActive,
        threadFilteredEventEntries,
        threadId,
      ]
    ),
    getScrollElement,
    getItemElement: getTimelineItemElement,
    onEnd: handleRoomTimelinePagination,
    shouldSuppressPagination: useCallback(() => suppressFocusPaginationRef.current, []),
    // The ledger fold above owns backward-prepend compensation; without
    // this the paginator's own restore scrollBy lands first in the same
    // commit (hook order), reads the pre-margin layout, and the prepend
    // compensates TWICE — a visible jump of exactly the folded height
    // (CodeRabbit on PR #91; invisible to unit tests because the
    // harness mocks this hook).
    externalBackwardScrollRestore: true,
  });
  const timelineItems = getItems();
  // (Estimator comment block retained below its hoisted declaration —
  // the room ledger fold inside the paginator's onRangeChange needs the
  // estimator in scope, so it is declared above useVirtualPaginator.)
  // Rows measure immediately (task #128); the momentum question is only
  // what happens to the compensating scrollTop write for an above-viewport
  // resize. virtual-core ≥3.17 would natively DEFER those on iOS and replay
  // them at quiescence — but repeated flicks block the flush, so the replay
  // accumulates the whole gesture's estimate error and lands as a half-page
  // lurch when momentum dies (device-tested). The hook below therefore
  // DROPS above-viewport corrections while an iOS scroll/touch is live
  // (bounded invisible drift instead), and applies them immediately when
  // quiet and on every other platform, like the pre-3.17 default.
  // Offset ledger for corrections dropped mid-scroll (device round 10):
  // estimate error for a fully-above row would otherwise shift the content
  // under the reader. The dropped delta is folded into the virtualizer's
  // OWN coordinate space: the inner container gets a real marginTop of
  // -px and options.scrollMargin tracks the same value, so the window
  // math and the painted positions move together — no scrollTop write to
  // kill iOS momentum, and no paint/window divergence at ANY accumulated
  // magnitude (the round-8 transform shifted paint only; the on-device
  // trace measured ±3000px of divergence rendering the viewport blank
  // for 30% of a 40s ride). The offset-ledger coherence contract in
  // virtualizerIOSScrollContract.test.ts pins this against the real
  // virtual-core. The ledger settles into one exactly-cancelling
  // scrollTop write ONLY at true rest — never via a timeout cap
  // mid-momentum (the trace's full-screen settle flash): an unsettled
  // ledger is coherent, so it can wait indefinitely.
  const scrollCompensationPxRef = useRef(0);
  const virtualInnerRef = useRef<HTMLDivElement | null>(null);
  const compensationSettleArmedRef = useRef(false);
  // Bumped by the room/thread render-time reset: an armed quiescence wait
  // from a previous view resolves early when its scroll element
  // disconnects, and must not settle (or block re-arming for) the next
  // view's ledger (greptile P1 on PR #83).
  const ledgerGenerationRef = useRef(0);
  // Room/thread switch drops the ledger at RENDER time, and it MUST run
  // before the useVirtualizer call below: the virtualizer reads
  // options.scrollMargin from the ref in this very render, and a
  // ref-only reset schedules no re-render — resetting after the call
  // would hand the new view a stale (possibly thousands-of-px) margin
  // for an unbounded number of frames (adversarial review on PR #88).
  const compensationResetKeyRef = useRef(`${room.roomId}|${threadId ?? ''}`);
  if (compensationResetKeyRef.current !== `${room.roomId}|${threadId ?? ''}`) {
    compensationResetKeyRef.current = `${room.roomId}|${threadId ?? ''}`;
    scrollCompensationPxRef.current = 0;
    ledgerGenerationRef.current += 1;
    compensationSettleArmedRef.current = false;
    if (virtualInnerRef.current) virtualInnerRef.current.style.marginTop = '';
  }
  const [, setLedgerCommitTick] = useState(0);
  // Prepend detection state (declared here because the render-time fold
  // below must run BEFORE the virtualizer reads scrollMargin). A prepend
  // is detected by the pending anchor's index shifting upward versus its
  // index captured at begin()/recapture time: the thread root permanently
  // occupies index 0, so watching the first event id would never fire.
  const threadVirtualPrependCaptureRef = useRef<
    | {
        threadId: string;
        anchorEventId: string;
        anchorIndex: number;
        anchorSeq: number;
        // Rows 1..anchorIndex-1 at capture/rebase time, each priced the way
        // virtual-core prices them (measured cache, else estimator). The
        // fold diffs against this to find what was actually inserted or
        // removed above the anchor — merge order is pure ts-sort, so a
        // page/band can interleave new rows BETWEEN existing ones and a
        // positional 1..shift sum would price the wrong rows (full-surface
        // adversarial review 2026-07-07, finding L1).
        abovePrices: Map<string, number>;
        // threadEvents reference at the last fold scan — O(1) gate so the
        // diff only runs on renders that actually changed the list.
        foldedEvents: unknown;
      }
    | undefined
  >(undefined);
  const ledgerSettleWantedRef = useRef(false);
  // The PREVIOUS render's virtualizer size cache, for fold pricing.
  // roomTimelineVirtualizerRef is declared below the useVirtualizer call
  // and would be a TDZ read from the render-time fold.
  const ledgerFoldSizeCacheRef = useRef<Map<string | number | bigint, number> | undefined>(
    undefined
  );
  const priceThreadRowForLedger = useCallback(
    (eventId: string, index: number): number =>
      ledgerFoldSizeCacheRef.current?.get(eventId) ?? estimateRoomTimelineItemSize(index),
    [estimateRoomTimelineItemSize]
  );
  const threadEventsRef = useRef(threadEvents);
  threadEventsRef.current = threadEvents;
  // Rows 1..boundary-1 priced for a fresh capture/rebase baseline.
  const buildLedgerFoldBaseline = useCallback(
    (boundaryIndex: number): Map<string, number> => {
      const events = threadEventsRef.current;
      const abovePrices = new Map<string, number>();
      for (let index = 1; index < boundaryIndex; index += 1) {
        const id = events[index]?.getId();
        if (id) abovePrices.set(id, priceThreadRowForLedger(id, index));
      }
      return abovePrices;
    },
    [priceThreadRowForLedger]
  );
  // PREPEND COMMITS ARE PURE LEDGER ARITHMETIC — no scroll write at all.
  // Folding the prepended block's height into the ledger AT RENDER TIME
  // keeps every quantity in the same commit: options.scrollMargin (read
  // below) drops by ΔH while every shifted row's start grows by ΔH, so
  // the rendered window and painted positions are IDENTICAL to the
  // pre-prepend frame by construction — the reader cannot see the commit,
  // scrollTop is never touched (nothing for iOS momentum to lose), and
  // concurrent measurement corrections stay independently ledgered.
  // ΔH is a KEY DIFF against the capture's priced baseline, not a
  // positional 1..shift sum: merge order is pure ts-sort, so a page or
  // band can interleave its new rows BETWEEN existing rows above the
  // anchor, and redactions can remove rows there (full-surface
  // adversarial review 2026-07-07, findings L1/L2). Added rows price at
  // the estimator — they have never been measured, so virtual-core
  // prices them with the same function; removed rows price at the
  // baseline capture (measured cache when one existed). (Replaces the
  // coarse-scrollTo + rect-based fine-correction restore, whose two
  // writes the e2e photographed racing virtual-core's own quiet-state
  // adjustments inside the commit.)
  {
    const prependCapture = threadVirtualPrependCaptureRef.current;
    if (
      prependCapture &&
      (prependCapture.threadId !== (threadId ?? '') ||
        getPendingThreadBackPaginationAnchorSeq() !== prependCapture.anchorSeq)
    ) {
      // Anchor cleared, restored or re-captured elsewhere (barren page,
      // thread switch, rapid second Load Older): nothing left to fold for
      // THIS pagination.
      threadVirtualPrependCaptureRef.current = undefined;
    }
    if (
      prependCapture &&
      threadId &&
      prependCapture.threadId === threadId &&
      getPendingThreadBackPaginationAnchorSeq() === prependCapture.anchorSeq &&
      prependCapture.foldedEvents !== threadEvents
    ) {
      let boundaryEventId = prependCapture.anchorEventId;
      let boundaryIndex = threadEventIndexMapRef.current.get(boundaryEventId) ?? -1;
      if (boundaryIndex < 0) {
        // The anchor event vanished from the render list (redaction
        // acknowledged, identity dedup collapse). Fall back to the
        // nearest surviving baseline row as the boundary: rows above it
        // stay compensated, and the anchor's own removal closes visibly
        // in view — which is what a redaction should look like.
        prependCapture.abovePrices.forEach((_px, id) => {
          const index = threadEventIndexMapRef.current.get(id);
          if (typeof index === 'number' && index > boundaryIndex) {
            boundaryIndex = index;
            boundaryEventId = id;
          }
        });
        countCacheProbe(
          boundaryIndex >= 0 ? 'threadPrependFoldAnchorFallback' : 'threadPrependFoldAnchorLost'
        );
      }
      if (boundaryIndex < 0) {
        // No baseline row survived either — nothing to anchor the diff
        // to; compensating would be guesswork.
        threadVirtualPrependCaptureRef.current = undefined;
      } else {
        let addedPx = 0;
        let addedCount = 0;
        for (let index = 1; index < boundaryIndex; index += 1) {
          const id = threadEvents[index]?.getId();
          if (id && !prependCapture.abovePrices.has(id)) {
            addedPx += priceThreadRowForLedger(id, index);
            addedCount += 1;
          }
        }
        let removedPx = 0;
        prependCapture.abovePrices.forEach((px, id) => {
          if (threadEventIndexMapRef.current.get(id) === undefined) {
            removedPx += px;
          }
        });
        const foldPx = addedPx - removedPx;
        if (foldPx !== 0) {
          scrollCompensationPxRef.current += foldPx;
          ledgerSettleWantedRef.current = true;
        }
        if (addedCount > 0 && !threadPaginatingBackRef.current) {
          // The pagination commit landed: consume.
          threadVirtualPrependCaptureRef.current = undefined;
          clearPendingThreadBackPaginationAnchor();
        } else if (addedCount > 0 || removedPx !== 0) {
          // Mid-flight band or a removal-only change: fold it, but
          // REBASE the capture instead of consuming — the actual
          // pagination commit renders later and must still find its
          // baseline, or its rows land uncompensated (adversarial
          // review on PR #88). Rebase whenever the above-boundary
          // region CHANGED, even if adds and removes cancelled to a
          // zero fold — a stale baseline would double-count the same
          // keys on the next scan.
          threadVirtualPrependCaptureRef.current = {
            ...prependCapture,
            anchorEventId: boundaryEventId,
            anchorIndex: boundaryIndex,
            abovePrices: buildLedgerFoldBaseline(boundaryIndex),
            foldedEvents: threadEvents,
          };
        } else {
          // List changed below the boundary only (live append, etc.):
          // nothing to fold; just advance the change gate.
          prependCapture.foldedEvents = threadEvents;
        }
      }
    }
  }
  // RENDER SNAPSHOT of the ledger: scrollMargin (below), the inner
  // container's marginTop (layout effect) and every tile's inline top all
  // read THIS value, so any single paint is internally consistent by
  // construction. A correction dropping into the ledger MID-COMMIT (the
  // sync measureElement path — a tile mounting at rest measures inside
  // the ref callback, before this commit's layout effects) mutates only
  // the ref; the whole new value lands together in the tick-forced next
  // commit. Reading the live ref from the layout effect instead would
  // pair the NEW margin with THIS render's OLD tile tops for one paint
  // (full-surface adversarial review 2026-07-07, finding L3).
  const ledgerPxAtRender = scrollCompensationPxRef.current;
  const roomTimelineVirtualizer = useVirtualizer({
    count: threadId ? threadEvents.length : timelineItems.length,
    getScrollElement,
    estimateSize: estimateRoomTimelineItemSize,
    overscan: 10,
    scrollMargin: -ledgerPxAtRender,
    getItemKey: (index) => {
      if (threadId) {
        return threadEvents[index]?.getId() ?? index;
      }
      const item = timelineItems[index];
      return threadFilteredEventEntries[item]?.event.getId() ?? item ?? index;
    },
  });
  ledgerFoldSizeCacheRef.current = roomTimelineVirtualizer.itemSizeCache;


  // The settle is ONE synchronous JS block: margin removal and the
  // cancelling scrollTop shift land in the same layout pass, so they are
  // atomic with respect to paints and rAF samplers (a React-commit-based
  // settle measured 20x worse on the sustained-ride e2e — the extra
  // scheduling hop split the pair across paints under CPU throttle). The
  // scroll event from the write re-renders the virtualizer, which then
  // reads scrollMargin 0 from the zeroed ref; tile positions are
  // margin-independent (rel coordinates), so the one-render option lag
  // shifts nothing visually.
  const settleScrollCompensation = useCallback(() => {
    // The armed flag is NOT cleared here: it tracks the outstanding
    // quiescence WAIT, not the settle. Clearing it at settle entry (e.g.
    // from a boundary-guard settle) let a new drop arm a SECOND wait
    // while the first was still pending (adversarial review 2026-07-07,
    // periphery F5); each waiter clears the flag in its own resolution.
    const px = scrollCompensationPxRef.current;
    const inner = virtualInnerRef.current;
    const scrollElement = getScrollElement();
    if (px === 0 || !inner || !scrollElement) return;
    scrollCompensationPxRef.current = 0;
    inner.style.marginTop = '';
    // The option must flip in the SAME synchronous block: tile positions
    // are margin-independent, but the WINDOW computation is not — at
    // prepend-fold scale (thousands of px) a one-render stale option
    // renders a faraway range for a frame (photographed as a 140px
    // anchor flash by the latency-ride e2e).
    // scrollTop FIRST: setOptions can notify a synchronous re-render,
    // which must see the (margin 0, shifted scrollTop) pair — the other
    // order lets that render compute the window with the old offset.
    scrollElement.scrollTop += px;
    const virtualizer = roomTimelineVirtualizerRef.current;
    virtualizer.setOptions({ ...virtualizer.options, scrollMargin: 0 });
  }, [getScrollElement]);
  // Ledger boundary guard: the ledger's exact-cancel contract holds only
  // while the viewport stays inside the content region — accumulated debt
  // is real empty space at the container's edge (the margin), and a long
  // continuous ride can carry the reader into it before any rest repays
  // it (device trace ride-trace-1783391256452: 3.0s blank at px=-9356;
  // pinned by the ledger-boundary e2e). Approaching an edge settles
  // immediately: one momentum interruption at the extreme of the loaded
  // window — where scrolling hard-stopped anyway — instead of visible
  // blank space. The settle pair is visually exact, so the only cost is
  // momentum, and only at the boundary.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return undefined;
    const onLedgerBoundaryScroll = () => {
      const px = scrollCompensationPxRef.current;
      // Cheap early exit on the hot path (the predicate re-checks, but
      // without rect reads the common px=0 case costs nothing).
      if (px > -48 && px < 48) return;
      const inner = virtualInnerRef.current;
      if (!inner) return;
      const innerRect = inner.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      if (
        shouldSettleLedgerAtBoundary({
          ledgerPx: px,
          innerTop: innerRect.top,
          innerBottom: innerRect.bottom,
          scrollTop: scrollRect.top,
          scrollBottom: scrollRect.bottom,
          clientHeight: scrollEl.clientHeight,
        })
      ) {
        settleScrollCompensation();
      }
    };
    scrollEl.addEventListener('scroll', onLedgerBoundaryScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', onLedgerBoundaryScroll);
  }, [scrollRef, settleScrollCompensation, threadId, threadInitialRenderMode]);
  const handleDroppedCorrection = useCallback(
    (deltaPx: number) => {
      // Accumulate + FORCE a commit. The tiles are absolutely positioned,
      // so the layout shift this delta cancels only materializes when a
      // render repositions them — and react-virtual SKIPS its rerender
      // when the visible range is unchanged, which round 8's "a drop
      // always rerenders" premise missed (the paired ±140px flashes the
      // sustained-ride e2e isolated). The tick guarantees the commit; the
      // margin style (sync effect below), the scrollMargin option (read
      // at render) and the repositioned tiles then land in ONE paint.
      scrollCompensationPxRef.current += deltaPx;
      setLedgerCommitTick((tick) => tick + 1);
      if (!compensationSettleArmedRef.current) {
        compensationSettleArmedRef.current = true;
        // No maxWait cap: a forced settle mid-momentum is a scrollTop
        // write mid-momentum (the trace's full-screen flash). The ledger
        // is coherent while unsettled, so only TRUE rest settles it.
        const generation = ledgerGenerationRef.current;
        waitForScrollQuiescence(getScrollElement(), {
          maxWaitMs: Infinity,
        }).then(() => {
          compensationSettleArmedRef.current = false;
          if (!alive() || ledgerGenerationRef.current !== generation) return;
          settleScrollCompensation();
        });
      }
    },
    [alive, getScrollElement, settleScrollCompensation]
  );
  // Sync the ledger margin in the SAME paint as the committed layout
  // shift (runs on every commit; a string compare when idle). It writes
  // the RENDER SNAPSHOT, not the live ref: scrollMargin and the tile
  // tops came from this render, and a mid-commit drop must not split
  // the pair for a paint (see ledgerPxAtRender above).
  useLayoutEffect(() => {
    const inner = virtualInnerRef.current;
    if (!inner) return;
    const px = ledgerPxAtRender;
    const marginTop = px === 0 ? '' : `${-px}px`;
    if (inner.style.marginTop !== marginTop) {
      inner.style.marginTop = marginTop;
    }
    // A render-time ledger fold (prepend commit) grows px outside the
    // dropped-correction path; arm its settle here, in the same commit.
    if (ledgerSettleWantedRef.current) {
      ledgerSettleWantedRef.current = false;
      if (!compensationSettleArmedRef.current) {
        compensationSettleArmedRef.current = true;
        const generation = ledgerGenerationRef.current;
        waitForScrollQuiescence(getScrollElement(), { maxWaitMs: Infinity }).then(() => {
          compensationSettleArmedRef.current = false;
          if (!alive() || ledgerGenerationRef.current !== generation) return;
          settleScrollCompensation();
        });
      }
    }
  });
  // On-device ride tracing (`?ridetrace=1`): per-frame invariant recorder
  // with a one-tap export overlay — the phone captures the same trace the
  // e2e recorder samples, for the device-only symptom classes the desktop
  // harness cannot reproduce. Off (one localStorage read) otherwise.
  useEffect(() => {
    if (!isRideTraceEnabled()) return undefined;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return undefined;
    return installRideTraceRecorder(scrollEl, () => virtualInnerRef.current, {
      roomId: room.roomId,
      threadId,
    });
  }, [room.roomId, scrollRef, threadId]);
  // Thread/room switch drops the pending compensation at RENDER time: the
  // new view's first tiles measure during the commit, before any effect
  // could reset stale state (same pattern as the other render-time resets).
  // Instance property, not an option (mirrors how virtual-core consults it:
  // `this.shouldAdjust...`, set on the instance).
  roomTimelineVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = useMemo(
    () =>
      buildMeasurementScrollCorrectionHook({
        isIOSWebKitDevice,
        onDroppedCorrection: handleDroppedCorrection,
      }),
    [handleDroppedCorrection]
  );
  // (The room coarse-scrollTo + rAF rect-correction restore effect and
  // its DOM-scanning anchor capture are GONE — room prepends fold into
  // the offset ledger inside the paginator's onRangeChange, same as
  // thread prepends. One architecture, zero scroll writes.)
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

    // Smooth scrolling to an unmounted target is unsupported with dynamic row
    // measurement (it can stop short of the target); keep smooth only for the
    // near-bottom case where the target row is already mounted.
    const targetMounted = roomTimelineVirtualizer
      .getVirtualItems()
      .some((virtualItem) => virtualItem.index === roomTimelineLatestVirtualIndex);
    roomTimelineVirtualizer.scrollToIndex(roomTimelineLatestVirtualIndex, {
      align: roomOverviewOrderActive ? 'start' : 'end',
      behavior: scrollToBottomRef.current.smooth && targetMounted ? 'smooth' : 'auto',
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
  // Active settle loop's stop function; programmatic in-thread jumps cancel
  // it so a streaming re-pin cannot yank a just-initiated jump back to the
  // bottom (jumps emit no user scroll-intent events).
  const threadSettleStopRef = useRef<(() => void) | undefined>(undefined);
  // Thread bottom-pin settling: under virtualization the scroll height is an
  // estimate until rows mount and measure, so a pin can land far off-bottom
  // while measurements keep growing the total size (opening a large thread can
  // need dozens of correction frames). Re-pin until the position is stably at
  // the bottom, and stop immediately on user scroll intent so streaming
  // re-pins cannot trap the user at the bottom.
  useLayoutEffect(() => {
    if (!threadId || roomScrollToBottomCount <= 0) {
      return undefined;
    }

    const scrollEl = scrollRef.current;
    if (!scrollEl) return undefined;

    const userScrollIntentEvents = [
      'wheel',
      'touchstart',
      'touchmove',
      'pointerdown',
      'keydown',
    ] as const;
    let rafId: number | undefined;
    let remainingTicks = 150;
    let stableTicks = 0;
    let lastScrollTop = Number.NaN;
    const removeListeners = () => {
      userScrollIntentEvents.forEach((eventType) => {
        scrollEl.removeEventListener(eventType, cancelOnUserScrollIntent);
      });
    };
    const stop = () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      rafId = undefined;
      removeListeners();
      if (threadSettleStopRef.current === stop) {
        threadSettleStopRef.current = undefined;
      }
    };
    threadSettleStopRef.current = stop;
    function cancelOnUserScrollIntent() {
      stop();
    }
    const settle = () => {
      rafId = undefined;
      // While a smooth pin animation is still moving, observe without
      // correcting; once motion stops, instant-correct any leftover gap from
      // rows that measured during the ride (a far Jump to Latest can land
      // hundreds of px short of the true bottom otherwise).
      const scrollInMotion = scrollEl.scrollTop !== lastScrollTop;
      lastScrollTop = scrollEl.scrollTop;
      if (!scrollInMotion) {
        if (
          isScrollNearBottom({
            scrollHeight: scrollEl.scrollHeight,
            scrollTop: scrollEl.scrollTop,
            clientHeight: scrollEl.clientHeight,
          })
        ) {
          stableTicks += 1;
          if (stableTicks >= 2) {
            stop();
            return;
          }
        } else {
          stableTicks = 0;
          scrollToBottom(scrollEl, 'instant');
        }
      } else {
        stableTicks = 0;
      }
      remainingTicks -= 1;
      if (remainingTicks > 0) {
        rafId = requestAnimationFrame(settle);
      } else {
        stop();
      }
    };
    userScrollIntentEvents.forEach((eventType) => {
      scrollEl.addEventListener(eventType, cancelOnUserScrollIntent, { passive: true });
    });
    rafId = requestAnimationFrame(settle);
    return stop;
  }, [roomScrollToBottomCount, scrollRef, scrollToBottomRef, threadId]);
  // Thread prepend compensation: after back-pagination prepends rows, virtual
  // item indexes shift while the scroll offset still points at the old offset,
  // which can unmount the captured anchor row. Scroll the anchor's new index
  // into view first so the DOM-based restore (which runs after this effect, in
  // useRoomFocusScrollController) can fine-correct against a mounted element.
  const beginThreadBackPaginationWithCapture = useCallback(
    (
      beginThreadId: string | undefined,
      scrollRoot: HTMLElement | null | undefined,
      eventCount?: number
    ) => {
      const began = beginThreadBackPagination(beginThreadId, scrollRoot, eventCount);
      // begin() refuses while a pagination is in flight (the chip stays
      // clickable showing "Loading..."); a refused call must not wipe the
      // in-flight pagination's armed capture.
      if (!began) return began;
      threadVirtualPrependCaptureRef.current = undefined;
      if (beginThreadId) {
        const anchorEventId = getPendingThreadBackPaginationAnchorEventId();
        const anchorSeq = getPendingThreadBackPaginationAnchorSeq();
        const anchorIndex =
          anchorEventId === undefined
            ? undefined
            : threadEventIndexMapRef.current.get(anchorEventId);
        if (
          anchorEventId !== undefined &&
          anchorSeq !== undefined &&
          typeof anchorIndex === 'number'
        ) {
          threadVirtualPrependCaptureRef.current = {
            threadId: beginThreadId,
            anchorEventId,
            anchorIndex,
            anchorSeq,
            abovePrices: buildLedgerFoldBaseline(anchorIndex),
            foldedEvents: threadEventsRef.current,
          };
        }
      }
      return began;
    },
    [
      beginThreadBackPagination,
      buildLedgerFoldBaseline,
      getPendingThreadBackPaginationAnchorEventId,
      getPendingThreadBackPaginationAnchorSeq,
      threadEventIndexMapRef,
    ]
  );
  // Task #125 follow-up: re-capture just before the (quiescence-
  // deferred) prepend commit, so the restore targets the row the user
  // actually stopped on rather than where the fire happened. Mirrors
  // beginThreadBackPaginationWithCapture's component-side bookkeeping
  // (the coarse scrollToIndex leg reads threadVirtualPrependCaptureRef).
  const recaptureThreadBackPaginationAnchorWithCapture = useCallback(
    (
      recaptureThreadId: string | undefined,
      scrollRoot: HTMLElement | null | undefined,
      eventCount?: number
    ): boolean => {
      if (!recaptureThreadBackPaginationAnchor(recaptureThreadId, scrollRoot, eventCount)) {
        // Recapture failed (no visible message row — e.g. momentum
        // settled in a virtualized/loading gap). The begin-time anchor
        // is stale by definition here; restoring it would teleport the
        // viewport back to where pagination fired, and committing
        // WITHOUT a restore would shift the viewport by the prepended
        // height (greptile rounds 2+3 on PR #75). Drop the anchor and
        // report failure — the caller skips the commit entirely; the
        // fetched page is already persisted, so the next gesture
        // retries as a fast cache-hit once the viewport has rows.
        clearPendingThreadBackPaginationAnchor();
        threadVirtualPrependCaptureRef.current = undefined;
        return false;
      }
      if (!recaptureThreadId) return true;
      const anchorEventId = getPendingThreadBackPaginationAnchorEventId();
      const anchorSeq = getPendingThreadBackPaginationAnchorSeq();
      const anchorIndex =
        anchorEventId === undefined
          ? undefined
          : threadEventIndexMapRef.current.get(anchorEventId);
      if (
        anchorEventId !== undefined &&
        anchorSeq !== undefined &&
        typeof anchorIndex === 'number'
      ) {
        threadVirtualPrependCaptureRef.current = {
          threadId: recaptureThreadId,
          anchorEventId,
          anchorIndex,
          anchorSeq,
          abovePrices: buildLedgerFoldBaseline(anchorIndex),
          foldedEvents: threadEventsRef.current,
        };
      }
      return true;
    },
    [
      recaptureThreadBackPaginationAnchor,
      buildLedgerFoldBaseline,
      clearPendingThreadBackPaginationAnchor,
      getPendingThreadBackPaginationAnchorEventId,
      getPendingThreadBackPaginationAnchorSeq,
      threadEventIndexMapRef,
    ]
  );
  const roomTimelineVirtualizerRef = useRef(roomTimelineVirtualizer);
  roomTimelineVirtualizerRef.current = roomTimelineVirtualizer;
  const scrollThreadEventIntoView = useCallback(
    (eventId: string) => {
      const eventIndex = threadEventIndexMapRef.current.get(eventId);
      if (typeof eventIndex !== 'number') return false;
      threadSettleStopRef.current?.();
      roomTimelineVirtualizerRef.current.scrollToIndex(eventIndex, { align: 'center' });
      return true;
    },
    [threadEventIndexMapRef]
  );
  const cancelThreadBottomSettle = useCallback(() => {
    threadSettleStopRef.current?.();
  }, []);
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
    prefetchDepth,
    prefetchDepthRef,
    cancelThreadBottomSettle,
    scheduledStatusMap,
    scrollRef,
    scrollThreadEventIntoView,
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

  useRoomLiveRenderController({
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
  });

  const [minimapStripMap] = useState(() => new Map<string, HTMLSpanElement>());
  // Fine-pointer only (like the reference implementation): touch devices
  // never see the minimap, so skip deriving items and tracking scroll there.
  const [minimapPointerFine, setMinimapPointerFine] = useState(
    () => typeof window !== 'undefined' && (window.matchMedia?.('(pointer: fine)').matches ?? false)
  );
  useEffect(() => {
    const queryList =
      typeof window === 'undefined' ? undefined : window.matchMedia?.('(pointer: fine)');
    if (!queryList) return undefined;
    const handleChange = () => setMinimapPointerFine(queryList.matches);
    queryList.addEventListener('change', handleChange);
    return () => queryList.removeEventListener('change', handleChange);
  }, []);
  const minimapEnabled = minimapPointerFine && !showCompactRoomView;
  const minimapEvents = threadId ? threadEvents : threadFilteredEvents;
  const minimapItems = useMemo(
    () => (minimapEnabled ? deriveTimelineMinimapItems(minimapEvents) : []),
    [minimapEnabled, minimapEvents]
  );
  useTimelineMinimapInView(scrollRef, minimapItems, minimapStripMap, minimapEnabled);
  const handleMinimapSelect = useCallback(
    (item: TimelineMinimapItem) => {
      void handleOpenEvent(item.id, false);
    },
    [handleOpenEvent]
  );

  const buildRoomCacheHydratedTimeline = useCallback(
    () =>
      getInitialTimeline(room, prefetchDepthRef.current, {
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
    eventId,
    mx,
    room,
    roomDebugTraceId,
    roomIdRef,
    scrollToBottomRef,
    sessionId,
    setAtBottom,
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
        getInitialTimeline(room, prefetchDepth, {
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
      prefetchDepth,
    ]),
  });

  // Stay at bottom when room editor resize
  useResizeObserver(
    useMemo(() => {
      let mounted = false;
      let previousHeight = 0;
      return (entries) => {
        if (!roomInputRef.current) return;
        const editorBaseEntry = getResizeObserverEntry(roomInputRef.current, entries);
        if (!editorBaseEntry) return;
        const height = editorBaseEntry.contentRect.height;
        const growth = Math.max(0, height - previousHeight);
        previousHeight = height;
        if (!mounted) {
          // skip initial mounting call
          mounted = true;
          return;
        }
        const scrollElement = getScrollElement();
        if (!scrollElement) return;

        // Live reading, not the ~1s-stale atBottom state (a composer resize
        // right after the user scrolled up must not yank them back down).
        // The growth slack reconstructs the pre-resize position: a composer
        // growing by d moves the bottom away by d for a pinned user.
        if (isViewportAtBottomNow(growth)) {
          scrollToBottom(scrollElement);
        }
      };
    }, [getScrollElement, isViewportAtBottomNow, roomInputRef]),
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
    refreshLatestThreadSlice,
    scheduleReconcile,
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
    cancelThreadBottomSettle,
    editId,
    focusItem,
    focusScrollResetToken: effectiveThreadFilterState,
    pendingThreadOpenRef,
    pendingThreadOpenTick,
    retryPagination,
    roomId: room.roomId,
    scrollRef,
    scrollThreadEventIntoView,
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
    threadOpenedAtLatest: threadOpenedAtLatestRef.current,
    threadUserScrolled,
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
      prefetchDepth,
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
          liveExpandOnceIds.current
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
                (isThreadFallbackReply(mEvent) ||
                  replyEventId === prevEvent?.getId() ||
                  replyEventId === threadId)
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
                  (isThreadFallbackReply(mEvent) ||
                    replyEventId === prevEvent?.getId() ||
                    replyEventId === threadId)
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
                (isThreadFallbackReply(mEvent) ||
                  replyEventId === prevEvent?.getId() ||
                  replyEventId === threadId)
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
                    liveExpandOnceIds.current
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
      beginThreadBackPagination: beginThreadBackPaginationWithCapture,
      recaptureThreadBackPaginationAnchor: recaptureThreadBackPaginationAnchorWithCapture,
      clearThreadBackPaginationAnchor: clearPendingThreadBackPaginationAnchor,
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

  // Scroll-driven thread back-pagination (task #125). Threads bypass
  // useVirtualPaginator (its count is 0 for threads), so unlike the
  // room view they had NO scroll trigger — older content only arrived
  // via the "Load Older Messages" chip or background band fills, and
  // upward momentum scrolling hard-stopped at the loaded-window edge
  // on slow connections. This effect fires the SAME chip pipeline
  // (cache-first IDB page, network fallback, prepend anchor
  // capture/restore) when the top of the rendered window comes within
  // THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS of the loaded edge.
  //
  // Guard inputs are STATE values, not refs (greptile P1 on PR #74):
  // the gating conditions must RE-RUN the effect when they change.
  // With refs in the dep array the identity is stable, so a
  // suppressed evaluation would never re-run without an index change.
  //
  // The "not an open-time artifact" gate is USER SCROLL INTENT, not
  // the open-lifecycle pending flag: threadLatestOpenPending stays
  // true until the whole open-time backfill chain completes (its
  // clear lives in the chain's finally), which on slow networks spans
  // the entire loading phase — exactly when a scrolling user needs
  // the trigger live. A real gesture (the same event set the
  // pin-settle loop watches) is both necessary and sufficient: before
  // any gesture, a low rendered index is the pre-pin transient and
  // must not fire; after one, the user is genuinely navigating.
  //
  // Barren-attempt guard (greptile P2): one fire per
  // (firstRenderedIndex, threadEvents.length) observation. If an
  // attempt completes without growing the loaded window (exhausted or
  // miscounted coverage upstream), the identical state must not
  // re-fire in a loop; the next fire requires the user to scroll
  // (index changes) or content to land (length changes).
  const threadFirstRenderedIndex = threadId
    ? roomTimelineVirtualizer.getVirtualItems()[0]?.index
    : undefined;
  // Bumped by a fresh gesture ONLY while a barren-attempt block is
  // armed (see below) — a renewed explicit user gesture is what
  // authorizes retrying after a no-progress attempt. Normal scrolling
  // never bumps it (zero extra renders on the hot path).
  const [threadAutoPaginateGestureTick, setThreadAutoPaginateGestureTick] = useState(0);
  const threadAutoPaginateLastFireRef = useRef<{ index: number; count: number } | null>(null);
  useEffect(() => {
    // Reset ONLY on thread change (coderabbit on PR #74: resetting on
    // render-mode transitions would wipe real user intent mid-open).
    setThreadUserScrolled(false);
    threadAutoPaginateLastFireRef.current = null;
  }, [threadId]);
  useEffect(() => {
    if (!threadId) return undefined;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return undefined;
    // 'touchstart' included: an iOS flick can produce scroll activity
    // before the first touchmove is seen, and user-scroll intent must
    // already be marked by then. pointerdown covers this on PointerEvent
    // browsers; touchstart is the belt for the rest.
    const gestureEvents = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const;
    const onGesture = () => {
      setThreadUserScrolled(true);
      // Renewed intent clears a barren block (greptile P1 round 2 on
      // PR #74): a no-progress attempt must not strand the user at
      // the edge while older history still exists — but retries are
      // paced by explicit gestures, so an exhausted-but-miscounted
      // coverage state cannot re-fire in an unattended loop either.
      if (threadAutoPaginateLastFireRef.current !== null) {
        threadAutoPaginateLastFireRef.current = null;
        setThreadAutoPaginateGestureTick((tick) => tick + 1);
      }
    };
    gestureEvents.forEach((eventType) => {
      scrollEl.addEventListener(eventType, onGesture, { passive: true });
    });
    return () => {
      gestureEvents.forEach((eventType) => {
        scrollEl.removeEventListener(eventType, onGesture);
      });
    };
    // threadInitialRenderMode: the scroll element mounts after the
    // loading placeholder phase; re-attach once real rows render.
  }, [threadId, threadInitialRenderMode]);
  useEffect(() => {
    if (
      !shouldAutoPaginateThreadBack({
        threadId,
        firstRenderedIndex: threadFirstRenderedIndex,
        paginatingBack: threadPaginatingBack,
        showLoadOlder: showThreadLoadOlderMessages,
        hasUserScrollIntent: threadUserScrolled,
        triggerRows: THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS,
      })
    ) {
      return;
    }
    const lastFire = threadAutoPaginateLastFireRef.current;
    if (
      lastFire &&
      lastFire.index === threadFirstRenderedIndex &&
      lastFire.count === threadEvents.length
    ) {
      return;
    }
    threadAutoPaginateLastFireRef.current = {
      index: threadFirstRenderedIndex as number,
      count: threadEvents.length,
    };
    countCacheProbe('threadAutoPaginateBackFired');
    handleThreadPaginateBack();
  }, [
    threadFirstRenderedIndex,
    threadId,
    showThreadLoadOlderMessages,
    threadPaginatingBack,
    threadUserScrolled,
    threadAutoPaginateGestureTick,
    threadEvents.length,
    handleThreadPaginateBack,
  ]);

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

  const isRoomTimelinePrimeSkipped = (mEvent: MatrixEvent) => {
    const mEventId = mEvent.getId();
    const eventSender = mEvent.getSender();
    if (eventSender && ignoredUsersSet.has(eventSender)) return true;
    if (!showThreadRepliesInRoom && mEvent.threadRootId && mEvent.threadRootId !== mEventId) {
      return true;
    }
    return mEvent.isRedacted() && !showHiddenEvents;
  };

  const primeRoomTimelineRenderContextBefore = (item: number) => {
    const primed = primeTimelineRenderContextBefore(
      (index) => threadFilteredEventEntries[index]?.event,
      item,
      isRoomTimelinePrimeSkipped
    );
    if (!primed) return;
    prevEvent = primed.prevEvent;
    isPrevRendered = primed.isPrevRendered;
    if (!roomThreadFilterActive) {
      dayDivider = primed.pendingDayDivider;
    }
    // The sequential path advances prevRenderedEventAbsoluteIndex only on
    // rendered rows, so it comes from the nearest surviving non-edit entry —
    // possibly further back than prevEvent.
    for (let previousItem = item - 1; previousItem >= 0; previousItem -= 1) {
      const eventEntry = threadFilteredEventEntries[previousItem];
      const mEvent = eventEntry?.event;
      if (!mEvent || !mEvent.getId()) continue;
      if (isRoomTimelinePrimeSkipped(mEvent)) continue;
      if (reactionOrEditEvent(mEvent)) continue;
      prevRenderedEventAbsoluteIndex = eventEntry.absoluteIndex;
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
        ref={virtualInnerRef}
        data-testid="room-virtual-inner"
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
              // Content-relative top: virtualItem.start includes the
              // scrollMargin option (-scrollCompensationPxRef, the offset
              // ledger), which the container's marginTop already applies in
              // the DOM — keeping start verbatim would double-count the
              // ledger and push the painted tiles out from under the
              // computed window (the sustained-ride e2e's blank bands at
              // ~2000px accumulation). Adding the ref back subtracts the
              // same render's margin exactly.
              style={{ top: virtualItem.start + ledgerPxAtRender }}
            >
              {eventRenderer(item)}
            </VirtualTile>
          );
        })}
      </div>
    );
  };

  const primeThreadTimelineRenderContextBefore = (index: number) => {
    const primed = primeTimelineRenderContextBefore(
      (previousIndex) => threadEvents[previousIndex],
      index,
      (mEvent) => {
        const eventSender = mEvent.getSender();
        if (eventSender && ignoredUsersSet.has(eventSender)) return true;
        return mEvent.isRedacted() && !showHiddenEvents;
      }
    );
    if (!primed) return;
    prevEvent = primed.prevEvent;
    isPrevRendered = primed.isPrevRendered;
    if (!roomThreadFilterActive) {
      dayDivider = primed.pendingDayDivider;
    }
  };

  const threadEventRenderer = (index: number) => {
    const mEvent = threadEvents[index];
    if (!mEvent) return null;
    const mEventId = mEvent.getId();
    if (!mEventId) return null;
    const threadTimeline = threadTimelineSet?.getTimelineForEvent(mEventId);
    const roomTimeline = roomTimelineSet.getTimelineForEvent(mEventId);
    const timelineSet =
      threadTimeline?.getTimelineSet() ??
      roomTimeline?.getTimelineSet() ??
      threadTimelineSet ??
      roomTimelineSet;

    return renderResolvedEvent(mEvent, index, timelineSet);
  };

  const renderVirtualThreadTimelineItems = () => {
    const virtualItems = roomTimelineVirtualizer.getVirtualItems();
    const firstVirtualItem = virtualItems[0];
    if (firstVirtualItem !== undefined) {
      primeThreadTimelineRenderContextBefore(firstVirtualItem.index);
    }

    return (
      <div
        ref={virtualInnerRef}
        data-thread-count={threadEvents.length}
        style={{
          height: roomTimelineVirtualizer.getTotalSize(),
          position: 'relative',
          width: '100%',
        }}
      >
        {virtualItems.map((virtualItem) => (
          <VirtualTile
            key={virtualItem.key}
            ref={roomTimelineVirtualizer.measureElement}
            virtualItem={virtualItem}
            // Content-relative top — see renderVirtualRoomTimelineItems.
            style={{ top: virtualItem.start + ledgerPxAtRender }}
          >
            {threadEventRenderer(virtualItem.index)}
          </VirtualTile>
        ))}
      </div>
    );
  };

  return (
    <ExpandAllInitContext.Provider value={expandAllOverride}>
      <Box grow="Yes" direction="Column">
        {shouldShowRoomThreadOverviewControls && (
          <RoomThreadOverview
            threadCount={
              showCompactRoomView
                ? compactFilteredThreadRootIds.length
                : filteredThreadRootIds.length
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
                  if (expandAllOverride === true) {
                    collapseAllMessages();
                    setExpandAllOverride(false);
                  } else {
                    expandAllMessages();
                    setExpandAllOverride(true);
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
                {expandAllOverride === true ? '[-all]' : '[+all]'}
              </button>
              <Scroll
                ref={scrollRef}
                visibility="Hover"
                style={{ overflowAnchor: threadId ? 'none' : 'auto' }}
              >
                <Box
                  direction="Column"
                  justifyContent={threadId ? 'Start' : 'End'}
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
                          padding: `${config.space.S700} ${config.space.S400} ${
                            config.space.S600
                          } ${
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

                  {threadId ? renderVirtualThreadTimelineItems() : renderVirtualRoomTimelineItems()}
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
              <TimelineMinimap
                items={minimapItems}
                stripMap={minimapStripMap}
                onSelect={handleMinimapSelect}
              />
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
    </ExpandAllInitContext.Provider>
  );
}
