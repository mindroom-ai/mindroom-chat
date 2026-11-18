import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
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
import {
  isFailedLocalEchoEvent,
  isPendingLocalEchoEvent,
} from '../../matrix/protocol/pendingLocalEcho';
import type { ThreadCacheCoverage, ThreadRecord } from './types';
import { collectThreadPeopleIds, currentUserTookPart } from './threadPeopleFilter';
import { RESOLVED_TAG, SNOOZED_TAG, type TagMetadata } from './threadTags';
import { parseThreadSnooze } from './threadSnooze';
import { isSeenThreadRoot } from '../../matrix/seenThreadRoots';
import { stableSerialize } from '../../matrix/eventRevision';
import { receiptEventsVersion } from '../../matrix/receiptReadTs';

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
  fallbackMessageCountMap?: ReadonlyMap<string, number>;
  fallbackLastActivityTsMap?: ReadonlyMap<string, number>;
  fallbackParticipantMap?: ReadonlyMap<string, string[]>;
  threadResolutionMap?: ReadonlyMap<string, ThreadResolutionLike>;
  currentUserId?: string;
  scheduledStatusMap?: ReadonlyMap<string, ThreadScheduledStatus>;
  cacheCoverageMap?: ReadonlyMap<string, ThreadCacheCoverage>;
  absoluteIndexMap?: ReadonlyMap<string, number>;
  /** The records of the last build and what changed in the room since: see `ThreadRecordReuse`. */
  reuse?: ThreadRecordReuse;
};

/**
 * What changed in a room's threads, for whoever keeps thread records or unread marks
 * (`buildThreadUnreadMap`): a record reads its thread's events, receipts and streaming state from
 * the SDK, which change in place. The listener of the room's events marks each change
 * (`markThreadRecordChange`) as one thread's or as the room's.
 */
export type ThreadRecordChanges = {
  /** Counts the marks. */
  count: number;
  /** The count at the last change that any thread's record may show. */
  room: number;
  /** The count at the last change of each thread, by root, since the room's last. */
  threads: Map<string, number>;
  /**
   * Whether the listener hears the room now. Without it nothing is marked, so no unread mark may
   * be kept.
   */
  listened: boolean;
  /**
   * Counts the threads the listener heard created, updated, deleted or replied to: the room has
   * other threads, or the same in another order, than a list read before (`useRoomThreadList`).
   */
  threadList: number;
};

export const createThreadRecordChanges = (): ThreadRecordChanges => ({
  count: 0,
  room: 0,
  threads: new Map(),
  listened: false,
  threadList: 0,
});

/** Marks a change of one thread, or without `threadRootId` one that any thread's record may show. */
export const markThreadRecordChange = (
  changes: ThreadRecordChanges,
  threadRootId?: string
): void => {
  changes.count += 1;
  if (threadRootId) {
    changes.threads.set(threadRootId, changes.count);
    return;
  }
  changes.room = changes.count;
  changes.threads.clear();
};

/** Whether nothing was marked for the thread or for the room after the count `builtAt`. */
const unchangedSince = (
  changes: ThreadRecordChanges,
  threadRootId: string,
  builtAt: number
): boolean =>
  // A mark of the room drops the threads' marks, so a thread's mark is the newer one.
  builtAt >= (changes.threads.get(threadRootId) ?? changes.room);

/**
 * Lets a build keep the records of the build before it (`previous`) for the threads that did not
 * change: no mark in `changes` for the thread or the room since its record was built, the same
 * values given for it, the same answers of the room that every record reads (`roomSources`), its
 * root opened on this device or not as before (`rootSeen`), and the same summary of the thread on
 * its root (`rootSummary`).
 */
export type ThreadRecordReuse = {
  previous: ReadonlyMap<string, ThreadRecord> | undefined;
  changes: ThreadRecordChanges;
};

type ThreadRecordSources = {
  options: BuildThreadRecordOptions;
  builtAt: number;
  roomSources: readonly unknown[];
  /**
   * Whether the reader opened the root's thread on this device (`isSeenThreadRoot`), which no
   * event tells of. A record reads it of its own root only (`isMainTimelineMessageUnread`).
   */
  rootSeen: boolean;
  /**
   * The summary of the thread its root carries (`unsigned['m.relations']['m.thread']`): the count
   * of replies, the newest one, and whether the reader took part. A copy of the root that is read
   * from the cache or fetched writes what it knows into the room's root, and no event tells of it.
   */
  rootSummary: unknown;
};

/** What each kept record was built from. */
const recordSources = new WeakMap<ThreadRecord, ThreadRecordSources>();

/**
 * What every record of a room reads that changes without an event of its thread: whether the
 * room's thread list is in (it decides whose reply count is used), and the receipt events a room
 * came to hold or lost (a receipt reads up to its event's time, or to when the server took it).
 */
const getRoomSources = (room: Room): readonly unknown[] => [
  roomThreadListIsListed(room),
  receiptEventsVersion(room),
];

/**
 * Whether the record's root still carries the summary the record was built from. A write puts
 * another object there, also one that says the same: only then the two are read through, once,
 * and the record goes by the new object from there on.
 */
const sameRootSummary = (keptFrom: ThreadRecordSources, rootSummary: unknown): boolean => {
  if (keptFrom.rootSummary === rootSummary) return true;
  if (stableSerialize(keptFrom.rootSummary) !== stableSerialize(rootSummary)) return false;
  keptFrom.rootSummary = rootSummary;
  return true;
};

/** The same value, or two lists or objects that hold the same values. */
const sameOption = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (!isRecordOrList(left) || !isRecordOrList(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.is(left[key], right[key]))
  );
};

const isRecordOrList = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The same values but for the place in the list, which a build only copies into its record. */
const sameOptions = (left: BuildThreadRecordOptions, right: BuildThreadRecordOptions): boolean =>
  (Object.keys(left) as Array<keyof BuildThreadRecordOptions>).every(
    (key) => key === 'absoluteIndex' || sameOption(left[key], right[key])
  );

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

/** The root a record reads: the one given for it, else the thread's, else the room's. */
const resolveThreadRootEvent = (
  room: Room,
  threadRootId: string,
  threadRootEvent: MatrixEvent | undefined
): MatrixEvent | undefined =>
  threadRootEvent ?? room.getThread(threadRootId)?.rootEvent ?? room.findEventById(threadRootId);

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
  const resolvedThreadRootEvent = resolveThreadRootEvent(room, threadRootId, threadRootEvent);
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
  fallbackMessageCountMap,
  fallbackLastActivityTsMap,
  fallbackParticipantMap,
  threadResolutionMap,
  currentUserId,
  scheduledStatusMap,
  cacheCoverageMap,
  absoluteIndexMap,
  reuse,
}: BuildThreadRecordMapOptions): Map<string, ThreadRecord> => {
  const records = new Map<string, ThreadRecord>();
  const roomSources = getRoomSources(room);
  const builtAt = reuse?.changes.count ?? 0;

  threadRootIds.forEach((threadRootId) => {
    const options: BuildThreadRecordOptions = {
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
      fallbackMessageCount: fallbackMessageCountMap?.get(threadRootId),
      fallbackLastActivityTs: fallbackLastActivityTsMap?.get(threadRootId),
      fallbackParticipantIds: fallbackParticipantMap?.get(threadRootId),
      threadResolution: threadResolutionMap?.get(threadRootId),
      currentUserId,
      scheduledStatus: scheduledStatusMap?.get(threadRootId),
      cacheCoverage: cacheCoverageMap?.get(threadRootId),
      absoluteIndex: absoluteIndexMap?.get(threadRootId),
    };
    const rootSeen =
      !!reuse && !!currentUserId && isSeenThreadRoot(currentUserId, room.roomId, threadRootId);
    const rootSummary =
      reuse &&
      resolveThreadRootEvent(room, threadRootId, options.threadRootEvent)?.getUnsigned()?.[
        'm.relations'
      ]?.['m.thread'];
    const kept = reuse?.previous?.get(threadRootId);
    const keptFrom = kept && recordSources.get(kept);
    if (
      reuse &&
      kept &&
      keptFrom &&
      unchangedSince(reuse.changes, threadRootId, keptFrom.builtAt) &&
      sameOption(keptFrom.roomSources, roomSources) &&
      keptFrom.rootSeen === rootSeen &&
      sameRootSummary(keptFrom, rootSummary) &&
      sameOptions(keptFrom.options, options)
    ) {
      // The room's threads trade places with every reply; a thread that only moved keeps its
      // record, with its new place.
      const index = options.absoluteIndex ?? 0;
      let record = kept;
      if (kept.absoluteIndex !== index) {
        record = { ...kept, absoluteIndex: index };
        recordSources.set(record, keptFrom);
      }
      records.set(threadRootId, record);
      return;
    }
    const record = buildThreadRecord(options);
    if (reuse) {
      recordSources.set(record, { options, builtAt, roomSources, rootSeen, rootSummary });
    }
    records.set(threadRootId, record);
  });

  return records;
};

/** What a map of unread marks was built from. */
type ThreadUnreadSources = {
  builtAt: number;
  userId: string;
  roomSources: readonly unknown[];
  threads: ReadonlyMap<string, Thread>;
};

const unreadSources = new WeakMap<ReadonlyMap<string, boolean>, ThreadUnreadSources>();

/**
 * Whether each of `threads` is unread for `userId` (`getThreadUnread`), by root. With `reuse`, the
 * marks of `previous` are kept as `buildThreadRecordMap` keeps records: for the same thread, with
 * no mark in `changes` for it or the room since, for the same reader and the same answers of the
 * room. Only while the listener hears the room (`listened`). A thread's mark reads its replies and
 * receipts, not its root, so not the roots opened on this device. A build that changes no mark
 * gives `previous` itself.
 */
export const buildThreadUnreadMap = (
  room: Room,
  threads: readonly Thread[],
  userId: string,
  reuse?: { previous: ReadonlyMap<string, boolean> | undefined; changes: ThreadRecordChanges }
): ReadonlyMap<string, boolean> => {
  const roomSources = getRoomSources(room);
  const previous = reuse?.changes.listened ? reuse.previous : undefined;
  const from = previous && unreadSources.get(previous);
  const keptFrom =
    from && from.userId === userId && sameOption(from.roomSources, roomSources) ? from : undefined;
  const unreads = new Map<string, boolean>();
  const checked = new Map<string, Thread>();
  let changed = false;
  threads.forEach((thread) => {
    checked.set(thread.id, thread);
    const kept = previous?.get(thread.id);
    if (
      reuse &&
      keptFrom &&
      kept !== undefined &&
      keptFrom.threads.get(thread.id) === thread &&
      unchangedSince(reuse.changes, thread.id, keptFrom.builtAt)
    ) {
      unreads.set(thread.id, kept);
      return;
    }
    const unread = getThreadUnread(thread, userId);
    if (unread !== kept) changed = true;
    unreads.set(thread.id, unread);
  });
  const built = !previous || changed || previous.size !== unreads.size ? unreads : previous;
  if (reuse) {
    unreadSources.set(built, {
      builtAt: reuse.changes.count,
      userId,
      roomSources,
      threads: checked,
    });
  }
  return built;
};
