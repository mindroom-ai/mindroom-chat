import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import {
  getLatestThreadSummaryInfoFromEventSources,
  pickLatestThreadSummaryInfo,
  type MindroomThreadSummaryInfo,
} from '../messages/threadSummary';
import { getMemberDisplayName } from '../../utils/room';
import {
  getCompactThreadRootBodyPreviewText,
  pickPreferredThreadRootPreviewText,
} from './compactThreadRootData';
import {
  getLatestRenderableVisibleThreadReplyEvent,
  getPreferredVisibleThreadReplyEvents,
  getVisibleThreadEventBodyPreviewText,
  getVisibleThreadMessageCount,
  type VisibleThreadEventCollectionLike,
} from './threadUtils';

export type ThreadPresentationSnapshot = {
  summaryInfo: MindroomThreadSummaryInfo | undefined;
  summaryText: string | undefined;
  rootPreviewText: string | undefined;
  latestReplyPreviewText: string | undefined;
  lastSenderId: string | undefined;
  lastSenderDisplayName: string | undefined;
  messageCount: number;
};

type ResolveThreadSummaryInfoOptions = {
  preferredSummaryInfo?: MindroomThreadSummaryInfo;
  thread?: VisibleThreadEventCollectionLike | null;
};

export const resolveThreadSummaryInfo = ({
  preferredSummaryInfo,
  thread,
}: ResolveThreadSummaryInfoOptions): MindroomThreadSummaryInfo | undefined =>
  pickLatestThreadSummaryInfo(
    preferredSummaryInfo,
    getLatestThreadSummaryInfoFromEventSources(thread?.events, thread?.timeline)
  );

type ResolveThreadRootPreviewTextOptions = {
  preferredPreviewText?: string;
  room: Room;
  rootEvent?: MatrixEvent;
  threadRootId: string;
};

export const resolveThreadRootPreviewText = ({
  room,
  threadRootId,
  rootEvent,
  preferredPreviewText,
}: ResolveThreadRootPreviewTextOptions): string | undefined =>
  pickPreferredThreadRootPreviewText({
    preferredPreviewText,
    fallbackPreviewText:
      getCompactThreadRootBodyPreviewText(rootEvent, {
        eventId: threadRootId,
        room,
      }) ?? getVisibleThreadEventBodyPreviewText(rootEvent),
  });

type ResolveThreadPresentationSnapshotOptions = {
  fallbackMessageCountIsLowerBound?: boolean;
  fallbackLastSenderDisplayName?: string;
  fallbackLastSenderId?: string;
  fallbackLatestReplyPreviewText?: string;
  fallbackMessageCount?: number;
  fallbackParticipantIds?: string[];
  preferredRootPreviewText?: string;
  preferredSummaryInfo?: MindroomThreadSummaryInfo;
  room: Room;
  rootEvent?: MatrixEvent;
  thread?: VisibleThreadEventCollectionLike | null;
  threadRootId: string;
};

export const resolveThreadPresentationSnapshot = ({
  room,
  threadRootId,
  thread,
  rootEvent,
  preferredSummaryInfo,
  preferredRootPreviewText,
  fallbackLatestReplyPreviewText,
  fallbackLastSenderId,
  fallbackLastSenderDisplayName,
  fallbackMessageCount,
  fallbackMessageCountIsLowerBound = false,
  fallbackParticipantIds,
}: ResolveThreadPresentationSnapshotOptions): ThreadPresentationSnapshot => {
  const replyEvents = getPreferredVisibleThreadReplyEvents(thread);
  const latestPreviewEvent = getLatestRenderableVisibleThreadReplyEvent(replyEvents);
  const lastEvent = latestPreviewEvent ?? replyEvents[replyEvents.length - 1];
  const lastSenderId =
    lastEvent?.getSender?.() ??
    fallbackLastSenderId ??
    fallbackParticipantIds?.find((candidateId) => !!candidateId);
  const lastSenderDisplayName = lastSenderId
    ? getMemberDisplayName(room, lastSenderId) ?? lastSenderId
    : fallbackLastSenderDisplayName;
  const summaryInfo = resolveThreadSummaryInfo({
    preferredSummaryInfo,
    thread,
  });
  const visibleMessageCount = getVisibleThreadMessageCount(thread, fallbackMessageCount);
  const minimumMessageCount =
    fallbackMessageCountIsLowerBound &&
    typeof fallbackMessageCount === 'number' &&
    Number.isFinite(fallbackMessageCount)
      ? fallbackMessageCount
      : 0;

  return {
    summaryInfo,
    summaryText: summaryInfo?.summaryText,
    rootPreviewText: resolveThreadRootPreviewText({
      room,
      threadRootId,
      rootEvent,
      preferredPreviewText: preferredRootPreviewText,
    }),
    latestReplyPreviewText:
      getVisibleThreadEventBodyPreviewText(latestPreviewEvent) ?? fallbackLatestReplyPreviewText,
    lastSenderId,
    lastSenderDisplayName,
    messageCount:
      typeof summaryInfo?.messageCount === 'number'
        ? Math.max(summaryInfo.messageCount, visibleMessageCount, minimumMessageCount)
        : Math.max(visibleMessageCount, minimumMessageCount),
  };
};

export const getThreadPrimarySummaryText = ({
  summaryText,
  rootPreviewText,
}: Pick<ThreadPresentationSnapshot, 'summaryText' | 'rootPreviewText'>): string | undefined =>
  summaryText ?? rootPreviewText;
