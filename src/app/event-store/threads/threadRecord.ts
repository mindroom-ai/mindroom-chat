import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import {
  pickLatestThreadSummaryInfo,
  type ThreadSummaryInfo,
} from '../../matrix/protocol/threadSummary';
import { getThreadStreamingState } from './useThreadStreamingState';
import { withRoomActiveRunsSnapshot } from '../../matrix/protocol/activeRunsContract';
import type { getBundledThreadPreviews } from './threadBundledPreviews';
import { getThreadLastActivityTs } from './useThreadLastActivityTs';
import { resolveRecentThreadSummaryText } from './recentThreadSummaryUtils';
import { isZeroReplyStandaloneThreadRootEvent } from './compactThreadRootData';
import { getThreadUnread, roomThreadListIsListed } from './roomThreadList';
import { getMainTimelineReadTs, isMainTimelineMessageUnread } from '../../matrix/mainTimelineRead';
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
import {
  getPendingThreadEvents,
  getPendingThreadEventsByThread,
} from '../cache/pendingThreadEvents';
import type { ThreadCacheCoverage, ThreadRecord } from './types';
import { collectThreadPeopleIds, currentUserTookPart } from './threadPeopleFilter';
import { RESOLVED_TAG, SNOOZED_TAG, type TagMetadata } from './threadTags';
import { parseThreadSnooze } from './threadSnooze';
import { seenThreadRootsVersion } from '../../matrix/seenThreadRoots';
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
  /** Reuse the bundle if the caller already read it. */
  bundledPreviews?: ReturnType<typeof getBundledThreadPreviews>;
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
  /** Reuse the thread's streaming state if the caller already read `roomActiveRuns(room)`. */
  isStreaming?: boolean;
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
};

export const createThreadRecordChanges = (): ThreadRecordChanges => ({
  count: 0,
  room: 0,
  threads: new Map(),
  listened: false,
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
 * values given for it, and the same answers of the room that every record reads (`roomSources`).
 *
 * `beside` is a map built just before this one, in the same pass, under the same `changes` and
 * with no `previous` of its own, so that all its records are new (the normal map, for the Compact
 * one). A record this build would build is taken from it instead when it stands by the same
 * rule: the two maps then build the record of a thread they list with the same values once.
 * Nothing of `beside` is kept beyond the records taken.
 */
export type ThreadRecordReuse = {
  previous: ReadonlyMap<string, ThreadRecord> | undefined;
  changes: ThreadRecordChanges;
  beside?: ReadonlyMap<string, ThreadRecord>;
  /**
   * Identifies a single synchronous build pass shared between a map and its `beside` sibling so
   * `beside` only reuses records freshly built in this pass (never older records kept from `previous`).
   */
  pass?: symbol;
};

type RoomSources = readonly [listed: boolean, seenVersion: number, receiptVersion: number];

type ThreadRecordSources = {
  options: BuildThreadRecordOptions;
  builtAt: number;
  roomSources: RoomSources;
  pass?: symbol;
};

/** Per-pass room snapshots computed lazily at most once per `buildThreadRecordMap` call. */
type BuildThreadRecordContext = {
  room: Room;
  currentUserId: string | undefined;
  serverListed: boolean;
  mainTimelineReadTs?: number;
  hasMainTimelineReadTs?: boolean;
  pendingByThread?: ReadonlyMap<string, MatrixEvent[]> | null;
  memberDisplayNames: Map<string, string | undefined>;
};

const EMPTY_PENDING_EVENTS: MatrixEvent[] = [];
let activeBuildContext: BuildThreadRecordContext | undefined;

/** What each kept record was built from. */
const recordSources = new WeakMap<ThreadRecord, ThreadRecordSources>();

/**
 * What every record of a room reads that changes without an event of its thread: whether the
 * room's thread list is in (it decides whose reply count is used), the roots opened on this
 * device, and the receipt events a room came to hold or lost (a receipt reads up to its event's
 * time, or to when the server took it).
 */
const getRoomSources = (room: Room): RoomSources => [
  roomThreadListIsListed(room),
  seenThreadRootsVersion(),
  receiptEventsVersion(room),
];

const sameRoomSources = (left: RoomSources, right: RoomSources): boolean =>
  left[0] === right[0] && left[1] === right[1] && left[2] === right[2];

/** The same value, or two lists or objects that hold the same values. */
const sameOption = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, i) => Object.is(value, right[i]));
  }
  if (
    !isRecordOrList(left) ||
    !isRecordOrList(right) ||
    Array.isArray(left) ||
    Array.isArray(right)
  ) {
    return false;
  }
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
  left.room === right.room &&
  left.threadRootId === right.threadRootId &&
  left.threadRootEvent === right.threadRootEvent &&
  left.currentUserId === right.currentUserId &&
  left.rootPreviewText === right.rootPreviewText &&
  left.fallbackLatestReplyPreviewText === right.fallbackLatestReplyPreviewText &&
  left.fallbackLastSenderId === right.fallbackLastSenderId &&
  Object.is(left.fallbackReplyCount, right.fallbackReplyCount) &&
  Object.is(left.fallbackLatestReplyTs, right.fallbackLatestReplyTs) &&
  Object.is(left.fallbackMessageCount, right.fallbackMessageCount) &&
  Object.is(left.fallbackLastActivityTs, right.fallbackLastActivityTs) &&
  left.isStreaming === right.isStreaming &&
  left.bundledPreviews === right.bundledPreviews &&
  sameOption(left.summaryInfo, right.summaryInfo) &&
  sameOption(left.fallbackSummaryInfo, right.fallbackSummaryInfo) &&
  sameOption(left.fallbackParticipantIds, right.fallbackParticipantIds) &&
  sameOption(left.threadResolution, right.threadResolution) &&
  sameOption(left.scheduledStatus, right.scheduledStatus) &&
  sameOption(left.cacheCoverage, right.cacheCoverage);

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
  replyEvents: MatrixEvent[],
  pendingReplyEvents: MatrixEvent[]
): boolean =>
  isPendingThreadEvent(threadRootEvent) ||
  replyEvents.some(isPendingThreadEvent) ||
  pendingReplyEvents.some(isPendingThreadEvent);

const getThreadFailedSend = (
  threadRootEvent: MatrixEvent | undefined,
  replyEvents: MatrixEvent[],
  pendingReplyEvents: MatrixEvent[]
): boolean =>
  isFailedThreadEvent(threadRootEvent) ||
  replyEvents.some(isFailedThreadEvent) ||
  pendingReplyEvents.some(isFailedThreadEvent);

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
    { count?: unknown; c?: unknown } | undefined;
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
  bundledPreviews,
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
  isStreaming: providedIsStreaming,
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
  const context =
    activeBuildContext?.room === room && activeBuildContext.currentUserId === currentUserId
      ? activeBuildContext
      : undefined;
  const serverCounted = !!thread && (context ? context.serverListed : roomThreadListIsListed(room));
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
    bundledPreviews,
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
    memberDisplayNameCache: context?.memberDisplayNames,
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
  let isUnread = false;
  if (currentUserId) {
    if (thread && getThreadUnread(thread, currentUserId)) {
      isUnread = true;
    } else if (resolvedThreadRootEvent) {
      let mainTimelineReadTs: number | undefined;
      if (context) {
        if (!context.hasMainTimelineReadTs) {
          context.mainTimelineReadTs = getMainTimelineReadTs(room, currentUserId);
          context.hasMainTimelineReadTs = true;
        }
        mainTimelineReadTs = context.mainTimelineReadTs;
      }
      isUnread = isMainTimelineMessageUnread(
        room,
        resolvedThreadRootEvent,
        currentUserId,
        mainTimelineReadTs
      );
    }
  }
  const isResolved = threadResolution?.isResolved ?? false;
  const snooze = parseThreadSnooze(
    threadResolution?.tags?.[SNOOZED_TAG] as TagMetadata | undefined
  );
  const isStreaming = providedIsStreaming ?? getThreadStreamingState(room, threadRootId);
  let pendingReplyEvents: MatrixEvent[];
  if (context) {
    if (context.pendingByThread === undefined) {
      context.pendingByThread = getPendingThreadEventsByThread(room) ?? null;
    }
    pendingReplyEvents = context.pendingByThread?.get(threadRootId) ?? EMPTY_PENDING_EVENTS;
  } else {
    pendingReplyEvents = getPendingThreadEvents(room, threadRootId);
  }
  const hasPendingSend = getThreadPendingSend(
    resolvedThreadRootEvent,
    visibleReplyEvents,
    pendingReplyEvents
  );
  const hasFailedSend = getThreadFailedSend(
    resolvedThreadRootEvent,
    visibleReplyEvents,
    pendingReplyEvents
  );

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
  const pass = reuse?.pass;
  const standing = (
    held: ThreadRecord | undefined,
    threadRootId: string,
    options: BuildThreadRecordOptions,
    fromBeside: boolean
  ): ThreadRecord | undefined => {
    const heldFrom = held && recordSources.get(held);
    if (
      !reuse ||
      !held ||
      !heldFrom ||
      (fromBeside && pass !== undefined && heldFrom.pass !== pass) ||
      !unchangedSince(reuse.changes, threadRootId, heldFrom.builtAt) ||
      !sameRoomSources(heldFrom.roomSources, roomSources) ||
      !sameOptions(heldFrom.options, options)
    ) {
      return undefined;
    }
    // The room's threads trade places with every reply; a thread that only moved keeps its
    // record, with its new place.
    const index = options.absoluteIndex ?? 0;
    if (held.absoluteIndex === index) return held;
    const moved = { ...held, absoluteIndex: index };
    recordSources.set(moved, heldFrom);
    return moved;
  };

  const prevContext = activeBuildContext;
  activeBuildContext = {
    room,
    currentUserId,
    serverListed: roomSources[0],
    memberDisplayNames: new Map(),
  };
  try {
    return withRoomActiveRunsSnapshot(room, () => {
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
        let record =
          standing(reuse?.previous?.get(threadRootId), threadRootId, options, false) ??
          standing(reuse?.beside?.get(threadRootId), threadRootId, options, true);
        if (!record) {
          record = buildThreadRecord(options);
          if (reuse) recordSources.set(record, { options, builtAt, roomSources, pass });
        }
        records.set(threadRootId, record);
      });
      return records;
    });
  } finally {
    activeBuildContext = prevContext;
  }
};

/** What a map of unread marks was built from. */
type ThreadUnreadSources = {
  builtAt: number;
  userId: string;
  roomSources: RoomSources;
  threads: ReadonlyMap<string, Thread>;
};

const unreadSources = new WeakMap<ReadonlyMap<string, boolean>, ThreadUnreadSources>();

/**
 * Whether each of `threads` is unread for `userId` (`getThreadUnread`), by root. With `reuse`, the
 * marks of `previous` are kept as `buildThreadRecordMap` keeps records: for the same thread, with
 * no mark in `changes` for it or the room since, for the same reader and the same answers of the
 * room. Only while the listener hears the room (`listened`). A build that changes no mark gives
 * `previous` itself.
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
    from && from.userId === userId && sameRoomSources(from.roomSources, roomSources)
      ? from
      : undefined;
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
