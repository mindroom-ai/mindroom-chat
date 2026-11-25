import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useAlive } from '../lib/hooks/useAlive';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { useIgnoredUsers } from '../matrix/hooks/useIgnoredUsers';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { MessageLayout } from '../preferences/settings';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import { scheduleReconcile, useSyncEngine } from '../event-store/engine';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { ThreadTimelineHeader } from '../threads/ThreadTimelineHeader';
import { useTimelineMessageFeature } from './message-rendering/useTimelineMessageFeature';
import type { TimelineMessageData } from './message-rendering/types';
import { useRoomLiveRenderController } from './roomLiveRenderController';
import {
  useRoomFocusScrollController,
  type RoomTimelineFocusItem,
} from './roomFocusScrollController';
import {
  useRoomEventOpenController,
  useRoomEventRouteOpenController,
} from './roomEventOpenController';
import { useRoomTimelineNavigationController } from './roomTimelineNavigationController';
import { useTimelineReadReceiptController } from './timelineReadReceiptController';
import {
  clearVirtualizerHoldOffset,
  useTimelineScrollLedgerController,
} from './timelineScrollLedgerController';
import { useRoomTimelineMinimap } from './useRoomTimelineMinimap';
import { useThreadAwareTimelineRefresh } from './useThreadAwareTimelineRefresh';
import { getLiveReplyStore } from '../messages/live/liveReplyStore';
import { useTimelineDebugTraceIds } from './timelineDebugController';
import { useThreadTimelineState } from './useThreadTimelineState';
import { useCachedThreadRoot } from '../event-store/sdk/cachedThreadRoots';
import { useThreadForkPrefix } from '../threads/fork/useThreadForkPrefix';
import { ThreadForkDivider } from '../threads/fork/ThreadForkDivider';
import { useThreadSession } from '../threads/open/useThreadSession';
import { useThreadPagination } from '../threads/open/useThreadPagination';
import type {
  ThreadOpenRuntime,
  ThreadOpenViewportPort,
  ThreadRenderPort,
  ThreadRoute,
  ThreadSeedOpenPort,
} from '../threads/open/threadSessionTypes';
import { useThreadBackPaginationController } from './threadBackPaginationController';
import { useThreadPrependViewport } from './useThreadPrependViewport';
import { useThreadOpenLifecycleController } from '../threads/open/threadOpenLifecycleController';
import { useThreadGapRecovery } from '../threads/open/useThreadGapRecovery';
import { useThreadEditBackfillController } from '../threads/open/threadEditBackfillController';
import { useThreadSummaryPublishController } from '../threads/summary/threadSummaryPublishController';
import { useThreadSummaryTimeline } from '../threads/summary/useThreadSummaryTimeline';
import { useThreadConversationCostSummary } from '../event-store/threads/useThreadConversationCost';
import {
  useThreadApprovalRowMeasurements,
  useThreadApprovalTimeline,
} from '../approvals/useThreadApprovalTimeline';
import { useInlineSecretRequestPlan } from '../messages/useInlineSecretRequestPlan';
import { useVoiceTranscriptPlan } from '../messages/voiceTranscripts';
import { useReplyCardPlan } from './replyCards';
import { useModelChangePlan } from '../messages/modelChanges';
import { isMindroomResponderForViewer } from '../matrix/protocol/agentIdentity';
import { useDrawnSecretRequestIds } from '../messages/inlineSecretRequests';
import { isTimelineAtLiveEnd } from '../event-store/timeline/timelineScrollUtils';
import { useHeldRowsLayout, useTimelineLiveEnd } from './timelineLiveEnd';
import { isLocalEchoEventId } from '../event-store/threads/threadRouteUtils';
import { getKnownThreadReplyCount } from '../event-store/threads/threadRecord';
import type { ThreadRecord } from '../event-store/threads/types';
import { useRoomBackgroundJobs } from '../matrix/hooks/useRoomBackgroundJobs';
import { indexThreadBackgroundJobs } from '../matrix/protocol/threadBackgroundJobs';
import { useThreadOpeningReveal } from './useThreadOpeningReveal';
import { useViewScopedFlag } from './roomTimelineViewScope';
import {
  useFlickStop,
  useGestureBottomPins,
  useThreadOpenedAtLatest,
  useThreadRowJumps,
  useViewportAtBottomNow,
} from './roomTimelineScroll';
import { useThreadAutoPaginateBack } from './roomTimelinePaginationWindow';
import { useMessageRowHidden } from '../plugins/messageRenderers';
import { isPluginHiddenRow } from './pluginHiddenRows';
import { useThreadTurnFolds, useTurnBreakRowMeasurements } from './useThreadTurnFolds';
import { isTimelineRowHidden, renderTimelineTiles, timelineRowSizing } from './roomTimelineRows';
import { useThreadLoadOlderMessages } from './roomTimelineWindowController';
import { ThreadLoadOlderLine, ThreadLoadingLines, threadViewStyle } from './RoomTimelineOverlays';
import {
  TimelineViewport,
  useTimelineDisplaySettings,
  useTimelineImageSlides,
  useTimelineScrollSetup,
  useTrustedRoomAccounts,
} from './TimelineViewport';
import type { RoomTimelineProps } from './RoomTimeline';

const EMPTY_IDS: ReadonlySet<string> = new Set();
const EMPTY_THREAD_RECORD_MAP: ReadonlyMap<string, ThreadRecord> = new Map();
const EMPTY_SUMMARY_INFO_MAP = new Map<string, ThreadSummaryInfo>();
const NOOP_SEED_PORT: ThreadSeedOpenPort = { waitForExistingOrQueued: () => undefined };
const NOOP = () => undefined;

export type ThreadTimelineProps = Omit<RoomTimelineProps, 'threadId'> & {
  threadId: string;
};

export function ThreadTimeline(props: ThreadTimelineProps) {
  const {
    room,
    eventId,
    threadId,
    focusEventInRoom,
    entryReturned,
    summaryMap,
    onStoreThreadSummary,
    viewMode,
    editor,
    onThreadLoadError,
    threadHeader,
    threadHeaderGapAbove = false,
    forkAt,
    forkTargetRoom,
  } = props;
  const crossRoomForkTarget =
    forkTargetRoom && forkTargetRoom.roomId !== room.roomId ? forkTargetRoom : undefined;
  const forkTargetRoomName = crossRoomForkTarget
    ? crossRoomForkTarget.name || crossRoomForkTarget.roomId
    : undefined;
  const mx = useMatrixClient();
  const alive = useAlive();
  const engine = useSyncEngine();
  const { sessionId } = engine;
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const { navigateRoomThread } = useRoomNavigate();
  const ignoredUsers = useIgnoredUsers();
  const ignoredUsersSet = useMemo(() => new Set(ignoredUsers), [ignoredUsers]);
  const {
    hideActivity,
    hideMembershipEvents,
    hideNickAvatarEvents,
    messageLayout,
    messageSpacing,
    showHiddenEvents,
  } = useTimelineDisplaySettings();
  const compactLayout = messageLayout === MessageLayout.Compact;
  const viewKey = `${room.roomId}|${threadId}`;
  const threadIdRef = useLatestRef<string | undefined>(threadId);
  const [, forceRender] = useReducer((value: number) => value + 1, 0);

  const { threadDebugTraceId } = useTimelineDebugTraceIds({
    eventId,
    room,
    threadId,
  });

  // Thread session: its state comes first, so viewport consumers read it this render.
  const route = useMemo<ThreadRoute>(
    () => ({ roomId: room.roomId, threadId, eventId }),
    [room.roomId, threadId, eventId]
  );
  const session = useThreadSession(route);
  const { pagination: threadPagination, bindRuntime } = useThreadPagination(
    session.commands,
    route
  );
  const backController = useThreadBackPaginationController();
  const cancelThreadScrollRef = useRef<(() => void) | undefined>(undefined);
  const onPrependBegin = useCallback(() => cancelThreadScrollRef.current?.(), []);

  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useLatestRef(atBottom);
  const [focusItem, setFocusItem] = useState<RoomTimelineFocusItem>();
  const focusEventId = focusItem?.eventId;

  // A fork shows its parent's conversation up to the fork point before its own rows.
  const liveThreadRoot = room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId);
  const cachedThreadRoot = useCachedThreadRoot(room, threadId, liveThreadRoot);
  const forkPrefix = useThreadForkPrefix(room, liveThreadRoot ?? cachedThreadRoot);

  // Thread rows.
  const threadState = useThreadTimelineState({
    room,
    threadId,
    threadInitialCacheHydrated: session.snapshot.open.initialCacheHydrated,
    threadInitialSdkLoaded: session.snapshot.open.sdkReady,
    threadFirstPaintHeld: session.snapshot.open.firstPaintHeld,
    timelineRevision: session.snapshot.timelineRevision,
    debugTraceId: threadDebugTraceId,
    prefixEvents: forkPrefix.events,
    forkAt,
  });
  const threadStateRef = useLatestRef(threadState);
  const {
    threadEvents,
    ownThreadEvents,
    forkPointIndex,
    threadEventIndexMapRef,
    threadInitialRenderMode,
  } = threadState;
  const ownThreadEventsRef = useLatestRef(ownThreadEvents);
  // A fork draft shows its thread up to the fork point, its last row.
  const forkPoint = forkPointIndex !== undefined ? threadEvents[forkPointIndex] : undefined;
  const shownForkPoint = forkPoint?.getId();
  // A fork's parent messages, and in a fork draft every row, also before or without its fork
  // point: what the fork will show of its parent, read-only as it will show it.
  const forkPrefixEventIds = useMemo(
    () =>
      new Set((forkAt ? threadEvents : forkPrefix.events).flatMap((event) => event.getId() ?? [])),
    [forkAt, forkPrefix.events, threadEvents]
  );
  // A draft's reader reads its thread up to the fork point; what follows is out of sight.
  const readThreadEvents = useMemo(
    () =>
      forkPoint
        ? ownThreadEvents.slice(0, ownThreadEvents.indexOf(forkPoint) + 1)
        : ownThreadEvents,
    [forkPoint, ownThreadEvents]
  );
  const threadEventIndexMap = threadState.threadEventIndexMap ?? threadEventIndexMapRef.current;
  const threadTailLoaded = session.snapshot.history.tailLoaded;
  const threadHasMoreCachedBack = session.snapshot.history.hasMoreCachedBack;

  // Scroll setup installs useFooterBottomPin BEFORE useTimelineScrollLedgerController.
  const scroll = useTimelineScrollSetup();
  const {
    scrollRef,
    scrollElement,
    getScrollElement,
    footerProbeRef,
    contentRef,
    atBottomAnchorRef,
    scrollToBottomRef,
  } = scroll;
  const prependViewport = useThreadPrependViewport({
    controller: backController,
    scrollRef,
    onBegin: onPrependBegin,
  });

  const showThreadLoadOlder = useThreadLoadOlderMessages({
    canPaginateThreadBack: threadState.canPaginateThreadBack,
    lastThreadBackwardPaginationToken: threadState.threadBackwardPaginationToken,
    threadEventsLength: ownThreadEvents.length,
    threadHasMoreCachedBack,
    threadTailLoaded,
  });
  const threadLeadingOffset = showThreadLoadOlder ? 1 : 0;
  const threadLeadingOffsetRef = useLatestRef(threadLeadingOffset);

  // Opening a thread: render and viewport ports for the session, and the runtime it opens with.
  const openAtLatest = useThreadOpenedAtLatest(viewKey, session.snapshot.open.latestPending);
  const { startOpen: startOpenAtLatest, pinnedAtLatest } = openAtLatest;
  const renderPort = useMemo<ThreadRenderPort>(
    () => ({
      reset: (nextThreadId) => threadStateRef.current.resetThreadRenderState(nextThreadId),
      append: (targetThreadId, events) =>
        threadStateRef.current.setSupplementalThreadEvents(targetThreadId, events),
      getEvents: (targetThreadId) => threadStateRef.current.getThreadRenderEvents(targetThreadId),
      invalidateTimeline: forceRender,
    }),
    [threadStateRef]
  );
  const viewportPort = useMemo<ThreadOpenViewportPort>(
    () => ({
      resetForOpen: () => {
        backController.reset();
        startOpenAtLatest();
      },
      resetAfterLeave: () => backController.reset(),
      // Queued: the next commit applies it, unless the reader scrolls first. From then on the
      // opening pin holds the newest row while the rows measure.
      requestLatestPin: () => {
        if (backController.requestOpenBottomPin(scrollToBottomRef)) pinnedAtLatest();
      },
    }),
    [backController, pinnedAtLatest, scrollToBottomRef, startOpenAtLatest]
  );
  const beginThreadCacheWrite = useCallback(
    () => engine.persist.forRoom(room).persistThreadEventCache,
    [engine, room]
  );
  const threadDebugTraceIdRef = useLatestRef(threadDebugTraceId);
  const reconcile = useCallback<ThreadOpenRuntime['reconcile']>(
    (args) =>
      scheduleReconcile({
        ...args,
        mx,
        sessionId,
        scheduler: engine.scheduler,
        debugTraceId: threadDebugTraceIdRef.current,
      }),
    [engine, mx, sessionId, threadDebugTraceIdRef]
  );
  const onThreadLoadErrorRef = useLatestRef(onThreadLoadError);
  const reportThreadLoadError = useCallback(
    (failedThreadId: string) => onThreadLoadErrorRef.current?.(failedThreadId),
    [onThreadLoadErrorRef]
  );
  const runtime = useMemo<ThreadOpenRuntime>(
    () => ({
      room,
      mx,
      sessionId,
      beginCacheWrite: beginThreadCacheWrite,
      reconcile,
      seed: NOOP_SEED_PORT,
      render: renderPort,
      viewport: viewportPort,
      debugTraceId: threadDebugTraceId,
      onThreadLoadError: reportThreadLoadError,
    }),
    [
      beginThreadCacheWrite,
      mx,
      reconcile,
      renderPort,
      reportThreadLoadError,
      room,
      sessionId,
      threadDebugTraceId,
      viewportPort,
    ]
  );
  useThreadOpenLifecycleController({ route, commands: session.commands, runtime });
  bindRuntime({
    mx,
    room,
    sessionId,
    beginThreadCacheWrite,
    thread: threadState.thread,
    threadEvents: ownThreadEvents,
    threadHasMoreCachedBack,
    viewport: prependViewport,
  });

  // A thread opened at its latest row stays pinned there until the reader scrolls. Whether the
  // reader scrolled belongs to the open view; the render that switches views starts it over.
  const readerScrolledRef = useViewScopedFlag(viewKey);
  const threadLatestOpenPending = openAtLatest.latestOpenPending;
  const threadOpenedAtLatest = openAtLatest.openedAtLatest;
  const threadUserScrolled = readerScrolledRef.current.value;

  const feature = useTimelineMessageFeature({
    room,
    forkTargetRoom: crossRoomForkTarget,
    editor,
    threadId,
    scrollRef,
    showThreadRepliesInRoom: false,
    messageLayout,
    messageSpacing,
    hideActivity,
  });

  const getRowContent = useCallback(
    (event: MatrixEvent) =>
      getLatestMessageContent(
        event,
        getEditedEvent(event.getId() ?? '', event, threadStateRef.current.threadTimelineSet)
      ) as Record<string, unknown>,
    [threadStateRef]
  );
  // Replies a plugin's renderer hides in the open thread (`MessageRenderer.hidden`), read as their
  // rows show them; one the route or a jump opened stays visible after the route moves on.
  const threadRowHidden = useMessageRowHidden(mx.getUserId() ?? undefined);
  const pluginRevealedRef = useRef(new Set<string>());
  const isHiddenByPlugin = useMemo(() => {
    if (eventId) pluginRevealedRef.current.add(eventId);
    if (focusEventId) pluginRevealedRef.current.add(focusEventId);
    const revealed = pluginRevealedRef.current;
    return (event: MatrixEvent) =>
      isPluginHiddenRow(event, getRowContent, threadRowHidden, revealed);
  }, [eventId, focusEventId, getRowContent, threadRowHidden]);
  // Looked up among the thread's rows, the cache's too before the SDK has them: no row quotes a
  // hidden one.
  const threadEventMap = threadState.threadEventMap;
  const isHiddenByPluginId = useCallback(
    (id: string) => {
      const event = threadRowHidden ? threadEventMap?.get(id) : undefined;
      return !!event && isHiddenByPlugin(event);
    },
    [threadRowHidden, threadEventMap, isHiddenByPlugin]
  );
  // The open thread's replies a plugin hides, which the virtual list sizes as nothing.
  const pluginHiddenThreadIds = useMemo(
    () =>
      threadRowHidden
        ? new Set(threadEvents.filter(isHiddenByPlugin).flatMap((event) => event.getId() ?? []))
        : EMPTY_IDS,
    [threadRowHidden, threadEvents, isHiddenByPlugin]
  );
  // Rows read edits from the open thread's set.
  const rowTimelineSet = threadState.threadTimelineSet || room.getUnfilteredTimelineSet();
  const getImageSlides = useTimelineImageSlides({
    mx,
    room,
    events: threadEvents,
    rowTimelineSet,
    forkPrefixEventIds,
    isHiddenByPlugin,
    ignoredUsersSet,
  });
  // What each agent reply of the open thread and the thread so far cost, for Reply details.
  const threadConversationCost = useThreadConversationCostSummary(threadEvents, {
    history: {
      sdkLoaded: session.snapshot.open.sdkReady,
      canPaginateBack: threadState.canPaginateThreadBack,
      hasMoreCachedBack: threadHasMoreCachedBack,
    },
    getContent: getRowContent,
    ignoredUserIds: ignoredUsersSet,
    viewerId: mx.getUserId() ?? undefined,
  });
  // The parent's approvals keep their cards in a fork's prefix: the fork's plan leaves them be.
  const approvalTimeline = useThreadApprovalTimeline(
    ownThreadEvents,
    ignoredUsersSet,
    threadId,
    eventId,
    focusEventId
  );
  // Secret request cards the open thread's replies may draw at their tool calls. A card's row
  // hides while its line is mounted in a reply and at no other time, so the two never disagree.
  const secretRequestPlan = useInlineSecretRequestPlan({
    room,
    events: ownThreadEvents,
    getContent: getRowContent,
    ignored: ignoredUsersSet,
    viewerId: mx.getUserId() ?? undefined,
    threadId,
    routeId: eventId,
    focusId: focusEventId,
  });
  const drawnSecretRequestIds = useDrawnSecretRequestIds(secretRequestPlan);
  const secretRequestTimeline = useMemo(
    () => ({ hiddenEventIds: drawnSecretRequestIds }),
    [drawnSecretRequestIds]
  );
  const { trustedAccountIds, viewerId } = useTrustedRoomAccounts(room, ignoredUsersSet);
  // Paired among the rows the window draws: an echo hides only beside its drawn voice message.
  const voiceTranscripts = useVoiceTranscriptPlan({
    events: threadEvents,
    getContent: getRowContent,
    trustedAccountIds,
    ignored: ignoredUsersSet,
    revealed: pluginRevealedRef.current,
    viewerId,
    expectsAnswer: () =>
      room
        .getJoinedMembers()
        .some(({ userId }) => isMindroomResponderForViewer(userId, viewerId, trustedAccountIds)),
    hasThreadReplies: (event) => {
      const id = event.getId();
      return (
        (getKnownThreadReplyCount(event) ?? 0) > 0 ||
        (!!id && (room.getThread(id)?.length ?? 0) > 0)
      );
    },
  });
  // The open thread's model changes these accounts applied: one line each at its reply, the
  // command's row hidden.
  const { forksByPoint } = feature;
  const modelChanges = useModelChangePlan({
    events: threadEvents,
    getContent: getRowContent,
    trustedAccountIds,
    ignored: ignoredUsersSet,
    keeps: (id) =>
      pluginRevealedRef.current.has(id) || isHiddenByPluginId(id) || forksByPoint.has(id),
  });
  // What the open thread's agent replies left behind (a canvas, a reminder), cards under them; not
  // under a model change's line, which draws none.
  const replyCards = useReplyCardPlan(room, {
    threadId,
    events: ownThreadEvents,
    viewerId,
    isHidden: (event) => isHiddenByPlugin(event) || modelChanges.byAckId.has(event.getId() ?? ''),
    revealed: pluginRevealedRef.current,
  });
  const isHiddenBeforeFolding = useCallback(
    (event: MatrixEvent) =>
      isTimelineRowHidden(event, {
        messageData: { approvalTimeline, voiceTranscripts, replyCards, modelChanges },
        ignoredUsersSet,
        showHiddenEvents,
        isHiddenByPlugin,
      }),
    [
      approvalTimeline,
      voiceTranscripts,
      replyCards,
      modelChanges,
      ignoredUsersSet,
      showHiddenEvents,
      isHiddenByPlugin,
    ]
  );
  // Cards eligible to move into a reply do not split titles. Read the plan, not the mounted
  // lines: which replies mount depends on the folds.
  const isTitleRowHidden = useMemo(() => {
    const inlineCardIds = new Set<string>();
    secretRequestPlan.byReply.forEach((calls) =>
      calls.forEach(({ eventId: cardId }) => inlineCardIds.add(cardId))
    );
    return (event: MatrixEvent) =>
      isHiddenBeforeFolding(event) || inlineCardIds.has(event.getId() ?? '');
  }, [isHiddenBeforeFolding, secretRequestPlan.byReply]);
  const threadSummaryTimeline = useThreadSummaryTimeline(threadEvents, {
    history: {
      sdkLoaded: session.snapshot.open.sdkReady,
      canPaginateBack: threadState.canPaginateThreadBack,
      hasMoreCachedBack: threadHasMoreCachedBack,
    },
    getContent: getRowContent,
    isHidden: isTitleRowHidden,
    rowRepaintRevision: feature.rowRepaintRevision,
    routeId: eventId,
    focusId: focusEventId,
  });
  const { isQuietMarkerRow } = feature;
  const isTurnQuietMarker = useCallback(
    (event: MatrixEvent) =>
      isQuietMarkerRow(
        event,
        { threadSummaryTimeline, modelChanges, forkPrefixEventIds },
        rowTimelineSet
      ),
    [forkPrefixEventIds, isQuietMarkerRow, modelChanges, rowTimelineSet, threadSummaryTimeline]
  );
  // Secret request cards still count as rows of their turns: folding a reply can unmount its
  // inline line and give the card its own row again.
  const isTurnRowSkipped = useCallback(
    (event: MatrixEvent) =>
      threadSummaryTimeline.hiddenEventIds.has(event.getId() ?? '') || isHiddenBeforeFolding(event),
    [isHiddenBeforeFolding, threadSummaryTimeline]
  );
  const forkStartId = forkPrefix.parent ? ownThreadEvents[0]?.getId() : undefined;
  const turnPinnedIds = useMemo(() => {
    // The plugin rule's revealed rows, which its memo adds the route's and the jump's to.
    void isHiddenByPlugin;
    const ids = new Set(pluginRevealedRef.current);
    if (forkStartId) ids.add(forkStartId);
    if (shownForkPoint) ids.add(shownForkPoint);
    return ids;
  }, [forkStartId, isHiddenByPlugin, shownForkPoint]);
  const { jobs: backgroundJobs } = useRoomBackgroundJobs(room);
  const backgroundState = useMemo(
    () => indexThreadBackgroundJobs(backgroundJobs).get(threadId),
    [backgroundJobs, threadId]
  );
  const turnFolds = useThreadTurnFolds({
    room,
    threadId,
    events: threadEvents,
    viewerId,
    getContent: getRowContent,
    timelineSet: rowTimelineSet,
    isSkipped: isTurnRowSkipped,
    isQuietMarker: isTurnQuietMarker,
    pinnedIds: turnPinnedIds,
    backgroundState,
  });

  const timelineAtLiveEnd = isTimelineAtLiveEnd({
    threadId,
    liveTimelineLinked: true,
    rangeAtEnd: true,
    canPaginateThreadFront: threadState.canPaginateThreadFront,
    threadTailLoaded,
  });
  const atLiveEndRef = useLatestRef(timelineAtLiveEnd);
  const itemCount = threadEvents.length + threadLeadingOffset;
  // Rows hidden in the open thread, by its plans, by plugins and by folded turns, measure nothing
  // (the row that draws a folded turn's break measures the break, also when it is a secret
  // request card a reply draws); one shown again gets its estimate back, so a jump to it mounts it.
  const threadHiddenIds = useMemo(() => {
    if (
      pluginHiddenThreadIds.size === 0 &&
      secretRequestTimeline.hiddenEventIds.size === 0 &&
      voiceTranscripts.hiddenEventIds.size === 0 &&
      replyCards.hiddenEventIds.size === 0 &&
      modelChanges.hiddenEventIds.size === 0 &&
      turnFolds.view.hiddenIds.size === 0
    ) {
      return approvalTimeline.hiddenEventIds;
    }
    return new Set([
      ...approvalTimeline.hiddenEventIds,
      ...[...secretRequestTimeline.hiddenEventIds].filter((id) => !turnFolds.view.breaks.has(id)),
      ...voiceTranscripts.hiddenEventIds,
      ...replyCards.hiddenEventIds,
      ...modelChanges.hiddenEventIds,
      ...pluginHiddenThreadIds,
      ...turnFolds.view.hiddenIds,
    ]);
  }, [
    approvalTimeline.hiddenEventIds,
    secretRequestTimeline.hiddenEventIds,
    voiceTranscripts.hiddenEventIds,
    replyCards.hiddenEventIds,
    modelChanges.hiddenEventIds,
    pluginHiddenThreadIds,
    turnFolds.view,
  ]);
  const { estimateSize, getItemKey } = timelineRowSizing({
    threadId,
    compactLayout,
    threadEvents,
    hasThreadLoadOlder: showThreadLoadOlder,
    turnFolds: turnFolds.view,
    hiddenIds: threadHiddenIds,
    // Fixed per form factor so splitter drags do not re-estimate unmeasured rows above the reader.
    columnWidth: phone ? undefined : 960,
  });
  const threadLoadError = session.snapshot.open.loadError;
  const threadLoading = threadEvents.length === 0 && threadInitialRenderMode === 'loading';
  const ledger = useTimelineScrollLedgerController({
    estimateSize,
    getItemKey,
    getScrollElement,
    itemCount,
    latestAtTop: false,
    roomId: room.roomId,
    threadId,
    pinThreadLeadingItem: showThreadLoadOlder,
    anchorSkipLeading: threadLeadingOffset + (threadEvents[0]?.getId() === threadId ? 1 : 0),
    canLoadOlder: showThreadLoadOlder,
  });
  const { virtualizer } = ledger;
  const virtualizerRef = useLatestRef(virtualizer);
  cancelThreadScrollRef.current = () => virtualizerRef.current.cancelScroll();
  const { virtualItems, listHeight, listHeightHeld, heldEndSpacer, pendingListShrinkPx } =
    useHeldRowsLayout({
      ledger,
      itemCount,
      contentRef,
      latestAtTop: false,
      startAligned: true,
      forceRender,
    });
  useThreadApprovalRowMeasurements(
    virtualizer,
    threadEvents,
    threadHiddenIds,
    estimateSize,
    threadLeadingOffset
  );
  useTurnBreakRowMeasurements(
    virtualizer,
    threadEvents,
    turnFolds.view,
    estimateSize,
    threadLeadingOffset
  );

  const { scrollToElement, scrollThreadEventIntoView } = useThreadRowJumps({
    getScrollElement,
    virtualizerRef,
    threadEventIndexMapRef,
    threadLeadingOffsetRef,
  });
  const cancelThreadBottomSettle = useCallback(
    () => backController.suppressOpenBottomPin(),
    [backController]
  );
  const requestThreadOpenBottomPin = useCallback(
    () => backController.requestOpenBottomPin(scrollToBottomRef),
    [backController, scrollToBottomRef]
  );
  const gesturePins = useGestureBottomPins({
    backController,
    scrollToBottomRef,
    readerScrolledRef,
    onFirstGesture: forceRender,
    onThreadTakeover: onPrependBegin,
  });
  const clearHoldOffset = useCallback(
    () => clearVirtualizerHoldOffset(virtualizerRef.current),
    [virtualizerRef]
  );
  const scrollThreadToEnd = useCallback(
    (smooth = false) => {
      clearHoldOffset();
      virtualizerRef.current.scrollToEnd({ behavior: smooth ? 'smooth' : 'auto' });
    },
    [clearHoldOffset, virtualizerRef]
  );

  const { handleOpenEvent, openRoomEventRoute } = useRoomEventOpenController({
    alive,
    cancelThreadBottomSettle,
    effectiveViewMode: viewMode,
    focusEventInRoom,
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    mx,
    navigateRoomThread,
    threadTargets: session.targets,
    room,
    scrollRef,
    scrollThreadEventIntoView,
    scrollToBottomRef,
    scrollToElement,
    setFocusItem,
    notifyThreadEventsChanged: session.commands.notifyEventsChanged,
    setTimeline: forceRender,
    showHiddenEvents,
    threadEventIndexMapRef,
    threadId,
  });
  useRoomEventRouteOpenController({
    effectiveViewMode: viewMode,
    entryReturned,
    eventId,
    focusEventInRoom,
    openRoomEventRoute,
    roomId: room.roomId,
    roomOverviewOrderActive: false,
    threadId,
  });

  useRoomFocusScrollController({
    readMeasurementCorrectionPx: ledger.readMeasurementCorrectionPx,
    cancelThreadBottomSettle,
    alive,
    atBottomAnchorRef,
    editId: feature.editingEventId,
    focusItem,
    focusScrollResetToken: room.roomId,
    threadTargets: session.targets,
    pendingThreadOpenTick: session.snapshot.targetRevision,
    roomId: room.roomId,
    scrollRef,
    onBottomPin: clearHoldOffset,
    scrollThreadToEnd,
    scrollThreadEventIntoView,
    scrollToBottomRef,
    scrollToElement,
    setAtBottom,
    setFocusItem,
    isThreadOpenBottomPinSuppressed: backController.isOpenBottomPinSuppressed,
    requestThreadOpenBottomPin,
    cancelThreadOpenBottomPin: gesturePins.onThreadGesture,
    shouldApplyThreadBottomPin: gesturePins.shouldApplyBottomPin,
    threadEventIndexMapRef,
    threadEventsLength: threadEvents.length,
    threadId,
    threadInitialRenderMode,
    threadLatestOpenPending,
    threadOpenedAtLatest,
    threadUserScrolled,
    threadTimelineTick: session.snapshot.timelineRevision,
    timelineAtLiveEnd,
  });
  // After the pins above: a thread opening at its newest reply shows its rows once they rest there
  // (a local echo root, a thread still being created, has no open to wait for).
  const hideOpeningThreadRows = useThreadOpeningReveal({
    viewKey,
    opensAtLatest: !eventId && !isLocalEchoEventId(threadId),
    rows: threadEvents,
    indexOffset: threadLeadingOffset,
    scrollRef,
    readerTookOver: () =>
      readerScrolledRef.current.value || backController.isOpenBottomPinSuppressed(),
  });

  const { handleJumpToLatest: showLatestRows, handleOpenReply } =
    useRoomTimelineNavigationController({
      // A fork draft's address names its fork point, its last row: dropping it would end the draft.
      eventId: forkAt ? undefined : eventId,
      handleOpenEvent,
      navigateRoomThread,
      room,
      scrollToBottomRef,
      setAtBottom,
      threadId,
    });
  const handleJumpToLatest = useCallback(() => {
    setFocusItem(undefined);
    showLatestRows();
  }, [showLatestRows]);
  const stopFlick = useFlickStop(getScrollElement);
  const handleJumpToLatestTap = useCallback(() => {
    stopFlick();
    handleJumpToLatest();
  }, [handleJumpToLatest, stopFlick]);

  useTimelineReadReceiptController({
    atBottom,
    atBottomAnchorRef,
    atBottomRef,
    atLiveEndRef,
    getScrollElement,
    handleOpenEvent,
    hideActivity,
    mx,
    readsMainTimeline: true,
    room,
    setAtBottom,
    threadEventsLength: readThreadEvents.length,
    threadId,
    threadInitialRenderMode,
    threadEvents: readThreadEvents,
    threadTailLoaded,
    timelineAtLiveEnd,
  });

  const isViewportAtBottomNow = useViewportAtBottomNow(scrollRef, atBottomRef);
  const { refreshLatest, notifyEventsChanged, readEditResetEpoch, observeLiveTail } =
    session.commands;
  const refreshLatestThreadSlice = useCallback(
    (refreshThreadId: string) => refreshLatest(refreshThreadId, runtime),
    [refreshLatest, runtime]
  );
  useThreadAwareTimelineRefresh({
    room,
    threadId,
    liveTimelineLinked: true,
    refreshLatestThreadSlice,
    onRoomRefresh: NOOP,
  });
  const getLoadedThreadEvents = useCallback(() => ownThreadEventsRef.current, [ownThreadEventsRef]);
  useThreadGapRecovery({
    engine,
    room,
    threadId,
    append: renderPort.append,
    getLoadedEvents: getLoadedThreadEvents,
    debugTraceId: threadDebugTraceId,
  });
  useThreadEditBackfillController({
    atLiveEndRef,
    eventId,
    forceTimelineUpdate: forceRender,
    mx,
    beginThreadCacheWrite,
    room,
    scrollRef,
    scrollToBottomRef,
    notifyThreadEventsChanged: notifyEventsChanged,
    editResetEpoch: session.snapshot.open.editResetEpoch,
    readEditResetEpoch,
    threadEvents: ownThreadEvents,
    threadId,
    threadIdRef,
    threadTailLoaded,
  });
  useThreadSummaryPublishController({
    onStoreThreadSummary,
    room,
    thread: threadState.thread,
    threadEvents: ownThreadEvents,
    threadId,
    threadSummaryInfoMap: EMPTY_SUMMARY_INFO_MAP,
  });

  // Live rows. This registers the room's last timeline listener, after every other one.
  // Passing forceRender as setTimeline ensures local-echo transitions trigger a re-render.
  useRoomLiveRenderController({
    atBottomRef,
    atLiveEndRef,
    hideActivity,
    readsMainTimeline: true,
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    markLiveExpansionCandidate: feature.markLiveExpansionCandidate,
    mx,
    onStoreThreadSummary,
    room,
    scrollRef,
    scrollToBottomRef,
    setSupplementalThreadEvents: renderPort.append,
    observeLiveTail,
    notifyThreadEventsChanged: notifyEventsChanged,
    setTimeline: forceRender,
    showHiddenEvents,
    threadEventIndexMapRef,
    threadId,
    timelineAtLiveEnd,
  });

  // Scrolling near the top of a thread's loaded rows asks for older ones.
  const threadPaginatingBack = threadPagination.isPending('backward');
  useThreadAutoPaginateBack({
    scrollElement,
    virtualizerRef,
    threadId,
    paginatingBack: threadPaginatingBack,
    showLoadOlder: showThreadLoadOlder,
    hasUserScrollIntent: threadUserScrolled,
    leadingOffset: threadLeadingOffset,
    paginateBack: threadPagination.paginateBack,
  });

  const minimap = useRoomTimelineMinimap({
    threadEvents,
    scrollRef,
    handleOpenEvent,
  });

  const { paginateBack: paginateThreadBack } = threadPagination;
  const handleLoadOlderThread = useCallback(() => {
    void paginateThreadBack();
  }, [paginateThreadBack]);

  // After every other timeline observer so its passive ResizeObserver runs last.
  useTimelineLiveEnd({
    surface: threadUserScrolled ? 'thread' : undefined,
    itemCount,
    virtualizer,
    listHeightHeld,
    opensAtLatest: !eventId,
    latestAtTop: false,
    roomId: room.roomId,
    scrollElement,
    scrollToBottomRef,
    committedView: `${viewKey}|${viewMode}`,
    focusItem,
    onReaderGesture: gesturePins.onRoomGesture,
    pendingListShrinkPx,
    contentRef,
    footerProbeRef,
    isViewportAtBottomNow,
    atLiveEndRef,
    liveReplies: getLiveReplyStore(mx),
  });

  // The fork's divider sits over its first row of its own, after the parent's messages.
  // For cross-room forks, show the divider even when the prefix is empty (e.g. unjoined parent
  // room) so the reader still sees "Forked from another room" above the fork root.
  const { parent: forkParent } = forkPrefix;
  const ownStartIndex = threadEventIndexMap.get(ownThreadEvents[0]?.getId() ?? '');
  const isCrossRoomFork = Boolean(forkParent?.roomId && forkParent.roomId !== room.roomId);
  const forkStartIndex =
    forkParent && ownStartIndex !== undefined && (ownStartIndex > 0 || isCrossRoomFork)
      ? ownStartIndex
      : undefined;
  const forkParentRoomId = forkParent?.roomId ?? room.roomId;
  const forkDivider =
    forkParent && forkStartIndex !== undefined
      ? {
          index: forkStartIndex,
          node: (
            <ThreadForkDivider
              room={room}
              parent={forkParent}
              root={forkPrefix.events.find(
                (event) =>
                  event.getId() === forkParent.threadId &&
                  (event.getRoomId() ?? room.roomId) === forkParentRoomId
              )}
              summaryInfo={isCrossRoomFork ? undefined : summaryMap.get(forkParent.threadId)}
            />
          ),
        }
      : undefined;
  // A fork draft's line under its fork point, the last row it shows.
  const forkingDivider =
    shownForkPoint && forkPointIndex !== undefined
      ? {
          index: forkPointIndex,
          node: (
            <ThreadForkDivider
              room={room}
              parent={{ threadId, eventId: shownForkPoint }}
              summaryInfo={summaryMap.get(threadId)}
              variant="forking"
              targetRoomName={forkTargetRoomName}
            />
          ),
        }
      : undefined;
  const messageData: TimelineMessageData = {
    threadRecordMap: EMPTY_THREAD_RECORD_MAP,
    approvalTimeline,
    threadSummaryTimeline,
    secretRequestTimeline,
    voiceTranscripts,
    replyCards,
    modelChanges,
    handleOpenReply,
    forkPrefixEventIds,
  };
  const threadLoadOlderNode = showThreadLoadOlder ? (
    <ThreadLoadOlderLine
      paginatingBack={threadPaginatingBack}
      onLoadOlder={handleLoadOlderThread}
    />
  ) : undefined;
  const tiles = renderTimelineTiles({
    virtualItems,
    threadId,
    threadEvents,
    threadLoadOlderNode,
    ignoredUsersSet,
    showHiddenEvents,
    timelineSet: rowTimelineSet,
    focusItem,
    messageData,
    isHiddenByPlugin,
    isHiddenByPluginId,
    renderEvent: feature.renderEvent,
    isQuietMarkerRow: feature.isQuietMarkerRow,
    joinsQuietMarkerRun: feature.joinsQuietMarkerRun,
    forkDivider,
    forkingDivider,
    turnFolds,
    measureElement: ledger.measureElement,
  });

  return (
    <TimelineViewport
      containerStyle={threadViewStyle}
      justifyContent="Start"
      contentTop={
        <>
          {threadHeader && (
            <ThreadTimelineHeader
              gapAbove={threadHeaderGapAbove}
              onResize={ledger.holdThreadBannerResize}
              scrollRef={scrollRef}
            >
              {threadHeader}
            </ThreadTimelineHeader>
          )}
          <ThreadLoadingLines loadError={threadLoadError} loading={threadLoading} />
        </>
      }
      tiles={tiles}
      scroll={scroll}
      virtualInnerRef={ledger.virtualInnerRef}
      listHeight={listHeight}
      heldEndSpacer={heldEndSpacer}
      hideRows={hideOpeningThreadRows}
      threadCount={threadEvents.length}
      threadConversationCost={threadConversationCost}
      getImageSlides={getImageSlides}
      wrapExpansion={feature.wrapExpansion}
      secretRequestPlan={secretRequestPlan}
      minimap={minimap}
      atBottom={atBottom}
      onJumpToLatest={handleJumpToLatestTap}
      forkToRoomDialog={feature.forkToRoomDialog}
    />
  );
}
