import {
  getCrossRoomThreadIndexKey,
  normalizeThreadSearchText,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';

export const SPACE_THREADS_TEST_NOW = 1_700_000_000_000;

export type SpaceThreadEntryOptions = Partial<CrossRoomThreadIndexEntry> & {
  roomId: string;
  threadRootId: string;
  replyCount?: number;
  isStreaming?: boolean;
  scheduledTaskCount?: number;
  nextScheduledTs?: number;
  participantIds?: string[];
  lastSenderDisplayName?: string;
  latestReplyPreviewText?: string;
};

/** Builds a cross-room thread index entry fixture with `rootSenderId` included in `peopleIds`. */
export const makeSpaceThreadEntry = (opts: SpaceThreadEntryOptions): CrossRoomThreadIndexEntry => {
  const {
    roomId,
    threadRootId,
    replyCount = 1,
    isStreaming = false,
    scheduledTaskCount = 0,
  } = opts;
  const rootSenderId = opts.rootSenderId ?? '@alice:example.org';
  const participantIds = opts.participantIds ?? [rootSenderId];
  const peopleIds = [...new Set([rootSenderId, ...participantIds])];
  const isResolved = opts.isResolved ?? false;
  const isUnread = opts.isUnread ?? false;
  const lastActivityTs = opts.lastActivityTs ?? SPACE_THREADS_TEST_NOW;
  const tags = opts.tags ?? [];
  const summaryText = opts.summaryText ?? `Summary ${threadRootId}`;
  const rootPreviewText = opts.rootPreviewText ?? `Root ${threadRootId}`;
  return {
    key: getCrossRoomThreadIndexKey(roomId, threadRootId),
    roomId,
    roomName: opts.roomName ?? roomId,
    threadRootId,
    indexedEventIds: [threadRootId],
    threadRecord: {
      roomId,
      threadRootId,
      rootEventId: threadRootId,
      absoluteIndex: 0,
      presentation: {
        summaryInfo: undefined,
        summaryText,
        primarySummaryText: summaryText,
        recentThreadSummaryText: summaryText,
        rootPreviewText,
        latestReplyPreviewText: opts.latestReplyPreviewText,
        lastSenderId: participantIds[0],
        lastSenderDisplayName: opts.lastSenderDisplayName,
        messageCount: replyCount,
        participantIds,
        replyParticipantIds: participantIds,
        peopleIds,
      },
      status: {
        isKnownThreadRoot: true,
        replyCount,
        lastActivityTs,
        isUnread,
        isResolved,
        snoozedUntilTs: opts.snoozedUntilTs,
        isStreaming,
        scheduledTaskCount,
        nextScheduledTs: opts.nextScheduledTs,
        tags,
      },
      cache: { eventCount: replyCount + 1, relationSnapshotComplete: true, tailLoaded: true },
    },
    rootSenderId,
    lastActivityTs,
    isUnread,
    isResolved,
    snoozedUntilTs: opts.snoozedUntilTs,
    hasAttention: !isResolved && (isUnread || isStreaming || scheduledTaskCount > 0),
    isInvolved: opts.isInvolved ?? true,
    isForUser: opts.isForUser ?? false,
    summaryText,
    rootPreviewText,
    searchableText:
      opts.searchableText ?? normalizeThreadSearchText(`${rootPreviewText} ${summaryText}`),
    tags,
    generation: 1,
  };
};
