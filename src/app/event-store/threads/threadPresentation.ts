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
import { getThreadSummaryReply } from '../../matrix/client/unopenedThreadEdits';
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
  const summaryReply = getThreadSummaryReply(thread);
  // A root fetched earlier keeps the server's previews of that moment. Once this device knows a
  // newer thread event, or a newer revision of the bundle's latest one, its reply is out of date.
  const bundleLatest = bundle.latest;
  const outgrown =
    !!bundleLatest &&
    [...replyEvents, summaryReply].some(
      (event) =>
        !!event &&
        (event.getId() === bundleLatest.id
          ? getThreadPreviewRevisionTs(event) > bundleLatest.ts
          : event.getTs() > bundleLatest.ts)
    );
  const bundled = { title: bundle.title, reply: outgrown ? undefined : bundle.reply };
  // The SDK restores the bundled reply before loading the thread timeline.
  // Use it for presentation without treating one event as the full reply count. Like the server's
  // bundled reply, it replaces a cached copy of the reply older than its newest revision, and a
  // loaded title notice shows only for want of a reply.
  const bundledReply = bundled.reply ?? summaryReply;
  const loadedPreviewCandidate = getLatestRenderableVisibleThreadReplyEvent(
    bundledReply && !isThreadSummaryEvent(bundledReply)
      ? replyEvents.filter((event) => !isThreadSummaryEvent(event))
      : replyEvents
  );
  // A title can arrive without its reply timeline. Keep the cached reply preview in that case.
  const loadedPreviewEvent =
    loadedPreviewCandidate &&
    isThreadSummaryEvent(loadedPreviewCandidate) &&
    fallbackLatestReplyPreviewText
      ? undefined
      : loadedPreviewCandidate;
  const candidatePreviewEvent =
    (!fallbackLatestReplyPreviewText ||
      (bundledReply && cachedReplyTs !== undefined &&
        getThreadPreviewRevisionTs(bundledReply) > cachedReplyTs)) &&
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
  const lastEvent = preferCachedReply ? undefined : latestPreviewEvent ?? replyEvents[replyEvents.length - 1];
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

  // CPT-DIAG
  try {
    const w = window as unknown as { __CPT_DIAG__?: Map<string, unknown[]> };
    w.__CPT_DIAG__ ??= new Map();
    const desc = (e: MatrixEvent | null | undefined) =>
      e
        ? {
            id: e.getId()?.slice(0, 8),
            body: String((e.getContent() as { body?: unknown }).body ?? '').slice(0, 24),
            repl: e.replacingEvent()?.getId()?.slice(0, 8),
            ts: e.getTs(),
            rts: getThreadPreviewRevisionTs(e),
            sum: isThreadSummaryEvent(e),
          }
        : undefined;
    const real = thread as unknown as {
      initialEventsFetched?: boolean;
      replayEvents?: MatrixEvent[] | null;
      findEventById?: (id: string) => MatrixEvent | undefined;
      lastEvent?: MatrixEvent;
    } | null | undefined;
    const isReal = typeof real?.findEventById === 'function';
    const entry = {
      t: Math.round(performance.now()),
      src: isReal ? 'sdk' : 'cache',
      text: latestReplyPreviewText?.slice(0, 24),
      loaded: replyEvents.map(desc),
      replyTo: desc(thread?.replyToEvent),
      sumReply: desc(summaryReply),
      replyToInLoaded: !!thread?.replyToEvent && replyEvents.includes(thread.replyToEvent),
      fb: fallbackLatestReplyPreviewText?.slice(0, 24),
      fbTs: fallbackLatestReplyTs,
      fbAct: fallbackLastActivityTs,
      bTitle: desc(bundle.title),
      bReply: desc(bundle.reply),
      bLatest: bundle.latest,
      outgrown,
      chosen: latestPreviewEvent === loadedPreviewEvent ? 'loaded' : latestPreviewEvent ? 'bundled/replyTo' : preferCachedReply ? 'cachedPref' : 'fallback',
      init: real?.initialEventsFetched,
      replay: real?.replayEvents?.map((edit) => ({
        target: edit.getAssociatedId()?.slice(0, 8),
        body: String(((edit.getContent() as { 'm.new_content'?: { body?: unknown } })['m.new_content'] ?? {}).body ?? '').slice(0, 24),
        ts: edit.getTs(),
      })),
      lastEv: desc(real?.lastEvent),
      found: (() => {
        const ids = new Set<string>();
        if (bundle.latest?.id) ids.add(bundle.latest.id);
        real?.replayEvents?.forEach((edit) => {
          const id = edit.getAssociatedId();
          if (id) ids.add(id);
        });
        return [...ids].map((id) => {
          const ev = isReal ? real?.findEventById?.(id) : undefined;
          return {
            id: id.slice(0, 8),
            ev: desc(ev),
            inLive: !!ev && !!thread?.events?.includes(ev),
          };
        });
      })(),
      segs: isReal
        ? (thread as unknown as { getUnfilteredTimelineSet: () => { getTimelines: () => unknown[] } })
            .getUnfilteredTimelineSet()
            .getTimelines().length
        : undefined,
    };
    const list = w.__CPT_DIAG__.get(threadRootId) ?? [];
    const key = (value: unknown) => JSON.stringify({ ...(value as object), t: 0 });
    const previous = list[list.length - 1];
    if (!previous || key(previous) !== key(entry)) list.push(entry);
    if (list.length > 40) list.shift();
    w.__CPT_DIAG__.set(threadRootId, list);
  } catch {
    // diag only
  }
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
