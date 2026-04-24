import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { MindroomThreadSummaryInfo } from '../../components/message/mindroomThreadSummary';
import { isThreadReplyEvent } from '../../features/room/threadUtils';
import {
  buildThreadRecord,
  getKnownThreadReplyCount,
  getThreadReplyCount,
  shouldRenderZeroReplyThreadBadge,
} from './threadRecord';
import type { ThreadBadgeViewModel, ThreadRecord } from './types';

export { getKnownThreadReplyCount, getThreadReplyCount, shouldRenderZeroReplyThreadBadge };

type BuildThreadBadgeViewModelOptions = {
  room: Room;
  threadRootEvent: MatrixEvent;
  threadRootId: string;
  activeThreadId?: string;
  eventThreadRootId?: string;
  replyCount?: number;
  participantIds?: string[];
  isResolved?: boolean;
  fallbackSummaryInfo?: MindroomThreadSummaryInfo;
  cachedSummaryInfo?: MindroomThreadSummaryInfo;
};

type BuildTimelineThreadBadgeViewModelOptions = {
  room: Room;
  threadRootEvent: MatrixEvent;
  activeThreadId?: string;
  fallbackReplyCount?: number;
  fallbackParticipantIds?: string[];
  isResolved?: boolean;
  fallbackSummaryInfo?: MindroomThreadSummaryInfo;
  cachedSummaryInfo?: MindroomThreadSummaryInfo;
};

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

export const buildThreadBadgeViewModel = ({
  room,
  threadRootEvent,
  threadRootId,
  activeThreadId,
  eventThreadRootId,
  replyCount,
  participantIds,
  isResolved,
  fallbackSummaryInfo,
  cachedSummaryInfo,
}: BuildThreadBadgeViewModelOptions): ThreadBadgeViewModel | undefined => {
  if (typeof replyCount !== 'number') return undefined;

  const record = buildThreadRecord({
    room,
    threadRootId,
    threadRootEvent,
    summaryInfo: cachedSummaryInfo,
    fallbackSummaryInfo,
    fallbackReplyCount: replyCount,
    fallbackParticipantIds: participantIds,
    threadResolution: { isResolved },
  });

  return buildThreadBadgeViewModelFromRecord({
    record,
    activeThreadId,
    eventThreadRootId,
  });
};

export const buildTimelineThreadBadgeViewModel = ({
  room,
  threadRootEvent,
  activeThreadId,
  fallbackReplyCount,
  fallbackParticipantIds,
  isResolved,
  fallbackSummaryInfo,
  cachedSummaryInfo,
}: BuildTimelineThreadBadgeViewModelOptions): ThreadBadgeViewModel | undefined => {
  const threadRootId = threadRootEvent.getId();
  if (!threadRootId) return undefined;

  const record = buildThreadRecord({
    room,
    threadRootId,
    threadRootEvent,
    summaryInfo: cachedSummaryInfo,
    fallbackSummaryInfo,
    fallbackReplyCount,
    fallbackParticipantIds,
    threadResolution: { isResolved },
  });

  return buildThreadBadgeViewModelFromRecord({
    record,
    activeThreadId,
    eventThreadRootId: threadRootEvent.threadRootId,
  });
};
