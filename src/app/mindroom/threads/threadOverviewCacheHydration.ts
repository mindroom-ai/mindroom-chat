import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from 'react';
import { useEffect } from 'react';
import type {
  IEvent,
  MatrixClient,
  MatrixEvent,
  Room,
} from 'matrix-js-sdk';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import type { ThreadCacheCoverage, ThreadRecord } from './types';
import {
  getCompactCachedThreadActivityTs,
  getCompactCachedThreadRootPreviewInfo,
} from './compactThreadRootData';
import {
  type CachedThreadEventPage,
  loadLatestCachedThreadEvents,
} from './eventRepository';
import { hasLikelyIncompleteStreamingBody } from './threadEditBackfill';
import { resolveThreadPresentationSnapshot } from './threadPresentation';
import { buildThreadCacheCoverage } from './threadCacheCoverage';

type MapSetter<K, V> = Dispatch<SetStateAction<Map<K, V>>>;

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
  compactCachedThreadRootBodyMap: Map<string, string>;
  cachedThreadLastActivityTsMap: Map<string, number>;
  cachedThreadCoverageMap: Map<string, ThreadCacheCoverage>;
  compactThreadRecordMap: ReadonlyMap<string, ThreadRecord>;
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  compactCachedRootPreviewAttemptCountsRef: MutableRefObject<Map<string, number>>;
  setCompactCachedThreadRootBodyMap: MapSetter<string, string>;
  setCachedThreadLastActivityTsMap: MapSetter<string, number>;
  setCachedThreadLatestReplyPreviewMap: MapSetter<string, string>;
  setCachedThreadLastSenderIdMap: MapSetter<string, string>;
  setCachedThreadMessageCountMap: MapSetter<string, number>;
  setCachedThreadCoverageMap: MapSetter<string, ThreadCacheCoverage>;
  onStoreThreadSummary: (rootId: string, info: MindroomThreadSummaryInfo) => void;
};

type CachedOverviewUpdate = {
  rootId: string;
  nextActivityTs?: number;
  nextPreview?: string;
  nextReplyPreviewText?: string;
  nextLastSenderId?: string;
  nextMessageCount?: number;
  nextSummaryInfo?: MindroomThreadSummaryInfo;
  nextCacheCoverage?: ThreadCacheCoverage;
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

const applyMapUpdates = <K, V>(
  entries: Array<{ key: K; value: V | undefined }>,
  setMap: MapSetter<K, V>
): void => {
  if (entries.length === 0) return;

  setMap((prev) => {
    const next = new Map(prev);
    entries.forEach(({ key, value }) => {
      if (value === undefined) return;
      next.set(key, value);
    });
    return next;
  });
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
  compactCachedThreadRootBodyMap,
  cachedThreadLastActivityTsMap,
  cachedThreadCoverageMap,
  compactThreadRecordMap,
  threadRecordMap,
  compactCachedRootPreviewAttemptCountsRef,
  setCompactCachedThreadRootBodyMap,
  setCachedThreadLastActivityTsMap,
  setCachedThreadLatestReplyPreviewMap,
  setCachedThreadLastSenderIdMap,
  setCachedThreadMessageCountMap,
  setCachedThreadCoverageMap,
  onStoreThreadSummary,
}: UseThreadOverviewCacheHydrationOptions): void => {
  useEffect(() => {
    if (threadId || overviewThreadRootIds.length === 0) return;

    const threadRootIdsToLoad = overviewThreadRootIds
      .slice(0, overviewThreadMetadataCacheLimit)
      .filter((rootId) => {
        const needsCacheCoverage = !cachedThreadCoverageMap.has(rootId);
        const needsActivityTs =
          !cachedThreadLastActivityTsMap.has(rootId) && needsCacheCoverage;

        if (!showCompactRoomView) {
          return needsActivityTs || needsCacheCoverage;
        }

        const currentPreview = compactThreadRootBodyMap.get(rootId);
        const attemptCount = compactCachedRootPreviewAttemptCountsRef.current.get(rootId) ?? 0;
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
        const currentCount = compactCachedRootPreviewAttemptCountsRef.current.get(rootId) ?? 0;
        compactCachedRootPreviewAttemptCountsRef.current.set(rootId, currentCount + 1);
      });
    }

    let cancelled = false;
    const mapper = mx.getEventMapper();

    const loadCachedThreadOverviewRecords = async () => {
      const updates = await Promise.all(
        threadRootIdsToLoad.map(async (rootId) => {
          const cachedPage = await loadLatestCachedThreadEvents(sessionId, room.roomId, rootId, 32);
          const currentRecord =
            (showCompactRoomView ? compactThreadRecordMap : threadRecordMap).get(rootId);
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

      applyMapUpdates(
        nextUpdates.map(({ rootId, nextActivityTs }) => ({ key: rootId, value: nextActivityTs })),
        setCachedThreadLastActivityTsMap
      );

      if (showCompactRoomView) {
        applyMapUpdates(
          nextUpdates.map(({ rootId, nextPreview }) => ({ key: rootId, value: nextPreview })),
          setCompactCachedThreadRootBodyMap
        );
      }

      applyMapUpdates(
        nextUpdates.map(({ rootId, nextReplyPreviewText }) => ({
          key: rootId,
          value: nextReplyPreviewText,
        })),
        setCachedThreadLatestReplyPreviewMap
      );

      applyMapUpdates(
        nextUpdates.map(({ rootId, nextLastSenderId }) => ({
          key: rootId,
          value: nextLastSenderId,
        })),
        setCachedThreadLastSenderIdMap
      );

      applyMapUpdates(
        nextUpdates.map(({ rootId, nextMessageCount }) => ({
          key: rootId,
          value: nextMessageCount,
        })),
        setCachedThreadMessageCountMap
      );

      applyMapUpdates(
        nextUpdates.map(({ rootId, nextCacheCoverage }) => ({
          key: rootId,
          value: nextCacheCoverage,
        })),
        setCachedThreadCoverageMap
      );

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
    compactCachedRootPreviewAttemptCountsRef,
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
    setCachedThreadLastActivityTsMap,
    setCachedThreadLastSenderIdMap,
    setCachedThreadLatestReplyPreviewMap,
    setCachedThreadMessageCountMap,
    setCachedThreadCoverageMap,
    setCompactCachedThreadRootBodyMap,
    showCompactRoomView,
    threadId,
    threadRecordMap,
  ]);
};
