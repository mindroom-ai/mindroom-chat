import React, { type MouseEventHandler } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Box, config } from 'folds';
import { ThreadIndicator } from '../messages/ThreadIndicator';
import { ThreadSummaryCard } from '../messages/thread-summary/ThreadSummaryCard';
import { buildThreadBadgeViewModelFromRecord } from '../threads/threadBadgeViewModel';
import { revealDirectionControls } from '../ui/directional';
import type { ThreadBadgeViewModel, ThreadRecord } from '../event-store/threads/types';

type ThreadBadgeProps = {
  model: ThreadBadgeViewModel | undefined;
  room: Room;
  onClick: MouseEventHandler;
  includeRecentSummaryData?: boolean;
};

export const ThreadBadge = ({
  model,
  room,
  onClick,
  includeRecentSummaryData = false,
}: ThreadBadgeProps): React.ReactNode => {
  if (!model) return null;

  const { threadRootId } = model.id;

  return (
    <>
      {model.summaryInfo && (
        <Box style={{ marginTop: config.space.S200 }}>
          <ThreadSummaryCard
            compact
            summaryInfo={model.summaryInfo}
            renderBody={({ body }) => <>{revealDirectionControls(body)}</>}
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

const getThreadBadgeModel = ({
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

type RenderThreadBadgeOptions = {
  eventId: string;
  event: Pick<MatrixEvent, 'threadRootId'>;
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  activeThreadId?: string;
  room: Room;
  onClick: MouseEventHandler;
  includeRecentSummaryData?: boolean;
};

export const renderThreadBadge = ({
  eventId,
  event,
  threadRecordMap,
  activeThreadId,
  room,
  onClick,
  includeRecentSummaryData,
}: RenderThreadBadgeOptions) => {
  const model = getThreadBadgeModel({
    eventId,
    event,
    threadRecordMap,
    activeThreadId,
  });
  if (!model) return null;

  return (
    <ThreadBadge
      model={model}
      room={room}
      onClick={onClick}
      includeRecentSummaryData={includeRecentSummaryData}
    />
  );
};
