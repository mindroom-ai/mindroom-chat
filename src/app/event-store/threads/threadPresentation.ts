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
  pickLatestThreadSummaryInfo,
  type ThreadSummaryInfo,
} from '../../matrix/protocol/threadSummary';
import { isFoldedSecretRequestEvent } from '../../matrix/protocol/secretRequestPreview';
import { getMemberDisplayName } from '../../matrix/room';
import {
  getRetainedThreadSummaryReply,
  getThreadSummaryReply,
} from '../../matrix/client/unopenedThreadEdits';
import { getBundledThreadPreviews, getThreadPreviewRevisionTs } from './threadBundledPreviews';
import {
  getCompactThreadRootBodyPreviewText,
  pickPreferredThreadRootPreviewText,
} from './compactThreadRootData';
import {
  getLatestRenderableVisibleThreadReplyEvent,
  getEventPreviewContent,
  getPreferredVisibleThreadReplyEvents,
  getVisibleThreadEventBodyPreviewText,
  getVisibleThreadMessageCount,
  isRenderableThreadReplyPreviewEvent,
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
  bundledPreviews?: ReturnType<typeof getBundledThreadPreviews>;
  fallbackLatestReplyTs?: number;
  /** Stands in for the cached reply's time when only the thread's activity is known. */
  fallbackLastActivityTs?: number;
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
  fallbackMessageCount,
  fallbackParticipantIds,
  visibleReplyEvents,
  fallbackLatestReplyTs,
  fallbackLastActivityTs,
  bundledPreviews,
}: ResolveThreadPresentationSnapshotOptions): ThreadPresentationSnapshot => {
  const viewerUserId = room.myUserId || undefined;
  const isFolded = (event: MatrixEvent) => isFoldedSecretRequestEvent(event, viewerUserId);
  const bundle = bundledPreviews ?? getBundledThreadPreviews(room, rootEvent ?? thread?.rootEvent);
  const cachedReplyTs = fallbackLatestReplyTs ?? fallbackLastActivityTs;
  const replyEvents = visibleReplyEvents ?? getPreferredVisibleThreadReplyEvents(thread);
  const summaryReply = getThreadSummaryReply(thread);
  const knownReplies = [
    ...replyEvents,
    thread?.replyToEvent,
    getRetainedThreadSummaryReply(thread),
  ];
  // A root fetched earlier keeps the server's previews of that moment. Once this device knows a
  // newer thread event, or a newer revision of the bundle's latest one, its reply is out of date.
  const bundleLatest = bundle.latest;
  const outgrown =
    !!bundleLatest &&
    [...knownReplies, summaryReply].some(
      (event) =>
        !!event &&
        (event.getId() === bundleLatest.id
          ? getThreadPreviewRevisionTs(event) > bundleLatest.ts
          : event.getTs() > bundleLatest.ts)
    );
  const bundledReplyFolded =
    !!bundle.reply &&
    knownReplies.some(
      (event) => !!event && event.getId() === bundle.reply?.getId() && isFolded(event)
    );
  const bundled = {
    title: bundle.title,
    reply: outgrown || bundledReplyFolded ? undefined : bundle.reply,
  };
  const loadedPreviewEvent = getLatestRenderableVisibleThreadReplyEvent(replyEvents, viewerUserId);
  // The SDK restores the bundled reply before loading the thread timeline.
  // Use it for presentation without treating one event as the full reply count. Like the server's
  // bundled reply, it replaces a cached copy of the reply older than its newest revision.
  const bundledReply = bundled.reply ?? summaryReply;
  // A cached prompt from a secret request that has since folded must not outlive its folding edit
  // and shadow an older agent reply; cached answers predating the request (< event.getTs()), from
  // another sender, or genuinely newer after the fold (> revisionTs) still win.
  const cachedSupersededByFoldedSecret =
    cachedReplyTs !== undefined &&
    knownReplies.some(
      (event) =>
        !!event &&
        isFolded(event) &&
        (!fallbackLastSenderId || fallbackLastSenderId === event.getSender()) &&
        cachedReplyTs >= event.getTs() &&
        getThreadPreviewRevisionTs(event) >= cachedReplyTs
    );
  const cachedFallback = cachedSupersededByFoldedSecret
    ? undefined
    : {
        previewText: fallbackLatestReplyPreviewText,
        replyTs: fallbackLatestReplyTs,
        lastSenderId: fallbackLastSenderId,
      };
  const candidatePreviewEvent =
    (!cachedFallback?.previewText ||
      (bundledReply &&
        cachedReplyTs !== undefined &&
        getThreadPreviewRevisionTs(bundledReply) > cachedReplyTs)) &&
    bundledReply &&
    isVisibleThreadReplyEvent(bundledReply) &&
    isRenderableThreadReplyPreviewEvent(bundledReply, viewerUserId) &&
    (!loadedPreviewEvent ||
      (bundledReply.getId() === loadedPreviewEvent.getId()
        ? getThreadPreviewRevisionTs(bundledReply) > getThreadPreviewRevisionTs(loadedPreviewEvent)
        : bundledReply.getTs() > loadedPreviewEvent.getTs()))
      ? bundledReply
      : loadedPreviewEvent;
  const preferCachedReply =
    bundled.reply &&
    cachedFallback?.previewText &&
    cachedReplyTs !== undefined &&
    (!candidatePreviewEvent || cachedReplyTs > getThreadPreviewRevisionTs(candidatePreviewEvent));
  const latestPreviewEvent = preferCachedReply ? undefined : candidatePreviewEvent;
  // A cached preview keeps its own sender: a newer reply not shown yet (one still encrypted) did
  // not write it (P2-e2ee-F005).
  const lastEvent = preferCachedReply
    ? undefined
    : (latestPreviewEvent ??
      (cachedFallback?.previewText
        ? undefined
        : replyEvents.findLast((event) => !isFolded(event))));
  const lastSenderId =
    lastEvent?.getSender?.() ??
    cachedFallback?.lastSenderId ??
    fallbackParticipantIds?.find((candidateId) => !!candidateId);
  const lastSenderDisplayName = lastSenderId
    ? (getMemberDisplayName(room, lastSenderId) ?? lastSenderId)
    : undefined;
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
    getVisibleThreadEventBodyPreviewText(latestPreviewEvent) ?? cachedFallback?.previewText;
  const rootPreviewLocalization = getThreadPreviewLocalization(
    getEventPreviewContent(rootEvent),
    rootPreviewText
  );
  const latestReplyPreviewLocalization = getThreadPreviewLocalization(
    getEventPreviewContent(latestPreviewEvent),
    latestReplyPreviewText
  );

  return {
    summaryInfo,
    summaryText: summaryInfo?.summaryText,
    rootPreviewText,
    latestReplyPreviewText,
    latestReplyTs: latestPreviewEvent
      ? getThreadPreviewRevisionTs(latestPreviewEvent)
      : cachedFallback?.replyTs,
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
  summaryText !== undefined
    ? localizeThreadPreview(summaryText, undefined, t)
    : localizeThreadPreview(rootPreviewText, rootPreviewLocalization, t);
