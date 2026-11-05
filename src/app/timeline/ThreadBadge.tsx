import React, { type MouseEventHandler } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Box, config } from 'folds';
import { ThreadIndicator } from '../messages/ThreadIndicator';
import { ThreadSummaryCard as MindroomThreadSummaryCard } from '../messages/thread-summary/ThreadSummaryCard';
import { buildThreadBadgeViewModelFromRecord } from '../threads/threadBadgeViewModel';
import type { ThreadBadgeViewModel, ThreadRecord } from '../event-store/threads/types';

type ThreadBadgeRendererProps = {
  model: ThreadBadgeViewModel | undefined;
  room: Room;
  onClick: MouseEventHandler;
  includeRecentSummaryData?: boolean;
};

export const ThreadBadgeRenderer = ({
  model,
  room,
  onClick,
  includeRecentSummaryData = false,
}: ThreadBadgeRendererProps): React.ReactNode => {
  if (!model) return null;

  const { threadRootId } = model.id;

  return (
    <>
      {model.summaryInfo && (
        <Box style={{ marginTop: config.space.S200 }}>
          <MindroomThreadSummaryCard
            compact
            summaryInfo={model.summaryInfo}
            renderBody={({ body }) => <>{body}</>}
          />
        </Box>
      )}
      <ThreadIndicator
        as="button"
        style={{ marginTop: model.summaryInfo ? config.space.S100 : config.space.S200 }}
        data-thread-root-id={threadRootId}
        data-event-id={threadRootId}
        data-thread-summary={includeRecentSummaryData ? model.recentThreadSummaryText : undefined}
        threadReplyCount={model.replyCount}
        threadParticipantIds={model.participantIds}
        isResolved={model.isResolved}
        threadRootId={threadRootId}
        room={room}
        onClick={onClick}
      />
    </>
  );
};

const getMindroomRoomTimelineThreadBadgeModel = ({
  eventId,
  event,
  threadRecordMap,
  activeThreadId,
}: {
  eventId: string;
  event: Pick<MatrixEvent, 'threadRootId'>;
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  activeThreadId?: string;
}): ThreadBadgeViewModel | undefined => {
  const record = threadRecordMap.get(eventId);
  if (!record) return undefined;

  return buildThreadBadgeViewModelFromRecord({
    record,
    activeThreadId,
    eventThreadRootId: event.threadRootId,
  });
};

type RenderMindroomRoomTimelineThreadBadgeOptions = {
  eventId: string;
  event: Pick<MatrixEvent, 'threadRootId'>;
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  activeThreadId?: string;
  room: Room;
  onClick: MouseEventHandler;
  includeRecentSummaryData?: boolean;
};

export const renderMindroomRoomTimelineThreadBadge = ({
  eventId,
  event,
  threadRecordMap,
  activeThreadId,
  room,
  onClick,
  includeRecentSummaryData,
}: RenderMindroomRoomTimelineThreadBadgeOptions) => {
  const model = getMindroomRoomTimelineThreadBadgeModel({
    eventId,
    event,
    threadRecordMap,
    activeThreadId,
  });
  if (!model) return null;

  return (
    <ThreadBadgeRenderer
      model={model}
      room={room}
      onClick={onClick}
      includeRecentSummaryData={includeRecentSummaryData}
    />
  );
};
