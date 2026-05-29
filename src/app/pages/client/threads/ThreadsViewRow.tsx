import React, { useMemo } from 'react';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { CompactThreadCard } from '../../../mindroom/threads/CompactThreadCard';
import { buildCompactThreadCardViewModelFromRecord } from '../../../mindroom/threads/compactThreadCardViewModel';
import type { CrossRoomThreadIndexEntry } from '../../../mindroom/cross-room-threads/crossRoomThreadIndex';
import * as css from './ThreadsView.css';

type ThreadsViewRowProps = {
  entry: CrossRoomThreadIndexEntry;
};

export function ThreadsViewRow({ entry }: ThreadsViewRowProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const { navigateRoomThread } = useRoomNavigate();
  const room = mx.getRoom(entry.roomId);
  const viewModel = useMemo(() => {
    if (!room) return undefined;

    return buildCompactThreadCardViewModelFromRecord({
      record: entry.threadRecord,
      room,
      currentUserId: mx.getUserId() ?? undefined,
      mx,
      useAuthentication,
    });
  }, [entry.threadRecord, mx, room, useAuthentication]);

  if (!room || !viewModel) return null;

  return (
    <Box className={css.Row}>
      <Box className={css.RowChrome}>
        <Avatar size="200" radii="400">
          <Icon size="100" src={room.isSpaceRoom?.() ? Icons.Space : Icons.Hash} />
        </Avatar>
        <Box className={css.Chip}>
          <Text size="T200" truncate title={entry.roomName}>
            {entry.roomName}
          </Text>
        </Box>
        {entry.parentSpaceIds.slice(0, 1).map((spaceId) => {
          const space = mx.getRoom(spaceId);
          const spaceName = space?.name ?? spaceId;

          return (
            <Box key={spaceId} className={css.Chip}>
              <Text size="T200" truncate title={spaceName}>
                {spaceName}
              </Text>
            </Box>
          );
        })}
      </Box>
      <CompactThreadCard
        viewModel={viewModel}
        onClick={() => navigateRoomThread(entry.roomId, entry.threadRootId)}
      />
    </Box>
  );
}
