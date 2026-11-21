import React, {
  type MutableRefObject,
  type RefObject,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Box, Button, Icon, IconButton, Icons, Text, type RectCords } from 'folds';
import { useAtom } from 'jotai';
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
import { SecondThreadContext, setThreadDragData } from '../../navigation/secondThread';
import { type ScrollAnchorMemory, useScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { IconTooltip } from '../../ui/IconTooltip';
import { useListMotion } from '../../ui/listMotion';
import { MessageRowBoundary } from '../../messages/content/MessageRowBoundary';
import { useHeldThreadOrder, usePointerOverCards } from './useHeldThreadOrder';
import {
  type CompactFocusRequest,
  compactFocusPlace,
  isCompactFocusRequestOpen,
  meetCompactFocusRequest,
} from './compactFocusRequest';
import { useCompactBlocks, type CompactBlockRow } from './useCompactBlocks';
import { useThreadRootLiveCallRow } from './useThreadRootLiveCallRow';
import { LazyCallRow } from '../../calls/transcription/LazyCallRow';
import { ThreadCardBadges } from './ThreadCardBadges';
import { useCompactThreadSections } from './useCompactThreadSections';
import { holdCompactThreadSections, type CompactThreadSection } from './compactThreadSections';
import { getCompactRoomSectionsAtom } from './compactRoomSections';
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import { ThreadCardDetails } from './ThreadCardDetails';
import { useLongPress } from '../../lib/hooks/useLongPress';
import { useShortcut } from '../../shortcuts/useShortcut';
import {
  KEY_FOCUS_ATTRIBUTE,
  compactCardsIn,
  focusCompactCard,
  focusedCompactCard,
  handleCardArrowKey,
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
  /** The card the address asks to show, when it asks for one. */
  focusRequest?: CompactFocusRequest;
  /** Whether the thread filter bar floats over the cards: they move down for it, and glide. */
  filterBarShown?: boolean;
  /**
   * Set while the cards show in sections (Needs you, Working, Later and Done, each folding on its
   * own): the snooze clock the list was filtered at (`useThreadIndex`'s `snoozeNow`), which the
   * sections classify at too, so they show what the selected tab does.
   */
  sectionsNow?: number;
};

// A section's header among the cards' rows; no event ID starts with it.
const SECTION_ROW_PREFIX = 'section:';
const sectionRowKey = (id: ThreadWorkflowBucket): string => `${SECTION_ROW_PREFIX}${id}`;
const sectionOfRow = (key: string): ThreadWorkflowBucket | undefined =>
  key.startsWith(SECTION_ROW_PREFIX)
    ? (key.slice(SECTION_ROW_PREFIX.length) as ThreadWorkflowBucket)
    : undefined;
const NO_FOLDS: readonly ThreadWorkflowBucket[] = [];

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
    // A card the room page could show in its second column drags there, pressed with a mouse (a
    // finger or a pen keeps its swipe and long press). A plain click still opens it: a drag needs
    // the mouse to move.
    const offered = !!useContext(SecondThreadContext)?.offers(roomId, rootId);
    const [mousePressed, setMousePressed] = useState(false);
    const draggable = offered && mousePressed;

    return (
      <div
        {...longPress}
        ref={shownRef}
        className={css.CardShell}
        data-scroll-anchor={rootId}
        // The phone slide can keep just this shell outside the list's clip. Card adornments
        // stay by the row, and popovers that can escape it render in the portal instead.
        data-page-slide-row=""
        draggable={draggable || undefined}
        onPointerDown={
          offered ? (event) => setMousePressed(event.pointerType === 'mouse') : undefined
        }
        onDragStart={(event) => {
          // A drag of something in the card (an avatar) stays its own.
          if (event.target !== event.currentTarget) return;
          if (draggable) setThreadDragData(event.dataTransfer, { roomId, rootId });
          else if (offered) event.preventDefault();
        }}
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
  focusRequest,
  filterBarShown = false,
  sectionsNow,
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
  const pinning = useThreadPinning(room);
  const pinnedRootIds = useMemo(
    () => threadRootIds.filter((rootId) => pinning.pinnedEventIds.includes(rootId)),
    [pinning.pinnedEventIds, threadRootIds]
  );
  const threadSections = useCompactThreadSections({
    room,
    now: sectionsNow,
    threadRootIds,
    threadRecordMap,
    pinnedRootIds,
  });
  const [sectionsChoice, updateSectionsChoice] = useAtom(
    useMemo(() => getCompactRoomSectionsAtom(room.myUserId ?? ''), [room.myUserId])
  );
  // While held, headers stay and shown cards keep their sections and order.
  // The hook below holds no order in sections. Only hold this room's sections: the view
  // stays mounted when the next room opens under the pointer.
  const shownSectionsRef = useRef<{ roomId: string; sections?: CompactThreadSection[] }>();
  const heldSections = useMemo(() => {
    const shown = shownSectionsRef.current;
    return orderHeld && threadSections && shown?.roomId === room.roomId && shown.sections
      ? holdCompactThreadSections(threadSections, shown.sections)
      : threadSections;
  }, [orderHeld, room.roomId, threadSections]);
  useLayoutEffect(() => {
    shownSectionsRef.current = { roomId: room.roomId, sections: heldSections };
  }, [heldSections, room.roomId]);
  // A section that shows alone, as under its workflow tab, is open: its stored fold waits for the
  // other sections to come back. If another section appears, such as Working below Needs you,
  // the original stays open until the hold lets go or the reader folds it.
  const soleSection = heldSections?.length === 1;
  const heldOpenRef = useRef<{ roomId: string; id: ThreadWorkflowBucket }>();
  const [, showFolds] = useReducer((count: number) => count + 1, 0);
  const heldOpen = soleSection
    ? heldSections?.[0]?.id
    : orderHeld && heldOpenRef.current?.roomId === room.roomId
    ? heldOpenRef.current.id
    : undefined;
  useLayoutEffect(() => {
    heldOpenRef.current = heldOpen ? { roomId: room.roomId, id: heldOpen } : undefined;
  }, [heldOpen, room.roomId]);
  const folded = useMemo(
    () => (soleSection ? NO_FOLDS : sectionsChoice.folded.filter((id) => id !== heldOpen)),
    [heldOpen, sectionsChoice.folded, soleSection]
  );
  const toggleFold = (id: ThreadWorkflowBucket) => {
    // A section held open shows open, so its header folds it, stored as folded once.
    if (id === heldOpen) {
      heldOpenRef.current = undefined;
      showFolds();
      if (sectionsChoice.folded.includes(id)) return;
    }
    updateSectionsChoice({ type: 'TOGGLE_FOLD', id });
  };
  // In sections, the list's rows are each section's header and, unless it is folded, its cards.
  const listedRows = useMemo(
    () =>
      heldSections
        ? heldSections.flatMap(({ id, rootIds }) => [
            sectionRowKey(id),
            ...(folded.includes(id) ? [] : rootIds),
          ])
        : threadRootIds,
    [folded, heldSections, threadRootIds]
  );
  const shownRows = useHeldThreadOrder(
    listedRows,
    orderHeld && !heldSections,
    viewRef,
    sectionOfRow
  );
  const memory = compactRoomScrollStateRef.current;
  const requestKey = focusRequest && `${focusRequest.entryKey ?? ''} ${focusRequest.eventId}`;
  const mountRequestKeyRef = useRef(requestKey);
  const pushed =
    focusRequest?.pushed &&
    requestKey !== mountRequestKeyRef.current &&
    isCompactFocusRequestOpen(memory, focusRequest);
  const groups = useMemo(() => {
    if (heldSections)
      return [[], ...heldSections.map(({ id, rootIds }) => (folded.includes(id) ? [] : rootIds))];
    const pinned = new Set(pinnedRootIds);
    return [shownRows.filter((id) => pinned.has(id)), shownRows.filter((id) => !pinned.has(id))];
  }, [folded, heldSections, pinnedRootIds, shownRows]);
  const blocks = useCompactBlocks({
    groups,
    scrollRef: viewRef,
    contentRef,
    memory,
    roomId: room.roomId,
    target: pushed ? focusRequest.eventId : undefined,
    protectedId: menu?.rootId,
  });
  const cardViewModels = useCompactThreadCardViewModels({
    room,
    threadRootIds: blocks.liveIds,
    threadRecordMap,
  });
  const { canToggle, setResolved, updatingThreadRootIds, error } = useToggleThreadResolution(room);
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
  const modelByRootId = new Map(cardViewModels.map((model) => [model.id.threadRootId, model]));
  // Each header counts its section's threads now: one that a held order still shows after it
  // emptied counts none until the order is let go.
  const sectionCounts = new Map(
    (threadSections ?? []).map(({ id, rootIds }) => [id, rootIds.length] as const)
  );
  // Discovery changes mounts, not the logical order that drives motion.
  const listMotion = useListMotion(
    contentRef,
    `${filterBarShown}|${shownRows.join(',')}|${pinnedRootIds.join(',')}`
  );

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
  // the focus moves on to the next card: under a filter, either may take the card off the list.
  useShortcut('resolveThread', () => {
    const card = focusedCompactCard(viewRef.current);
    const rootId = card?.dataset.threadRootId;
    const viewModel = rootId === undefined ? undefined : viewModelByRootRef.current.get(rootId);
    if (!card || !rootId || !viewModel) return false;
    const fixed =
      !canToggle ||
      pinning.pinnedEventIds.includes(rootId) ||
      !isConfirmedMatrixEventId(rootId) ||
      updatingThreadRootIds.has(rootId);
    if (fixed) return true;
    const cards = compactCardsIn(viewRef.current);
    const index = cards.indexOf(card);
    focusCompactCard(cards[index + 1] ?? cards[index - 1]);
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
  const placeList = useScrollAnchorMemory({
    memory: compactRoomScrollStateRef.current,
    memoryKey: room.roomId,
    scrollRef: viewRef,
    contentRef,
    ready: cardViewModels.length > 0 && blocks.placeReady,
  });

  // A link followed to the mounted list (a pin's) places its card once the card shows, as a mount
  // with that request does; the one the list mounted with had that mount. A replaced entry (a
  // thread beside the list closing) or a step back or forward leaves the list where it is.
  const focusShown =
    blocks.placeReady &&
    (!pushed || blocks.targetReady) &&
    cardViewModels.some((card) => card.id.threadRootId === focusRequest?.eventId);
  const arrivedRequestKey = pushed && focusShown ? requestKey : undefined;
  useLayoutEffect(() => {
    if (requestKey !== mountRequestKeyRef.current) mountRequestKeyRef.current = undefined;
    const place =
      arrivedRequestKey &&
      focusRequest &&
      viewRef.current &&
      compactFocusPlace(focusRequest, viewRef.current);
    if (place) placeList(place);
  });

  // The address's request is met once its card shows, which a folded section's does not.
  useLayoutEffect(() => {
    if (focusRequest && focusShown) {
      meetCompactFocusRequest(compactRoomScrollStateRef.current, focusRequest);
    }
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

  const renderSectionHeader = (id: ThreadWorkflowBucket) => {
    const key = sectionRowKey(id);
    const closed = folded.includes(id);
    const count = sectionCounts.get(id) ?? 0;
    const label = <Text size="B300">{`${t(`thread.workflow.${id}`)} · ${count}`}</Text>;
    return (
      <div key={key} className={css.SectionHeader} data-motion-row={key} data-compact-section={id}>
        {soleSection ? (
          <Button as="div" size="300" variant="Secondary" fill="None" radii="300">
            {label}
          </Button>
        ) : (
          <Button
            size="300"
            variant="Secondary"
            fill="None"
            radii="300"
            aria-expanded={!closed}
            onClick={() => toggleFold(id)}
            before={
              <Icon
                size="100"
                src={closed ? Icons.ChevronRight : Icons.ChevronBottom}
                data-directional={closed || undefined}
              />
            }
          >
            {label}
          </Button>
        )}
      </div>
    );
  };
  const renderRow = (row: CompactBlockRow) => {
    if (typeof row !== 'string') {
      return (
        <div
          key={`spacer:${row.key}`}
          aria-hidden
          data-compact-spacer={row.key}
          className={css.Spacer}
          style={{ height: row.height }}
        />
      );
    }
    const model = modelByRootId.get(row);
    return model ? renderCard(model) : null;
  };
  return (
    <Box
      ref={viewRef}
      className={css.View}
      data-compact-room-view="true"
      data-page-slide-clip=""
      data-compact-card-count={shownRows.filter((id) => !sectionOfRow(id)).length}
      data-cards-pending={!blocks.extentComplete || undefined}
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
          if (!event.currentTarget.contains(event.relatedTarget)) {
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
        {groups[0]!.length > 0 && (
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
            {blocks.rows[0]?.map(renderRow)}
          </Box>
        )}
        {threadRootIds.length === 0 ? (
          <Box className={css.EmptyState}>
            <Text size="T300" priority="300">
              {t('mindroomUi.threads.compactRoomView.noThreads')}
            </Text>
          </Box>
        ) : (
          blocks.rows.slice(1).flatMap((rows, i) => {
            const section = heldSections?.[i]?.id;
            return [...(section ? [renderSectionHeader(section)] : []), ...rows.map(renderRow)];
          })
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
