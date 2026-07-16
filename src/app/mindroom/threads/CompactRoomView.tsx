import React, { type MutableRefObject, useCallback, useLayoutEffect, useRef } from 'react';
import { Box, Text } from 'folds';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useCompactThreadCardViewModels } from './compactThreadCardViewModel';
import type { CompactThreadCardViewModel, ThreadRecord } from './types';
import { CompactThreadCard } from './CompactThreadCard';
import * as css from './CompactRoomView.css';

export type CompactRoomViewProps = {
  room: Room;
  threadRootIds: string[];
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  onThreadClick: (threadRootId: string, summaryText?: string) => void;
  compactRoomScrollStateRef: MutableRefObject<Map<string, number>>;
};

export function CompactRoomView({
  room,
  threadRootIds,
  threadRecordMap,
  onThreadClick,
  compactRoomScrollStateRef,
}: CompactRoomViewProps) {
  const viewRef = useRef<HTMLDivElement>(null);
  const cardViewModels = useCompactThreadCardViewModels({
    room,
    threadRootIds,
    threadRecordMap,
  });

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

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return undefined;
    const scrollState = compactRoomScrollStateRef.current;

    const savedScrollTop = scrollState.get(room.roomId);
    if (savedScrollTop !== undefined) view.scrollTop = savedScrollTop;

    return () => {
      scrollState.set(room.roomId, view.scrollTop);
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
      {cardViewModels.map((viewModel) => (
        <CompactThreadCard
          key={viewModel.id.threadRootId}
          viewModel={viewModel}
          onClick={handleCardClick}
        />
      ))}
    </Box>
  );
}
