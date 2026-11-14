import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import {
  pickLatestThreadSummaryInfo,
  type ThreadSummaryInfo,
} from '../../matrix/protocol/threadSummary';
import { getThreadStreamingState } from './useThreadStreamingState';
import { getThreadLastActivityTs } from './useThreadLastActivityTs';
import { resolveRecentThreadSummaryText } from './recentThreadSummaryUtils';
import { isZeroReplyStandaloneThreadRootEvent } from './compactThreadRootData';
import { getThreadUnread, roomThreadListIsListed } from './roomThreadList';
import { isMainTimelineMessageUnread } from '../../matrix/mainTimelineRead';
import { getEffectiveThreadRootActivityTs } from './threadRouteUtils';
import {
  getThreadPrimarySummaryText,
  resolveThreadPresentationSnapshot,
} from './threadPresentation';
import {
  buildVisibleThreadParticipantMap,
  buildVisibleThreadReplyCountMap,
  getPreferredVisibleThreadReplyEvents,
  getVisibleThreadMessageCount,
  getVisibleThreadParticipantIds,
} from './threadUtils';
import { EMPTY_THREAD_SCHEDULED_STATUS, type ThreadScheduledStatus } from './threadScheduledStatus';
import { isFailedLocalEchoEvent, isPendingLocalEchoEvent } from '../../matrix/protocol/pendingLocalEcho';
import type { ThreadCacheCoverage, ThreadRecord } from './types';
import { collectThreadPeopleIds, currentUserTookPart } from './threadPeopleFilter';
import { RESOLVED_TAG, SNOOZED_TAG, type TagMetadata } from './threadTags';
import { parseThreadSnooze } from './threadSnooze';

const THREAD_PARTICIPANT_LIMIT = 3;

type ThreadResolutionLike = {
  isResolved?: boolean;
  tags?: Record<string, unknown> | null;
};

type BuildThreadRecordOptions = {
  room: Room;
  threadRootId: string;
  threadRootEvent?: MatrixEvent;
  summaryInfo?: ThreadSummaryInfo;
  fallbackSummaryInfo?: ThreadSummaryInfo;
  fallbackReplyCount?: number;
  rootPreviewText?: string;
  fallbackLatestReplyPreviewText?: string;
  fallbackLatestReplyTs?: number;
  fallbackLastSenderId?: string;
  fallbackLastSenderDisplayName?: string;
  fallbackMessageCount?: number;
  fallbackLastActivityTs?: number;
  fallbackParticipantIds?: string[];
  threadResolution?: ThreadResolutionLike;
  currentUserId?: string;
  scheduledStatus?: ThreadScheduledStatus;
  cacheCoverage?: ThreadCacheCoverage;
  absoluteIndex?: number;
};

type BuildThreadRecordMapOptions = {
  room: Room;
  threadRootIds: string[];
  threadRootEventMap?: ReadonlyMap<string, MatrixEvent>;
  summaryMap?: ReadonlyMap<string, ThreadSummaryInfo>;
  fallbackSummaryMap?: ReadonlyMap<string, ThreadSummaryInfo>;
  fallbackReplyCountMap?: ReadonlyMap<string, number>;
  rootPreviewTextMap?: ReadonlyMap<string, string>;
  fallbackLatestReplyPreviewMap?: ReadonlyMap<string, string>;
  fallbackLatestReplyTsMap?: ReadonlyMap<string, number>;
  fallbackLastSenderIdMap?: ReadonlyMap<string, string>;
  fallbackLastSenderDisplayNameMap?: ReadonlyMap<string, string>;
  fallbackMessageCountMap?: ReadonlyMap<string, number>;
  fallbackLastActivityTsMap?: ReadonlyMap<string, number>;
  fallbackParticipantMap?: ReadonlyMap<string, string[]>;
  threadResolutionMap?: ReadonlyMap<string, ThreadResolutionLike>;
  currentUserId?: string;
  scheduledStatusMap?: ReadonlyMap<string, ThreadScheduledStatus>;
  cacheCoverageMap?: ReadonlyMap<string, ThreadCacheCoverage>;
  absoluteIndexMap?: ReadonlyMap<string, number>;
};

const getLoadedThreadEvents = (thread: ReturnType<Room['getThread']>): MatrixEvent[] | undefined =>
  thread?.events && thread.events.length > 0
    ? thread.events
    : thread?.timeline && thread.timeline.length > 0
    ? thread.timeline
    : undefined;

const isPendingThreadEvent = (event: MatrixEvent | undefined): boolean =>
  isPendingLocalEchoEvent(event) || isPendingLocalEchoEvent(event?.replacingEvent?.());

const isFailedThreadEvent = (event: MatrixEvent | undefined): boolean =>
  isFailedLocalEchoEvent(event) || isFailedLocalEchoEvent(event?.replacingEvent?.());

const getThreadPendingSend = (
  threadRootEvent: MatrixEvent | undefined,
  replyEvents: MatrixEvent[]
): boolean => {
  if (isPendingThreadEvent(threadRootEvent)) return true;

  return replyEvents.some((event) => isPendingThreadEvent(event));
};

const getThreadFailedSend = (
  threadRootEvent: MatrixEvent | undefined,
  replyEvents: MatrixEvent[]
): boolean => {
  if (isFailedThreadEvent(threadRootEvent)) return true;

  return replyEvents.some((event) => isFailedThreadEvent(event));
};

export const getThreadReplyCount = (
  room: Room,
  mEvent: MatrixEvent,
  fallbackReplyCount?: number,
  allowZeroReplyCount = false
): number | undefined => {
  const eventId = mEvent.getId();
  if (!eventId) return undefined;

  const replyCount = getVisibleThreadMessageCount(
    room.getThread(eventId),
    Math.max(getKnownThreadReplyCount(mEvent) ?? 0, fallbackReplyCount ?? 0)
  );
  return replyCount > 0 || allowZeroReplyCount ? replyCount : undefined;
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
  Object.keys(threadResolution?.tags ?? {}).filter(
    (tagName) => tagName !== RESOLVED_TAG && tagName !== SNOOZED_TAG
  );

const getThreadResolverUserId = (
  threadResolution: ThreadResolutionLike | undefined
): string | undefined => {
  const resolvedTag = threadResolution?.tags?.[RESOLVED_TAG];
  if (typeof resolvedTag !== 'object' || resolvedTag === null) return undefined;

  const userId = (resolvedTag as { set_by?: unknown }).set_by;
  return typeof userId === 'string' && userId.trim().length > 0 ? userId.trim() : undefined;
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
    hasMoreBackward: zeroReplyComplete ? false : undefined,
    snapshotComplete: zeroReplyComplete ? true : undefined,
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
  fallbackLatestReplyTs,
  fallbackLastSenderId,
  fallbackLastSenderDisplayName,
  fallbackMessageCount,
  fallbackLastActivityTs,
  fallbackParticipantIds,
  threadResolution,
  currentUserId,
  scheduledStatus = EMPTY_THREAD_SCHEDULED_STATUS,
  cacheCoverage,
  absoluteIndex,
}: BuildThreadRecordOptions): ThreadRecord => {
  const thread = room.getThread(threadRootId);
  // Share this snapshot only within this synchronous build; SDK events can
  // change in place between updates through edits, decryption and redaction.
  const visibleReplyEvents = getPreferredVisibleThreadReplyEvents(thread);
  const resolvedThreadRootEvent =
    threadRootEvent ?? thread?.rootEvent ?? room.findEventById(threadRootId);
  const zeroReplyThreadRoot = resolvedThreadRootEvent
    ? shouldRenderZeroReplyThreadBadge(room, resolvedThreadRootEvent)
    : false;
  // Once the room's whole thread list is in, the SDK thread holds the server's count and every
  // change since. The cache and older copies of the root may still count a reply redacted since.
  const serverCounted = !!thread && roomThreadListIsListed(room);
  const resolvedFallbackReplyCount =
    serverCounted || (fallbackReplyCount === undefined && fallbackMessageCount === undefined)
      ? undefined
      : Math.max(fallbackReplyCount ?? 0, fallbackMessageCount ?? 0);
  let recordReplyCount: number | undefined;
  if (serverCounted) {
    const serverReplyCount = getVisibleThreadMessageCount(thread, undefined, visibleReplyEvents);
    recordReplyCount = serverReplyCount > 0 || zeroReplyThreadRoot ? serverReplyCount : undefined;
  } else {
    recordReplyCount =
      (resolvedThreadRootEvent
        ? getThreadReplyCount(
            room,
            resolvedThreadRootEvent,
            resolvedFallbackReplyCount,
            zeroReplyThreadRoot
          )
        : undefined) ?? resolvedFallbackReplyCount;
  }
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
  const presentation = resolveThreadPresentationSnapshot({
    room,
    threadRootId,
    thread,
    rootEvent: resolvedThreadRootEvent,
    preferredSummaryInfo,
    preferredRootPreviewText: rootPreviewText,
    fallbackLatestReplyPreviewText,
    fallbackLatestReplyTs,
    fallbackLastActivityTs,
    fallbackLastSenderId,
    fallbackLastSenderDisplayName,
    fallbackMessageCount: serverCounted
      ? recordReplyCount
      : Math.max(fallbackMessageCount ?? 0, recordReplyCount ?? 0),
    fallbackParticipantIds,
    visibleReplyEvents,
  });
  // The newest reply's sender (the server's bundled reply counts), the loaded repliers, the
  // other known writers, then the root's sender.
  const participantIds = collectThreadPeopleIds(undefined, [
    presentation.lastSenderId,
    ...getVisibleThreadParticipantIds(
      thread,
      undefined,
      THREAD_PARTICIPANT_LIMIT,
      visibleReplyEvents
    ),
    ...(fallbackParticipantIds ?? []),
    resolvedThreadRootEvent?.getSender(),
  ]).slice(0, THREAD_PARTICIPANT_LIMIT);
  const resolvedScheduledTaskCount = scheduledStatus.scheduledTaskCount;
  const resolvedNextScheduledTs =
    resolvedScheduledTaskCount > 0 ? scheduledStatus.nextScheduledTs : undefined;
  const resolvedCronDescription =
    resolvedScheduledTaskCount > 0 ? scheduledStatus.cronDescription : undefined;
  const liveLastActivityTs = getThreadLastActivityTs(room, threadRootId) ?? 0;
  const lastActivityTs =
    Math.max(
      liveLastActivityTs,
      fallbackLastActivityTs ?? 0,
      getEffectiveThreadRootActivityTs(resolvedThreadRootEvent)
    ) || undefined;
  // An unread root counts toward the room's unread badge, so its thread is unread too.
  const isUnread =
    !!currentUserId &&
    ((!!thread && getThreadUnread(thread, currentUserId)) ||
      (!!resolvedThreadRootEvent &&
        isMainTimelineMessageUnread(room, resolvedThreadRootEvent, currentUserId)));
  const isResolved = threadResolution?.isResolved ?? false;
  const snooze = parseThreadSnooze(
    threadResolution?.tags?.[SNOOZED_TAG] as TagMetadata | undefined
  );
  const isStreaming = getThreadStreamingState(room, threadRootId);
  const hasPendingSend = getThreadPendingSend(resolvedThreadRootEvent, visibleReplyEvents);
  const hasFailedSend = getThreadFailedSend(resolvedThreadRootEvent, visibleReplyEvents);

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
      participantIds,
      replyParticipantIds,
      peopleIds: collectThreadPeopleIds(resolvedThreadRootEvent?.getSender(), [
        ...visibleReplyEvents.map((event) => event.getSender()),
        ...(fallbackParticipantIds ?? []),
        presentation.lastSenderId,
        currentUserId && currentUserTookPart(resolvedThreadRootEvent) ? currentUserId : undefined,
      ]),
    },
    status: {
      isKnownThreadRoot,
      replyCount: recordReplyCount ?? 0,
      isResolved,
      resolvedByUserId: isResolved ? getThreadResolverUserId(threadResolution) : undefined,
      isUnread,
      isStreaming,
      hasPendingSend,
      hasFailedSend,
      scheduledTaskCount: resolvedScheduledTaskCount,
      nextScheduledTs: resolvedNextScheduledTs,
      cronDescription: resolvedCronDescription,
      lastActivityTs,
      tags: getThreadStatusTags(threadResolution),
      snoozedUntilTs: snooze?.untilTs,
      snoozedAtTs: snooze?.setAtTs,
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
  fallbackLatestReplyTsMap,
  fallbackLastSenderIdMap,
  fallbackLastSenderDisplayNameMap,
  fallbackMessageCountMap,
  fallbackLastActivityTsMap,
  fallbackParticipantMap,
  threadResolutionMap,
  currentUserId,
  scheduledStatusMap,
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
        fallbackLatestReplyTs: fallbackLatestReplyTsMap?.get(threadRootId),
        fallbackLastSenderId: fallbackLastSenderIdMap?.get(threadRootId),
        fallbackLastSenderDisplayName: fallbackLastSenderDisplayNameMap?.get(threadRootId),
        fallbackMessageCount: fallbackMessageCountMap?.get(threadRootId),
        fallbackLastActivityTs: fallbackLastActivityTsMap?.get(threadRootId),
        fallbackParticipantIds: fallbackParticipantMap?.get(threadRootId),
        threadResolution: threadResolutionMap?.get(threadRootId),
        currentUserId,
        scheduledStatus: scheduledStatusMap?.get(threadRootId),
        cacheCoverage: cacheCoverageMap?.get(threadRootId),
        absoluteIndex: absoluteIndexMap?.get(threadRootId),
      })
    );
  });

  return records;
};
