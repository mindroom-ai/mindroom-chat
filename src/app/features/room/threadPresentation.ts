import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import {
  getLatestThreadSummaryInfoFromEventSources,
  pickLatestThreadSummaryInfo,
  type MindroomThreadSummaryInfo,
} from '../../components/message/mindroomThreadSummary';
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
  room: Room;
  threadRootId: string;
  rootEvent?: MatrixEvent;
  preferredPreviewText?: string;
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
  room: Room;
  threadRootId: string;
  thread?: VisibleThreadEventCollectionLike | null;
  rootEvent?: MatrixEvent;
  preferredSummaryInfo?: MindroomThreadSummaryInfo;
  preferredRootPreviewText?: string;
  fallbackLatestReplyPreviewText?: string;
  fallbackLastSenderId?: string;
  fallbackLastSenderDisplayName?: string;
  fallbackMessageCount?: number;
  fallbackParticipantIds?: string[];
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
    messageCount: summaryInfo?.messageCount ?? getVisibleThreadMessageCount(thread, fallbackMessageCount),
  };
};

export const getThreadPrimarySummaryText = ({
  summaryText,
  rootPreviewText,
}: Pick<ThreadPresentationSnapshot, 'summaryText' | 'rootPreviewText'>): string | undefined =>
  summaryText ?? rootPreviewText;
