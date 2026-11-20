import React, { useMemo, type ComponentPropsWithoutRef, type MouseEventHandler } from 'react';
import { atom, useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Box, config } from 'folds';
import { ThreadIndicator, type ThreadIndicatorUnread } from '../messages/ThreadIndicator';
import { ThreadSummaryCard } from '../messages/thread-summary/ThreadSummaryCard';
import { buildThreadBadgeViewModelFromRecord } from '../threads/threadBadgeViewModel';
import {
  crossRoomThreadIndexAtom,
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import { getThreadSignalsReader } from '../threads/cross-room/threadSignalsReader';
import { revealDirectionControls } from '../ui/directional';
import type { ThreadBadgeViewModel, ThreadRecord } from '../event-store/threads/types';

// Read-only, so it holds nothing an account could leave behind.
const noEntryAtom = atom((): CrossRoomThreadIndexEntry | undefined => undefined);

/**
 * What is new in an unread thread, from the client's shared signals cache that the sidebar and
 * Activity keep filled: a cached read unless the thread changed. The chip follows only its own
 * thread's index entry, so another thread's update renders nothing here, and a read thread
 * follows nothing and reads nothing. Until the index holds the thread, the count is unknown.
 * A receipt or a reply re-renders the chip through the timeline, whose records it reads, and the
 * cache reads the thread again for it (`threadChanges` in `threadSignalsReader.ts`).
 */
const useThreadUnread = (
  room: Room,
  threadRootId: string,
  isUnread: boolean
): ThreadIndicatorUnread | undefined => {
  const entryAtom = useMemo(() => {
    if (!isUnread) return noEntryAtom;
    const key = getCrossRoomThreadIndexKey(room.roomId, threadRootId);
    return selectAtom(crossRoomThreadIndexAtom, ({ entries }) => entries.get(key));
  }, [isUnread, room.roomId, threadRootId]);
  const entry = useAtomValue(entryAtom);
  if (!isUnread) return undefined;
  if (!entry) return { newCount: 0, mentionsMe: false };
  const signals = getThreadSignalsReader(room.client).read(room, entry, room.myUserId, Date.now());
  return {
    // A count of only the replies held, which may begin after new ones, would read as exact.
    newCount: signals.newCountComplete ? signals.newCount : 0,
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
