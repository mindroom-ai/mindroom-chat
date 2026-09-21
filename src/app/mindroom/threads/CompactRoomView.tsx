import React, {
  type MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { Box, Button, Icon, Icons, Text } from 'folds';
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
      <div key={rootId} className={css.CardShell}>
        <CompactThreadCard viewModel={viewModel} onClick={handleCardClick} />
        {(showResolveAction || showPinAction) && (
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
          </div>
        )}
      </div>
    );
  };

  return (
    <Box ref={viewRef} className={css.View} data-compact-room-view="true">
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
    </Box>
  );
}
