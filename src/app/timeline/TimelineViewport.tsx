import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
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
import { useForceUpdate } from '../lib/hooks/useForceUpdate';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { useSettingValue } from '../preferences/useSettingValue';
import { settingsAtom } from '../preferences/settings';
import { prefetchSettingsAtom } from '../event-store/engine/prefetchSettings';
import { sanitizePrefetchDepth } from '../event-store/engine/prefetchPolicy';
import { useStateEvent } from '../matrix/hooks/useStateEvent';
import { StateEvent } from '../matrix/types/room';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
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
import { InsetScrollbar } from '../ui/InsetScrollbar';
import * as overlay from '../ui/styles/RoomOverlay.css';
import { TimelineMinimap } from './TimelineMinimap';
import type { useRoomTimelineMinimap } from './useRoomTimelineMinimap';
import { useFooterBottomPin } from './useFooterBottomPin';
import { useTimelineScrollElement } from './roomTimelineScroll';
import type { ScrollToBottomState } from './roomFocusScrollController';
import { JumpToLatestAction, footerProbeStyle } from './RoomTimelineOverlays';

const NEVER_HIDDEN = () => false;

/** The display settings the timeline follows, each read on its own so a change re-renders. */
export const useTimelineDisplaySettings = () => ({
  hideActivity: !!useSettingValue(settingsAtom, 'hideActivity'),
  hideMembershipEvents: !!useSettingValue(settingsAtom, 'hideMembershipEvents'),
  hideNickAvatarEvents: !!useSettingValue(settingsAtom, 'hideNickAvatarEvents'),
  messageLayout: useSettingValue(settingsAtom, 'messageLayout'),
  messageSpacing: useSettingValue(settingsAtom, 'messageSpacing'),
  showHiddenEvents: !!useSettingValue(settingsAtom, 'showHiddenEvents'),
  hideThreadFilterBar: !!useSettingValue(settingsAtom, 'hideThreadFilterBar'),
  prefetchDepth: sanitizePrefetchDepth(useSettingValue(prefetchSettingsAtom, 'prefetchDepth')),
});

/**
 * Resolves the room's bound router account, its joined roster accounts (filtered by ignored users),
 * the viewer ID, and whether the viewer can post messages in this room.
 */
export const useTrustedRoomAccounts = (room: Room, ignoredUsersSet: ReadonlySet<string>) => {
  const mx = useMatrixClient();
  // Fold only messages from the bound account or joined accounts it vouches for.
  // The SDK may redact and re-emit the same state event object.
  const bindingEvent = useStateEvent(room, MINDROOM_ROUTER_STATE_EVENT);
  const routerBinding = bindingEvent?.isRedacted() ? undefined : bindingEvent;
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
    // A new roster can list someone whose membership changes we were not following before.
    void rosterAccountIds;
    return new Set(room.getJoinedMembers().map((member) => member.userId));
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
    return () => {
      mx.removeListener(RoomMemberEvent.Membership, onMembership);
    };
  }, [mx, room.roomId, boundUserId, rosterAccountIds, refreshMembership]);

  return { trustedAccountIds, viewerId, canCompose };
};

/**
 * Stable getter for the open conversation's image slides. Reading through a ref lets the viewer
 * pick up newly loaded slides without re-rendering when the timeline updates.
 */
export const useTimelineImageSlides = ({
  mx,
  room,
  events,
  rowTimelineSet,
  forkPrefixEventIds,
  isHiddenByPlugin = NEVER_HIDDEN,
  ignoredUsersSet,
}: {
  mx: MatrixClient;
  room: Room;
  events: readonly MatrixEvent[];
  rowTimelineSet: EventTimelineSet;
  forkPrefixEventIds?: ReadonlySet<string>;
  isHiddenByPlugin?: (event: MatrixEvent) => boolean;
  ignoredUsersSet: ReadonlySet<string>;
}): (() => readonly ImageSlide[]) => {
  const imageSlideSourceRef = useLatestRef({
    events,
    rowTimelineSet,
    forkPrefixEventIds,
    isHiddenByPlugin,
    ignoredUsersSet,
  });
  return useCallback(() => {
    const source = imageSlideSourceRef.current;
    return buildImageSlides(
      source.events,
      // As its row does.
      (event) => {
        const prefixThreadId = source.forkPrefixEventIds
          ? forkPrefixThreadId(event, event.getId() ?? '', source.forkPrefixEventIds)
          : undefined;
        return rowEditTimelineSet(
          rowEventRoom(mx, room, event, prefixThreadId),
          prefixThreadId,
          source.rowTimelineSet
        );
      },
      source.isHiddenByPlugin,
      source.ignoredUsersSet
    );
  }, [imageSlideSourceRef, mx, room]);
};

export type TimelineScrollSetup = {
  scrollRef: RefObject<HTMLDivElement | null>;
  scrollElement: HTMLDivElement | null;
  attachScroll: (element: HTMLDivElement | null) => void;
  getScrollElement: () => HTMLDivElement | null;
  footerProbeRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  atBottomAnchorRef: MutableRefObject<HTMLElement | null>;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  latestAtTopRef: MutableRefObject<boolean>;
};

/**
 * Sets up the shared viewport refs and installs `useFooterBottomPin`. Call this BEFORE
 * `useTimelineScrollLedgerController` so footer resize pins run before the ledger's layout pass.
 */
export const useTimelineScrollSetup = ({
  latestAtTop = false,
  scrollToBottomRef: externalScrollToBottomRef,
}: {
  latestAtTop?: boolean;
  scrollToBottomRef?: MutableRefObject<ScrollToBottomState>;
} = {}): TimelineScrollSetup => {
  const scroll = useTimelineScrollElement();
  // As tall as the footer inset: a growing composer moves the newest row up with it.
  const footerProbeRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const atBottomAnchorRef = useRef<HTMLElement | null>(null);
  const internalScrollToBottomRef = useRef<ScrollToBottomState>({ count: 0, smooth: false });
  const scrollToBottomRef = externalScrollToBottomRef ?? internalScrollToBottomRef;
  const latestAtTopRef = useLatestRef(latestAtTop);
  // Rows that wrap anew at another width still end at the bottom, as after a send.
  const followLatestRows = useCallback(() => {
    if (latestAtTopRef.current) return;
    const { count } = scrollToBottomRef.current;
    scrollToBottomRef.current = { count: count + 1, smooth: false };
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

export type TimelineViewportProps = {
  containerStyle?: CSSProperties;
  justifyContent: 'Start' | 'End';
  latestAtTop?: boolean;
  filterBar?: ReactNode;
  unreadActions?: ReactNode;
  contentTop?: ReactNode;
  contentBottom?: ReactNode;
  topSentinel?: ReactNode;
  tiles: ReactNode;
  scroll: Pick<
    TimelineScrollSetup,
    'scrollRef' | 'attachScroll' | 'footerProbeRef' | 'contentRef' | 'atBottomAnchorRef'
  >;
  virtualInnerRef: RefObject<HTMLDivElement | null>;
  listHeight: number;
  heldEndSpacer: number;
  hideRows?: boolean;
  threadCount?: number;
  virtualInnerTestId?: string;
  threadConversationCost?: ComponentProps<typeof ThreadConversationCostProvider>['value'];
  getImageSlides: () => readonly ImageSlide[];
  wrapExpansion: (node: ReactNode) => ReactNode;
  secretRequestPlan?: InlineSecretRequestPlan;
  minimap?: ReturnType<typeof useRoomTimelineMinimap>;
  atBottom: boolean;
  onJumpToLatest: () => void;
  forkToRoomDialog?: ReactNode;
};

export function TimelineViewport({
  containerStyle,
  justifyContent,
  latestAtTop = false,
  filterBar,
  unreadActions,
  contentTop,
  contentBottom,
  topSentinel,
  tiles,
  scroll,
  virtualInnerRef,
  listHeight,
  heldEndSpacer,
  hideRows = false,
  threadCount,
  virtualInnerTestId,
  threadConversationCost,
  getImageSlides,
  wrapExpansion,
  secretRequestPlan = NO_INLINE_SECRET_REQUESTS,
  minimap,
  atBottom,
  onJumpToLatest,
  forkToRoomDialog,
}: TimelineViewportProps) {
  const { t } = useTranslation();
  // Marks the rows' latest end for Jump to Latest and the read receipts.
  const latestEndAnchor = (
    <span ref={scroll.atBottomAnchorRef} style={{ display: 'block', height: 0 }} />
  );

  return (
    <Box grow="Yes" direction="Column" style={containerStyle}>
      <div ref={scroll.footerProbeRef} aria-hidden style={footerProbeStyle} />
      {filterBar}
      {unreadActions}
      <Scroll ref={scroll.attachScroll} className={overlay.Scroll} visibility="Hover" size="300">
        {latestAtTop && latestEndAnchor}
        <Box
          ref={scroll.contentRef}
          direction="Column"
          justifyContent={justifyContent}
          style={{
            minHeight: '100%',
            paddingTop: overlay.topInset,
            paddingBottom: `calc(${overlay.footerInset} + ${config.space.S400})`,
          }}
        >
          {contentTop}
          <ThreadConversationCostProvider value={threadConversationCost}>
            <ImageSlidesContext.Provider value={getImageSlides}>
              {wrapExpansion(
                <div
                  ref={virtualInnerRef}
                  // This timeline's rows, for a row that looks for another (SecretRequestCard.tsx).
                  data-timeline-rows=""
                  data-thread-count={threadCount}
                  data-testid={virtualInnerTestId}
                  style={{
                    ...overlay.overviewInsetStop,
                    position: 'relative',
                    height: listHeight,
                    visibility: hideRows ? 'hidden' : undefined,
                  }}
                >
                  {topSentinel}
                  <InlineSecretRequestsContext.Provider value={secretRequestPlan}>
                    {tiles}
                  </InlineSecretRequestsContext.Provider>
                </div>
              )}
            </ImageSlidesContext.Provider>
          </ThreadConversationCostProvider>
          {contentBottom}
        </Box>
        {heldEndSpacer > 0 && (
          <div
            aria-hidden
            data-held-end-spacer=""
            style={{ height: heldEndSpacer, flexShrink: 0 }}
          />
        )}
        {/* After the content's padding, so "at the bottom" means the end of the scroll range,
            not the last row, which sits a composer's height higher, behind the footer. */}
        {!latestAtTop && latestEndAnchor}
        {/* In the scroll area for its accessibility tree; the unpositioned Scroll leaves it
            placed by the timeline box, so it stays between the header and the composer. */}
        <InsetScrollbar
          scrollRef={scroll.scrollRef}
          contentRef={scroll.contentRef}
          className={overlay.Scrollbar}
          label={t('threadNav.messages')}
        />
        {/* Sits inside Scroll alongside InsetScrollbar for reader-gesture bubbling, while
            forwarding vertical wheel events to scrollRef because its containing block is the
            positioned timeline box outside Scroll. */}
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
      {!atBottom && <JumpToLatestAction onSelect={onJumpToLatest} up={latestAtTop} />}
      {forkToRoomDialog}
    </Box>
  );
}
