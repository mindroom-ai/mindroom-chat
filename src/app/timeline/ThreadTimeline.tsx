import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import { scheduleReconcile } from '../event-store/engine';
import { ThreadTimelineHeader } from '../threads/ThreadTimelineHeader';
import { useTimelineMessageFeature } from './message-rendering/useTimelineMessageFeature';
import { useRoomLiveRenderController } from './roomLiveRenderController';
import {
  useRoomFocusScrollController,
  type RoomTimelineFocusItem,
} from './roomFocusScrollController';
import {
  useRoomEventOpenController,
  useRoomEventRouteOpenController,
} from './roomEventOpenController';
import { useTimelineLiveEnd } from './timelineLiveEnd';
import { useRoomTimelineMinimap } from './useRoomTimelineMinimap';
import { useThreadAwareTimelineRefresh } from './useThreadAwareTimelineRefresh';
import { useTimelineDebugTraceIds } from './timelineDebugController';
import { useThreadTimelineState } from './useThreadTimelineState';
import { useCachedThreadRoot } from '../event-store/sdk/cachedThreadRoots';
import { useThreadForkPrefix } from '../threads/fork/useThreadForkPrefix';
import { ThreadForkDivider } from '../threads/fork/ThreadForkDivider';
import { useThreadSession } from '../threads/open/useThreadSession';
import { useThreadPagination } from '../threads/open/useThreadPagination';
import type {
  ThreadOpenRuntime,
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
import { useDrawnSecretRequestIds } from '../messages/inlineSecretRequests';
import { isTimelineAtLiveEnd } from '../event-store/timeline/timelineScrollUtils';
import { isLocalEchoEventId } from '../event-store/threads/threadRouteUtils';
import { getKnownThreadReplyCount } from '../event-store/threads/threadRecord';
import { useRoomBackgroundJobs } from '../matrix/hooks/useRoomBackgroundJobs';
import { indexThreadBackgroundJobs } from '../matrix/protocol/threadBackgroundJobs';
import { useThreadOpeningReveal } from './useThreadOpeningReveal';
import { useViewScopedFlag } from './roomTimelineViewScope';
import { useThreadOpenedAtLatest, useTimelineRowJumps } from './roomTimelineScroll';
import { useThreadAutoPaginateBack } from './roomTimelinePaginationWindow';
import { useMessageRowHidden } from '../plugins/messageRenderers';
import { isPluginHiddenRow } from './pluginHiddenRows';
import { useThreadTurnFolds, useTurnBreakRowMeasurements } from './useThreadTurnFolds';
import { isTimelineRowHidden, timelineRowSizing } from './roomTimelineRows';
import { useThreadLoadOlderMessages } from './roomTimelineWindowController';
import { ThreadLoadOlderLine, ThreadLoadingLines, threadViewStyle } from './RoomTimelineOverlays';
import {
  TimelineViewport,
  roomExpectsVoiceAnswer,
  timelineFocusBase,
  timelineLiveEndBase,
  useTimelineEnvironment,
  useTimelineImageSlides,
  useTimelineListLedger,
  useTimelineNavReceipts,
  useTimelineScrollSetup,
  useTrustedRoomAccounts,
} from './TimelineViewport';
import type { RoomTimelineProps } from './RoomTimeline';

const EMPTY_IDS: ReadonlySet<string> = new Set();
const NOOP_SEED_PORT: ThreadSeedOpenPort = { waitForExistingOrQueued: () => undefined };

export function ThreadTimeline(props: Omit<RoomTimelineProps, 'threadId'> & { threadId: string }) {
  const { room, eventId, threadId, summaryMap, onStoreThreadSummary, viewMode, forkAt } = props;
  const crossRoomForkTarget =
    props.forkTargetRoom?.roomId !== room.roomId ? props.forkTargetRoom : undefined;
  const env = useTimelineEnvironment();
  const { mx, alive, engine, sessionId, phone, navigateRoomThread, ignoredUsersSet, settings } =
    env;
  const viewKey = `${room.roomId}|${threadId}`;
  const threadIdRef = useLatestRef<string | undefined>(threadId);
  const [, forceRender] = useReducer((v: number) => v + 1, 0);
  const { threadDebugTraceId } = useTimelineDebugTraceIds({ eventId, room, threadId });

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

  const liveThreadRoot = room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId);
  const cachedThreadRoot = useCachedThreadRoot(room, threadId, liveThreadRoot);
  const forkPrefix = useThreadForkPrefix(room, liveThreadRoot ?? cachedThreadRoot);
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
  const forkPoint = forkPointIndex !== undefined ? threadEvents[forkPointIndex] : undefined;
  const shownForkPoint = forkPoint?.getId();
  const forkPrefixEventIds = useMemo(
    () => new Set((forkAt ? threadEvents : forkPrefix.events).flatMap((e) => e.getId() ?? [])),
    [forkAt, forkPrefix.events, threadEvents]
  );
  const readThreadEvents = useMemo(
    () =>
      forkPoint
        ? ownThreadEvents.slice(0, ownThreadEvents.indexOf(forkPoint) + 1)
        : ownThreadEvents,
    [forkPoint, ownThreadEvents]
  );
  const threadEventIndexMap = threadState.threadEventIndexMap ?? threadEventIndexMapRef.current;
  const { tailLoaded: threadTailLoaded, hasMoreCachedBack: threadHasMoreCachedBack } =
    session.snapshot.history;

  // Scroll setup installs useFooterBottomPin BEFORE useTimelineScrollLedgerController.
  const scroll = useTimelineScrollSetup();
  const { scrollRef, scrollElement, getScrollElement, scrollToBottomRef } = scroll;
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

  const openAtLatest = useThreadOpenedAtLatest(viewKey, session.snapshot.open.latestPending);
  const { startOpen: startOpenAtLatest, pinnedAtLatest } = openAtLatest;
  const renderPort = useMemo<ThreadRenderPort>(
    () => ({
      reset: (id) => threadStateRef.current.resetThreadRenderState(id),
      append: (id, events) => threadStateRef.current.setSupplementalThreadEvents(id, events),
      getEvents: (id) => threadStateRef.current.getThreadRenderEvents(id),
      invalidateTimeline: forceRender,
    }),
    [threadStateRef]
  );
  const beginThreadCacheWrite = useCallback(
    () => engine.persist.forRoom(room).persistThreadEventCache,
    [engine, room]
  );
  const threadDebugTraceIdRef = useLatestRef(threadDebugTraceId);
  const onThreadLoadErrorRef = useLatestRef(props.onThreadLoadError);
  const runtime = useMemo<ThreadOpenRuntime>(
    () => ({
      room,
      mx,
      sessionId,
      beginCacheWrite: beginThreadCacheWrite,
      reconcile: (args) =>
        scheduleReconcile({
          ...args,
          mx,
          sessionId,
          scheduler: engine.scheduler,
          debugTraceId: threadDebugTraceIdRef.current,
        }),
      seed: NOOP_SEED_PORT,
      render: renderPort,
      viewport: {
        resetForOpen: () => {
          backController.reset();
          startOpenAtLatest();
        },
        resetAfterLeave: () => backController.reset(),
        requestLatestPin: () => {
          if (backController.requestOpenBottomPin(scrollToBottomRef)) pinnedAtLatest();
        },
      },
      debugTraceId: threadDebugTraceId,
      onThreadLoadError: (id) => onThreadLoadErrorRef.current?.(id),
    }),
    [
      backController,
      beginThreadCacheWrite,
      engine.scheduler,
      mx,
      onThreadLoadErrorRef,
      pinnedAtLatest,
      renderPort,
      room,
      scrollToBottomRef,
      sessionId,
      startOpenAtLatest,
      threadDebugTraceId,
      threadDebugTraceIdRef,
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

  const readerScrolledRef = useViewScopedFlag(viewKey);
  const threadUserScrolled = readerScrolledRef.current.value;

  const feature = useTimelineMessageFeature({
    room,
    forkTargetRoom: crossRoomForkTarget,
    editor: props.editor,
    threadId,
    scrollRef,
    showThreadRepliesInRoom: false,
    messageLayout: settings.messageLayout,
    messageSpacing: settings.messageSpacing,
    hideActivity: settings.hideActivity,
  });
  const getRowContent = useCallback(
    (event: MatrixEvent) =>
      getLatestMessageContent(
        event,
        getEditedEvent(event.getId() ?? '', event, threadStateRef.current.threadTimelineSet)
      ) as Record<string, unknown>,
    [threadStateRef]
  );
  const threadRowHidden = useMessageRowHidden(mx.getUserId() ?? undefined);
  const pluginRevealedRef = useRef(new Set<string>());
  const isHiddenByPlugin = useMemo(() => {
    if (eventId) pluginRevealedRef.current.add(eventId);
    if (focusEventId) pluginRevealedRef.current.add(focusEventId);
    const revealed = pluginRevealedRef.current;
    return (event: MatrixEvent) =>
      isPluginHiddenRow(event, getRowContent, threadRowHidden, revealed);
  }, [eventId, focusEventId, getRowContent, threadRowHidden]);
  const isHiddenByPluginId = useCallback(
    (id: string) => {
      const event = threadRowHidden ? threadState.threadEventMap?.get(id) : undefined;
      return !!event && isHiddenByPlugin(event);
    },
    [threadRowHidden, threadState.threadEventMap, isHiddenByPlugin]
  );
  const pluginHiddenThreadIds = useMemo(
    () =>
      threadRowHidden
        ? new Set(threadEvents.filter(isHiddenByPlugin).flatMap((e) => e.getId() ?? []))
        : EMPTY_IDS,
    [threadRowHidden, threadEvents, isHiddenByPlugin]
  );
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
  const threadHistory = {
    sdkLoaded: session.snapshot.open.sdkReady,
    canPaginateBack: threadState.canPaginateThreadBack,
    hasMoreCachedBack: threadHasMoreCachedBack,
  };
  const { trustedAccountIds, viewerId } = useTrustedRoomAccounts(room, ignoredUsersSet);
  const threadConversationCost = useThreadConversationCostSummary(threadEvents, {
    history: threadHistory,
    getContent: getRowContent,
    ignoredUserIds: ignoredUsersSet,
    viewerId,
  });
  const approvalTimeline = useThreadApprovalTimeline(
    ownThreadEvents,
    ignoredUsersSet,
    threadId,
    eventId,
    focusEventId
  );
  const secretRequestPlan = useInlineSecretRequestPlan({
    room,
    events: ownThreadEvents,
    getContent: getRowContent,
    ignored: ignoredUsersSet,
    viewerId,
    threadId,
    routeId: eventId,
    focusId: focusEventId,
  });
  const drawnSecretRequestIds = useDrawnSecretRequestIds(secretRequestPlan);
  const secretRequestTimeline = useMemo(
    () => ({ hiddenEventIds: drawnSecretRequestIds }),
    [drawnSecretRequestIds]
  );
  const voiceTranscripts = useVoiceTranscriptPlan({
    events: threadEvents,
    getContent: getRowContent,
    trustedAccountIds,
    ignored: ignoredUsersSet,
    revealed: pluginRevealedRef.current,
    viewerId,
    expectsAnswer: () => roomExpectsVoiceAnswer(room, viewerId, trustedAccountIds),
    hasThreadReplies: (event) => {
      const id = event.getId();
      return (
        (getKnownThreadReplyCount(event) ?? 0) > 0 ||
        (!!id && (room.getThread(id)?.length ?? 0) > 0)
      );
    },
  });
  const modelChanges = useModelChangePlan({
    events: threadEvents,
    getContent: getRowContent,
    trustedAccountIds,
    ignored: ignoredUsersSet,
    keeps: (id) =>
      pluginRevealedRef.current.has(id) || isHiddenByPluginId(id) || feature.forksByPoint.has(id),
  });
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
        showHiddenEvents: settings.showHiddenEvents,
        isHiddenByPlugin,
      }),
    [
      approvalTimeline,
      voiceTranscripts,
      replyCards,
      modelChanges,
      ignoredUsersSet,
      settings.showHiddenEvents,
      isHiddenByPlugin,
    ]
  );
  const isTitleRowHidden = useMemo(() => {
    const inlineCardIds = new Set<string>();
    secretRequestPlan.byReply.forEach((calls) =>
      calls.forEach((c) => inlineCardIds.add(c.eventId))
    );
    return (event: MatrixEvent) =>
      isHiddenBeforeFolding(event) || inlineCardIds.has(event.getId() ?? '');
  }, [isHiddenBeforeFolding, secretRequestPlan.byReply]);
  const threadSummaryTimeline = useThreadSummaryTimeline(threadEvents, {
    history: threadHistory,
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
  const isTurnRowSkipped = useCallback(
    (event: MatrixEvent) =>
      threadSummaryTimeline.hiddenEventIds.has(event.getId() ?? '') || isHiddenBeforeFolding(event),
    [isHiddenBeforeFolding, threadSummaryTimeline]
  );
  const forkStartId = forkPrefix.parent ? ownThreadEvents[0]?.getId() : undefined;
  const turnPinnedIds = useMemo(() => {
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
  const threadHiddenIds = useMemo(() => {
    const extra = [
      voiceTranscripts.hiddenEventIds,
      replyCards.hiddenEventIds,
      modelChanges.hiddenEventIds,
      pluginHiddenThreadIds,
      turnFolds.view.hiddenIds,
    ];
    if (secretRequestTimeline.hiddenEventIds.size === 0 && extra.every((s) => s.size === 0)) {
      return approvalTimeline.hiddenEventIds;
    }
    const ids = new Set(approvalTimeline.hiddenEventIds);
    secretRequestTimeline.hiddenEventIds.forEach((id) => {
      if (!turnFolds.view.breaks.has(id)) ids.add(id);
    });
    extra.forEach((set) => set.forEach((id) => ids.add(id)));
    return ids;
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
    compactLayout: env.compactLayout,
    threadEvents,
    hasThreadLoadOlder: showThreadLoadOlder,
    turnFolds: turnFolds.view,
    hiddenIds: threadHiddenIds,
    columnWidth: phone ? undefined : 960,
  });
  const list = useTimelineListLedger(scroll, {
    estimateSize,
    getItemKey,
    itemCount,
    latestAtTop: false,
    roomId: room.roomId,
    threadId,
    pinThreadLeadingItem: showThreadLoadOlder,
    anchorSkipLeading: threadLeadingOffset + (threadEvents[0]?.getId() === threadId ? 1 : 0),
    canLoadOlder: showThreadLoadOlder,
    startAligned: true,
    forceRender,
    readerScrolledRef,
    backController,
    onThreadTakeover: onPrependBegin,
  });
  const { ledger, virtualizer, virtualizerRef, clearHoldOffset, gesturePins } = list;
  cancelThreadScrollRef.current = () => virtualizerRef.current.cancelScroll();
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

  const { scrollToElement, scrollThreadEventIntoView } = useTimelineRowJumps({
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
  const scrollThreadToEnd = useCallback(
    (smooth = false) => {
      clearHoldOffset();
      virtualizerRef.current.scrollToEnd({ behavior: smooth ? 'smooth' : 'auto' });
    },
    [clearHoldOffset, virtualizerRef]
  );

  const { handleOpenEvent, openRoomEventRoute } = useRoomEventOpenController({
    ...env.filters,
    alive,
    cancelThreadBottomSettle,
    effectiveViewMode: viewMode,
    focusEventInRoom: props.focusEventInRoom,
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
    threadEventIndexMapRef,
    threadId,
  });
  useRoomEventRouteOpenController({
    effectiveViewMode: viewMode,
    entryReturned: props.entryReturned,
    eventId,
    focusEventInRoom: props.focusEventInRoom,
    openRoomEventRoute,
    roomId: room.roomId,
    roomOverviewOrderActive: false,
    threadId,
  });
  useRoomFocusScrollController({
    ...timelineFocusBase(env, room, scroll, list, feature),
    cancelThreadBottomSettle,
    focusItem,
    threadTargets: session.targets,
    pendingThreadOpenTick: session.snapshot.targetRevision,
    scrollThreadToEnd,
    scrollThreadEventIntoView,
    scrollToElement,
    setAtBottom,
    setFocusItem,
    isThreadOpenBottomPinSuppressed: backController.isOpenBottomPinSuppressed,
    requestThreadOpenBottomPin,
    cancelThreadOpenBottomPin: gesturePins.onThreadGesture,
    threadEventIndexMapRef,
    threadEventsLength: threadEvents.length,
    threadId,
    threadInitialRenderMode,
    threadLatestOpenPending: openAtLatest.latestOpenPending,
    threadOpenedAtLatest: openAtLatest.openedAtLatest,
    threadUserScrolled,
    threadTimelineTick: session.snapshot.timelineRevision,
    timelineAtLiveEnd,
  });
  const hideOpeningThreadRows = useThreadOpeningReveal({
    viewKey,
    opensAtLatest: !eventId && !isLocalEchoEventId(threadId),
    rows: threadEvents,
    indexOffset: threadLeadingOffset,
    scrollRef,
    readerTookOver: () =>
      readerScrolledRef.current.value || backController.isOpenBottomPinSuppressed(),
  });

  const { handleJumpToLatestTap, handleOpenReply, isViewportAtBottomNow } = useTimelineNavReceipts(
    env,
    room,
    scroll,
    setFocusItem,
    {
      eventId: forkAt ? undefined : eventId,
      atBottom,
      atBottomRef,
      atLiveEndRef,
      handleOpenEvent,
      readsMainTimeline: true,
      setAtBottom,
      threadId,
      threadInitialRenderMode,
      threadEvents: readThreadEvents,
      threadTailLoaded,
      timelineAtLiveEnd,
    }
  );

  const { refreshLatest, notifyEventsChanged, readEditResetEpoch, observeLiveTail } =
    session.commands;
  const refreshLatestThreadSlice = useCallback(
    (id: string) => refreshLatest(id, runtime),
    [refreshLatest, runtime]
  );
  useThreadAwareTimelineRefresh({ room, threadId, refreshLatestThreadSlice });
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
  });
  // Live rows. Passing forceRender as setTimeline ensures local-echo transitions trigger repaint.
  useRoomLiveRenderController({
    ...env.filters,
    atBottomRef,
    atLiveEndRef,
    hideActivity: settings.hideActivity,
    readsMainTimeline: true,
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
    threadEventIndexMapRef,
    threadId,
    timelineAtLiveEnd,
  });

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
  const minimap = useRoomTimelineMinimap({ threadEvents, scrollRef, handleOpenEvent });
  const { paginateBack: paginateThreadBack } = threadPagination;
  const handleLoadOlderThread = useCallback(() => void paginateThreadBack(), [paginateThreadBack]);

  useTimelineLiveEnd({
    ...timelineLiveEndBase(mx, scroll, list),
    roomId: room.roomId,
    surface: threadUserScrolled ? 'thread' : undefined,
    itemCount,
    opensAtLatest: !eventId,
    latestAtTop: false,
    committedView: `${viewKey}|${viewMode}`,
    focusItem,
    isViewportAtBottomNow,
    atLiveEndRef,
  });

  const { parent: forkParent } = forkPrefix;
  const ownStartIndex = threadEventIndexMap.get(ownThreadEvents[0]?.getId() ?? '');
  const isCrossRoomFork = Boolean(forkParent?.roomId && forkParent.roomId !== room.roomId);
  const forkParentRoomId = forkParent?.roomId ?? room.roomId;
  const forkDivider =
    forkParent && ownStartIndex !== undefined && (ownStartIndex > 0 || isCrossRoomFork)
      ? {
          index: ownStartIndex,
          node: (
            <ThreadForkDivider
              room={room}
              parent={forkParent}
              root={forkPrefix.events.find(
                (e) =>
                  e.getId() === forkParent.threadId &&
                  (e.getRoomId() ?? room.roomId) === forkParentRoomId
              )}
              summaryInfo={isCrossRoomFork ? undefined : summaryMap.get(forkParent.threadId)}
            />
          ),
        }
      : undefined;
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
              targetRoomName={crossRoomForkTarget?.name || crossRoomForkTarget?.roomId}
            />
          ),
        }
      : undefined;

  return (
    <TimelineViewport
      env={env}
      containerStyle={threadViewStyle}
      justifyContent="Start"
      contentTop={
        <>
          {props.threadHeader && (
            <ThreadTimelineHeader
              gapAbove={props.threadHeaderGapAbove ?? false}
              onResize={ledger.holdThreadBannerResize}
              scrollRef={scrollRef}
            >
              {props.threadHeader}
            </ThreadTimelineHeader>
          )}
          <ThreadLoadingLines
            loadError={session.snapshot.open.loadError}
            loading={threadEvents.length === 0 && threadInitialRenderMode === 'loading'}
          />
        </>
      }
      scroll={scroll}
      list={list}
      hideRows={hideOpeningThreadRows}
      threadCount={threadEvents.length}
      threadConversationCost={threadConversationCost}
      getImageSlides={getImageSlides}
      feature={feature}
      secretRequestPlan={secretRequestPlan}
      minimap={minimap}
      atBottom={atBottom}
      onJumpToLatest={handleJumpToLatestTap}
      tiles={{
        threadId,
        threadEvents,
        threadLoadOlderNode: showThreadLoadOlder ? (
          <ThreadLoadOlderLine
            paginatingBack={threadPaginatingBack}
            onLoadOlder={handleLoadOlderThread}
          />
        ) : undefined,
        timelineSet: rowTimelineSet,
        focusItem,
        messageData: {
          approvalTimeline,
          threadSummaryTimeline,
          secretRequestTimeline,
          voiceTranscripts,
          replyCards,
          modelChanges,
          handleOpenReply,
          forkPrefixEventIds,
        },
        isHiddenByPlugin,
        isHiddenByPluginId,
        forkDivider,
        forkingDivider,
        turnFolds,
      }}
    />
  );
}
