import React, { type ComponentPropsWithoutRef, type MouseEventHandler } from 'react';
import { useAtomValue } from 'jotai';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Box, config } from 'folds';
import { ThreadIndicator, type ThreadIndicatorUnread } from '../messages/ThreadIndicator';
import { ThreadSummaryCard } from '../messages/thread-summary/ThreadSummaryCard';
import { buildThreadBadgeViewModelFromRecord } from '../threads/threadBadgeViewModel';
import { roomThreadIndexEntriesAtom } from '../threads/cross-room/crossRoomThreadIndex';
import { SIGNAL_EVENT_LIMIT } from '../threads/cross-room/threadSignals';
import { getThreadSignalsReader } from '../threads/cross-room/threadSignalsReader';
import { revealDirectionControls } from '../ui/directional';
import type { ThreadBadgeViewModel, ThreadRecord } from '../event-store/threads/types';

/**
 * What is new in an unread thread, from the client's shared signals cache that the sidebar and
 * Activity keep filled: a cached read unless the thread changed. A read thread follows nothing
 * and reads nothing. Until the thread index holds the thread, the count is unknown ("New").
 */
const useThreadUnread = (
  room: Room,
  threadRootId: string,
  isUnread: boolean
): ThreadIndicatorUnread | undefined => {
  const entries = useAtomValue(roomThreadIndexEntriesAtom(isUnread ? room.roomId : undefined));
  if (!isUnread) return undefined;
  const entry = entries.get(threadRootId);

  if (!entry) return { newCount: 0, mentionsMe: false };

  const signals = getThreadSignalsReader(room.client).read(room, entry, room.myUserId, Date.now());
  return {
    newCount: signals.newCount,
    // The signals read the thread's newest replies only: all of them new may mean more.
    newCountAtLeast: signals.newCount >= SIGNAL_EVENT_LIMIT,
    mentionsMe: signals.mentionedMe,
  };
};

type TimelineThreadIndicatorProps = Omit<
  ComponentPropsWithoutRef<typeof ThreadIndicator>,
  'unread'
> & {
  room: Room;
  threadRootId: string;
  /** The record's unread state, as the sidebar reads it; the signals only add how much is new. */
  isUnread: boolean;
};

/** The timeline's thread chip, which shows what is new while the thread is unread. */
function TimelineThreadIndicator({ isUnread, ...props }: TimelineThreadIndicatorProps) {
  const unread = useThreadUnread(props.room, props.threadRootId, isUnread);
  return <ThreadIndicator {...props} unread={unread} />;
}

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
      <TimelineThreadIndicator
        as="button"
        style={{ marginTop: model.summaryInfo ? config.space.S100 : config.space.S200 }}
        data-thread-root-id={threadRootId}
        data-event-id={threadRootId}
        data-thread-summary={includeRecentSummaryData ? model.recentThreadSummaryText : undefined}
        threadReplyCount={model.replyCount}
        threadParticipantIds={model.participantIds}
        isResolved={model.isResolved}
        isUnread={model.isUnread}
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
