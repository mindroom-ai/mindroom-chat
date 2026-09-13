import React from 'react';
import { Box, Text } from 'folds';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { getAttentionState, type ThreadOverviewMetadata } from './roomThreadOverviewModel';
import { CompactThreadCard } from './CompactThreadCard';
import * as css from './CompactRoomView.css';

export type CompactRoomViewProps = {
  room: Room;
  threadRootIds: string[];
  metadataMap: Map<string, ThreadOverviewMetadata>;
  onThreadClick: (threadRootId: string) => void;
};

export function CompactRoomView({
  room,
  threadRootIds,
  metadataMap,
  onThreadClick,
}: CompactRoomViewProps) {
  const currentUserId = room.client.getUserId() ?? '';

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
      {threadRootIds.map((threadRootId) => {
        const metadata = metadataMap.get(threadRootId);
        if (!metadata) return null;

        return (
          <CompactThreadCard
            key={threadRootId}
            threadRootId={threadRootId}
            metadata={metadata}
            attentionState={getAttentionState(metadata, currentUserId)}
            onClick={onThreadClick}
          />
        );
      })}
    </Box>
  );
}
