import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';

export type ThreadId = {
  roomId: string;
  threadRootId: string;
};

export type ThreadPresentationSnapshot = {
  summaryInfo: MindroomThreadSummaryInfo | undefined;
  summaryText: string | undefined;
  rootPreviewText: string | undefined;
  latestReplyPreviewText: string | undefined;
  lastSenderId: string | undefined;
  lastSenderDisplayName: string | undefined;
  messageCount: number;
  participantIds: string[];
  replyParticipantIds: string[];
  primarySummaryText: string | undefined;
  recentThreadSummaryText: string | undefined;
};

export type ThreadStatusSnapshot = {
  isKnownThreadRoot: boolean;
  replyCount: number;
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
  hasMoreBackward?: boolean;
  snapshotComplete?: boolean;
  relationSnapshotComplete: boolean;
  tailLoaded: boolean;
  expectedReplyCount?: number;
};

export type ThreadRecord = ThreadId & {
  rootEventId?: string;
  presentation: ThreadPresentationSnapshot;
  status: ThreadStatusSnapshot;
  cache: ThreadCacheCoverage;
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

export type ThreadHeaderViewModel = {
  summaryText?: string;
  displayTags: string[];
  isResolved: boolean;
  canEdit: boolean;
  availableTags: string[];
  pickerDisabled: boolean;
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  scheduledDisplayText?: string;
  scheduledLabel?: string;
  bannerScheduledText?: string;
};

export type RecentThreadViewModel = {
  id: ThreadId;
  storedThreadId: string;
  openedAt: number;
  roomName: string;
  summaryText: string;
  persistableSummaryText?: string;
  shouldRekey: boolean;
};

export type CommandPaletteThreadViewModel = {
  id: ThreadId;
  summaryText: string;
  roomName: string;
  participantNames?: string[];
  tags?: string[];
  isResolved?: boolean;
  messageCount?: number;
  sortRank?: number;
  boost?: number;
};
