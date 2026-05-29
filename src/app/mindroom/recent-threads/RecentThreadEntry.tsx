import React, { memo, useEffect } from 'react';
import { Text } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { bumpRecentThread, rekeyRecentThread } from './recentThreads';
import { useRecentThreadViewModel } from '../threads/recentThreadViewModel';
import { getRoomViewMode } from '../threads/roomViewMode';
import * as css from './recentThreads.css';

type RecentThreadEntryProps = {
  room: Room;
  threadId: string;
  openedAt: number;
  summaryText?: string;
};

export const RecentThreadEntry = memo(({
  room,
  threadId,
  openedAt,
  summaryText,
}: RecentThreadEntryProps) => {
  const viewModel = useRecentThreadViewModel(room, threadId, openedAt, summaryText);
  const relativeTime = useRelativeTime(openedAt);
  const { navigateRoom, navigateRoomThreadDirect } = useRoomNavigate();
  const ariaLabel = [
    `Open thread: ${viewModel.summaryText}`,
    viewModel.roomName,
    relativeTime ? `Opened ${relativeTime}` : undefined,
  ]
    .filter(Boolean)
    .join('. ');

  useEffect(() => {
    if (!viewModel.shouldRekey) return;

    rekeyRecentThread(room.roomId, viewModel.storedThreadId, viewModel.id.threadRootId);
  }, [room.roomId, viewModel.id.threadRootId, viewModel.shouldRekey, viewModel.storedThreadId]);

  useEffect(() => {
    if (!viewModel.persistableSummaryText) return;
    if (viewModel.persistableSummaryText === summaryText) return;

    bumpRecentThread(
      room.roomId,
      viewModel.id.threadRootId,
      openedAt,
      viewModel.persistableSummaryText
    );
  }, [
    openedAt,
    room.roomId,
    summaryText,
    viewModel.id.threadRootId,
    viewModel.persistableSummaryText,
  ]);

  return (
    <button
      className={css.EntryButton}
      type="button"
      onClick={() => {
        if (getRoomViewMode(room.roomId) === 'classic') {
          navigateRoom(room.roomId, viewModel.id.threadRootId);
          return;
        }
        navigateRoomThreadDirect(room.roomId, viewModel.id.threadRootId);
      }}
      title={`${viewModel.roomName}: ${viewModel.summaryText}`}
      aria-label={ariaLabel}
    >
      <div className={css.EntryTopRow}>
        <Text className={css.EntryRoomName} size="T200" priority="300" truncate>
          {viewModel.roomName}
        </Text>
        {relativeTime && (
          <Text className={css.EntryTime} size="T200" priority="400">
            {relativeTime}
          </Text>
        )}
      </div>
      <Text className={css.EntrySummary} size="T300">
        {viewModel.summaryText}
      </Text>
    </button>
  );
});

RecentThreadEntry.displayName = 'RecentThreadEntry';
