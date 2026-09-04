import React, {
  type MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { Box, Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useCompactThreadCardViewModels } from './compactThreadCardViewModel';
import type { CompactThreadCardViewModel, ThreadRecord } from './types';
import { CompactThreadCard } from './CompactThreadCard';
import * as css from './CompactRoomView.css';
import { useToggleThreadResolution } from './useRoomThreadTags';

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
  const scrollRestoreStateRef = useRef<ScrollRestoreState>();
  const cardViewModels = useCompactThreadCardViewModels({
    room,
    threadRootIds,
    threadRecordMap,
  });
  const { canToggle, setResolved, updating, error } = useToggleThreadResolution(room);

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

    const restoreState = scrollRestoreStateRef.current;
    if (restoreState?.roomId === room.roomId) {
      const restoreWasClamped = restoreState.lastAppliedScrollTop !== restoreState.targetScrollTop;
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

  if (threadRootIds.length === 0) {
    return (
      <Box ref={viewRef} className={css.View} data-compact-room-view="true">
        <Box className={css.EmptyState}>
          <Text size="T300" priority="300">
            No threads
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box ref={viewRef} className={css.View} data-compact-room-view="true">
      {cardViewModels.map((viewModel) => {
        const showResolveAction = canToggle && !viewModel.isResolved;

        return (
          <div
            key={viewModel.id.threadRootId}
            className={css.CardShell}
            data-has-compact-thread-action={showResolveAction || undefined}
          >
            <CompactThreadCard viewModel={viewModel} onClick={handleCardClick} />
            {showResolveAction && (
              <Button
                className={css.CardAction}
                type="button"
                size="300"
                variant="Secondary"
                fill="Soft"
                outlined
                radii="300"
                disabled={updating}
                onClick={() => handleResolve(viewModel.id.threadRootId)}
                data-compact-thread-resolve="true"
              >
                <Text as="span" size="T200">
                  {t('thread.resolve')}
                </Text>
              </Button>
            )}
          </div>
        );
      })}
    </Box>
  );
}
