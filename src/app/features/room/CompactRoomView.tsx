import React from 'react';
import { Box, Text } from 'folds';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { MindroomThreadSummaryInfo } from '../../components/message/mindroomThreadSummary';
import { useCompactThreadCardViewModels } from '../../mindroom/threads/compactThreadCardViewModel';
import type { ThreadOverviewMetadata } from './roomThreadOverviewModel';
import { CompactThreadCard } from './CompactThreadCard';
import * as css from './CompactRoomView.css';

export type CompactRoomViewProps = {
  room: Room;
  threadRootIds: string[];
  metadataMap: Map<string, ThreadOverviewMetadata>;
  summaryMap?: Map<string, MindroomThreadSummaryInfo>;
  onThreadClick: (threadRootId: string, summaryText?: string) => void;
};

export function CompactRoomView({
  room,
  threadRootIds,
  metadataMap,
  summaryMap,
  onThreadClick,
}: CompactRoomViewProps) {
  const cardViewModels = useCompactThreadCardViewModels({
    room,
    threadRootIds,
    metadataMap,
    summaryMap,
  });

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
          onClick={(clickedThreadRootId) =>
            onThreadClick(clickedThreadRootId, viewModel.recentThreadSummaryText)
          }
        />
      ))}
    </Box>
  );
}
