import React, { useCallback, useRef } from 'react';
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
};

export function CompactRoomView({
  room,
  threadRootIds,
  threadRecordMap,
  onThreadClick,
}: CompactRoomViewProps) {
  const cardViewModels = useCompactThreadCardViewModels({
    room,
    threadRootIds,
    threadRecordMap,
  });

  // A fully stable click handler keeps the memoized cards from re-rendering
  // when unrelated threads update; the per-thread summary text and the latest
  // onThreadClick are resolved through refs at click time.
  const viewModelByRootRef = useRef<ReadonlyMap<string, CompactThreadCardViewModel>>(new Map());
  viewModelByRootRef.current = new Map(
    cardViewModels.map((viewModel) => [viewModel.id.threadRootId, viewModel])
  );
  const onThreadClickRef = useRef(onThreadClick);
  onThreadClickRef.current = onThreadClick;
  const handleCardClick = useCallback((clickedThreadRootId: string) => {
    const viewModel = viewModelByRootRef.current.get(clickedThreadRootId);
    onThreadClickRef.current(clickedThreadRootId, viewModel?.recentThreadSummaryText);
  }, []);

  if (threadRootIds.length === 0) {
    return (
      <Box className={css.View} data-compact-room-view="true">
        <Box className={css.EmptyState}>
          <Text size="T300" priority="300">
            No threads
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box className={css.View} data-compact-room-view="true">
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
