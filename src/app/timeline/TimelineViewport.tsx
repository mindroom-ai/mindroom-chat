import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  RoomMemberEvent,
  type EventTimelineSet,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
} from 'matrix-js-sdk';
import { Box, Scroll, config } from 'folds';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useAlive } from '../lib/hooks/useAlive';
import { useForceUpdate } from '../lib/hooks/useForceUpdate';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { useIgnoredUsers } from '../matrix/hooks/useIgnoredUsers';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useSyncEngine } from '../event-store/engine';
import { useSettingValue } from '../preferences/useSettingValue';
import { MessageLayout, settingsAtom } from '../preferences/settings';
import { prefetchSettingsAtom } from '../event-store/engine/prefetchSettings';
import { sanitizePrefetchDepth } from '../event-store/engine/prefetchPolicy';
import { useStateEvent } from '../matrix/hooks/useStateEvent';
import { StateEvent } from '../matrix/types/room';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { isMindroomResponderForViewer } from '../matrix/protocol/agentIdentity';
import {
  MINDROOM_ACCOUNTS_STATE_EVENT,
  MINDROOM_ROUTER_STATE_EVENT,
  boundRoomRoster,
  trustedRoomAccountIds,
  trustedRouterUserId,
} from '../matrix/protocol/routerBinding';
import {
  buildImageSlides,
  ImageSlidesContext,
  type ImageSlide,
} from '../messages/content/imageSlides';
import { forkPrefixThreadId, rowEditTimelineSet, rowEventRoom } from './forkPrefixTimelineSet';
import { ThreadConversationCostProvider } from '../event-store/threads/useThreadConversationCost';
import {
  InlineSecretRequestsContext,
  NO_INLINE_SECRET_REQUESTS,
  type InlineSecretRequestPlan,
} from '../messages/inlineSecretRequests';
import { NO_MODEL_CHANGES } from '../messages/modelChanges';
import { NO_REPLY_CARDS } from './replyCards';
import { getLiveReplyStore } from '../messages/live/liveReplyStore';
import { InsetScrollbar } from '../ui/InsetScrollbar';
import * as overlay from '../ui/styles/RoomOverlay.css';
import { TimelineMinimap } from './TimelineMinimap';
import { notifyTimelineRowsChanged } from './typing/RoomViewTyping';
import type { useRoomTimelineMinimap } from './useRoomTimelineMinimap';
import { useFooterBottomPin } from './useFooterBottomPin';
import {
  useFlickStop,
  useGestureBottomPins,
  useTimelineScrollElement,
  useViewportAtBottomNow,
} from './roomTimelineScroll';
import type { ViewScopedFlag } from './roomTimelineViewScope';
import type { ThreadBackPaginationController } from './threadBackPaginationController';
import {
  clearVirtualizerHoldOffset,
  useTimelineScrollLedgerController,
} from './timelineScrollLedgerController';
import { useHeldRowsLayout } from './timelineLiveEnd';
import type { RoomTimelineFocusItem, ScrollToBottomState } from './roomFocusScrollController';
import { useRoomTimelineNavigationController } from './roomTimelineNavigationController';
import { useTimelineReadReceiptController } from './timelineReadReceiptController';
import { renderTimelineTiles } from './roomTimelineRows';
import type { useTimelineMessageFeature } from './message-rendering/useTimelineMessageFeature';
import type { TimelineMessageData } from './message-rendering/types';
import type { ThreadRecord } from '../event-store/threads/types';
import type { Timeline } from '../event-store/timeline/timelinePagination';
import { JumpToLatestAction, footerProbeStyle } from './RoomTimelineOverlays';

const NEVER_HIDDEN = () => false;
const EMPTY_IDS: ReadonlySet<string> = new Set();
const EMPTY_MESSAGE_DATA = {
  threadRecordMap: new Map<string, ThreadRecord>(),
  threadSummaryTimeline: { hiddenEventIds: EMPTY_IDS, markersByEventId: new Map() },
  secretRequestTimeline: { hiddenEventIds: EMPTY_IDS },
  replyCards: NO_REPLY_CARDS,
  modelChanges: NO_MODEL_CHANGES,
};

/** Shared client, engine, navigation, screen size, ignored users, and display settings. */
export const useTimelineEnvironment = () => {
  const mx = useMatrixClient();
  const alive = useAlive();
  const engine = useSyncEngine();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const ignoredUsers = useIgnoredUsers();
  const ignoredUsersSet = useMemo(() => new Set(ignoredUsers), [ignoredUsers]);
  const settings = {
    hideActivity: !!useSettingValue(settingsAtom, 'hideActivity'),
    hideMembershipEvents: !!useSettingValue(settingsAtom, 'hideMembershipEvents'),
    hideNickAvatarEvents: !!useSettingValue(settingsAtom, 'hideNickAvatarEvents'),
    messageLayout: useSettingValue(settingsAtom, 'messageLayout'),
    messageSpacing: useSettingValue(settingsAtom, 'messageSpacing'),
    showHiddenEvents: !!useSettingValue(settingsAtom, 'showHiddenEvents'),
    hideThreadFilterBar: !!useSettingValue(settingsAtom, 'hideThreadFilterBar'),
    prefetchDepth: sanitizePrefetchDepth(useSettingValue(prefetchSettingsAtom, 'prefetchDepth')),
  };
  const { showHiddenEvents, hideMembershipEvents, hideNickAvatarEvents } = settings;
  const filters = useMemo(
    () => ({ ignoredUsersSet, showHiddenEvents, hideMembershipEvents, hideNickAvatarEvents }),
    [ignoredUsersSet, showHiddenEvents, hideMembershipEvents, hideNickAvatarEvents]
  );
  return {
    mx,
    alive,
    engine,
    sessionId: engine.sessionId,
    phone,
    navigateRoom,
    navigateRoomThread,
    ignoredUsersSet,
    settings,
    compactLayout: settings.messageLayout === MessageLayout.Compact,
    filters,
  };
};

export type TimelineEnvironment = ReturnType<typeof useTimelineEnvironment>;

/** Bound router account, joined roster accounts, viewer ID, and room compose permission. */
export const useTrustedRoomAccounts = (room: Room, ignoredUsersSet: ReadonlySet<string>) => {
  const mx = useMatrixClient();
  const binding = useStateEvent(room, MINDROOM_ROUTER_STATE_EVENT);
  const routerBinding = binding?.isRedacted() ? undefined : binding;
  const powerLevels = usePowerLevelsContext();
  const roomCreators = useRoomCreators(room);
  const rawPowerLevels = useStateEvent(room, StateEvent.RoomPowerLevels)?.getContent();
  const boundUserId = useMemo(
    () => trustedRouterUserId(routerBinding, powerLevels, roomCreators, rawPowerLevels),
    [routerBinding, powerLevels, roomCreators, rawPowerLevels]
  );
  const rosterEvent = useStateEvent(room, MINDROOM_ACCOUNTS_STATE_EVENT, boundUserId ?? null);
  const roster = rosterEvent?.isRedacted() ? undefined : rosterEvent;
  const rosterAccountIds = useMemo(
    () => boundRoomRoster(boundUserId, roster),
    [boundUserId, roster]
  );
  const [membershipRevision, refreshMembership] = useForceUpdate();
  const joinedAccountIds = useMemo(() => {
    void membershipRevision;
    void rosterAccountIds;
    return new Set(room.getJoinedMembers().map((m) => m.userId));
  }, [room, membershipRevision, rosterAccountIds]);
  const trustedAccountIds = useMemo(
    () => trustedRoomAccountIds(boundUserId, rosterAccountIds, joinedAccountIds, ignoredUsersSet),
    [boundUserId, rosterAccountIds, joinedAccountIds, ignoredUsersSet]
  );
  const viewerId = mx.getUserId() ?? undefined;
  const roomPermissions = useRoomPermissions(roomCreators, powerLevels);
  const tombstone = useStateEvent(room, StateEvent.RoomTombstone);
  const canCompose = !!viewerId && roomPermissions.event('m.room.message', viewerId) && !tombstone;
  useLayoutEffect(() => {
    const onMembership = (_event: MatrixEvent, member: RoomMember, previous?: string) => {
      if (
        member.roomId === room.roomId &&
        (member.membership === 'join') !== (previous === 'join') &&
        (member.userId === boundUserId || rosterAccountIds.has(member.userId))
      ) {
        refreshMembership();
      }
    };
    mx.on(RoomMemberEvent.Membership, onMembership);
    return () => void mx.removeListener(RoomMemberEvent.Membership, onMembership);
  }, [mx, room.roomId, boundUserId, rosterAccountIds, refreshMembership]);
  return { trustedAccountIds, viewerId, canCompose };
};

export const roomExpectsVoiceAnswer = (
  room: Room,
  viewerId: string | undefined,
  trustedAccountIds: ReadonlySet<string>
) =>
  room
    .getJoinedMembers()
    .some(({ userId }) => isMindroomResponderForViewer(userId, viewerId, trustedAccountIds));

/** Stable getter for the open conversation's image slides. */
export const useTimelineImageSlides = (opts: {
  mx: MatrixClient;
  room: Room;
  events: readonly MatrixEvent[];
  rowTimelineSet: EventTimelineSet;
  forkPrefixEventIds?: ReadonlySet<string>;
  isHiddenByPlugin?: (event: MatrixEvent) => boolean;
  ignoredUsersSet: ReadonlySet<string>;
}): (() => readonly ImageSlide[]) => {
  const sourceRef = useLatestRef(opts);
  return useCallback(() => {
    const s = sourceRef.current;
    return buildImageSlides(
      s.events,
      (event) => {
        const prefix = s.forkPrefixEventIds
          ? forkPrefixThreadId(event, event.getId() ?? '', s.forkPrefixEventIds)
          : undefined;
        return rowEditTimelineSet(
          rowEventRoom(s.mx, s.room, event, prefix),
          prefix,
          s.rowTimelineSet
        );
      },
      s.isHiddenByPlugin ?? NEVER_HIDDEN,
      s.ignoredUsersSet
    );
  }, [sourceRef]);
};

/**
 * Sets up shared viewport refs and installs `useFooterBottomPin`. Call BEFORE
 * `useTimelineScrollLedgerController` so footer resize pins run before the ledger's layout pass.
 */
export const useTimelineScrollSetup = ({
  latestAtTop = false,
  scrollRef: externalScrollRef,
  scrollToBottomRef: externalScrollToBottomRef,
}: {
  latestAtTop?: boolean;
  scrollRef?: MutableRefObject<HTMLDivElement | null>;
  scrollToBottomRef?: MutableRefObject<ScrollToBottomState>;
} = {}) => {
  const scroll = useTimelineScrollElement(externalScrollRef);
  const footerProbeRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const atBottomAnchorRef = useRef<HTMLElement | null>(null);
  const internalScrollToBottomRef = useRef<ScrollToBottomState>({ count: 0, smooth: false });
  const scrollToBottomRef = externalScrollToBottomRef ?? internalScrollToBottomRef;
  const latestAtTopRef = useLatestRef(latestAtTop);
  const followLatestRows = useCallback(() => {
    if (latestAtTopRef.current) return;
    scrollToBottomRef.current = { count: scrollToBottomRef.current.count + 1, smooth: false };
  }, [latestAtTopRef, scrollToBottomRef]);
  useFooterBottomPin(scroll.scrollElement, footerProbeRef, followLatestRows);
  return {
    ...scroll,
    footerProbeRef,
    contentRef,
    atBottomAnchorRef,
    scrollToBottomRef,
    latestAtTopRef,
  };
};

export type TimelineScrollSetup = ReturnType<typeof useTimelineScrollSetup>;

/** Shared ledger -> held layout -> gesture pin setup for virtualized timeline rows. */
export const useTimelineListLedger = (
  scroll: TimelineScrollSetup,
  {
    startAligned,
    forceRender,
    readerScrolledRef,
    backController,
    onThreadTakeover,
    ...ledgerOptions
  }: Omit<Parameters<typeof useTimelineScrollLedgerController>[0], 'getScrollElement'> & {
    startAligned: boolean;
    forceRender: () => void;
    readerScrolledRef: MutableRefObject<ViewScopedFlag>;
    backController?: ThreadBackPaginationController;
    onThreadTakeover?: () => void;
  }
) => {
  const ledger = useTimelineScrollLedgerController({
    ...ledgerOptions,
    getScrollElement: scroll.getScrollElement,
  });
  const virtualizerRef = useLatestRef(ledger.virtualizer);
  const heldLayout = useHeldRowsLayout({
    ledger,
    itemCount: ledgerOptions.itemCount,
    contentRef: scroll.contentRef,
    latestAtTop: ledgerOptions.latestAtTop ?? false,
    startAligned,
    forceRender,
  });
  const gesturePins = useGestureBottomPins({
    backController,
    scrollToBottomRef: scroll.scrollToBottomRef,
    readerScrolledRef,
    onFirstGesture: forceRender,
    onThreadTakeover,
  });
  const clearHoldOffset = useCallback(
    () => clearVirtualizerHoldOffset(virtualizerRef.current),
    [virtualizerRef]
  );
  return {
    ledger,
    virtualizer: ledger.virtualizer,
    virtualizerRef,
    heldLayout,
    gesturePins,
    clearHoldOffset,
  };
};

export type TimelineListLedger = ReturnType<typeof useTimelineListLedger>;

/** Shared base fields for `useRoomFocusScrollController` from viewport setup. */
export const timelineFocusBase = (
  env: TimelineEnvironment,
  room: Room,
  scroll: TimelineScrollSetup,
  list: TimelineListLedger,
  feature: Pick<ReturnType<typeof useTimelineMessageFeature>, 'editingEventId'>
) => ({
  readMeasurementCorrectionPx: list.ledger.readMeasurementCorrectionPx,
  listHeightHeld: list.heldLayout.listHeightHeld,
  pendingListShrinkPx: list.heldLayout.pendingListShrinkPx,
  alive: env.alive,
  atBottomAnchorRef: scroll.atBottomAnchorRef,
  editId: feature.editingEventId,
  focusScrollResetToken: room.roomId,
  roomId: room.roomId,
  scrollRef: scroll.scrollRef,
  onBottomPin: list.clearHoldOffset,
  scrollToBottomRef: scroll.scrollToBottomRef,
  shouldApplyThreadBottomPin: list.gesturePins.shouldApplyBottomPin,
});

/** Shared base fields for `useTimelineLiveEnd` from viewport setup. */
export const timelineLiveEndBase = (
  mx: MatrixClient,
  scroll: TimelineScrollSetup,
  list: TimelineListLedger
) => ({
  virtualizer: list.virtualizer,
  listHeightHeld: list.heldLayout.listHeightHeld,
  scrollElement: scroll.scrollElement,
  scrollToBottomRef: scroll.scrollToBottomRef,
  onReaderGesture: list.gesturePins.onRoomGesture,
  pendingListShrinkPx: list.heldLayout.pendingListShrinkPx,
  contentRef: scroll.contentRef,
  footerProbeRef: scroll.footerProbeRef,
  liveReplies: getLiveReplyStore(mx),
});

type ReadReceiptInput = Parameters<typeof useTimelineReadReceiptController>[0];

/** Shared Jump-to-Latest / reply navigation, read receipts, and live viewport bottom check. */
export const useTimelineNavReceipts = (
  env: TimelineEnvironment,
  room: Room,
  scroll: TimelineScrollSetup,
  setFocusItem: Dispatch<SetStateAction<RoomTimelineFocusItem | undefined>>,
  opts: Omit<
    ReadReceiptInput,
    'atBottomAnchorRef' | 'getScrollElement' | 'hideActivity' | 'mx' | 'room' | 'threadEventsLength'
  > & {
    eventId?: string;
    prefetchDepth?: number;
    setTimeline?: Dispatch<SetStateAction<Timeline>>;
    showThreadRepliesInRoom?: boolean;
  }
) => {
  const {
    handleJumpToLatest: showLatestRows,
    handleJumpToUnread,
    handleOpenReply,
  } = useRoomTimelineNavigationController({
    ...env.filters,
    eventId: opts.eventId,
    handleOpenEvent: opts.handleOpenEvent,
    navigateRoom: env.navigateRoom,
    navigateRoomThread: env.navigateRoomThread,
    room,
    prefetchDepth: opts.prefetchDepth,
    scrollToBottomRef: scroll.scrollToBottomRef,
    setAtBottom: opts.setAtBottom,
    setTimeline: opts.setTimeline,
    showThreadRepliesInRoom: opts.showThreadRepliesInRoom,
    threadId: opts.threadId,
    readUptoEventId: opts.unreadInfo?.readUptoEventId,
  });
  const handleJumpToLatest = useCallback(() => {
    setFocusItem(undefined);
    showLatestRows();
  }, [setFocusItem, showLatestRows]);
  const stopFlick = useFlickStop(scroll.getScrollElement);
  const handleJumpToLatestTap = useCallback(() => {
    stopFlick();
    handleJumpToLatest();
  }, [handleJumpToLatest, stopFlick]);
  const { handleMarkAsRead } = useTimelineReadReceiptController({
    ...opts,
    room,
    mx: env.mx,
    hideActivity: env.settings.hideActivity,
    threadEventsLength: opts.threadEvents?.length,
    atBottomAnchorRef: scroll.atBottomAnchorRef,
    getScrollElement: scroll.getScrollElement,
  });
  const isViewportAtBottomNow = useViewportAtBottomNow(scroll.scrollRef, opts.atBottomRef);
  return {
    handleJumpToLatest,
    handleJumpToLatestTap,
    handleJumpToUnread,
    handleOpenReply,
    handleMarkAsRead,
    isViewportAtBottomNow,
  };
};

export type TimelineViewportProps = {
  env: Pick<TimelineEnvironment, 'ignoredUsersSet' | 'settings'>;
  containerStyle?: CSSProperties;
  justifyContent: 'Start' | 'End';
  latestAtTop?: boolean;
  filterBar?: ReactNode;
  unreadActions?: ReactNode;
  contentTop?: ReactNode;
  contentBottom?: ReactNode;
  topSentinel?: ReactNode;
  scroll: TimelineScrollSetup;
  list: TimelineListLedger;
  hideRows?: boolean;
  threadCount?: number;
  virtualInnerTestId?: string;
  threadConversationCost?: ComponentProps<typeof ThreadConversationCostProvider>['value'];
  getImageSlides: () => readonly ImageSlide[];
  feature: Pick<
    ReturnType<typeof useTimelineMessageFeature>,
    | 'renderEvent'
    | 'isQuietMarkerRow'
    | 'joinsQuietMarkerRun'
    | 'wrapExpansion'
    | 'forkToRoomDialog'
  >;
  secretRequestPlan?: InlineSecretRequestPlan;
  minimap?: ReturnType<typeof useRoomTimelineMinimap>;
  atBottom: boolean;
  onJumpToLatest: () => void;
  tiles: Omit<
    Parameters<typeof renderTimelineTiles>[0],
    | 'virtualItems'
    | 'ignoredUsersSet'
    | 'showHiddenEvents'
    | 'renderEvent'
    | 'isQuietMarkerRow'
    | 'joinsQuietMarkerRun'
    | 'measureElement'
    | 'messageData'
  > & {
    messageData: Pick<
      TimelineMessageData,
      'approvalTimeline' | 'voiceTranscripts' | 'handleOpenReply'
    > &
      Partial<TimelineMessageData>;
  };
};

export function TimelineViewport(p: TimelineViewportProps) {
  const { t } = useTranslation();
  useLayoutEffect(() => {
    notifyTimelineRowsChanged();
  }, []);
  useEffect(() => () => notifyTimelineRowsChanged(), []);
  const { env, scroll, list, feature, minimap, latestAtTop = false } = p;
  const latestEndAnchor = (
    <span ref={scroll.atBottomAnchorRef} style={{ display: 'block', height: 0 }} />
  );
  const tiles = renderTimelineTiles({
    ...p.tiles,
    messageData: { ...EMPTY_MESSAGE_DATA, ...p.tiles.messageData },
    virtualItems: list.heldLayout.virtualItems,
    ignoredUsersSet: env.ignoredUsersSet,
    showHiddenEvents: env.settings.showHiddenEvents,
    renderEvent: feature.renderEvent,
    isQuietMarkerRow: feature.isQuietMarkerRow,
    joinsQuietMarkerRun: feature.joinsQuietMarkerRun,
    measureElement: list.ledger.measureElement,
  });

  return (
    <Box grow="Yes" direction="Column" style={p.containerStyle}>
      <div ref={scroll.footerProbeRef} aria-hidden style={footerProbeStyle} />
      {p.filterBar}
      {p.unreadActions}
      <Scroll ref={scroll.attachScroll} className={overlay.Scroll} visibility="Hover" size="300">
        {latestAtTop && latestEndAnchor}
        <Box
          ref={scroll.contentRef}
          direction="Column"
          justifyContent={p.justifyContent}
          style={{
            minHeight: '100%',
            paddingTop: overlay.topInset,
            paddingBottom: `calc(${overlay.footerInset} + ${config.space.S400})`,
          }}
        >
          {p.contentTop}
          <ThreadConversationCostProvider value={p.threadConversationCost}>
            <ImageSlidesContext.Provider value={p.getImageSlides}>
              {feature.wrapExpansion(
                <div
                  ref={list.ledger.virtualInnerRef}
                  // This timeline's rows, for a row that looks for another (SecretRequestCard.tsx).
                  data-timeline-rows=""
                  data-thread-count={p.threadCount}
                  data-testid={p.virtualInnerTestId}
                  style={{
                    ...overlay.overviewInsetStop,
                    position: 'relative',
                    height: list.heldLayout.listHeight,
                    visibility: p.hideRows ? 'hidden' : undefined,
                  }}
                >
                  {p.topSentinel}
                  <InlineSecretRequestsContext.Provider
                    value={p.secretRequestPlan ?? NO_INLINE_SECRET_REQUESTS}
                  >
                    {tiles}
                  </InlineSecretRequestsContext.Provider>
                </div>
              )}
            </ImageSlidesContext.Provider>
          </ThreadConversationCostProvider>
          {p.contentBottom}
        </Box>
        {list.heldLayout.heldEndSpacer > 0 && (
          <div
            aria-hidden
            data-held-end-spacer=""
            style={{ height: list.heldLayout.heldEndSpacer, flexShrink: 0 }}
          />
        )}
        {!latestAtTop && latestEndAnchor}
        <InsetScrollbar
          scrollRef={scroll.scrollRef}
          contentRef={scroll.contentRef}
          className={overlay.Scrollbar}
          label={t('threadNav.messages')}
        />
        {minimap && minimap.minimapItems.length > 0 && (
          <TimelineMinimap
            items={minimap.minimapItems}
            stripMap={minimap.minimapStripMap}
            scrollRef={scroll.scrollRef}
            onSelect={minimap.handleMinimapSelect}
            onScrub={minimap.handleMinimapScrub}
          />
        )}
      </Scroll>
      {!p.atBottom && <JumpToLatestAction onSelect={p.onJumpToLatest} up={latestAtTop} />}
      {feature.forkToRoomDialog}
    </Box>
  );
}
