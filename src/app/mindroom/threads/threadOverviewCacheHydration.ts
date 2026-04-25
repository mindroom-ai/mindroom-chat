import { useEffect } from 'react';
import type { IEvent, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import type { ThreadCacheCoverage, ThreadRecord } from './types';
import {
  getCompactCachedThreadActivityTs,
  getCompactCachedThreadRootPreviewInfo,
} from './compactThreadRootData';
import { type CachedThreadEventPage, loadLatestCachedThreadEvents } from './eventRepository';
import { hasLikelyIncompleteStreamingBody } from './threadEditBackfill';
import { resolveThreadPresentationSnapshot } from './threadPresentation';
import { buildThreadCacheCoverage } from './threadCacheCoverage';
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

export const buildCachedOverviewCoverage = (
  cachedPage: CachedThreadEventPage
): ThreadCacheCoverage => {
  const { oldestTs, newestTs } = getCachedEventTsRange(cachedPage);

  return buildThreadCacheCoverage({
    eventCount: cachedPage.events.length,
    oldestTs,
    newestTs,
    backwardToken: cachedPage.beforeToken,
    hasMoreBackward: cachedPage.hasMoreBefore || typeof cachedPage.beforeToken === 'string',
    expectedReplyCount: cachedPage.expectedReplyCount,
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
  const nextMessageCount =
    cachedPresentation.messageCount > 0 && cachedPresentation.messageCount > currentMessageCount
      ? cachedPresentation.messageCount
      : undefined;
  const nextSummaryInfo = cachedPresentation.summaryInfo?.summaryText
    ? cachedPresentation.summaryInfo
    : undefined;
  const nextCacheCoverage = buildThreadCacheCoverage({
    eventCount: events.length,
    oldestTs,
    newestTs,
    backwardToken: beforeToken,
    hasMoreBackward: typeof beforeToken === 'string',
    expectedReplyCount,
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
  const nextMessageCount =
    cachedPresentation.messageCount > 0 && cachedPresentation.messageCount > currentMessageCount
      ? cachedPresentation.messageCount
      : undefined;
  const nextSummaryInfo = cachedPresentation.summaryInfo?.summaryText
    ? cachedPresentation.summaryInfo
    : undefined;
  const nextCacheCoverage = hasCachedOverviewCoverage(cachedPage)
    ? buildCachedOverviewCoverage(cachedPage)
    : undefined;

  let nextPreview: string | undefined;
  if (showCompactRoomView && !compactCachedThreadRootBodyMap.has(rootId)) {
    const cachedPreview = getCompactCachedThreadRootPreviewInfo({
      threadId: rootId,
      cachedPage,
      mapper,
    });
    if (cachedPreview) {
      const currentPreview = compactThreadRootBodyMap.get(rootId);
      const currentSourceTs =
        currentRootEvent?.replacingEvent()?.getTs() ?? currentRootEvent?.getTs() ?? 0;
      if (
        cachedPreview.previewText !== currentPreview &&
        (!currentPreview || cachedPreview.sourceTs > currentSourceTs)
      ) {
        nextPreview = cachedPreview.previewText;
      }
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
      const updates = await Promise.all(
        threadRootIdsToLoad.map(async (rootId) => {
          const cachedPage = await loadLatestCachedThreadEvents(sessionId, room.roomId, rootId, 32);
          const currentRecord = (
            showCompactRoomView ? compactThreadRecordMap : threadRecordMap
          ).get(rootId);
          const currentRootEvent =
            room.findEventById(rootId) ??
            room.getThread(rootId)?.rootEvent ??
            roomThreadListThreads.find((thread) => thread.id === rootId)?.rootEvent;

          return resolveCachedOverviewUpdate({
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
        })
      );

      if (cancelled) return;

      const nextUpdates: CachedOverviewUpdate[] = [];
      updates.forEach((entry) => {
        if (entry !== null) nextUpdates.push(entry);
      });
      if (nextUpdates.length === 0) return;

      applyUpdates(nextUpdates, { includeCompactRootBody: showCompactRoomView });

      nextUpdates.forEach(({ rootId, nextSummaryInfo }) => {
        if (!nextSummaryInfo?.summaryText) return;
        onStoreThreadSummary(rootId, nextSummaryInfo);
      });
    };

    loadCachedThreadOverviewRecords();

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
