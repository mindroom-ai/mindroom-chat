import { isThreadReplyEvent } from '../event-store/threads/threadUtils';
import type { ThreadBadgeViewModel, ThreadRecord } from '../event-store/threads/types';

type BuildThreadBadgeViewModelFromRecordOptions = {
  record: ThreadRecord;
  activeThreadId?: string;
  eventThreadRootId?: string;
};

export const buildThreadBadgeViewModelFromRecord = ({
  record,
  activeThreadId,
  eventThreadRootId,
}: BuildThreadBadgeViewModelFromRecordOptions): ThreadBadgeViewModel | undefined => {
  if (activeThreadId) return undefined;
  if (isThreadReplyEvent(record.threadRootId, eventThreadRootId)) return undefined;
  if (!record.status.isKnownThreadRoot) return undefined;

  return {
    id: {
      roomId: record.roomId,
      threadRootId: record.threadRootId,
    },
    summaryInfo: record.presentation.summaryInfo,
    recentThreadSummaryText: record.presentation.recentThreadSummaryText,
    replyCount: record.status.replyCount,
    participantIds:
      record.presentation.replyParticipantIds.length > 0
        ? record.presentation.replyParticipantIds
        : undefined,
    isResolved: record.status.isResolved,
  };
};
