import React from 'react';
import { Box, Text } from 'folds';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { MindroomThreadSummaryInfo } from '../../components/message/mindroomThreadSummary';
import { resolveRecentThreadSummaryText } from '../recent-threads/recentThreadSummaryUtils';
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
        const liveThread = room.getThread(threadRootId);
        const threadRootEvent = room.findEventById(threadRootId) ?? liveThread?.rootEvent;
        const fallbackSummaryInfo =
          metadata?.summaryText || metadata?.messageCount
            ? {
                summaryText: metadata?.summaryText,
                messageCount:
                  typeof metadata?.messageCount === 'number' && metadata.messageCount > 0
                    ? metadata.messageCount
                    : undefined,
              }
            : undefined;
        const resolvedSummaryInfo = summaryMap?.get(threadRootId) ?? fallbackSummaryInfo;
        const recentThreadSummaryText =
          resolvedSummaryInfo?.summaryText ??
          metadata?.rootPreviewText ??
          resolveRecentThreadSummaryText({
            room,
            threadRootId,
            rootEvent: threadRootEvent,
            summaryInfo: resolvedSummaryInfo,
          });

        return (
          <CompactThreadCard
            key={threadRootId}
            room={room}
            threadRootId={threadRootId}
            threadRootEvent={threadRootEvent}
            rootPreviewText={metadata?.rootPreviewText}
            summaryInfo={resolvedSummaryInfo}
            lastActivityTs={metadata?.lastActivityTs}
            onClick={(clickedThreadRootId) => onThreadClick(clickedThreadRootId, recentThreadSummaryText)}
          />
        );
      })}
    </Box>
  );
}
