import { truncateRecentThreadSummaryText } from '../recent-threads/recentThreadSummaryUtils';
import type { CommandPaletteThreadViewModel, ThreadRecord } from './types';

type BuildCommandPaletteThreadViewModelFromRecordOptions = {
  record: ThreadRecord;
  roomName: string;
  getParticipantName: (userId: string) => string;
  fallbackSummaryText?: string;
  sortRank?: number;
  boost?: number;
};

const THREAD_FALLBACK = 'Thread';

const getRecordSummaryText = (record: ThreadRecord): string | undefined =>
  record.presentation.recentThreadSummaryText ??
  record.presentation.primarySummaryText ??
  record.presentation.summaryText ??
  record.presentation.rootPreviewText;

export const buildCommandPaletteThreadViewModelFromRecord = ({
  record,
  roomName,
  getParticipantName,
  fallbackSummaryText,
  sortRank,
  boost,
}: BuildCommandPaletteThreadViewModelFromRecordOptions): CommandPaletteThreadViewModel => {
  const participantNames = record.presentation.participantIds.map(getParticipantName);
  const tags = record.status.tags.length > 0 ? record.status.tags : undefined;
  const summaryText = truncateRecentThreadSummaryText(
    getRecordSummaryText(record) ?? fallbackSummaryText ?? THREAD_FALLBACK
  );

  return {
    id: {
      roomId: record.roomId,
      threadRootId: record.threadRootId,
    },
    summaryText,
    roomName,
    participantNames: participantNames.length > 0 ? participantNames : undefined,
    tags,
    isResolved: record.status.isResolved,
    messageCount: record.presentation.messageCount,
    sortRank: sortRank ?? record.status.lastActivityTs ?? 0,
    boost,
  };
};
