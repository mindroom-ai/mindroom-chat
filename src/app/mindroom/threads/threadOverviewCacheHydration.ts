import { useCallback, useEffect } from 'react';
import type { IEvent, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import type { ThreadCacheCoverage, ThreadRecord, ThreadReplyCountSnapshotEvidence } from './types';
import {
  getCompactCachedThreadActivityTs,
  getCompactCachedThreadRootPreviewInfo,
  getCompactThreadRootPreviewInfo,
} from './compactThreadRootData';
import { type CachedThreadEventPage, loadLatestCachedThreadEventsBatch } from './eventRepository';
import { hasLikelyIncompleteStreamingBody } from './threadEditBackfill';
import { resolveThreadPresentationSnapshot } from './threadPresentation';
import { buildThreadCacheCoverage } from './threadCacheCoverage';
import {
  buildVisibleThreadReplyCountMap,
  getPreferredVisibleThreadReplyEvents,
  reconcileThreadReplyCountWithEvidence,
} from './threadUtils';
import type {
  ThreadOverviewCachedMetadataController,
  ThreadOverviewCachedMetadataUpdate,
} from './threadOverviewCacheMetadata';

type ThreadLikeRoot = {
  id: string;
  rootEvent?: MatrixEvent;
};

type UseThreadOverviewCacheHydrationOptions = {
  threadId?: string;
  overviewThreadRootIds: string[];
  overviewThreadMetadataCacheLimit: number;
  room: Room;
  roomThreadListThreads: ThreadLikeRoot[];
  sessionId: string;
  mx: MatrixClient;
  showCompactRoomView: boolean;
  compactThreadRootBodyMap: Map<string, string>;
  compactThreadRecordMap: ReadonlyMap<string, ThreadRecord>;
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  cachedMetadata: ThreadOverviewCachedMetadataController;
  onStoreThreadSummary: (rootId: string, info: MindroomThreadSummaryInfo) => void;
};

type CachedOverviewUpdate = ThreadOverviewCachedMetadataUpdate & {
  nextSummaryInfo?: MindroomThreadSummaryInfo;
};

export type FetchedRelationOverviewUpdateOptions = {
  rootId: string;
  room: Room;
  events: MatrixEvent[];
  currentRecord?: ThreadRecord;
  rootEvent?: MatrixEvent | null;
  beforeToken?: string | null;
  expectedReplyCount?: number;
  relationSnapshotComplete?: boolean;
  snapshotComplete?: boolean;
  tailLoaded?: boolean;
  replyCountEvidence?: ThreadReplyCountSnapshotEvidence;
};

type ResolveCachedOverviewUpdateOptions = {
  rootId: string;
  room: Room;
  mapper: (rawEvent: IEvent) => MatrixEvent;
  cachedPage: CachedThreadEventPage;
  currentRecord?: ThreadRecord;
  currentRootEvent?: MatrixEvent;
  showCompactRoomView: boolean;
  compactCachedThreadRootBodyMap: ReadonlyMap<string, string>;
  compactThreadRootBodyMap: ReadonlyMap<string, string>;
};

const getCachedEventTsRange = (
  cachedPage: Pick<CachedThreadEventPage, 'events'>
): { oldestTs: number | undefined; newestTs: number | undefined } => {
  const timestamps = cachedPage.events
    .map((event) => event.origin_server_ts)
    .filter((ts): ts is number => typeof ts === 'number' && Number.isFinite(ts));

  return {
    oldestTs: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
    newestTs: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
  };
};

const getMatrixEventTsRange = (
  events: MatrixEvent[]
): { oldestTs: number | undefined; newestTs: number | undefined } => {
  const timestamps = events
    .map((event) => event.getTs())
    .filter((ts): ts is number => typeof ts === 'number' && Number.isFinite(ts));

  return {
    oldestTs: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
    newestTs: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
  };
};

const getMatrixRelationSnapshotTs = (events: MatrixEvent[]): number | undefined => {
  const timestamps = events.flatMap((event) => {
    const redactedBecause = event.getUnsigned()?.redacted_because as
      | { origin_server_ts?: unknown }
      | undefined;
    return [event.getTs(), redactedBecause?.origin_server_ts].filter(
      (timestamp): timestamp is number =>
        typeof timestamp === 'number' && Number.isFinite(timestamp)
    );
  });
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
};

const getOldestVisibleReplyEventId = (events: MatrixEvent[]): string | undefined =>
  getPreferredVisibleThreadReplyEvents({ events, timeline: events })
    .reduce<MatrixEvent | undefined>((oldestEvent, event) => {
      if (!oldestEvent || event.getTs() < oldestEvent.getTs()) return event;
      return oldestEvent;
    }, undefined)
    ?.getId();

const getSafeMessageCount = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

const resolveNextMessageCount = ({
  currentMessageCount,
  observedMessageCount,
  authoritative,
}: {
  currentMessageCount: number;
  observedMessageCount: number;
  authoritative: boolean;
}): number | undefined => {
  if (authoritative) {
    return observedMessageCount !== currentMessageCount ? observedMessageCount : undefined;
  }
  return observedMessageCount > currentMessageCount ? observedMessageCount : undefined;
};

export const buildCachedOverviewCoverage = (
  cachedPage: CachedThreadEventPage,
  cachedEvents: MatrixEvent[] = []
): ThreadCacheCoverage => {
  const { oldestTs, newestTs } = getCachedEventTsRange(cachedPage);

  return buildThreadCacheCoverage({
    eventCount: cachedPage.events.length,
    oldestTs,
    oldestVisibleReplyEventId: getOldestVisibleReplyEventId(cachedEvents),
    newestTs,
    backwardToken: cachedPage.beforeToken,
    hasMoreBackward: cachedPage.hasMoreBefore || typeof cachedPage.beforeToken === 'string',
    expectedReplyCount: cachedPage.expectedReplyCount,
    expectedReplyCountSnapshotTs: cachedPage.expectedReplyCountSnapshotTs,
    expectedReplyCountEvidence: cachedPage.expectedReplyCountEvidence,
    relationSnapshotComplete: cachedPage.relationSnapshotComplete,
    snapshotComplete: cachedPage.snapshotComplete,
    tailLoaded: cachedPage.tailLoaded,
  });
};

export const resolveFetchedRelationOverviewUpdate = ({
  rootId,
  room,
  events,
  currentRecord,
  rootEvent,
  beforeToken,
  expectedReplyCount,
  relationSnapshotComplete,
  snapshotComplete,
  tailLoaded,
  replyCountEvidence,
}: FetchedRelationOverviewUpdateOptions): CachedOverviewUpdate | null => {
  const { oldestTs, newestTs } = getMatrixEventTsRange(events);
  const liveActivityTs = currentRecord?.status.lastActivityTs ?? 0;
  const nextActivityTs = newestTs !== undefined && newestTs > liveActivityTs ? newestTs : undefined;
  const cachedPresentation = resolveThreadPresentationSnapshot({
    room,
    threadRootId: rootId,
    thread: { events, timeline: events },
    rootEvent: rootEvent ?? undefined,
  });
  const currentPresentation = currentRecord?.presentation;
  const shouldUseFetchedReplyMetadata =
    (newestTs !== undefined && newestTs >= liveActivityTs) ||
    !currentPresentation?.latestReplyPreviewText;
  const nextReplyPreviewText =
    shouldUseFetchedReplyMetadata &&
    cachedPresentation.latestReplyPreviewText &&
    cachedPresentation.latestReplyPreviewText !== currentPresentation?.latestReplyPreviewText
      ? cachedPresentation.latestReplyPreviewText
      : undefined;
  const nextLastSenderId =
    shouldUseFetchedReplyMetadata &&
    cachedPresentation.lastSenderId &&
    cachedPresentation.lastSenderId !== currentPresentation?.lastSenderId
      ? cachedPresentation.lastSenderId
      : undefined;
  const currentMessageCount =
    currentPresentation?.messageCount ?? currentRecord?.status.replyCount ?? 0;
  const authoritativeFetchedMessageCount = relationSnapshotComplete
    ? buildVisibleThreadReplyCountMap(events).get(rootId) ?? 0
    : undefined;
  const nextExpectedReplyCount = authoritativeFetchedMessageCount ?? expectedReplyCount;
  const retainedReplyCountEvidence =
    nextExpectedReplyCount !== undefined &&
    nextExpectedReplyCount === currentRecord?.cache.expectedReplyCount
      ? currentRecord.cache.expectedReplyCountEvidence
      : undefined;
  const evidenceAdjustedExpectedReplyCount =
    getSafeMessageCount(nextExpectedReplyCount) !== undefined && retainedReplyCountEvidence
      ? reconcileThreadReplyCountWithEvidence({
          baseCount: getSafeMessageCount(nextExpectedReplyCount) ?? 0,
          events,
          evidence: retainedReplyCountEvidence,
          threadRootId: rootId,
        })
      : getSafeMessageCount(nextExpectedReplyCount);
  const observedMessageCount =
    authoritativeFetchedMessageCount ??
    Math.max(
      buildVisibleThreadReplyCountMap(events).get(rootId) ?? 0,
      evidenceAdjustedExpectedReplyCount ?? 0
    );
  const nextMessageCount = resolveNextMessageCount({
    currentMessageCount,
    observedMessageCount,
    authoritative: authoritativeFetchedMessageCount !== undefined,
  });
  const nextSummaryInfo = cachedPresentation.summaryInfo?.summaryText
    ? cachedPresentation.summaryInfo
    : undefined;
  const fetchedRelationSnapshotTs =
    getMatrixRelationSnapshotTs(events) ?? rootEvent?.getTs() ?? undefined;
  const resolvedReplyCountEvidence =
    relationSnapshotComplete === true
      ? replyCountEvidence ?? {
          knownEventIds: [
            ...new Set(
              events
                .map((event) => event.getId())
                .filter((eventId): eventId is string => !!eventId && eventId !== rootId)
            ),
          ],
          visibleEventIds: [
            ...new Set(
              getPreferredVisibleThreadReplyEvents({ events, timeline: events })
                .map((event) => event.getId())
                .filter((eventId): eventId is string => !!eventId)
            ),
          ],
        }
      : undefined;
  const expectedReplyCountSnapshotTs =
    relationSnapshotComplete === true
      ? fetchedRelationSnapshotTs
      : nextExpectedReplyCount !== undefined &&
        nextExpectedReplyCount === currentRecord?.cache.expectedReplyCount
      ? currentRecord.cache.expectedReplyCountSnapshotTs
      : undefined;
  const nextCacheCoverage = buildThreadCacheCoverage({
    eventCount: events.length,
    oldestTs,
    oldestVisibleReplyEventId: getOldestVisibleReplyEventId(events),
    newestTs,
    backwardToken: beforeToken,
    hasMoreBackward: typeof beforeToken === 'string',
    expectedReplyCount: nextExpectedReplyCount,
    expectedReplyCountSnapshotTs,
    expectedReplyCountEvidence:
      relationSnapshotComplete === true ? resolvedReplyCountEvidence : retainedReplyCountEvidence,
    relationSnapshotComplete,
    snapshotComplete,
    tailLoaded,
  });

  if (
    nextActivityTs === undefined &&
    nextReplyPreviewText === undefined &&
    nextLastSenderId === undefined &&
    nextMessageCount === undefined &&
    nextSummaryInfo === undefined
  ) {
    return {
      rootId,
      nextCacheCoverage,
    };
  }

  return {
    rootId,
    nextActivityTs,
    nextReplyPreviewText,
    nextLastSenderId,
    nextMessageCount,
    nextSummaryInfo,
    nextCacheCoverage,
  };
};

const hasCachedOverviewCoverage = (cachedPage: CachedThreadEventPage): boolean =>
  cachedPage.events.length > 0 ||
  !!cachedPage.rootEvent ||
  cachedPage.beforeToken !== undefined ||
  cachedPage.expectedReplyCount !== undefined ||
  cachedPage.snapshotComplete !== undefined ||
  cachedPage.relationSnapshotComplete !== undefined ||
  cachedPage.tailLoaded !== undefined;

export const resolveCachedOverviewUpdate = ({
  rootId,
  room,
  mapper,
  cachedPage,
  currentRecord,
  currentRootEvent,
  showCompactRoomView,
  compactCachedThreadRootBodyMap,
  compactThreadRootBodyMap,
}: ResolveCachedOverviewUpdateOptions): CachedOverviewUpdate | null => {
  // Capture the SDK revision before the cache mapper gets a chance to reuse
  // and update the same MatrixEvent instance.
  const livePreview = compactThreadRootBodyMap.get(rootId);
  const livePreviewSourceTs = getCompactThreadRootPreviewInfo(currentRootEvent, {
    eventId: rootId,
    room,
  })?.sourceTs;
  const cachedActivityTs = getCompactCachedThreadActivityTs({
    threadId: rootId,
    cachedPage,
    mapper,
  });
  const liveActivityTs = currentRecord?.status.lastActivityTs ?? 0;
  const nextActivityTs =
    cachedActivityTs && cachedActivityTs > liveActivityTs ? cachedActivityTs : undefined;
  const cachedEvents = cachedPage.events.map((rawEvent) => mapper(rawEvent as IEvent));
  const cachedPresentation = resolveThreadPresentationSnapshot({
    room,
    threadRootId: rootId,
    thread: { events: cachedEvents, timeline: cachedEvents },
    rootEvent: cachedEvents.find((event) => event.getId() === rootId) ?? currentRootEvent,
  });
  const currentPresentation = currentRecord?.presentation;
  const shouldUseCachedReplyMetadata =
    (cachedActivityTs !== undefined && cachedActivityTs >= liveActivityTs) ||
    !currentPresentation?.latestReplyPreviewText;
  const nextReplyPreviewText =
    shouldUseCachedReplyMetadata &&
    cachedPresentation.latestReplyPreviewText &&
    cachedPresentation.latestReplyPreviewText !== currentPresentation?.latestReplyPreviewText
      ? cachedPresentation.latestReplyPreviewText
      : undefined;
  const nextLastSenderId =
    shouldUseCachedReplyMetadata &&
    cachedPresentation.lastSenderId &&
    cachedPresentation.lastSenderId !== currentPresentation?.lastSenderId
      ? cachedPresentation.lastSenderId
      : undefined;
  const currentMessageCount =
    currentPresentation?.messageCount ?? currentRecord?.status.replyCount ?? 0;
  const durableMessageCount = getSafeMessageCount(cachedPage.expectedReplyCount);
  const cachedVisibleMessageCount = buildVisibleThreadReplyCountMap(cachedEvents).get(rootId) ?? 0;
  const evidenceAdjustedDurableMessageCount =
    durableMessageCount !== undefined && cachedPage.expectedReplyCountEvidence
      ? reconcileThreadReplyCountWithEvidence({
          baseCount: durableMessageCount,
          events: cachedEvents,
          evidence: cachedPage.expectedReplyCountEvidence,
          threadRootId: rootId,
        })
      : durableMessageCount;
  const observedMessageCount =
    durableMessageCount === undefined
      ? cachedVisibleMessageCount
      : cachedPage.expectedReplyCountEvidence
      ? evidenceAdjustedDurableMessageCount ?? cachedVisibleMessageCount
      : Math.max(durableMessageCount, cachedVisibleMessageCount);
  const nextMessageCount = resolveNextMessageCount({
    currentMessageCount,
    observedMessageCount,
    authoritative:
      durableMessageCount !== undefined &&
      cachedPage.relationSnapshotComplete === true &&
      cachedActivityTs !== undefined &&
      cachedActivityTs >= liveActivityTs,
  });
  const nextSummaryInfo = cachedPresentation.summaryInfo?.summaryText
    ? cachedPresentation.summaryInfo
    : undefined;
  const nextCacheCoverage = hasCachedOverviewCoverage(cachedPage)
    ? buildCachedOverviewCoverage(cachedPage, cachedEvents)
    : undefined;

  let nextPreview: string | undefined;
  let nextPreviewSourceTs: number | undefined;
  if (showCompactRoomView && !compactCachedThreadRootBodyMap.has(rootId)) {
    const cachedPreviewInfo = getCompactCachedThreadRootPreviewInfo({
      threadId: rootId,
      cachedPage,
      mapper,
    });
    const shouldUseCachedPreview =
      !!cachedPreviewInfo &&
      (!livePreview ||
        (hasLikelyIncompleteStreamingBody(livePreview) &&
          !hasLikelyIncompleteStreamingBody(cachedPreviewInfo.previewText)) ||
        (!hasLikelyIncompleteStreamingBody(cachedPreviewInfo.previewText) &&
          livePreviewSourceTs !== undefined &&
          cachedPreviewInfo.sourceTs > livePreviewSourceTs));
    if (cachedPreviewInfo && shouldUseCachedPreview) {
      nextPreview = cachedPreviewInfo.previewText;
      nextPreviewSourceTs = cachedPreviewInfo.sourceTs;
    }
  }

  if (
    nextActivityTs === undefined &&
    nextPreview === undefined &&
    nextReplyPreviewText === undefined &&
    nextLastSenderId === undefined &&
    nextMessageCount === undefined &&
    nextSummaryInfo === undefined &&
    nextCacheCoverage === undefined
  ) {
    return null;
  }

  return {
    rootId,
    nextActivityTs,
    nextPreview,
    nextPreviewSourceTs,
    nextReplyPreviewText,
    nextLastSenderId,
    nextMessageCount,
    nextSummaryInfo,
    nextCacheCoverage,
  };
};

export const useThreadOverviewCacheHydration = ({
  threadId,
  overviewThreadRootIds,
  overviewThreadMetadataCacheLimit,
  room,
  roomThreadListThreads,
  sessionId,
  mx,
  showCompactRoomView,
  compactThreadRootBodyMap,
  compactThreadRecordMap,
  threadRecordMap,
  cachedMetadata,
  onStoreThreadSummary,
}: UseThreadOverviewCacheHydrationOptions): void => {
  const {
    compactRootBodyMap: compactCachedThreadRootBodyMap,
    lastActivityTsMap: cachedThreadLastActivityTsMap,
    coverageMap: cachedThreadCoverageMap,
    compactRootPreviewAttemptCountsRef,
    applyUpdates,
  } = cachedMetadata;

  useEffect(() => {
    if (threadId || overviewThreadRootIds.length === 0) return;

    const threadRootIdsToLoad = overviewThreadRootIds
      .slice(0, overviewThreadMetadataCacheLimit)
      .filter((rootId) => {
        const needsCacheCoverage = !cachedThreadCoverageMap.has(rootId);
        const needsActivityTs = !cachedThreadLastActivityTsMap.has(rootId) && needsCacheCoverage;

        if (!showCompactRoomView) {
          return needsActivityTs || needsCacheCoverage;
        }

        const currentPreview = compactThreadRootBodyMap.get(rootId);
        const attemptCount = compactRootPreviewAttemptCountsRef.current.get(rootId) ?? 0;
        const maxAttempts =
          !currentPreview || hasLikelyIncompleteStreamingBody(currentPreview) ? 3 : 1;
        const needsPreview =
          !compactCachedThreadRootBodyMap.has(rootId) && attemptCount < maxAttempts;

        return needsActivityTs || needsPreview || needsCacheCoverage;
      });
    if (threadRootIdsToLoad.length === 0) return;

    if (showCompactRoomView) {
      threadRootIdsToLoad.forEach((rootId) => {
        if (compactCachedThreadRootBodyMap.has(rootId)) return;
        const currentCount = compactRootPreviewAttemptCountsRef.current.get(rootId) ?? 0;
        compactRootPreviewAttemptCountsRef.current.set(rootId, currentCount + 1);
      });
    }

    let cancelled = false;
    const mapper = mx.getEventMapper();

    const loadCachedThreadOverviewRecords = async () => {
      let cachedPages: Map<string, CachedThreadEventPage>;
      try {
        cachedPages = await loadLatestCachedThreadEventsBatch(
          sessionId,
          room.roomId,
          threadRootIdsToLoad,
          32
        );
      } catch {
        return;
      }
      if (cancelled) return;

      const nextUpdates: CachedOverviewUpdate[] = [];
      threadRootIdsToLoad.forEach((rootId) => {
        const cachedPage = cachedPages.get(rootId);
        if (!cachedPage) return;
        try {
          const currentRecord = (
            showCompactRoomView ? compactThreadRecordMap : threadRecordMap
          ).get(rootId);
          const currentRootEvent =
            room.findEventById(rootId) ??
            room.getThread(rootId)?.rootEvent ??
            roomThreadListThreads.find((thread) => thread.id === rootId)?.rootEvent;

          const update = resolveCachedOverviewUpdate({
            rootId,
            room,
            mapper,
            cachedPage,
            currentRecord,
            currentRootEvent,
            showCompactRoomView,
            compactCachedThreadRootBodyMap,
            compactThreadRootBodyMap,
          });
          if (update) nextUpdates.push(update);
        } catch {
          // A single unreadable cached page must not block the others.
        }
      });

      if (nextUpdates.length === 0) return;

      applyUpdates(nextUpdates, { includeCompactRootBody: showCompactRoomView });

      nextUpdates.forEach(({ rootId, nextSummaryInfo }) => {
        if (!nextSummaryInfo?.summaryText) return;
        onStoreThreadSummary(rootId, nextSummaryInfo);
      });
    };

    void loadCachedThreadOverviewRecords();

    return () => {
      cancelled = true;
    };
  }, [
    cachedThreadLastActivityTsMap,
    cachedThreadCoverageMap,
    compactRootPreviewAttemptCountsRef,
    compactCachedThreadRootBodyMap,
    compactThreadRecordMap,
    compactThreadRootBodyMap,
    mx,
    onStoreThreadSummary,
    overviewThreadMetadataCacheLimit,
    overviewThreadRootIds,
    room,
    room.roomId,
    roomThreadListThreads,
    sessionId,
    applyUpdates,
    showCompactRoomView,
    threadId,
    threadRecordMap,
  ]);
};

export type UseThreadOverviewRelationUpdatesOptions = {
  threadId?: string;
  showCompactRoomView: boolean;
  compactThreadRecordMap: ReadonlyMap<string, ThreadRecord>;
  normalThreadRecordMap: ReadonlyMap<string, ThreadRecord>;
  cachedMetadata: ThreadOverviewCachedMetadataController;
  room: Room;
  roomThreadListThreads: ThreadLikeRoot[];
  onStoreThreadSummary: (rootId: string, info: MindroomThreadSummaryInfo) => void;
};

export const useThreadOverviewRelationUpdates = ({
  threadId,
  showCompactRoomView,
  compactThreadRecordMap,
  normalThreadRecordMap,
  cachedMetadata,
  room,
  roomThreadListThreads,
  onStoreThreadSummary,
}: UseThreadOverviewRelationUpdatesOptions): ((
  options: FetchedRelationOverviewUpdateOptions
) => void) =>
  useCallback(
    (options: FetchedRelationOverviewUpdateOptions) => {
      if (threadId) return;

      const rootId = options.rootId;
      const currentRecord = (
        showCompactRoomView ? compactThreadRecordMap : normalThreadRecordMap
      ).get(rootId);
      const rootEvent =
        options.rootEvent ??
        room.findEventById(rootId) ??
        room.getThread(rootId)?.rootEvent ??
        roomThreadListThreads.find((thread) => thread.id === rootId)?.rootEvent ??
        undefined;
      const update = resolveFetchedRelationOverviewUpdate({
        ...options,
        currentRecord,
        rootEvent,
        room,
      });
      if (!update) return;

      cachedMetadata.applyUpdate(update, { includeCompactRootBody: false });

      if (update.nextSummaryInfo?.summaryText) {
        onStoreThreadSummary(rootId, update.nextSummaryInfo);
      }
    },
    [
      compactThreadRecordMap,
      cachedMetadata,
      normalThreadRecordMap,
      onStoreThreadSummary,
      room,
      roomThreadListThreads,
      showCompactRoomView,
      threadId,
    ]
  );
