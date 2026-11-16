import React, {
  type MutableRefObject,
  type RefObject,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, Icon, IconButton, Icons, Text, type RectCords } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useCompactThreadCardViewModels } from './compactThreadCardViewModel';
import type { CompactThreadCardViewModel, ThreadRecord } from '../../event-store/threads/types';
import { CompactThreadCard } from './CompactThreadCard';
import { CompactCardSwipe, useCompactCardSwipeList } from './CompactCardSwipe';
import { SwipeList } from './CompactCardSwipe.css';
import * as css from './CompactRoomView.css';
import { useToggleThreadResolution } from '../tags/useRoomThreadTags';
import { InsetScrollbar } from '../../ui/InsetScrollbar';
import * as overlay from '../../ui/styles/RoomOverlay.css';
import { useThreadPinning } from '../../event-store/threads/useThreadPinning';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import { useInitializeShownThread } from '../useInitializeShownThread';
import { type ScrollAnchorMemory, useScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { IconTooltip } from '../../ui/IconTooltip';
import { useListMotion } from '../../ui/listMotion';
import { MessageRowBoundary } from '../../messages/content/MessageRowBoundary';
import { useHeldThreadOrder, usePointerOverCards } from './useHeldThreadOrder';
import { firstRenderCardCount, useStagedCardIds } from './useStagedCardIds';
import { useThreadRootLiveCallRow } from './useThreadRootLiveCallRow';
import { LazyCallRow } from '../../calls/transcription/LazyCallRow';
import { ThreadCardBadges } from './ThreadCardBadges';
import { ThreadCardDetails } from './ThreadCardDetails';
import { useLongPress } from '../../lib/hooks/useLongPress';
import { useShortcut } from '../../shortcuts/useShortcut';
import {
  KEY_FOCUS_ATTRIBUTE,
  compactCardsIn,
  focusCompactCard,
  focusedCompactCard,
  handleCardArrowKey,
  noteCompactCardOrder,
} from './compactCardKeys';

const ThreadActionsMenu = lazy(() =>
  import('../ThreadActionsMenu').then((module) => ({ default: module.ThreadActionsMenu }))
);

export type CompactRoomViewProps = {
  room: Room;
  threadRootIds: string[];
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  onThreadClick: (threadRootId: string, summaryText?: string) => void;
  compactRoomScrollStateRef: MutableRefObject<ScrollAnchorMemory>;
  /** Whether the thread filter bar floats over the cards: they move down for it, and glide. */
  filterBarShown?: boolean;
};

type ThreadActionsMenuState = {
  roomId: string;
  rootId: string;
  anchor: RectCords;
  trigger?: HTMLElement;
  viewModel: CompactThreadCardViewModel;
};

type CompactThreadCardRowProps = {
  room: Room;
  scrollRootRef: RefObject<HTMLDivElement>;
  viewModel: CompactThreadCardViewModel;
  pinned: boolean;
  showResolveAction: boolean;
  showPinAction: boolean;
  actionsDisabled: boolean;
  swipeEnabled: boolean;
  menuOpen: boolean;
  resolveLabel: string;
  reopenLabel: string;
  pinLabel: string;
  moreLabel: string;
  onThreadClick: (threadRootId: string) => void;
  onSetResolved: (threadRootId: string, resolved: boolean) => void;
  onPin: (threadRootId: string, pinned: boolean) => void;
  onOpenMenu: (menu: ThreadActionsMenuState) => void;
};

const CompactThreadCardRow = React.memo(
  ({
    room,
    scrollRootRef,
    viewModel,
    pinned,
    showResolveAction,
    showPinAction,
    actionsDisabled,
    swipeEnabled,
    menuOpen,
    resolveLabel,
    reopenLabel,
    pinLabel,
    moreLabel,
    onThreadClick,
    onSetResolved,
    onPin,
    onOpenMenu,
  }: CompactThreadCardRowProps) => {
    const { roomId } = room;
    const rootId = viewModel.id.threadRootId;
    const shownRef = useInitializeShownThread(roomId, rootId, scrollRootRef);
    // A live call's row shows in its card as in the timeline: who is in the call, Join and
    // Transcript. Once the call ends the card is a thread like any other.
    const callRow = useThreadRootLiveCallRow(room, rootId);
    // Client plugins' marks for the thread, one node per thread so the memoized card does not
    // render again for them. A thread whose first message is still sending has none until the
    // server has confirmed it, so a badge is only ever given the root's own ID.
    const badges = useMemo(
      () =>
        isConfirmedMatrixEventId(rootId) ? (
          <ThreadCardBadges room={room} threadId={rootId} />
        ) : undefined,
      [room, rootId]
    );

    const openMenuAt = (x: number, y: number, shell: HTMLElement) => {
      onOpenMenu({
        roomId,
        rootId,
        viewModel,
        anchor: { x, y, width: 0, height: 0 },
        trigger: shell.querySelector<HTMLButtonElement>('[data-thread-root-id]') ?? undefined,
      });
    };
    const longPress = useLongPress(openMenuAt, (evt) =>
      evt.currentTarget.contains(evt.target as Node)
    );

    return (
      <div
        {...longPress}
        ref={shownRef}
        className={css.CardShell}
        data-scroll-anchor={rootId}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenuAt(event.clientX, event.clientY, event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          event.preventDefault();
          event.stopPropagation();
          onOpenMenu({
            roomId,
            rootId,
            viewModel,
            anchor: event.currentTarget.getBoundingClientRect(),
            trigger: event.target as HTMLElement,
          });
        }}
      >
        {/* What moves when the list changes (`useListMotion`): the element around it stays put,
            so the scroll position is measured on a card at rest. */}
        <div className={css.CardMotion} data-motion-row={rootId}>
          <CompactCardSwipe
            enabled={swipeEnabled}
            resolved={viewModel.isResolved}
            label={viewModel.isResolved ? reopenLabel : resolveLabel}
            onSwipe={(wasResolved) => onSetResolved(rootId, !wasResolved)}
          >
            <MessageRowBoundary
              render={() => (
                <CompactThreadCard
                  viewModel={viewModel}
                  onClick={onThreadClick}
                  attachment={callRow && <LazyCallRow {...callRow} />}
                  badges={badges}
                  room={room}
                />
              )}
            />
            <div className={css.CardAction}>
              {showResolveAction && (
                <IconTooltip label={resolveLabel} position="Top">
                  {(triggerRef) => (
                    <IconButton
                      ref={triggerRef}
                      className={css.CardQuickAction}
                      type="button"
                      size="300"
                      variant="Secondary"
                      fill="None"
                      radii="300"
                      aria-label={resolveLabel}
                      disabled={actionsDisabled}
                      onClick={() => onSetResolved(rootId, true)}
                      data-compact-thread-resolve="true"
                    >
                      <Icon size="100" src={Icons.Check} />
                    </IconButton>
                  )}
                </IconTooltip>
              )}
              {showPinAction && (
                <IconTooltip label={pinLabel} position="Top">
                  {(triggerRef) => (
                    <IconButton
                      ref={triggerRef}
                      className={css.CardQuickAction}
                      type="button"
                      size="300"
                      variant="Secondary"
                      fill="None"
                      radii="300"
                      aria-label={pinLabel}
                      disabled={actionsDisabled}
                      onClick={() => onPin(rootId, pinned)}
                      data-compact-thread-pin="true"
                    >
                      <Icon size="100" src={Icons.Pin} filled={pinned} />
                    </IconButton>
                  )}
                </IconTooltip>
              )}
              <IconTooltip label={moreLabel} position="Top">
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    className={css.CardMenuButton}
                    type="button"
                    size="300"
                    variant="Secondary"
                    fill="None"
                    radii="300"
                    aria-label={moreLabel}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
                      onOpenMenu({
                        roomId,
                        rootId,
                        viewModel,
                        anchor: event.currentTarget.getBoundingClientRect(),
                        trigger: event.currentTarget,
                      })
                    }
                  >
                    <Icon size="100" src={Icons.HorizontalDots} />
                  </IconButton>
                )}
              </IconTooltip>
            </div>
          </CompactCardSwipe>
        </div>
      </div>
    );
  }
);

const isKeyboardFocus = (element: Element): boolean => {
  if (element.hasAttribute(KEY_FOCUS_ATTRIBUTE)) return true;
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
};

export function CompactRoomView({
  room,
  threadRootIds,
  threadRecordMap,
  onThreadClick,
  compactRoomScrollStateRef,
  filterBarShown = false,
}: CompactRoomViewProps) {
  const { t } = useTranslation();
  const viewRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useCompactCardSwipeList(contentRef);
  const [menu, setMenu] = useState<ThreadActionsMenuState>();
  // While the reader points at or focuses a card, or has a card's menu open, the cards keep
  // their order so none moves under the pointer; the new order applies afterwards.
  const { pointerInside, ...pointerHandlers } = usePointerOverCards();
  const [focusInside, setFocusInside] = useState(false);
  const focusHeld = focusInside && !!contentRef.current?.contains(document.activeElement);
  const orderHeld = pointerInside || focusHeld || !!menu;
  const shownRootIds = useHeldThreadOrder(threadRootIds, orderHeld, viewRef);
  // A filter change mounts the cards it brings back a chunk at a time, and so does a mount after
  // the cards of its first screen, or of the place the reader left (`useScrollAnchorMemory`).
  const stagedRootIds = useStagedCardIds(
    room.roomId,
    shownRootIds,
    firstRenderCardCount(shownRootIds, compactRoomScrollStateRef.current.get(room.roomId))
  );
  const cardViewModels = useCompactThreadCardViewModels({
    room,
    threadRootIds: stagedRootIds,
    threadRecordMap,
  });
  const { canToggle, setResolved, updatingThreadRootIds, error } = useToggleThreadResolution(room);
  const pinning = useThreadPinning(room);
  const menuRef = useRef<ThreadActionsMenuState>();
  const openMenu = useCallback((nextMenu: ThreadActionsMenuState) => {
    menuRef.current = nextMenu;
    setMenu(nextMenu);
  }, []);
  const closeMenu = (selectedMenu: ThreadActionsMenuState) => {
    if (menuRef.current !== selectedMenu) return;
    menuRef.current = undefined;
    setMenu(undefined);
    const trigger = selectedMenu.trigger?.isConnected
      ? selectedMenu.trigger
      : viewRef.current?.querySelector<HTMLButtonElement>(
          `[data-thread-root-id="${CSS.escape(selectedMenu.rootId)}"]`
        ) ?? viewRef.current;
    trigger?.focus();
  };
  const menuModel =
    menu?.roomId === room.roomId
      ? cardViewModels.find((model) => model.id.threadRootId === menu.rootId) ?? menu.viewModel
      : undefined;
  useLayoutEffect(() => {
    menuRef.current = undefined;
    setMenu(undefined);
  }, [room.roomId]);
  const pinnedCards = cardViewModels.filter((model) =>
    pinning.pinnedEventIds.includes(model.id.threadRootId)
  );
  const ordinaryCards = cardViewModels.filter(
    (model) => !pinning.pinnedEventIds.includes(model.id.threadRootId)
  );
  // The cards glide to a new order or to the place the filter bar leaves them, a new one fades
  // in and one that left fades out. After the hook that holds the order: it scrolls the list
  // where the browser does not anchor it.
  const rootIdsOf = (models: CompactThreadCardViewModel[]) =>
    models.map((model) => model.id.threadRootId).join(',');
  const listMotion = useListMotion(
    contentRef,
    `${filterBarShown}|${rootIdsOf(pinnedCards)}|${rootIdsOf(ordinaryCards)}`
  );

  // The order the cards show in, pinned ones first, for the keys that step from an open thread
  // to the next (`useThreadKeys`): the cards themselves unmount under a thread that fills the page.
  const { pinnedEventIds } = pinning;
  useLayoutEffect(() => {
    const pinned = shownRootIds.filter((rootId) => pinnedEventIds.includes(rootId));
    noteCompactCardOrder(
      room.roomId,
      pinned.length === 0
        ? shownRootIds
        : [...pinned, ...shownRootIds.filter((rootId) => !pinnedEventIds.includes(rootId))]
    );
  }, [room.roomId, shownRootIds, pinnedEventIds]);

  // A fully stable click handler keeps the memoized cards from re-rendering
  // when unrelated threads update; the per-thread summary text and the latest
  // onThreadClick are resolved through refs at click time.
  const viewModelByRootRef = useRef<ReadonlyMap<string, CompactThreadCardViewModel>>(new Map());
  const onThreadClickRef = useRef(onThreadClick);
  const setResolvedRef = useRef(setResolved);
  const setPinnedRef = useRef(pinning.setPinned);
  // Synced after commit (not during render) so a discarded concurrent render
  // cannot leave uncommitted view models behind the stable click handler.
  useLayoutEffect(() => {
    viewModelByRootRef.current = new Map(
      cardViewModels.map((viewModel) => [viewModel.id.threadRootId, viewModel])
    );
    onThreadClickRef.current = onThreadClick;
    setResolvedRef.current = setResolved;
    setPinnedRef.current = pinning.setPinned;
  });
  const handleCardClick = useCallback((clickedThreadRootId: string) => {
    const viewModel = viewModelByRootRef.current.get(clickedThreadRootId);
    onThreadClickRef.current(clickedThreadRootId, viewModel?.recentThreadSummaryText);
  }, []);
  const handleSetResolved = useCallback((threadRootId: string, resolved: boolean) => {
    void setResolvedRef.current(threadRootId, resolved);
  }, []);
  const handlePin = useCallback((threadRootId: string, pinned: boolean) => {
    void setPinnedRef.current(threadRootId, !pinned);
  }, []);

  // On a focused card, the keys that resolve the open thread resolve or reopen the card's, and
  // the focus moves on to the next card: a resolved one may leave the list.
  useShortcut('resolveThread', () => {
    const card = focusedCompactCard(viewRef.current);
    const rootId = card?.dataset.threadRootId;
    const viewModel = rootId === undefined ? undefined : viewModelByRootRef.current.get(rootId);
    if (!card || !rootId || !viewModel) return false;
    const fixed =
      !canToggle ||
      pinnedEventIds.includes(rootId) ||
      !isConfirmedMatrixEventId(rootId) ||
      updatingThreadRootIds.has(rootId);
    if (fixed) return true;
    if (!viewModel.isResolved) {
      const cards = compactCardsIn(viewRef.current);
      const index = cards.indexOf(card);
      focusCompactCard(cards[index + 1] ?? cards[index - 1]);
    }
    handleSetResolved(rootId, !viewModel.isResolved);
    return true;
  });

  useEffect(() => {
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[CompactRoomView] Resolve failed:', error);
    }
  }, [error]);

  // Opening a card remounts this view, and threads that got replies meanwhile
  // sort above the cards that were in view, so restore by those cards.
  useScrollAnchorMemory({
    memory: compactRoomScrollStateRef.current,
    memoryKey: room.roomId,
    scrollRef: viewRef,
    contentRef,
    ready: cardViewModels.length > 0,
  });

  const resolveLabel = t('thread.resolve');
  const reopenLabel = t('threadActions.reopen');
  const pinLabel = t('threadNav.pin');
  const unpinLabel = t('threadNav.unpin');
  const moreLabel = t('threadActions.more');
  const renderCard = (viewModel: CompactThreadCardViewModel) => {
    const rootId = viewModel.id.threadRootId;
    const pinned = pinning.pinnedEventIds.includes(rootId);
    const showResolveAction = canToggle && !viewModel.isResolved && !pinned;
    // Touch screens hide the hover Resolve button; a swipe resolves or reopens.
    const swipeEnabled =
      canToggle &&
      menu?.rootId !== rootId &&
      !pinned &&
      isConfirmedMatrixEventId(rootId) &&
      !updatingThreadRootIds.has(rootId);
    const showPinAction = pinning.canPin && isConfirmedMatrixEventId(rootId);
    return (
      <CompactThreadCardRow
        key={rootId}
        room={room}
        scrollRootRef={viewRef}
        viewModel={viewModel}
        pinned={pinned}
        showResolveAction={showResolveAction}
        showPinAction={showPinAction}
        actionsDisabled={
          (showResolveAction || showPinAction) &&
          (pinning.updating || updatingThreadRootIds.has(rootId))
        }
        swipeEnabled={swipeEnabled}
        menuOpen={menu?.rootId === rootId && !!menuModel}
        resolveLabel={resolveLabel}
        reopenLabel={reopenLabel}
        pinLabel={pinned ? unpinLabel : pinLabel}
        moreLabel={moreLabel}
        onThreadClick={handleCardClick}
        onSetResolved={handleSetResolved}
        onPin={handlePin}
        onOpenMenu={openMenu}
      />
    );
  };

  return (
    <Box
      ref={viewRef}
      className={css.View}
      data-compact-room-view="true"
      // Cards still to mount: the cards' end is further down than the view's.
      data-cards-pending={stagedRootIds.length < shownRootIds.length || undefined}
      tabIndex={-1}
    >
      <Box
        ref={contentRef}
        className={`${SwipeList} ${css.Cards}`}
        style={overlay.overviewInsetStop}
        direction="Column"
        gap="100"
        shrink="No"
        data-order-held={orderHeld || undefined}
        {...pointerHandlers}
        onKeyDown={handleCardArrowKey}
        // Keyboard focus only: a card a mouse click left focused does not hold the order.
        onFocus={(event: React.FocusEvent<HTMLDivElement>) =>
          setFocusInside(isKeyboardFocus(event.target))
        }
        onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setFocusInside(false);
          }
        }}
      >
        {listMotion}
        {!!pinning.error && (
          <Text role="alert" size="T200">
            {t('thread.pinFailed')}
          </Text>
        )}
        {pinnedCards.length > 0 && (
          <Box
            as="section"
            direction="Column"
            gap="100"
            className={css.PinnedSection}
            aria-label={t('threadNav.pinned')}
            data-pinned-threads="true"
          >
            <Box alignItems="Center" gap="100">
              <Icon src={Icons.Pin} size="100" />
              <Text as="h2" size="L400">
                {t('threadNav.pinned')}
              </Text>
            </Box>
            {pinnedCards.map(renderCard)}
          </Box>
        )}
        {threadRootIds.length === 0 ? (
          <Box className={css.EmptyState}>
            <Text size="T300" priority="300">
              {t('mindroomUi.threads.compactRoomView.noThreads')}
            </Text>
          </Box>
        ) : (
          ordinaryCards.map(renderCard)
        )}
      </Box>
      <InsetScrollbar
        scrollRef={viewRef}
        contentRef={contentRef}
        className={overlay.Scrollbar}
        label={t('threadNav.messages')}
      />
      <ThreadCardDetails room={room} listRef={contentRef} menuOpen={!!menu} />
      {menu && menuModel && (
        <Suspense fallback={null}>
          <ThreadActionsMenu
            key={`${room.roomId}:${menu.rootId}`}
            room={room}
            rootId={menu.rootId}
            summaryText={menuModel.primarySummaryText}
            anchor={menu.anchor}
            onClose={() => closeMenu(menu)}
            onOpenThread={() => {
              if (menuRef.current !== menu) return;
              menuRef.current = undefined;
              setMenu(undefined);
              handleCardClick(menu.rootId);
            }}
          />
        </Suspense>
      )}
    </Box>
  );
}
