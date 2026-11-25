import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { Direction, type MatrixEvent } from 'matrix-js-sdk';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { useRoomUnread } from '../matrix/state/useUnread';
import { roomToUnreadAtom } from '../matrix/state/roomToUnread';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import { RoomIntro } from './RoomIntro';
import { CompactRoomWithoutThreads } from './CompactRoomWithoutThreads';
import { useTimelineMessageFeature } from './message-rendering/useTimelineMessageFeature';
import { useRoomFocusScrollController } from './roomFocusScrollController';
import { useTimelineLiveEnd } from './timelineLiveEnd';
import { useRoomAutomaticFill } from './roomAutomaticFill';
import { useThreadApprovalTimeline } from '../approvals/useThreadApprovalTimeline';
import { useVoiceTranscriptPlan } from '../messages/voiceTranscripts';
import { isTimelineAtLiveEnd } from '../event-store/timeline/timelineScrollUtils';
import { THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS } from '../event-store/cache/preloadSettings';
import { getKnownThreadReplyCount } from '../event-store/threads/threadRecord';
import { useViewScopedFlag } from './roomTimelineViewScope';
import {
  isNearLatestEnd,
  useLatestPinAsked,
  useThreadReturnPlace,
  useTimelineRowJumps,
  useViewportAtBottomNow,
  type RoomRowsPlace,
} from './roomTimelineScroll';
import {
  useRetryAfterPageWithoutRows,
  useRoomWindowPaginator,
  useWindowHoldsWholeFolds,
  useWindowKeepsNewestRow,
} from './roomTimelinePaginationWindow';
import {
  offersJumpToUnread,
  UnreadActions,
  useMarkRoomAsRead,
  useShownInScrollArea,
} from './roomTimelineUnread';
import { loadedRangeOfRows, rowIndexOfLoaded, type RenderedRoomRows } from './membershipFolds';
import {
  NO_RENDERED_ROOM_ROWS,
  forgetFormedFoldHeights,
  useMembershipFoldRowSizes,
  useMembershipFolds,
  useRoomRowWindow,
} from './useMembershipFolds';
import { isTimelineRowHidden, timelineRowSizing } from './roomTimelineRows';
import type { Timeline } from '../event-store/timeline/timelinePagination';
import { ExpandAllLine, listTopSentinelStyle } from './RoomTimelineOverlays';
import {
  TimelineViewport,
  roomExpectsVoiceAnswer,
  timelineFocusBase,
  timelineLiveEndBase,
  useTimelineImageSlides,
  useTimelineListLedger,
  useTimelineNavReceipts,
  useTimelineScrollSetup,
} from './TimelineViewport';
import type { RoomTimelineProps } from './RoomTimeline';
import type { RoomSurfaceState } from './RoomSurface';

const EMPTY_IDS: ReadonlySet<string> = new Set();
const getRoomRowContent = (event: MatrixEvent) =>
  getLatestMessageContent(event, getEditedEvent(event.getId() ?? '', event, undefined)) as Record<
    string,
    unknown
  >;

export function RoomRowsTimeline({
  props,
  state,
}: {
  props: RoomTimelineProps;
  state: RoomSurfaceState;
}) {
  const { room, eventId, viewMode } = props;
  const { env, threadIndex, windowState, latestAtTop, compactCards, trusted } = state;
  const { mx, alive, phone, ignoredUsersSet, settings } = env;
  const compactViewRequested = viewMode === 'compact';
  const showThreadRepliesInRoom = viewMode === 'classic';
  const { threadFilteredEvents: loadedRoomRows, activeTimelineRange: stateRange } = windowState;
  const roomUnread = !!useRoomUnread(room.roomId, roomToUnreadAtom);
  const viewKey = `${room.roomId}|`;
  const [unreadMarker, setUnreadMarker] = useState<HTMLDivElement | null>(null);
  const suppressFocusPaginationRef = useRef(false);
  const [, forceRender] = useReducer((v: number) => v + 1, 0);
  const threadRecordMapRef = useLatestRef(threadIndex.threadRecordMap);
  const firstRoomTimelineRef = useLatestRef(state.timeline.linkedTimelines[0]);
  const lastRoomTimelineRef = useLatestRef(
    state.timeline.linkedTimelines[state.timeline.linkedTimelines.length - 1]
  );
  const fallbackReturnPlaceRef = useRef<RoomRowsPlace>(undefined);

  // Scroll setup installs useFooterBottomPin BEFORE useTimelineScrollLedgerController.
  const scroll = useTimelineScrollSetup({
    latestAtTop,
    scrollRef: state.scrollRef,
    scrollToBottomRef: state.scrollToBottomRef,
  });
  const { scrollRef, scrollElement, getScrollElement, latestAtTopRef } = scroll;
  const unreadMarkerShown = useShownInScrollArea(unreadMarker, scrollElement);
  const readerScrolledRef = useViewScopedFlag(viewKey);

  const feature = useTimelineMessageFeature({
    room,
    forkTargetRoom: props.forkTargetRoom?.roomId !== room.roomId ? props.forkTargetRoom : undefined,
    editor: props.editor,
    scrollRef,
    showThreadRepliesInRoom,
    messageLayout: settings.messageLayout,
    messageSpacing: settings.messageSpacing,
    hideActivity: settings.hideActivity,
  });

  const revealedIdsRef = useRef(new Set<string>());
  const focusEventId = state.focusItem?.eventId;
  if (eventId) revealedIdsRef.current.add(eventId);
  if (focusEventId) revealedIdsRef.current.add(focusEventId);

  const rowTimelineSet = room.getUnfilteredTimelineSet();
  const getImageSlides = useTimelineImageSlides({
    mx,
    room,
    events: loadedRoomRows,
    rowTimelineSet,
    ignoredUsersSet,
  });
  const approvalTimeline = useThreadApprovalTimeline(
    loadedRoomRows,
    ignoredUsersSet,
    undefined,
    eventId,
    focusEventId
  );
  const voiceTranscripts = useVoiceTranscriptPlan({
    events: state.loadedWindowRows,
    getContent: getRoomRowContent,
    trustedAccountIds: trusted.trustedAccountIds,
    ignored: ignoredUsersSet,
    revealed: revealedIdsRef.current,
    viewerId: trusted.viewerId,
    expectsAnswer: () => roomExpectsVoiceAnswer(room, trusted.viewerId, trusted.trustedAccountIds),
    hasThreadReplies: (event) => {
      const id = event.getId();
      return (
        (getKnownThreadReplyCount(event) ?? 0) > 0 ||
        (!!id &&
          ((threadIndex.threadReplyCountMap.get(id) ?? 0) > 0 ||
            (room.getThread(id)?.length ?? 0) > 0))
      );
    },
  });
  const isHiddenBeforeFolding = useCallback(
    (event: MatrixEvent) =>
      isTimelineRowHidden(event, {
        messageData: { approvalTimeline, voiceTranscripts },
        ignoredUsersSet,
        showHiddenEvents: settings.showHiddenEvents,
      }),
    [approvalTimeline, voiceTranscripts, ignoredUsersSet, settings.showHiddenEvents]
  );

  // Separate from rows mounted: the 0-thread compact fallback stays start-aligned with no fill.
  const roomSurfaceShown = !compactViewRequested;
  const threadReturnPlace = useThreadReturnPlace({
    memoryRef: props.threadReturnPlaceRef ?? fallbackReturnPlaceRef,
    roomId: room.roomId,
    eventId,
    roomRowsShown: roomSurfaceShown,
    latestAtTop,
    scrollRef,
  });
  const membershipRevealedRef = useRef(new Set<string>());
  const returnEventId = threadReturnPlace?.eventId;
  const membershipPinnedIds = useMemo(() => {
    for (const id of [eventId, focusEventId, returnEventId]) {
      if (id) membershipRevealedRef.current.add(id);
    }
    return membershipRevealedRef.current.size === 0
      ? EMPTY_IDS
      : new Set(membershipRevealedRef.current);
  }, [eventId, focusEventId, returnEventId]);
  const membershipFolds = useMembershipFolds({
    mx,
    roomId: room.roomId,
    enabled: true,
    events: loadedRoomRows,
    entries: windowState.threadFilteredEventEntries,
    isSkipped: isHiddenBeforeFolding,
    pinnedIds: membershipPinnedIds,
  });
  const membershipFoldsRef = useLatestRef(membershipFolds.view);
  const renderedRoomRowsRef = useRef<RenderedRoomRows>(NO_RENDERED_ROOM_ROWS);
  forgetFormedFoldHeights(renderedRoomRowsRef.current, membershipFolds.view);
  const roomProjection = membershipFolds.rows;
  const roomProjectionRef = useLatestRef(roomProjection);
  const roomRows = roomProjection.rows;
  const roomRowsRef = useLatestRef(roomRows);
  const { rowRange: activeTimelineRange, loadedRange } = useRoomRowWindow(
    roomProjection,
    stateRange
  );
  const activeRangeRef = useLatestRef(activeTimelineRange);
  const loadedRangeOfRef = useRef((rowRange: Timeline['range']) =>
    loadedRangeOfRows(roomProjectionRef.current, rowRange)
  );
  const roomWindowRows = useMemo(
    () => roomRows.slice(activeTimelineRange.start, activeTimelineRange.end),
    [activeTimelineRange.end, activeTimelineRange.start, roomRows]
  );
  useWindowHoldsWholeFolds({
    timeline: state.timeline,
    roomWindow: !threadIndex.roomThreadFilterActive,
    stateRange,
    loadedRange,
    setTimeline: state.setTimeline,
  });
  useWindowKeepsNewestRow({
    activeTimelineRange: loadedRange,
    eventId,
    roomRowCount: loadedRoomRows.length,
    setTimeline: state.setTimeline,
  });
  const timelineAtLiveEnd = isTimelineAtLiveEnd({
    threadId: undefined,
    liveTimelineLinked: state.liveTimelineLinked,
    rangeAtEnd: activeTimelineRange.end >= roomRows.length,
    canPaginateThreadFront: false,
    threadTailLoaded: false,
  });
  const atLiveEndRef = useLatestRef(timelineAtLiveEnd);

  const automaticFill = useRoomAutomaticFill({
    viewKey,
    enabled: roomSurfaceShown && !eventId && !latestAtTop,
    latestEventId: loadedRoomRows[loadedRoomRows.length - 1]?.getId(),
    contentKey: `${loadedRange.start}:${loadedRange.end}:${loadedRoomRows.length}`,
    getScrollElement,
    isPaginating: () => state.roomPaginatingBackRef.current,
  });

  // Read live SDK tokens directly so an empty back-page updates showRoomIntro on this render.
  const canPaginateRoomBack =
    typeof firstRoomTimelineRef.current?.getPaginationToken(Direction.Backward) === 'string';
  const canPaginateRoomFront =
    typeof lastRoomTimelineRef.current?.getPaginationToken(Direction.Forward) === 'string';
  const showRoomIntro =
    state.liveTimelineLinked &&
    activeTimelineRange.start === 0 &&
    !canPaginateRoomBack &&
    !state.roomHasMoreCachedBack;
  const hasRoomLeadingIntro = showRoomIntro && !latestAtTop;
  const hasRoomLeadingTile = !latestAtTop && (hasRoomLeadingIntro || roomWindowRows.length > 0);
  const roomLeadingOffset = hasRoomLeadingTile ? 1 : 0;
  const roomLeadingOffsetRef = useLatestRef(roomLeadingOffset);
  const itemCount = roomWindowRows.length + roomLeadingOffset;
  const showRoomBackSentinel =
    activeTimelineRange.start > 0 || canPaginateRoomBack || state.roomHasMoreCachedBack;
  const showRoomFrontSentinel = activeTimelineRange.end < roomRows.length || canPaginateRoomFront;
  const { estimateSize, getItemKey } = timelineRowSizing({
    compactLayout: env.compactLayout,
    showThreadRepliesInRoom,
    hasRoomIntro: hasRoomLeadingTile,
    roomWindowRows,
    windowStart: activeTimelineRange.start,
    roomRowsRef,
    activeRangeRef,
    threadRecordMapRef,
    membershipFoldsRef,
    renderedRoomRowsRef,
    columnWidth: phone ? undefined : 960,
  });
  const anchorBelowLatestEnd = useCallback(() => {
    const scrollArea = getScrollElement();
    return !!scrollArea && !isNearLatestEnd(scrollArea, true);
  }, [getScrollElement]);
  const latestPinAsked = useLatestPinAsked(state.scrollToBottomRef);
  const list = useTimelineListLedger(scroll, {
    anchorRoomRows: latestAtTop && !latestPinAsked ? anchorBelowLatestEnd : undefined,
    estimateSize,
    getItemKey,
    itemCount,
    latestAtTop,
    roomId: room.roomId,
    threadId: undefined,
    pinThreadLeadingItem: false,
    anchorSkipLeading: roomLeadingOffset,
    canLoadOlder: !latestAtTop && showRoomBackSentinel,
    automaticFill: roomSurfaceShown ? { geometryReader: automaticFill.geometryReader } : undefined,
    startAligned: compactCards,
    forceRender,
    readerScrolledRef,
  });
  const { virtualizer, virtualizerRef, heldLayout } = list;
  useMembershipFoldRowSizes(
    virtualizer,
    roomWindowRows,
    membershipFolds.view,
    renderedRoomRowsRef,
    roomLeadingOffset
  );

  const { paginator, settledRoomPage, getRoomRowElement } = useRoomWindowPaginator({
    alive,
    roomRows,
    roomRowsRef,
    activeTimelineRange,
    activeRangeRef,
    loadedRangeOfRef,
    firstRoomTimelineRef,
    lastRoomTimelineRef,
    scrollRef,
    setTimeline: state.setTimeline,
    paginateRoom: state.paginateRoom,
    suppressFocusPaginationRef,
    windowLimit: state.windowLimit,
    getScrollElement,
    deferAutomaticPagination: automaticFill.defer,
    readAhead: !latestAtTop,
  });
  useRetryAfterPageWithoutRows(settledRoomPage, roomRowsRef, paginator.retryPagination);
  const { scrollToItem, scrollToElement } = useTimelineRowJumps({
    paginatorScrollToItem: paginator.scrollToItem,
    paginatorScrollToElement: paginator.scrollToElement,
    activeRangeRef,
    virtualizerRef,
    roomLeadingOffsetRef,
    rows: { getScrollElement, getRowElement: getRoomRowElement, roomRowsRef },
  });

  useRoomFocusScrollController({
    ...timelineFocusBase(env, room, scroll, list, feature),
    focusItem: state.focusItem,
    latestAtTopRef,
    retryPagination: paginator.retryPagination,
    scrollToElement,
    scrollToItem,
    setAtBottom: state.setAtBottom,
    setFocusItem: state.setFocusItem,
    suppressFocusPaginationRef,
    threadFilteredEvents: roomRows,
    threadFilteredEventsRef: roomRowsRef,
    foldedRows: roomProjection.foldedRows,
    timelineAtLiveEnd,
    unreadInfo: state.unreadInfo,
    unreadScrollAnchorIndex:
      windowState.unreadScrollAnchorIndex === undefined
        ? undefined
        : rowIndexOfLoaded(roomProjection, windowState.unreadScrollAnchorIndex),
  });

  const {
    handleJumpToLatest,
    handleJumpToLatestTap,
    handleJumpToUnread,
    handleOpenReply,
    handleMarkAsRead,
    isViewportAtBottomNow,
  } = useTimelineNavReceipts(env, room, scroll, state.setFocusItem, {
    eventId,
    prefetchDepth: state.windowLimit,
    setTimeline: state.setTimeline,
    showThreadRepliesInRoom,
    atBottom: state.atBottom,
    atBottomRef: state.atBottomRef,
    atLiveEndRef,
    latestAtTop,
    handleOpenEvent: state.handleOpenEvent,
    readUptoEventIdRef: state.readUptoEventIdRef,
    readsMainTimeline: !compactCards,
    setAtBottom: state.setAtBottom,
    classicRows: state.classicRows,
    timelineAtLiveEnd,
    unreadInfo: state.unreadInfo,
  });
  const markRoomAsRead = useMarkRoomAsRead(handleMarkAsRead, state.setUnreadInfo);
  const isViewportAtLatestNow = useViewportAtBottomNow(
    scrollRef,
    state.atBottomRef,
    latestAtTopRef
  );

  const followOwnSend = useCallback(() => {
    if (compactViewRequested) return;
    if (!atLiveEndRef.current) return handleJumpToLatest();
    state.scrollToBottomRef.current = {
      count: state.scrollToBottomRef.current.count + 1,
      smooth: false,
    };
  }, [atLiveEndRef, compactViewRequested, handleJumpToLatest, state.scrollToBottomRef]);

  // Publish live viewport operations to RoomSurface's persistent data controllers.
  state.atLiveEndRef.current = timelineAtLiveEnd;
  state.loadedRangeRef.current = loadedRange;
  state.roomRowsRef.current = roomRows;
  state.foldedRowsRef.current = roomProjection.foldedRows;
  state.viewportApiRef.current = {
    scrollToItem,
    scrollToElement,
    isViewportAtLatestNow,
    markLiveExpansionCandidate: feature.markLiveExpansionCandidate,
    followOwnSend,
  };
  useLayoutEffect(
    () => () => {
      state.viewportApiRef.current = null;
    },
    [state.viewportApiRef]
  );

  const returnRowIndex = threadReturnPlace
    ? roomRows.findIndex((e) => e.getId() === threadReturnPlace.eventId)
    : -1;
  const returnedRef = useRef(false);
  useLayoutEffect(() => {
    if (!threadReturnPlace || returnRowIndex === -1 || returnedRef.current) return;
    returnedRef.current = true;
    state.setFocusItem({
      eventId: threadReturnPlace.eventId,
      index: returnRowIndex,
      scrollTo: true,
      highlight: false,
      offset: threadReturnPlace.offset,
    });
  }, [returnRowIndex, state, threadReturnPlace]);

  const { expandAll, toggleExpandAll } = feature;
  const handleToggleExpandAll = useCallback(
    (evt: MouseEvent<HTMLButtonElement>) => {
      evt.preventDefault?.();
      toggleExpandAll();
    },
    [toggleExpandAll]
  );

  useTimelineLiveEnd({
    ...timelineLiveEndBase(mx, scroll, list),
    roomId: room.roomId,
    surface: roomSurfaceShown ? 'room' : undefined,
    itemCount,
    opensAtLatest:
      !eventId &&
      !threadReturnPlace &&
      (latestAtTop || !(state.unreadInfo?.scrollTo && state.unreadInfo.inLiveTimeline)),
    latestAtTop,
    committedView: `${viewKey}|${viewMode}`,
    focusItem: state.focusItem,
    isViewportAtBottomNow,
    atLiveEndRef,
  });

  const showJumpToUnread =
    !latestAtTop &&
    offersJumpToUnread({ unreadInfo: state.unreadInfo, roomUnread, unreadMarkerShown });
  const expandAllToggle = roomWindowRows.length > 0 && (
    <ExpandAllLine
      expanded={expandAll}
      onToggle={handleToggleExpandAll}
      atStart={phone && showJumpToUnread}
    />
  );
  const roomIntro =
    showRoomIntro &&
    (compactCards ? <CompactRoomWithoutThreads room={room} /> : <RoomIntro room={room} />);
  const backHeadroomPx =
    !latestAtTop && readerScrolledRef.current.value
      ? (virtualizer.measurementsCache[
          Math.min(THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS, itemCount - 1)
        ]?.start ?? 0)
      : 0;
  const topSentinelStyle =
    heldLayout.holdOffset !== 0 || backHeadroomPx > 1
      ? {
          ...listTopSentinelStyle,
          ...(heldLayout.holdOffset !== 0
            ? { insetBlockStart: -heldLayout.holdOffset }
            : undefined),
          ...(backHeadroomPx > 1 ? { height: backHeadroomPx } : undefined),
        }
      : listTopSentinelStyle;
  const backSentinel = showRoomBackSentinel && (
    <div ref={paginator.observeBackAnchor} style={latestAtTop ? { height: 1 } : topSentinelStyle} />
  );
  const frontSentinel = showRoomFrontSentinel && (
    <div
      ref={paginator.observeFrontAnchor}
      style={latestAtTop ? listTopSentinelStyle : { height: 1 }}
    />
  );

  return (
    <TimelineViewport
      env={env}
      containerStyle={state.roomStyle}
      justifyContent={compactCards || latestAtTop ? 'Start' : 'End'}
      latestAtTop={latestAtTop}
      filterBar={state.filterBar}
      unreadActions={
        showJumpToUnread && (
          <UnreadActions
            onJumpToUnread={handleJumpToUnread}
            onMarkAsRead={markRoomAsRead}
            clearStart={phone}
          />
        )
      }
      contentTop={latestAtTop && expandAllToggle}
      contentBottom={
        latestAtTop ? (
          <>
            {roomIntro}
            {backSentinel}
          </>
        ) : (
          frontSentinel
        )
      }
      topSentinel={latestAtTop ? frontSentinel : backSentinel}
      scroll={scroll}
      list={list}
      hideRows={automaticFill.hideInitialRows}
      virtualInnerTestId="room-virtual-inner"
      getImageSlides={getImageSlides}
      feature={feature}
      atBottom={state.atBottom}
      onJumpToLatest={handleJumpToLatestTap}
      tiles={{
        roomIntroNode: hasRoomLeadingTile ? (
          <>
            {hasRoomLeadingIntro && roomIntro}
            {expandAllToggle}
          </>
        ) : undefined,
        roomWindowRows,
        roomRowEntries: roomProjection.entries,
        windowStart: activeTimelineRange.start,
        readUptoAbsoluteIndex: latestAtTop ? undefined : windowState.readUptoAbsoluteIndex,
        timelineSet: rowTimelineSet,
        focusItem: state.focusItem,
        messageData: {
          threadRecordMap: threadIndex.threadRecordMap,
          approvalTimeline,
          voiceTranscripts,
          handleOpenReply,
        },
        membershipFolds,
        unreadMarkerRef: setUnreadMarker,
      }}
    />
  );
}
