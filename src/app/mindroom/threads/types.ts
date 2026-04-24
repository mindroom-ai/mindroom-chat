import type { MindroomThreadSummaryInfo } from '../../components/message/mindroomThreadSummary';

export type ThreadId = {
  roomId: string;
  threadRootId: string;
};

export type ThreadPresentationSnapshot = {
  summaryInfo?: MindroomThreadSummaryInfo;
  summaryText?: string;
  rootPreviewText?: string;
  latestReplyPreviewText?: string;
  titleText: string;
  subtitleText?: string;
  lastSenderId?: string;
  lastSenderDisplayName?: string;
  messageCount: number;
  participantIds: string[];
};

export type ThreadStatusSnapshot = {
  isResolved: boolean;
  isUnread: boolean;
  isStreaming: boolean;
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  lastActivityTs?: number;
  tags: string[];
};

export type ThreadCacheCoverage = {
  eventCount: number;
  oldestTs?: number;
  newestTs?: number;
  backwardToken?: string | null;
  relationSnapshotComplete: boolean;
  tailLoaded: boolean;
  expectedReplyCount?: number;
};

export type ThreadRecord = ThreadId & {
  rootEventId?: string;
  presentation: ThreadPresentationSnapshot;
  status: ThreadStatusSnapshot;
  cache?: ThreadCacheCoverage;
  absoluteIndex: number;
};

export type ThreadParticipantViewModel = {
  userId: string;
  displayName: string;
  avatarUrl?: string;
};

export type CompactThreadAttentionState =
  | 'needs-attention'
  | 'waiting'
  | 'streaming'
  | 'resolved'
  | 'idle';

export type CompactThreadCardViewModel = {
  id: ThreadId;
  titleText: string;
  displayTitleText: string;
  previewText: string;
  primarySummaryText?: string;
  recentThreadSummaryText?: string;
  messageCount: number;
  messageCountLabel: string;
  attentionState: CompactThreadAttentionState;
  attentionStatusText: string;
  participants: ThreadParticipantViewModel[];
  tags: string[];
  isResolved: boolean;
  isUnread: boolean;
  isStreaming: boolean;
  scheduledDisplayText?: string;
  scheduledTaskLabel?: string;
  lastActivityTs?: number;
  lastActivityTitle?: string;
};

export type ThreadBadgeViewModel = {
  id: ThreadId;
  summaryInfo?: MindroomThreadSummaryInfo;
  recentThreadSummaryText?: string;
  replyCount: number;
  participantIds?: string[];
  isResolved: boolean;
};
