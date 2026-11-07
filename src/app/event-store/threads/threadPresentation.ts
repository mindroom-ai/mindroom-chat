import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { TFunction } from 'i18next';
import {
  getThreadPreviewLocalization,
  localizeThreadPreview,
  type ThreadPreviewLocalization,
} from './threadMessagePreview';
import {
  getThreadSummaryInfosFromEventSources,
  getThreadSummaryEventInfo,
  isThreadSummaryEvent,
  pickLatestThreadSummaryInfo,
  type ThreadSummaryInfo,
} from '../../matrix/protocol/threadSummary';
import { getMemberDisplayName } from '../../matrix/room';
import { getBundledThreadPreviews, getThreadPreviewRevisionTs } from './threadBundledPreviews';
import {
  getCompactThreadRootBodyPreviewText,
  pickPreferredThreadRootPreviewText,
} from './compactThreadRootData';
import {
  getLatestRenderableVisibleThreadReplyEvent,
  getPreferredVisibleThreadReplyEvents,
  getVisibleThreadEventBodyPreviewText,
  getVisibleThreadMessageCount,
  isVisibleThreadReplyEvent,
  type VisibleThreadEventCollectionLike,
} from './threadUtils';

export type ThreadPresentationSnapshot = {
  summaryInfo: ThreadSummaryInfo | undefined;
  summaryText: string | undefined;
  rootPreviewText: string | undefined;
  latestReplyPreviewText: string | undefined;
  latestReplyTs?: number;
  rootPreviewLocalization?: ThreadPreviewLocalization;
  latestReplyPreviewLocalization?: ThreadPreviewLocalization;
  lastSenderId: string | undefined;
  lastSenderDisplayName: string | undefined;
  messageCount: number;
};

type ResolveThreadSummaryInfoOptions = {
  preferredSummaryInfo?: ThreadSummaryInfo;
  thread?: VisibleThreadEventCollectionLike | null;
};

export const resolveThreadSummaryInfo = ({
  preferredSummaryInfo,
  thread,
}: ResolveThreadSummaryInfoOptions): ThreadSummaryInfo | undefined =>
  pickLatestThreadSummaryInfo(
    ...getThreadSummaryInfosFromEventSources(
      thread?.replyToEvent && isVisibleThreadReplyEvent(thread.replyToEvent)
        ? [thread.replyToEvent]
        : undefined
    ),
    preferredSummaryInfo,
    ...getThreadSummaryInfosFromEventSources(thread?.events, thread?.timeline)
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
  fallbackLatestReplyTs?: number;
  /** Stands in for the cached reply's time when only the thread's activity is known. */
  fallbackLastActivityTs?: number;
  fallbackLastSenderDisplayName?: string;
  fallbackLastSenderId?: string;
  fallbackLatestReplyPreviewText?: string;
  fallbackMessageCount?: number;
  fallbackParticipantIds?: string[];
  preferredRootPreviewText?: string;
  preferredSummaryInfo?: ThreadSummaryInfo;
  room: Room;
  rootEvent?: MatrixEvent;
  thread?: VisibleThreadEventCollectionLike | null;
  threadRootId: string;
  visibleReplyEvents?: MatrixEvent[];
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
  visibleReplyEvents,
  fallbackLatestReplyTs,
  fallbackLastActivityTs,
}: ResolveThreadPresentationSnapshotOptions): ThreadPresentationSnapshot => {
  const bundle = getBundledThreadPreviews(room, rootEvent ?? thread?.rootEvent);
  const cachedReplyTs = fallbackLatestReplyTs ?? fallbackLastActivityTs;
  const replyEvents = visibleReplyEvents ?? getPreferredVisibleThreadReplyEvents(thread);
  // A root fetched earlier keeps the server's previews of that moment. Once this device knows a
  // newer thread event, or a newer revision of the bundle's latest one, its reply is out of date.
  const bundleLatest = bundle.latest;
  const outgrown =
    !!bundleLatest &&
    [...replyEvents, thread?.replyToEvent].some(
      (event) =>
        !!event &&
        (event.getId() === bundleLatest.id
          ? getThreadPreviewRevisionTs(event) > bundleLatest.ts
          : event.getTs() > bundleLatest.ts)
    );
  const bundled = { title: bundle.title, reply: outgrown ? undefined : bundle.reply };
  const loadedPreviewEvent = getLatestRenderableVisibleThreadReplyEvent(replyEvents);
  // The SDK restores the bundled reply before loading the thread timeline.
  // Use it for presentation without treating one event as the full reply count.
  const bundledReply = bundled.reply ?? thread?.replyToEvent;
  const candidatePreviewEvent =
    (!fallbackLatestReplyPreviewText ||
      (bundled.reply && cachedReplyTs !== undefined &&
        getThreadPreviewRevisionTs(bundled.reply) > cachedReplyTs)) &&
    bundledReply &&
    !isThreadSummaryEvent(bundledReply) &&
    isVisibleThreadReplyEvent(bundledReply) &&
    getVisibleThreadEventBodyPreviewText(bundledReply) &&
    (!loadedPreviewEvent || (bundledReply.getId() === loadedPreviewEvent.getId()
      ? getThreadPreviewRevisionTs(bundledReply) > getThreadPreviewRevisionTs(loadedPreviewEvent)
      : bundledReply.getTs() > loadedPreviewEvent.getTs()))
      ? bundledReply
      : loadedPreviewEvent;
  const preferCachedReply = bundled.reply && fallbackLatestReplyPreviewText &&
    cachedReplyTs !== undefined && (!candidatePreviewEvent ||
      cachedReplyTs > getThreadPreviewRevisionTs(candidatePreviewEvent));
  const latestPreviewEvent = preferCachedReply ? undefined : candidatePreviewEvent;
  // A cached preview keeps its own sender: a newer reply not shown yet (one still encrypted) did
  // not write it (P2-e2ee-F005).
  const lastEvent = preferCachedReply
    ? undefined
    : latestPreviewEvent ??
      (fallbackLatestReplyPreviewText ? undefined : replyEvents[replyEvents.length - 1]);
  const lastSenderId =
    lastEvent?.getSender?.() ??
    fallbackLastSenderId ??
    fallbackParticipantIds?.find((candidateId) => !!candidateId);
  const lastSenderDisplayName = lastSenderId
    ? getMemberDisplayName(room, lastSenderId) ?? lastSenderId
    : fallbackLastSenderDisplayName;
  const summaryInfo = resolveThreadSummaryInfo({
    preferredSummaryInfo: pickLatestThreadSummaryInfo(
      bundled.title ? getThreadSummaryEventInfo(bundled.title) : undefined,
      preferredSummaryInfo
    ),
    thread,
  });
  const visibleMessageCount = getVisibleThreadMessageCount(
    thread,
    fallbackMessageCount,
    replyEvents
  );
  const rootPreviewText = resolveThreadRootPreviewText({
    room,
    threadRootId,
    rootEvent,
    preferredPreviewText: preferredRootPreviewText,
  });
  const latestReplyPreviewText =
    getVisibleThreadEventBodyPreviewText(latestPreviewEvent) ?? fallbackLatestReplyPreviewText;
  const rootPreviewLocalization = getThreadPreviewLocalization(
    rootEvent?.getContent?.(),
    rootPreviewText
  );
  const latestReplyPreviewLocalization = getThreadPreviewLocalization(
    latestPreviewEvent?.getContent?.(),
    latestReplyPreviewText
  );

  return {
    summaryInfo,
    summaryText: summaryInfo?.summaryText,
    rootPreviewText,
    latestReplyPreviewText,
    // A title notice shown for want of a reply has no reply time.
    latestReplyTs: latestPreviewEvent
      ? isThreadSummaryEvent(latestPreviewEvent)
        ? undefined
        : getThreadPreviewRevisionTs(latestPreviewEvent)
      : fallbackLatestReplyTs,
    ...(rootPreviewLocalization ? { rootPreviewLocalization } : {}),
    ...(latestReplyPreviewLocalization ? { latestReplyPreviewLocalization } : {}),
    lastSenderId,
    lastSenderDisplayName,
    messageCount:
      typeof summaryInfo?.messageCount === 'number'
        ? Math.max(summaryInfo.messageCount, visibleMessageCount)
        : visibleMessageCount,
  };
};

export const getThreadPrimarySummaryText = (
  {
    summaryText,
    rootPreviewText,
    rootPreviewLocalization,
  }: Pick<
    ThreadPresentationSnapshot,
    'summaryText' | 'rootPreviewText' | 'rootPreviewLocalization'
  >,
  t?: TFunction
): string | undefined =>
  summaryText ?? localizeThreadPreview(rootPreviewText, rootPreviewLocalization, t);
