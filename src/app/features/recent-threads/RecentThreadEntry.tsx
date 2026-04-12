import React, { memo, useEffect } from 'react';
import { Text } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { useRoomName } from '../../hooks/useRoomMeta';
import { bumpRecentThread, rekeyRecentThread } from '../../state/recentThreads';
import { useRecentThreadSummary } from './useRecentThreadSummary';
import { shouldPersistRecentThreadSummaryText } from './recentThreadSummaryUtils';
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
  const roomName = useRoomName(room);
  const relativeTime = useRelativeTime(openedAt);
  const { navigateRoomThreadDirect } = useRoomNavigate();
  const { summary, resolvedThreadId } = useRecentThreadSummary(room, threadId, summaryText);

  useEffect(() => {
    if (resolvedThreadId === threadId) return;

    rekeyRecentThread(room.roomId, threadId, resolvedThreadId);
  }, [resolvedThreadId, room.roomId, threadId]);

  useEffect(() => {
    if (!shouldPersistRecentThreadSummaryText(room, roomName, summary)) return;
    if (summary === summaryText) return;

    bumpRecentThread(room.roomId, threadId, openedAt, summary);
  }, [openedAt, room, room.roomId, roomName, summary, summaryText, threadId]);

  return (
    <button
      className={css.EntryButton}
      type="button"
      onClick={() => navigateRoomThreadDirect(room.roomId, resolvedThreadId)}
      title={`${roomName}: ${summary}`}
    >
      <div className={css.EntryTopRow}>
        <Text className={css.EntryRoomName} size="T200" priority="300" truncate>
          {roomName}
        </Text>
        {relativeTime && (
          <Text className={css.EntryTime} size="T200" priority="400">
            {relativeTime}
          </Text>
        )}
      </div>
      <Text className={css.EntrySummary} size="T300">
        {summary}
      </Text>
    </button>
  );
});

RecentThreadEntry.displayName = 'RecentThreadEntry';
