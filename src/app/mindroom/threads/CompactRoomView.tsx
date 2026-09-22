import React, {
  type MutableRefObject,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Box, Button, Icon, IconButton, Icons, Text, type RectCords } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useCompactThreadCardViewModels } from './compactThreadCardViewModel';
import type { CompactThreadCardViewModel, ThreadRecord } from './types';
import { CompactThreadCard } from './CompactThreadCard';
import * as css from './CompactRoomView.css';
import { useToggleThreadResolution } from './useRoomThreadTags';
import { InsetScrollbar } from '../../components/inset-scrollbar/InsetScrollbar';
import * as overlay from './RoomOverlay.css';
import { useThreadPinning } from './useThreadPinning';
import { isConfirmedMatrixEventId } from './threadRouteUtils';

const CompactThreadMenu = lazy(() =>
  import('./CompactThreadMenu').then((module) => ({ default: module.CompactThreadMenu }))
);

export type CompactRoomViewProps = {
  room: Room;
  threadRootIds: string[];
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  onThreadClick: (threadRootId: string, summaryText?: string) => void;
  compactRoomScrollStateRef: MutableRefObject<Map<string, number>>;
};

type ScrollRestoreState = {
  roomId: string;
  targetScrollTop: number;
  lastAppliedScrollTop: number;
};

type CompactThreadMenuState = {
  roomId: string;
  rootId: string;
  anchor: RectCords;
  trigger?: HTMLElement;
  viewModel: CompactThreadCardViewModel;
};

export function CompactRoomView({
  room,
  threadRootIds,
  threadRecordMap,
  onThreadClick,
  compactRoomScrollStateRef,
}: CompactRoomViewProps) {
  const { t } = useTranslation();
  const viewRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRestoreStateRef = useRef<ScrollRestoreState>();
  const cardViewModels = useCompactThreadCardViewModels({
    room,
    threadRootIds,
    threadRecordMap,
  });
  const { canToggle, setResolved, updatingThreadRootIds, error } = useToggleThreadResolution(room);
  const pinning = useThreadPinning(room);
  const [menu, setMenu] = useState<CompactThreadMenuState>();
  const menuRef = useRef<CompactThreadMenuState>();
  const openMenu = (nextMenu: CompactThreadMenuState) => {
    menuRef.current = nextMenu;
    setMenu(nextMenu);
  };
  const closeMenu = (selectedMenu: CompactThreadMenuState) => {
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

  // A fully stable click handler keeps the memoized cards from re-rendering
  // when unrelated threads update; the per-thread summary text and the latest
  // onThreadClick are resolved through refs at click time.
  const viewModelByRootRef = useRef<ReadonlyMap<string, CompactThreadCardViewModel>>(new Map());
  const onThreadClickRef = useRef(onThreadClick);
  // Synced after commit (not during render) so a discarded concurrent render
  // cannot leave uncommitted view models behind the stable click handler.
  useLayoutEffect(() => {
    viewModelByRootRef.current = new Map(
      cardViewModels.map((viewModel) => [viewModel.id.threadRootId, viewModel])
    );
    onThreadClickRef.current = onThreadClick;
  });
  const handleCardClick = useCallback((clickedThreadRootId: string) => {
    const viewModel = viewModelByRootRef.current.get(clickedThreadRootId);
    onThreadClickRef.current(clickedThreadRootId, viewModel?.recentThreadSummaryText);
  }, []);
  const handleResolve = useCallback(
    (threadRootId: string) => {
      void setResolved(threadRootId, true);
    },
    [setResolved]
  );

  useEffect(() => {
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[CompactRoomView] Resolve failed:', error);
    }
  }, [error]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || cardViewModels.length === 0) return;

    const restore = () => {
      const restoreState = scrollRestoreStateRef.current;
      if (restoreState?.roomId === room.roomId) {
        const restoreWasClamped =
          restoreState.lastAppliedScrollTop !== restoreState.targetScrollTop;
        const scrollHasNotMoved = view.scrollTop === restoreState.lastAppliedScrollTop;
        if (restoreWasClamped && scrollHasNotMoved) {
          view.scrollTop = restoreState.targetScrollTop;
          restoreState.lastAppliedScrollTop = view.scrollTop;
        }
        return;
      }

      const savedScrollTop = compactRoomScrollStateRef.current.get(room.roomId);
      if (savedScrollTop !== undefined) view.scrollTop = savedScrollTop;
      scrollRestoreStateRef.current = {
        roomId: room.roomId,
        targetScrollTop: savedScrollTop ?? view.scrollTop,
        lastAppliedScrollTop: view.scrollTop,
      };
    };
    restore();
    // Overlay measurements can increase padding after the initial restore.
    // Retry only a clamped restore, and never after the reader has moved.
    const observer = new ResizeObserver(restore);
    observer.observe(view);
    return () => observer.disconnect();
  }, [cardViewModels.length, compactRoomScrollStateRef, room.roomId]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return undefined;
    const scrollState = compactRoomScrollStateRef.current;
    const roomId = room.roomId;

    return () => {
      if (scrollRestoreStateRef.current?.roomId === roomId) {
        scrollState.set(roomId, view.scrollTop);
      }
    };
  }, [compactRoomScrollStateRef, room.roomId]);

  const renderCard = (viewModel: CompactThreadCardViewModel) => {
    const rootId = viewModel.id.threadRootId;
    const pinned = pinning.pinnedEventIds.includes(rootId);
    const showResolveAction = canToggle && !viewModel.isResolved && !pinned;
    const showPinAction = pinning.canPin && isConfirmedMatrixEventId(rootId);
    return (
      <div
        key={rootId}
        className={css.CardShell}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenu({
            roomId: room.roomId,
            rootId,
            viewModel,
            anchor: { x: event.clientX, y: event.clientY, width: 0, height: 0 },
            trigger:
              event.currentTarget.querySelector<HTMLButtonElement>('[data-thread-root-id]') ??
              undefined,
          });
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          event.preventDefault();
          event.stopPropagation();
          openMenu({
            roomId: room.roomId,
            rootId,
            viewModel,
            anchor: event.currentTarget.getBoundingClientRect(),
            trigger: event.target as HTMLElement,
          });
        }}
      >
        <CompactThreadCard viewModel={viewModel} onClick={handleCardClick} />
        <div className={css.CardAction}>
          {showResolveAction && (
            <Button
              type="button"
              size="300"
              variant="Secondary"
              fill="Soft"
              outlined
              radii="300"
              disabled={pinning.updating || updatingThreadRootIds.has(rootId)}
              onClick={() => handleResolve(rootId)}
              data-compact-thread-resolve="true"
            >
              <Text as="span" size="T200">
                {t('thread.resolve')}
              </Text>
            </Button>
          )}
          {showPinAction && (
            <Button
              type="button"
              size="300"
              variant="Secondary"
              fill="Soft"
              outlined
              radii="300"
              disabled={pinning.updating || updatingThreadRootIds.has(rootId)}
              onClick={() => pinning.setPinned(rootId, !pinned)}
              data-compact-thread-pin="true"
            >
              <Text as="span" size="T200">
                {t(pinned ? 'threadNav.unpin' : 'threadNav.pin')}
              </Text>
            </Button>
          )}
          <IconButton
            type="button"
            size="300"
            variant="Secondary"
            fill="Soft"
            radii="300"
            aria-label={t('threadActions.more')}
            aria-haspopup="menu"
            aria-expanded={menu?.rootId === rootId && !!menuModel}
            onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
              openMenu({
                roomId: room.roomId,
                rootId,
                viewModel,
                anchor: event.currentTarget.getBoundingClientRect(),
                trigger: event.currentTarget,
              })
            }
          >
            <Icon size="100" src={Icons.VerticalDots} />
          </IconButton>
        </div>
      </div>
    );
  };

  return (
    <Box ref={viewRef} className={css.View} data-compact-room-view="true" tabIndex={-1}>
      <Box ref={contentRef} direction="Column" gap="100" shrink="No">
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
      {menu && menuModel && (
        <Suspense fallback={null}>
          <CompactThreadMenu
            key={`${room.roomId}:${menu.rootId}`}
            room={room}
            viewModel={menuModel}
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
