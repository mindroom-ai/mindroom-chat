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
import { Box, Text } from 'folds';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useCompactThreadCardViewModels } from './compactThreadCardViewModel';
import type { CompactThreadCardViewModel, ThreadRecord } from '../../event-store/threads/types';
import { CompactSectionHeader } from './CompactSectionHeader';
import { CompactRoomEmptyState, type CompactRoomEmptyStateConfig } from './CompactRoomEmptyState';
import { CompactCardList, PinnedThreadsSection } from './CompactThreadCardChrome';
import {
  CompactThreadCardRow,
  getCompactCardRowActions,
  type ThreadActionsMenuState,
} from './CompactThreadCardRow';
import * as css from './CompactRoomView.css';
import { useToggleThreadResolution } from '../tags/useRoomThreadTags';
import { InsetScrollbar } from '../../ui/InsetScrollbar';
import * as overlay from '../../ui/styles/RoomOverlay.css';
import { useThreadPinning } from '../../event-store/threads/useThreadPinning';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import { type ScrollAnchorMemory, useScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { MOST_ROWS_IN_MOTION, useListMotion } from '../../ui/listMotion';
import { useCompactScrollFallback, usePointerOverCards } from './useCompactScrollFallback';
import {
  type CompactFocusRequest,
  compactFocusPlace,
  isCompactFocusRequestOpen,
  meetCompactFocusRequest,
} from './compactFocusRequest';
import { useCompactBlocks, type CompactBlockRow } from './useCompactBlocks';
import { useCompactThreadSections } from './useCompactThreadSections';
import {
  COMPACT_THREAD_SECTION_ORDER,
  type CompactThreadSection,
  type CompactThreadSectionId,
} from './compactThreadSections';
import { step } from './compactShownOrder';
import { getCompactRoomSectionsAtom } from './compactRoomSections';
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import { ThreadCardDetails } from './ThreadCardDetails';
import { useShortcut } from '../../shortcuts/useShortcut';
import { tabbablesOf } from '../../lib/overlayFocus';
import { useHomeserverUnreachable } from '../../matrix/client/homeserverReachability';
import {
  KEY_FOCUS_ATTRIBUTE,
  compactCardsIn,
  compactCardNavigation,
  navigationIn,
  focusCardBeside,
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

type GuardProps = {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  liveIds: readonly string[];
};
class CompactHeightGuard extends React.Component<GuardProps> {
  override getSnapshotBeforeUpdate(prev: GuardProps): boolean {
    const [view, content] = [this.props.scrollRef.current, this.props.contentRef.current];
    if (!view?.scrollTop || !content || prev.liveIds === this.props.liveIds) return false;
    if (globalThis.CSS?.supports?.('overflow-anchor', 'auto')) return false;
    // Pin height across React's mutation phase so WebKit does not clamp scrollTop between removals
    // and insertions.
    const height = content.getBoundingClientRect?.().height ?? 0;
    if (height <= 0) return false;
    content.style.minHeight = `${height}px`;
    content.getBoundingClientRect();
    return true;
  }

  override componentDidUpdate(_prev: GuardProps, _state: unknown, pinned: boolean) {
    if (pinned && this.props.contentRef.current) this.props.contentRef.current.style.minHeight = '';
  }

  override render = () => null;
}

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
  indexPending,
  focusScope,
  filterBarShown = false,
  sectionsNow,
  singleBucketTab,
  emptyState,
}: CompactRoomViewProps) {
  const { t } = useTranslation();
  const viewRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
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
      ? step(shown.sections, threadSections, true, COMPACT_THREAD_SECTION_ORDER)
      : threadSections;
  }, [orderHeld, roomId, singleBucketTab, threadSections]);
  // Under a single-bucket workflow tab (such as Done), that section stays open without
  // changing its stored fold, so switching to Done still shows Done threads immediately.
  const folded = useMemo(
    () =>
      singleBucketTab
        ? sectionsChoice.folded.filter((id) => id !== singleBucketTab)
        : sectionsChoice.folded,
    [sectionsChoice.folded, singleBucketTab]
  );
  const toggleFold = (id: CompactThreadSectionId) => {
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
  useCompactScrollFallback(shownRows, viewRef, sectionOfRow);
  const memory = compactRoomScrollStateRef.current;
  const requestKey = focusRequest && `${focusRequest.entryKey ?? ''} ${focusRequest.eventId}`;
  const mountRequestKeyRef = useRef(requestKey);
  const placing = useRef<string>(undefined);
  const asked = useRef<[key?: string, top?: number, input?: number]>([]);
  const pushed =
    focusRequest?.pushed &&
    requestKey !== mountRequestKeyRef.current &&
    isCompactFocusRequestOpen(memory, focusRequest);
  const groups = useMemo(() => {
    if (heldSections)
      return Object.fromEntries([
        ['pinned', []],
        ...heldSections.map(({ id, rootIds }) => [id, folded.includes(id) ? [] : rootIds]),
      ]) as Record<string, string[]>;
    const pins = new Set(pinnedRootIds);
    return {
      pinned: shownRows.filter((id) => pins.has(id)),
      ordinary: shownRows.filter((id) => !pins.has(id)),
    };
  }, [folded, heldSections, pinnedRootIds, shownRows]);
  const ids = useMemo(() => Object.values(groups).flat(), [groups]);
  const keyScope = `${roomId}|${requestKey ?? ''}|${focusScope ?? ''}`;
  type Intent = { id: string; scope: string; from: Element | null; last?: boolean; at: number[] };
  const [intent, setIntent] = useState<Intent>();
  const pending = intent?.scope === keyScope && ids.includes(intent.id) ? intent : undefined;
  // One destination owns the window: the address while its card is in the shown order (one in a
  // folded section or outside the filter is not), else the card the keys go to.
  const address = !!pushed && ids.includes(focusRequest.eventId);
  const unreachable = useHomeserverUnreachable(room.client);
  const blocks = useCompactBlocks({
    groups,
    scrollRef: viewRef,
    contentRef,
    memory,
    roomId,
    target: address ? focusRequest.eventId : pending?.id,
    protectedId: menu?.roomId === roomId ? menu.rootId : undefined,
    records: threadRecordMap,
    // A read the homeserver cannot answer only retries: the list places on the cards it has.
    indexPending: indexPending && !unreachable,
  });
  const cardViewModels = useCompactThreadCardViewModels({
    room,
    threadRootIds: blocks.liveIds,
    threadRecordMap,
  });
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || typeof document === 'undefined') return undefined;
    // A card's button, or the last control Tab reaches in the card: where Shift+Tab enters it.
    const card = (id: string, last?: boolean) => {
      const button = compactCardsIn(view).find((entry) => entry.dataset.threadRootId === id);
      const shell = last && button?.closest('[data-scroll-anchor]');
      return (shell && tabbablesOf(shell).at(-1)) || button;
    };
    const at = () => [view.scrollTop, blocks.progress.input];
    const focus = (id: string | undefined, last?: boolean) => {
      if (!id) return false;
      if (focusCompactCard(card(id, last))) setIntent(undefined);
      else {
        if (!document.activeElement || document.activeElement === document.body)
          view.focus({ preventScroll: true });
        setIntent({ id, scope: keyScope, from: document.activeElement, last, at: at() });
      }
      return true;
    };
    compactCardNavigation.set(view, { ids, focus });
    const active = document.activeElement;
    // A reader whose input scrolled the list since the key keeps the place, as with an address.
    const left = pending && at().every((now, i) => now !== pending.at[i]);
    if (intent && (!pending || left || (active !== pending.from && active !== document.body)))
      setIntent(undefined);
    else if (pending && !address && blocks.targetReady) {
      focusCompactCard(card(pending.id, pending.last));
      // The focus scrolled the list: the window follows before the target's band is let go.
      blocks.progress.onWrite?.();
      setIntent(undefined);
    }
    return () => void compactCardNavigation.delete(view);
  }, [ids, intent, pending, address, blocks.targetReady, blocks.progress, keyScope]);
  const { canToggle, setResolved, updatingThreadRootIds, error } = useToggleThreadResolution(room);
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
      : compactCardsIn(viewRef.current).find(
          (button) => button.dataset.threadRootId === selectedMenu.rootId
        );
    (trigger ?? viewRef.current)?.focus();
  };
  const modelByRootId = new Map(cardViewModels.map((model) => [model.id.threadRootId, model]));
  const menuModel =
    menu?.roomId === room.roomId ? (modelByRootId.get(menu.rootId) ?? menu.viewModel) : undefined;
  useLayoutEffect(() => {
    if (menuRef.current === undefined) return;
    menuRef.current = undefined;
    setMenu(undefined);
  }, [room.roomId]);
  // Each header counts its section's threads now: one that a held order still shows after it
  // emptied counts none until the order is let go.
  const sectionCounts = new Map(
    (threadSections ?? []).map(({ id, rootIds }) => [id, rootIds.length] as const)
  );
  // Discovery changes mounts, not the logical order that drives motion.
  const listMotion = useListMotion(
    contentRef,
    shownRows.length > MOST_ROWS_IN_MOTION
      ? undefined
      : `${filterBarShown}|${shownRows.join(',')}|${pinnedRootIds.join(',')}`
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
    viewModelByRootRef.current = modelByRootId;
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
  const restoreListFocus = useCallback(() => {
    viewRef.current?.focus({ preventScroll: true });
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
    if (ids.length > 1) focusCardBeside(viewRef.current, rootId, ids.at(-1) === rootId ? -1 : 1);
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
    progress: blocks.progress,
  });

  // A link followed to the mounted list (a pin's) places its card once the card shows, as a mount
  // with that request does; the one the list mounted with had that mount. A replaced entry (a
  // thread beside the list closing) or a step back or forward leaves the list where it is.
  const focusShown =
    (address ? blocks.targetReady : blocks.placeReady) &&
    !!focusRequest &&
    modelByRootId.has(focusRequest.eventId);
  useLayoutEffect(() => {
    if (requestKey !== mountRequestKeyRef.current) mountRequestKeyRef.current = undefined;
    const view = viewRef.current;
    const now = [view?.scrollTop, blocks.progress.input] as const;
    if (address && asked.current[0] !== requestKey) asked.current = [requestKey, ...now];
    if (!focusRequest || !focusShown) return;
    // A newer address retires a Back that still waits; a reader whose input scrolled it stays.
    if (address) blocks.retireBack();
    const stayed = now.some((value, i) => value === asked.current[i + 1]);
    const place = pushed && view && stayed && compactFocusPlace(focusRequest, view);
    if (place && placing.current !== requestKey) {
      placing.current = requestKey;
      placeList(place);
    } else {
      placing.current = undefined;
      meetCompactFocusRequest(memory, focusRequest);
    }
  });

  const resolveLabel = t('thread.resolve');
  const reopenLabel = t('threadActions.reopen');
  const renderCard = (viewModel: CompactThreadCardViewModel) => {
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
        scrollRootRef={viewRef}
        viewModel={viewModel}
        pinned={pinned}
        {...actions}
        menuOpen={menu?.rootId === rootId && !!menuModel}
        resolveLabel={resolveLabel}
        reopenLabel={reopenLabel}
        onThreadClick={handleCardClick}
        onSetResolved={handleSetResolved}
        onPin={handlePin}
        onOpenMenu={openMenu}
      />
    );
  };

  const renderSectionHeader = (id: CompactThreadSectionId) => {
    const key = sectionRowKey(id);
    return (
      <CompactSectionHeader
        key={key}
        id={id}
        count={sectionCounts.get(id) ?? 0}
        closed={folded.includes(id)}
        fixedOpen={id === singleBucketTab}
        onToggle={toggleFold}
        motionRow={key}
      />
    );
  };
  const renderRow = (row: CompactBlockRow) => {
    if (typeof row === 'string') {
      const model = modelByRootId.get(row);
      return model ? renderCard(model) : null;
    }
    // A Tab stop where its cards would be: the keyboard's focus goes on to its first card, or
    // from below (Shift+Tab) to the last control of its last. A button, so a browser that tabs
    // past buttons (Safari) passes it too; named, so assistive technology can show its cards.
    return (
      <button
        key={`spacer:${row.key}`}
        type="button"
        aria-label={t('threadNav.moreThreads', { count: row.ids.length })}
        data-compact-spacer={row.key}
        className={css.Spacer}
        style={{ height: row.height }}
        onClick={() => navigationIn(viewRef.current)?.focus(row.ids[0])}
        onFocus={({ currentTarget: spacer, relatedTarget: from }) => {
          const below =
            from && spacer.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING;
          if (isKeyboardFocus(spacer))
            navigationIn(viewRef.current)?.focus(row.ids.at(below ? -1 : 0), !!below);
        }}
      />
    );
  };
  const showRichEmptyState =
    threadRootIds.length === 0 && emptyState !== undefined && threadRecordMap.size > 0;
  return (
    <Box
      ref={viewRef}
      className={css.View}
      data-compact-room-view="true"
      data-page-slide-clip=""
      // For e2e: the cards the list has, which is more than it mounts.
      data-compact-card-count={ids.length}
      data-cards-pending={!blocks.extentComplete || undefined}
      tabIndex={-1}
    >
      <CompactCardList
        ref={contentRef}
        className={showRichEmptyState ? css.CardsEmpty : undefined}
        style={overlay.overviewInsetStop}
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
        <CompactHeightGuard scrollRef={viewRef} contentRef={contentRef} liveIds={blocks.liveIds} />
        {listMotion}
        {!!pinning.error && (
          <Text role="alert" size="T200">
            {t('thread.pinFailed')}
          </Text>
        )}
        {!!groups.pinned?.length && (
          <PinnedThreadsSection>{blocks.rows[0]?.map(renderRow)}</PinnedThreadsSection>
        )}
        {threadRootIds.length === 0 ? (
          showRichEmptyState ? (
            <CompactRoomEmptyState
              room={room}
              threadRecordMap={threadRecordMap}
              filterState={emptyState.filterState}
              now={emptyState.now}
              canCompose={emptyState.canCompose}
              indexPending={indexPending && !unreachable}
              canToggle={canToggle}
              updatingThreadRootIds={updatingThreadRootIds}
              onThreadClick={onThreadClick}
              onSetResolved={handleSetResolved}
              onReset={emptyState.onReset}
              onToggleForMe={emptyState.onToggleForMe}
              onShowSnoozed={emptyState.onShowSnoozed}
              onRestoreFocus={restoreListFocus}
            />
          ) : (
            <Box className={css.EmptyState}>
              <Text size="T300" priority="300">
                {t('mindroomUi.threads.compactRoomView.noThreads')}
              </Text>
            </Box>
          )
        ) : (
          blocks.rows.slice(1).flatMap((rows, i) => {
            const section = heldSections?.[i]?.id;
            return [...(section ? [renderSectionHeader(section)] : []), ...rows.map(renderRow)];
          })
        )}
      </CompactCardList>
      <InsetScrollbar
        scrollRef={viewRef}
        contentRef={contentRef}
        className={overlay.Scrollbar}
        label={t('threadNav.messages')}
        beforeEnd={blocks.extentComplete ? blocks.prepareEnd : undefined}
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
