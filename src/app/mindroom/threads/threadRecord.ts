import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import {
  pickLatestThreadSummaryInfo,
  type MindroomThreadSummaryInfo,
} from '../../components/message/mindroomThreadSummary';
import { getNextThreadScheduledTs } from '../../hooks/useThreadHeaderInfo';
import { getThreadLastActivityTs } from '../../hooks/useThreadLastActivityTs';
import { getThreadStreamingState } from '../../hooks/useThreadStreamingState';
import { resolveRecentThreadSummaryText } from '../../features/recent-threads/recentThreadSummaryUtils';
import { isZeroReplyStandaloneThreadRootEvent } from '../../features/room/compactThreadRootData';
import { getThreadUnread } from '../../features/room/roomThreadList';
import { getEffectiveThreadRootActivityTs } from '../../features/room/threadRouteUtils';
import {
  getThreadPrimarySummaryText,
  resolveThreadPresentationSnapshot,
} from '../../features/room/threadPresentation';
import {
  buildVisibleThreadParticipantMap,
  buildVisibleThreadReplyCountMap,
  getPreferredVisibleThreadReplyEvents,
  getVisibleThreadParticipantIds,
} from '../../features/room/threadUtils';
import type { ThreadCacheCoverage, ThreadRecord } from './types';

const THREAD_PARTICIPANT_LIMIT = 3;

type ThreadResolutionLike = {
  isResolved?: boolean;
  tags?: Record<string, unknown> | null;
};

type BuildThreadRecordOptions = {
  room: Room;
  threadRootId: string;
  threadRootEvent?: MatrixEvent;
  summaryInfo?: MindroomThreadSummaryInfo;
  fallbackSummaryInfo?: MindroomThreadSummaryInfo;
  fallbackReplyCount?: number;
  rootPreviewText?: string;
  fallbackLatestReplyPreviewText?: string;
  fallbackLastSenderId?: string;
  fallbackLastSenderDisplayName?: string;
  fallbackMessageCount?: number;
  fallbackLastActivityTs?: number;
  fallbackParticipantIds?: string[];
  threadResolution?: ThreadResolutionLike;
  currentUserId?: string;
  readUpToTs?: number | null;
  scheduledTaskEvents?: MatrixEvent[];
  scheduledTaskCount?: number;
  nextScheduledTs?: number;
  cacheCoverage?: ThreadCacheCoverage;
  absoluteIndex?: number;
};

type BuildThreadRecordMapOptions = {
  room: Room;
  threadRootIds: string[];
  threadRootEventMap?: ReadonlyMap<string, MatrixEvent>;
  summaryMap?: ReadonlyMap<string, MindroomThreadSummaryInfo>;
  fallbackSummaryMap?: ReadonlyMap<string, MindroomThreadSummaryInfo>;
  fallbackReplyCountMap?: ReadonlyMap<string, number>;
  rootPreviewTextMap?: ReadonlyMap<string, string>;
  fallbackLatestReplyPreviewMap?: ReadonlyMap<string, string>;
  fallbackLastSenderIdMap?: ReadonlyMap<string, string>;
  fallbackLastSenderDisplayNameMap?: ReadonlyMap<string, string>;
  fallbackMessageCountMap?: ReadonlyMap<string, number>;
  fallbackLastActivityTsMap?: ReadonlyMap<string, number>;
  fallbackParticipantMap?: ReadonlyMap<string, string[]>;
  threadResolutionMap?: ReadonlyMap<string, ThreadResolutionLike>;
  currentUserId?: string;
  readUpToTs?: number | null;
  scheduledTaskEvents?: MatrixEvent[];
  scheduledTaskCounts?: ReadonlyMap<string, number>;
  cacheCoverageMap?: ReadonlyMap<string, ThreadCacheCoverage>;
  absoluteIndexMap?: ReadonlyMap<string, number>;
};

const getLoadedThreadEvents = (thread: ReturnType<Room['getThread']>): MatrixEvent[] | undefined =>
  thread?.events && thread.events.length > 0
    ? thread.events
    : thread?.timeline && thread.timeline.length > 0
    ? thread.timeline
    : undefined;

export const getThreadReplyCount = (
  room: Room,
  mEvent: MatrixEvent,
  fallbackReplyCount?: number,
  allowZeroReplyCount = false
): number | undefined => {
  const eventId = mEvent.getId();
  if (!eventId) return undefined;

  const thread = room.getThread(eventId);
  const loadedThreadEvents = getLoadedThreadEvents(thread);
  if (loadedThreadEvents && loadedThreadEvents.length > 0) {
    const visibleThreadReplyCount =
      buildVisibleThreadReplyCountMap(loadedThreadEvents).get(eventId) ?? 0;
    if (visibleThreadReplyCount > 0 || allowZeroReplyCount) {
      return visibleThreadReplyCount;
    }
  }

  const threadMeta = mEvent.getUnsigned()?.['m.relations']?.['m.thread'] as
    | { count?: unknown; c?: unknown }
    | undefined;
  if (typeof threadMeta?.count === 'number') return threadMeta.count;
  if (typeof threadMeta?.c === 'number') return threadMeta.c;

  const threadLength = thread?.length;
  if (typeof threadLength === 'number' && (threadLength > 0 || allowZeroReplyCount)) {
    return threadLength;
  }

  if (typeof fallbackReplyCount === 'number' && (fallbackReplyCount > 0 || allowZeroReplyCount)) {
    return fallbackReplyCount;
  }

  return allowZeroReplyCount ? 0 : undefined;
};

export const getKnownThreadReplyCount = (mEvent: MatrixEvent): number | undefined => {
  const threadMeta = mEvent.getUnsigned()?.['m.relations']?.['m.thread'] as
    | { count?: unknown; c?: unknown }
    | undefined;
  if (typeof threadMeta?.count === 'number') return threadMeta.count;
  if (typeof threadMeta?.c === 'number') return threadMeta.c;

  return undefined;
};

export const shouldRenderZeroReplyThreadBadge = (room: Room, mEvent: MatrixEvent): boolean => {
  const eventId = mEvent.getId();
  if (eventId) {
    const loadedThreadEvents = getLoadedThreadEvents(room.getThread(eventId));
    if (loadedThreadEvents && loadedThreadEvents.length > 0) {
      const visibleThreadReplyCount =
        buildVisibleThreadReplyCountMap(loadedThreadEvents).get(eventId) ?? 0;
      return visibleThreadReplyCount === 0;
    }

    const threadLength = room.getThread(eventId)?.length;
    if (typeof threadLength === 'number') return threadLength === 0;
  }

  const threadReplyCount = getKnownThreadReplyCount(mEvent);
  if (typeof threadReplyCount === 'number') return threadReplyCount === 0;

  return isZeroReplyStandaloneThreadRootEvent(mEvent);
};

export const getThreadReplyParticipantIds = (
  room: Room,
  mEvent: MatrixEvent | undefined,
  fallbackParticipantIds?: string[]
): string[] => {
  const eventId = mEvent?.getId();
  if (eventId) {
    const loadedThreadEvents = getLoadedThreadEvents(room.getThread(eventId));
    if (loadedThreadEvents && loadedThreadEvents.length > 0) {
      const participants =
        buildVisibleThreadParticipantMap(loadedThreadEvents, THREAD_PARTICIPANT_LIMIT).get(
          eventId
        ) ?? [];
      if (participants.length > 0) return participants;
    }
  }

  return fallbackParticipantIds?.slice(0, THREAD_PARTICIPANT_LIMIT) ?? [];
};

const getThreadStatusTags = (threadResolution: ThreadResolutionLike | undefined): string[] =>
  Object.keys(threadResolution?.tags ?? {}).filter((tagName) => tagName !== 'resolved');

const getThreadUnreadFromReadUpToTs = (
  thread: ReturnType<Room['getThread']>,
  currentUserId: string | undefined,
  readUpToTs: number | null | undefined
): boolean | undefined => {
  if (readUpToTs === undefined || !thread || !currentUserId) return undefined;

  const replyEvents = getPreferredVisibleThreadReplyEvents(thread);
  const latestReply = replyEvents[replyEvents.length - 1];
  if (!latestReply) return false;
  if (latestReply.getSender() === currentUserId) return false;
  if (readUpToTs === null) return true;
  return latestReply.getTs() > readUpToTs;
};

const buildDefaultThreadCacheCoverage = (
  thread: ReturnType<Room['getThread']>,
  expectedReplyCount: number | undefined
): ThreadCacheCoverage => {
  const loadedThreadEvents = getLoadedThreadEvents(thread) ?? [];
  const timestamps = loadedThreadEvents
    .map((event) => event.getTs())
    .filter((ts): ts is number => typeof ts === 'number');
  const oldestTs = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
  const newestTs = timestamps.length > 0 ? Math.max(...timestamps) : undefined;
  const zeroReplyComplete = expectedReplyCount === 0;

  return {
    eventCount: loadedThreadEvents.length,
    oldestTs,
    newestTs,
    backwardToken: zeroReplyComplete ? null : undefined,
    relationSnapshotComplete: zeroReplyComplete,
    tailLoaded: zeroReplyComplete,
    expectedReplyCount,
  };
};

export const buildThreadRecord = ({
  room,
  threadRootId,
  threadRootEvent,
  summaryInfo,
  fallbackSummaryInfo,
  fallbackReplyCount,
  rootPreviewText,
  fallbackLatestReplyPreviewText,
  fallbackLastSenderId,
  fallbackLastSenderDisplayName,
  fallbackMessageCount,
  fallbackLastActivityTs,
  fallbackParticipantIds,
  threadResolution,
  currentUserId,
  readUpToTs,
  scheduledTaskEvents = [],
  scheduledTaskCount,
  nextScheduledTs,
  cacheCoverage,
  absoluteIndex,
}: BuildThreadRecordOptions): ThreadRecord => {
  const thread = room.getThread(threadRootId);
  const resolvedThreadRootEvent =
    threadRootEvent ?? thread?.rootEvent ?? room.findEventById(threadRootId);
  const zeroReplyThreadRoot = resolvedThreadRootEvent
    ? shouldRenderZeroReplyThreadBadge(room, resolvedThreadRootEvent)
    : false;
  const resolvedFallbackReplyCount = fallbackReplyCount ?? fallbackMessageCount;
  const recordReplyCount =
    (resolvedThreadRootEvent
      ? getThreadReplyCount(
          room,
          resolvedThreadRootEvent,
          resolvedFallbackReplyCount,
          zeroReplyThreadRoot
        )
      : undefined) ??
    fallbackReplyCount ??
    fallbackMessageCount;
  const isKnownThreadRoot =
    (typeof recordReplyCount === 'number' && (recordReplyCount > 0 || zeroReplyThreadRoot)) ||
    typeof fallbackReplyCount === 'number' ||
    typeof fallbackMessageCount === 'number';
  const preferredSummaryInfo = pickLatestThreadSummaryInfo(summaryInfo, fallbackSummaryInfo);
  const replyParticipantIds = getThreadReplyParticipantIds(
    room,
    resolvedThreadRootEvent,
    fallbackParticipantIds
  );
  const participantIds = getVisibleThreadParticipantIds(
    thread,
    resolvedThreadRootEvent,
    THREAD_PARTICIPANT_LIMIT
  );
  const presentation = resolveThreadPresentationSnapshot({
    room,
    threadRootId,
    thread,
    rootEvent: resolvedThreadRootEvent,
    preferredSummaryInfo,
    preferredRootPreviewText: rootPreviewText,
    fallbackLatestReplyPreviewText,
    fallbackLastSenderId,
    fallbackLastSenderDisplayName,
    fallbackMessageCount: fallbackMessageCount ?? recordReplyCount,
    fallbackParticipantIds,
  });
  const resolvedScheduledTaskCount = scheduledTaskCount ?? 0;
  const resolvedNextScheduledTs =
    resolvedScheduledTaskCount > 0
      ? nextScheduledTs ?? getNextThreadScheduledTs(scheduledTaskEvents, threadRootId)
      : undefined;
  const liveLastActivityTs = getThreadLastActivityTs(room, threadRootId) ?? 0;
  const lastActivityTs =
    Math.max(
      liveLastActivityTs,
      fallbackLastActivityTs ?? 0,
      getEffectiveThreadRootActivityTs(resolvedThreadRootEvent)
    ) || undefined;
  const isUnread =
    getThreadUnreadFromReadUpToTs(thread, currentUserId, readUpToTs) ??
    (thread && currentUserId ? getThreadUnread(room, thread, currentUserId) : false);
  const isResolved = threadResolution?.isResolved ?? false;
  const isStreaming = getThreadStreamingState(room, threadRootId);

  return {
    roomId: room.roomId,
    threadRootId,
    rootEventId: resolvedThreadRootEvent?.getId(),
    presentation: {
      ...presentation,
      primarySummaryText: getThreadPrimarySummaryText(presentation),
      recentThreadSummaryText:
        presentation.summaryText ??
        rootPreviewText ??
        resolveRecentThreadSummaryText({
          room,
          threadRootId,
          rootEvent: resolvedThreadRootEvent,
          summaryInfo: presentation.summaryInfo,
        }),
      participantIds:
        participantIds.length > 0
          ? participantIds
          : fallbackParticipantIds?.slice(0, THREAD_PARTICIPANT_LIMIT) ?? [],
      replyParticipantIds,
    },
    status: {
      isKnownThreadRoot,
      replyCount: recordReplyCount ?? 0,
      isResolved,
      isUnread,
      isStreaming,
      scheduledTaskCount: resolvedScheduledTaskCount,
      nextScheduledTs: resolvedNextScheduledTs,
      lastActivityTs,
      tags: getThreadStatusTags(threadResolution),
    },
    cache: cacheCoverage ?? buildDefaultThreadCacheCoverage(thread, recordReplyCount),
    absoluteIndex: absoluteIndex ?? 0,
  };
};

export const buildThreadRecordMap = ({
  room,
  threadRootIds,
  threadRootEventMap,
  summaryMap,
  fallbackSummaryMap,
  fallbackReplyCountMap,
  rootPreviewTextMap,
  fallbackLatestReplyPreviewMap,
  fallbackLastSenderIdMap,
  fallbackLastSenderDisplayNameMap,
  fallbackMessageCountMap,
  fallbackLastActivityTsMap,
  fallbackParticipantMap,
  threadResolutionMap,
  currentUserId,
  readUpToTs,
  scheduledTaskEvents,
  scheduledTaskCounts,
  cacheCoverageMap,
  absoluteIndexMap,
}: BuildThreadRecordMapOptions): Map<string, ThreadRecord> => {
  const records = new Map<string, ThreadRecord>();

  threadRootIds.forEach((threadRootId) => {
    records.set(
      threadRootId,
      buildThreadRecord({
        room,
        threadRootId,
        threadRootEvent: threadRootEventMap?.get(threadRootId),
        summaryInfo: summaryMap?.get(threadRootId),
        fallbackSummaryInfo: fallbackSummaryMap?.get(threadRootId),
        fallbackReplyCount: fallbackReplyCountMap?.get(threadRootId),
        rootPreviewText: rootPreviewTextMap?.get(threadRootId),
        fallbackLatestReplyPreviewText: fallbackLatestReplyPreviewMap?.get(threadRootId),
        fallbackLastSenderId: fallbackLastSenderIdMap?.get(threadRootId),
        fallbackLastSenderDisplayName: fallbackLastSenderDisplayNameMap?.get(threadRootId),
        fallbackMessageCount: fallbackMessageCountMap?.get(threadRootId),
        fallbackLastActivityTs: fallbackLastActivityTsMap?.get(threadRootId),
        fallbackParticipantIds: fallbackParticipantMap?.get(threadRootId),
        threadResolution: threadResolutionMap?.get(threadRootId),
        currentUserId,
        readUpToTs,
        scheduledTaskEvents,
        scheduledTaskCount: scheduledTaskCounts?.get(threadRootId),
        cacheCoverage: cacheCoverageMap?.get(threadRootId),
        absoluteIndex: absoluteIndexMap?.get(threadRootId),
      })
    );
  });

  return records;
};
