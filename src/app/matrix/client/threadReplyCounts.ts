import {
  MatrixEventEvent,
  RoomEvent,
  THREAD_RELATION_TYPE,
  ThreadEvent,
  type IRoomTimelineData,
  type IThreadBundledRelationship,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type Thread,
} from 'matrix-js-sdk';
import { watchRoomThreads } from '../watchRoomThreads';

// The MindRoom SDK patch leaves a thread unopened (summary only) until the app shows or opens it.
// Its reply count starts at the root's server summary (the `m.thread` count) and grows by one for
// every reply added after the SDK read that summary. A batch that brings the root together with
// replies its summary already counts (the first sync, the saved sync replayed after a reload, a
// limited sync, the event cache) counted those replies twice: 4, 6 and 8 for threads of 2, 3 and
// 4. This module keeps the count of an unopened thread at what its summary and the replies the
// client holds imply, also while the thread opens. An opened thread counts from the server's root
// and first page, and is left to the SDK.

type ThreadSummary = IThreadBundledRelationship;

/** The SDK thread's own reply counter; `Thread.length` adds the replies still being sent. */
type ThreadReplyCounter = { replyCount: number };

const readSummary = (event: MatrixEvent | null | undefined): ThreadSummary | undefined => {
  const summary = event?.getServerAggregatedRelation<ThreadSummary>(THREAD_RELATION_TYPE.name);
  return typeof summary?.count === 'number' && summary.latest_event ? summary : undefined;
};

const isReplyOf = (thread: Thread, event: MatrixEvent): boolean =>
  event.getId() !== thread.id && event.isRelation(THREAD_RELATION_TYPE.name);

/** How many replies the thread holds that came after the summary's latest reply. */
const countRepliesAfterSummary = (thread: Thread, summary: ThreadSummary): number => {
  const sent = thread.events.filter((event) => isReplyOf(thread, event) && event.status === null);
  const latestIndex = sent.findIndex((event) => event.getId() === summary.latest_event.event_id);
  if (latestIndex !== -1) return sent.length - latestIndex - 1;
  // The latest reply is not held (a sync gap moved it out of the live timeline): go by time.
  return sent.filter((event) => event.getTs() > summary.latest_event.origin_server_ts).length;
};

/**
 * Corrects the reply count of an unopened thread to its root's summary count plus the replies the
 * client holds that the summary does not cover yet. A count below that stays, since redactions
 * lower it; a count equal to the summary's means the SDK read the summary again (it does once
 * server discovery ends) and dropped the newer replies. Returns whether the count changed.
 */
const settleThreadReplyCount = (thread: Thread): boolean => {
  if (thread.initialEventsFetched) return false;
  const summary = readSummary(thread.rootEvent);
  if (!summary) return false;
  const counter = thread as unknown as ThreadReplyCounter;
  const implied = summary.count + countRepliesAfterSummary(thread, summary);
  const settled =
    counter.replyCount === summary.count ? implied : Math.min(counter.replyCount, implied);
  if (settled === counter.replyCount) return false;
  counter.replyCount = settled;
  thread.emit(ThreadEvent.Update, thread);
  return true;
};

/**
 * A summary is a snapshot: once a reply it counts is redacted, it counts one reply too many, and
 * the thread cards and badges, which show the larger of the thread's count and the summary's, kept
 * showing the old number.
 */
const removeRedactedReplyFromSummary = (root: MatrixEvent, reply: MatrixEvent): void => {
  const summary = readSummary(root);
  if (!summary) return;
  const latest = summary.latest_event;
  if (reply.getId() !== latest.event_id && reply.getTs() > latest.origin_server_ts) return;
  const unsigned = root.getUnsigned();
  root.setUnsigned({
    ...unsigned,
    'm.relations': {
      ...unsigned['m.relations'],
      [THREAD_RELATION_TYPE.name]: { ...summary, count: Math.max(0, summary.count - 1) },
    },
  });
};

/**
 * A thread lowers its count when its room forwards a reply's BeforeRedaction. The SDK maps the
 * events of a room's first sync (also the saved sync after a reload) before it stores the room, so
 * those events never forwarded it, and redacting them left every count as it was. Forwarding
 * twice is a no-op.
 */
const forwardRedactions = (room: Room, event: MatrixEvent): void => {
  room.reEmitter.reEmit(event, [MatrixEventEvent.BeforeRedaction]);
};

/**
 * The saved sync can replay a reply and its redaction in one batch. The SDK looks for the reply
 * before it adds the batch to the thread, so the reply came back unredacted and counted. Apply
 * such redactions again once the thread holds the reply.
 */
const reappliedRedactions = new WeakSet<MatrixEvent>();
const applyLateRedactions = (room: Room, thread: Thread): void => {
  const late = thread.events.filter((event) => {
    if (!event.isRedaction() || reappliedRedactions.has(event)) return false;
    const target = event.getAssociatedId();
    return !!target && thread.findEventById(target)?.isRedacted() === false;
  });
  if (late.length === 0) return;
  // Applying one updates the thread, which comes back here before the reply is redacted.
  late.forEach((event) => reappliedRedactions.add(event));
  room.processThreadedEvents(late, false);
};

/**
 * Keeps thread reply counts right for the client's whole life; call it before the client starts,
 * so it sees the saved sync. Returns a function that stops it.
 */
export const keepThreadReplyCounts = (mx: MatrixClient): (() => void) => {
  // The SDK announces a thread once its first batch is in, and updates it once each later batch
  // is counted, also when it read the summary again.
  // The SDK counts a reply once its thread's timeline adds it, and announces an opening thread
  // only after its first page is in. Opening reads the root again, whose summary can count a reply
  // that sync brings before that page, so the SDK counted it twice (5 for a thread of 4) and the
  // count stayed once the thread was open. The count is settled as soon as each event is in; these
  // listeners run after the SDK's own.
  const timelineStops = new Map<Room, Map<Thread, () => void>>();
  const watchTimeline = (room: Room, thread: Thread) => {
    const stops = timelineStops.get(room);
    if (!stops || stops.has(thread)) return;
    const onAdded = () => {
      settleThreadReplyCount(thread);
    };
    thread.timelineSet.on(RoomEvent.Timeline, onAdded);
    stops.set(thread, () => thread.timelineSet.removeListener(RoomEvent.Timeline, onAdded));
  };

  const onThread = (room: Room, thread: Thread) => {
    watchTimeline(room, thread);
    applyLateRedactions(room, thread);
    settleThreadReplyCount(thread);
  };

  const onRoom = (room: Room) => {
    const stops = new Map<Thread, () => void>();
    timelineStops.set(room, stops);
    // The same test as the SDK's, which lowers the thread's own count before the redaction.
    const onBeforeRedaction = (event: MatrixEvent, redaction: MatrixEvent) => {
      if (redaction.status || !event.isRelation(THREAD_RELATION_TYPE.name)) return;
      const thread = event.threadRootId ? room.getThread(event.threadRootId) : null;
      if (!thread || event.getId() === thread.id) return;
      new Set([thread.rootEvent, room.findEventById(thread.id)]).forEach(
        (root) => root && removeRedactedReplyFromSummary(root, event)
      );
    };
    room.on(MatrixEventEvent.BeforeRedaction, onBeforeRedaction);
    // Redactions saved with the threads, before the threads are counted.
    room.getThreads().forEach((thread) => {
      thread.events.forEach((event) => forwardRedactions(room, event));
    });
    return () => {
      room.removeListener(MatrixEventEvent.BeforeRedaction, onBeforeRedaction);
      stops.forEach((stop) => stop());
      timelineStops.delete(room);
    };
  };

  const onTimeline = (
    event: MatrixEvent,
    room: Room | undefined,
    _toStartOfTimeline: boolean | undefined,
    removed: boolean,
    data: IRoomTimelineData
  ) => {
    if (removed || !room || !data.timeline?.getTimelineSet().thread) return;
    forwardRedactions(room, event);
  };

  mx.on(RoomEvent.Timeline, onTimeline);
  const stopRooms = watchRoomThreads(mx, { onThread, onRoom });

  return () => {
    mx.removeListener(RoomEvent.Timeline, onTimeline);
    stopRooms();
  };
};
