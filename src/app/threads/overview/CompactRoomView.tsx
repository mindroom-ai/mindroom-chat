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
import { Box } from 'folds';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { CompactThreadCardViewModel, ThreadRecord } from '../../event-store/threads/types';
import type { CompactRoomEmptyStateConfig } from './CompactRoomEmptyState';
import { sectionBlockGroups } from './CompactThreadCardChrome';
import {
  CompactThreadCardRow,
  getCompactCardRowActions,
  type ThreadActionsMenuState,
} from './CompactThreadCardRow';
import * as css from './CompactRoomView.css';
import { useToggleThreadResolution } from '../tags/useRoomThreadTags';
import * as overlay from '../../ui/styles/RoomOverlay.css';
import { useThreadPinning } from '../../event-store/threads/useThreadPinning';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { usePointerOverCards } from './useCompactScrollFallback';
import type { CompactFocusRequest } from './compactFocusRequest';
import { useCompactThreadSections } from './useCompactThreadSections';
import type { CompactThreadSection, CompactThreadSectionId } from './compactThreadSections';
import { CompactRoomColumnsBody } from './CompactRoomColumnsBody';
import { CompactRoomVerticalBody } from './CompactRoomVerticalBody';
import { step } from './compactShownOrder';
import { getCompactRoomSectionsAtom } from './compactRoomSections';
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import { ThreadCardDetails } from './ThreadCardDetails';
import { useShortcut } from '../../shortcuts/useShortcut';
import { useHomeserverUnreachable } from '../../matrix/client/homeserverReachability';
import {
  findCompactCard,
  focusCardBeside,
  focusedCompactCard,
  isKeyboardFocus,
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
  /** The thread index is still being read: cards a saved place names may yet arrive. */
  indexPending?: boolean;
  /** Changes with the sort and filters: a key's pending focus does not outlive it. */
  focusScope?: string;
  /** Whether the thread filter bar floats over the cards: they move down for it, and glide. */
  filterBarShown?: boolean;
  /**
   * Set while the cards show in sections (Needs you, Working, Later, Quiet and Done, each folding
   * own): the snooze clock the list was filtered at (`useThreadIndex`'s `snoozeNow`), which the
   * sections classify at too, so they show what the selected tab does.
   */
  sectionsNow?: number;
  /** Transpose workflow sections into side-by-side collapsible columns (wide panes only). */
  columnsMode?: boolean;
  /**
   * Set when the active workflow tab filters the list to one bucket (`needsYou`, `working`,
   * `later`, `done` — not `all`; Simple mode projects `tab` away in `useRoomViewThreadState`,
   * so it is unset there). That section stays open with a plain non-collapsible header without
   * changing its stored fold, so switching to Done still shows Done threads immediately.
   */
  singleBucketTab?: ThreadWorkflowBucket;
  /** Filter context and actions for the rich empty state when filters hide every thread. */
  emptyState?: CompactRoomEmptyStateConfig;
};

// A section's header among the cards' rows; no event ID starts with it.
const SECTION_ROW_PREFIX = 'section:';
const sectionRowKey = (id: CompactThreadSectionId): string => `${SECTION_ROW_PREFIX}${id}`;
const sectionOfRow = (key: string): CompactThreadSectionId | undefined =>
  key.startsWith(SECTION_ROW_PREFIX)
    ? (key.slice(SECTION_ROW_PREFIX.length) as CompactThreadSectionId)
    : undefined;

export function CompactRoomView({
  room,
  threadRootIds,
  threadRecordMap,
  onThreadClick,
  compactRoomScrollStateRef,
  focusRequest,
  indexPending,
  focusScope,
  filterBarShown = false,
  sectionsNow,
  columnsMode = false,
  singleBucketTab,
  emptyState,
}: CompactRoomViewProps) {
  const { t } = useTranslation();
  const viewRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<ThreadActionsMenuState>();
  // While the reader points at or focuses a card, or has a card's menu open, the cards keep
  // their order so none moves under the pointer; the new order applies afterwards.
  const { pointerInside, ...pointerHandlers } = usePointerOverCards();
  const [focusInside, setFocusInside] = useState(false);
  const focusHeld =
    focusInside &&
    document.activeElement !== viewRef.current &&
    !document.activeElement?.hasAttribute('data-compact-room-view') &&
    !!viewRef.current?.contains(document.activeElement);
  const orderHeld = pointerInside || focusHeld || !!menu;
  const pinning = useThreadPinning(room);
  const pinnedRootIds = useMemo(
    () => threadRootIds.filter((rootId) => pinning.pinnedEventIds.includes(rootId)),
    [pinning.pinnedEventIds, threadRootIds]
  );
  const [sectionsChoice, updateSectionsChoice] = useAtom(
    useMemo(() => getCompactRoomSectionsAtom(room.myUserId ?? ''), [room.myUserId])
  );
  const threadSections = useCompactThreadSections({
    room,
    now: sectionsNow,
    threadRootIds,
    threadRecordMap,
    pinnedRootIds,
    sectionOrder: sectionsChoice.order,
  });
  const { roomId } = room;
  const shownRef = useRef<{
    roomId: string;
    singleBucketTab: ThreadWorkflowBucket | undefined;
    sections: CompactThreadSection[] | undefined;
    rows: string[];
  }>(undefined);
  const heldSections = useMemo(() => {
    const shown = shownRef.current;
    // Sections start live when entering from flat, from another room, or from another bucket tab.
    return orderHeld &&
      threadSections &&
      shown?.roomId === roomId &&
      shown.singleBucketTab === singleBucketTab &&
      shown.sections
      ? step(shown.sections, threadSections, true, sectionsChoice.order)
      : threadSections;
  }, [orderHeld, roomId, sectionsChoice.order, singleBucketTab, threadSections]);
  // Under a single-bucket workflow tab (such as Done), that section stays open without
  // changing its stored fold, so switching to Done still shows Done threads immediately.
  const folded = useMemo(
    () =>
      singleBucketTab
        ? sectionsChoice.folded.filter((id) => id !== singleBucketTab)
        : sectionsChoice.folded,
    [sectionsChoice.folded, singleBucketTab]
  );
  const toggleFold = useCallback(
    (id: CompactThreadSectionId) => updateSectionsChoice({ type: 'TOGGLE_FOLD', id }),
    [updateSectionsChoice]
  );
  const reorderSections = useCallback(
    (order: CompactThreadSectionId[]) => updateSectionsChoice({ type: 'REORDER_SECTIONS', order }),
    [updateSectionsChoice]
  );
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
  const holdFlat = orderHeld && !heldSections;
  const shownRows = useMemo(() => {
    const shown = shownRef.current;
    if (!holdFlat || shown?.roomId !== roomId) return listedRows;
    // Flat is one headerless group. On leaving Sections, only cards visible after folding survive.
    const id = 'flat';
    const [flat] = step([{ id, rootIds: shown.rows }], [{ id, rootIds: listedRows }], true, [id]);
    return flat!.rootIds;
  }, [holdFlat, listedRows, roomId]);
  useLayoutEffect(() => {
    shownRef.current = { roomId, singleBucketTab, sections: heldSections, rows: shownRows };
  }, [heldSections, roomId, shownRows, singleBucketTab]);

  const columnsShown = Boolean(
    columnsMode && heldSections && !singleBucketTab && threadRootIds.length > 0
  );
  const groups = useMemo((): Record<string, string[]> => {
    if (heldSections) return { pinned: [], ...sectionBlockGroups(heldSections, folded) };
    const pins = new Set(pinnedRootIds);
    return {
      pinned: shownRows.filter((id) => pins.has(id)),
      ordinary: shownRows.filter((id) => !pins.has(id)),
    };
  }, [folded, heldSections, pinnedRootIds, shownRows]);
  const activeCardIds = useMemo(() => Object.values(groups).flat(), [groups]);
  const unreachable = useHomeserverUnreachable(room.client);
  const { canToggle, setResolved, unsnooze, updatingThreadRootIds, error } =
    useToggleThreadResolution(room);
  const menuRef = useRef<ThreadActionsMenuState>(undefined);
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
      : findCompactCard(viewRef.current, selectedMenu.rootId);
    (trigger ?? viewRef.current?.querySelector<HTMLElement>('[data-compact-room-view]'))?.focus();
  };
  useLayoutEffect(() => {
    if (menuRef.current === undefined) return;
    menuRef.current = undefined;
    setMenu(undefined);
  }, [room.roomId]);
  // Each header counts its section's threads now: one that a held order still shows after it
  // emptied counts none until the order is let go.
  const sectionCounts = useMemo(
    () => new Map((threadSections ?? []).map(({ id, rootIds }) => [id, rootIds.length] as const)),
    [threadSections]
  );

  // A fully stable click handler keeps the memoized cards from re-rendering
  // when unrelated threads update; the per-thread summary text and the latest
  // onThreadClick are resolved through refs at click time.
  const viewModelByRootRef = useRef<ReadonlyMap<string, CompactThreadCardViewModel>>(new Map());
  const onThreadClickRef = useRef(onThreadClick);
  const setResolvedRef = useRef(setResolved);
  const unsnoozeRef = useRef(unsnooze);
  const setPinnedRef = useRef(pinning.setPinned);
  useLayoutEffect(() => {
    onThreadClickRef.current = onThreadClick;
    setResolvedRef.current = setResolved;
    unsnoozeRef.current = unsnooze;
    setPinnedRef.current = pinning.setPinned;
  });
  const handleCardClick = useCallback((clickedThreadRootId: string) => {
    const viewModel = viewModelByRootRef.current.get(clickedThreadRootId);
    onThreadClickRef.current(clickedThreadRootId, viewModel?.recentThreadSummaryText);
  }, []);
  const handleSetResolved = useCallback((threadRootId: string, resolved: boolean) => {
    void setResolvedRef.current(threadRootId, resolved);
  }, []);
  const handleUnsnooze = useCallback((threadRootId: string) => {
    void unsnoozeRef.current?.(threadRootId);
  }, []);
  const handlePin = useCallback((threadRootId: string, pinned: boolean) => {
    void setPinnedRef.current(threadRootId, !pinned);
  }, []);
  const restoreListFocus = useCallback(() => {
    viewRef.current
      ?.querySelector<HTMLElement>('[data-compact-room-view]')
      ?.focus({ preventScroll: true });
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
    if (activeCardIds.length > 1) {
      focusCardBeside(viewRef.current, rootId, activeCardIds.at(-1) === rootId ? -1 : 1);
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

  const menuModel =
    menu?.roomId === room.roomId
      ? (viewModelByRootRef.current.get(menu.rootId) ?? menu.viewModel)
      : undefined;
  const resolveLabel = t('thread.resolve');
  const reopenLabel = t('threadActions.reopen');
  const snoozeLabel = t('thread.snooze');
  const unsnoozeLabel = t('thread.unsnooze');
  const renderCard = (
    viewModel: CompactThreadCardViewModel,
    scrollRootRef: RefObject<HTMLDivElement | null>
  ) => {
    const rootId = viewModel.id.threadRootId;
    const pinned = pinning.pinnedEventIds.includes(rootId);
    const actions = getCompactCardRowActions({
      rootId,
      isResolved: viewModel.isResolved,
      pinned,
      canToggle,
      canPin: pinning.canPin,
      resolving: updatingThreadRootIds.has(rootId),
      pinning: pinning.updating,
      menuOpen: menu?.rootId === rootId,
    });
    return (
      <CompactThreadCardRow
        key={rootId}
        room={room}
        scrollRootRef={scrollRootRef}
        viewModel={viewModel}
        pinned={pinned}
        {...actions}
        menuOpen={menu?.rootId === rootId && !!menuModel}
        resolveLabel={resolveLabel}
        reopenLabel={reopenLabel}
        snoozeLabel={snoozeLabel}
        unsnoozeLabel={unsnoozeLabel}
        onThreadClick={handleCardClick}
        onSetResolved={handleSetResolved}
        onUnsnooze={handleUnsnooze}
        onPin={handlePin}
        onOpenMenu={openMenu}
      />
    );
  };

  const sharedInteractionProps = {
    style: overlay.overviewInsetStop,
    'data-order-held': orderHeld || undefined,
    ...pointerHandlers,
    // Keyboard focus only: a card a mouse click left focused does not hold the order.
    onFocus: (event: React.FocusEvent<HTMLDivElement>) =>
      setFocusInside(isKeyboardFocus(event.target)),
    onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocusInside(false);
    },
  };

  return (
    <Box ref={viewRef} className={css.Host}>
      {columnsShown && heldSections ? (
        <CompactRoomColumnsBody
          room={room}
          sections={heldSections}
          folded={folded}
          fullOrder={sectionsChoice.order}
          sectionCounts={sectionCounts}
          threadRecordMap={threadRecordMap}
          memory={compactRoomScrollStateRef.current}
          focusRequest={focusRequest}
          pinError={!!pinning.error}
          viewModelByRootRef={viewModelByRootRef}
          boardProps={sharedInteractionProps}
          onToggleFold={toggleFold}
          onReorder={reorderSections}
          renderCard={renderCard}
        />
      ) : (
        <CompactRoomVerticalBody
          room={room}
          groups={groups}
          heldSections={heldSections}
          folded={folded}
          singleBucketTab={singleBucketTab}
          sectionCounts={sectionCounts}
          shownRows={shownRows}
          pinnedRootIds={pinnedRootIds}
          threadRootIds={threadRootIds}
          threadRecordMap={threadRecordMap}
          memory={compactRoomScrollStateRef.current}
          focusRequest={focusRequest}
          focusScope={focusScope}
          filterBarShown={filterBarShown}
          indexPending={indexPending}
          unreachable={unreachable}
          menuProtectedId={menu?.roomId === roomId ? menu.rootId : undefined}
          pinError={!!pinning.error}
          emptyState={emptyState}
          canToggle={canToggle}
          updatingThreadRootIds={updatingThreadRootIds}
          viewModelByRootRef={viewModelByRootRef}
          listProps={sharedInteractionProps}
          scrollbarClassName={overlay.Scrollbar}
          sectionRowKey={sectionRowKey}
          sectionOfRow={sectionOfRow}
          onToggleFold={toggleFold}
          onThreadClick={onThreadClick}
          onSetResolved={handleSetResolved}
          onRestoreFocus={restoreListFocus}
          renderCard={renderCard}
        />
      )}
      <ThreadCardDetails room={room} listRef={viewRef} menuOpen={!!menu} />
      {menu && menuModel && (
        <Suspense fallback={null}>
          <ThreadActionsMenu
            key={`${room.roomId}:${menu.rootId}:${menu.initialDialog ?? ''}`}
            room={room}
            rootId={menu.rootId}
            summaryText={menuModel.primarySummaryText}
            anchor={menu.anchor}
            initialDialog={menu.initialDialog}
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
