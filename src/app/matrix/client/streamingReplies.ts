import {
  ClientEvent,
  RelationType,
  RoomEvent,
  ThreadEvent,
  type EventTimelineSet,
  type IEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type SyncState,
} from 'matrix-js-sdk';
import {
  AI_RUN_METADATA_KEY,
  getStreamStatusFromContent,
  TERMINAL_STREAM_STATUSES,
} from '../protocol/aiRun';
import { getSameSenderBundledEdit } from '../editEvent';
import { getLatestEdit, isEventOrderedAfter } from '../room';
import { getThreadSummaryReply } from './unopenedThreadEdits';

// A thread's card says "streaming" while its newest reply says it streams. What the client holds of
// a reply can be old, though: a root's thread summary is the server's word at the moment it was
// read (a thread list read mid-stream keeps the reply's placeholder), the page's cache keeps that
// summary and the replies across reloads, and a reply whose finishing edit came in a sync gap
// keeps its last edit from before the gap. Edits only grow a reply, so nothing later corrects
// those copies, and finished threads kept "streaming" for hours, through reloads.
//
// So a reply shows as streaming only while the client can vouch for it: it saw the reply or an
// edit of it by its sender arrive through /sync since the room's last gap (the SDK's saved sync,
// replayed at start, does not count), or the server said so. Any other reply that says it streams
// is checked: the server's copy of the reply bundles its newest edit, which the client puts on the
// reply. Until the answer, a reply seen before a gap still streams and one never seen does not.
// As a last resort, a reply without an edit for STREAM_IDLE_LIMIT_MS no longer streams, whatever
// it says: its writer is gone.
//
// A room's thread list answers for 30 threads per request: each listed root bundles its thread's
// newest event with that event's newest edit. So a check waits a moment before it asks (a room's
// cards ask before its list starts reading) and then while the room's thread list is read (a
// reload of a room with hundreds of threads asked once per finished thread before), a listed
// reply counts as the server's answer, and a reply older than the event its listed thread names
// as the newest needs no answer, then or later: the client keeps that answer, because a card whose
// loaded events still end with the reply (a reload restores them) would ask again whenever it is
// drawn. What the list leaves open is checked when the read ends.

/** A reply whose newest revision is older than this is not streaming. */
export const STREAM_IDLE_LIMIT_MS = 30 * 60_000;
/** Server checks in flight at once. */
const CHECKS_AT_ONCE = 4;
/**
 * How long a check waits before it may ask: the thread list of a room being opened starts reading
 * meanwhile (its cards ask before the list's loader runs) and answers for many replies at once.
 */
export const CHECK_DELAY_MS = 2_000;
/** Waits before a failed check is tried again; the last one repeats. */
const RETRY_DELAYS_MS = [15_000, 60_000, 300_000];
/** Replies the client remembers seeing; the oldest are forgotten first. */
const SEEN_LIMIT = 5_000;

/** A reply the client vouches for: its room's gap count then, and its newest edit known. */
type Seen = { roomId: string; gap: number; edit?: MatrixEvent };

/** The newest event of a thread, as the room's thread list named it. */
type Listed = { roomId: string; eventId: string; ts: number };

type Check = {
  roomId: string;
  eventId: string;
  threadId?: string;
  /** The copies of the reply that records showed, which get the server's newest edit. */
  targets: Set<MatrixEvent>;
  attempts: number;
  /** Asking the server now; such a check runs to its end. */
  running?: boolean;
};

type Checker = {
  isCurrent: (room: Room, event: MatrixEvent) => boolean;
  hold: (roomId: string) => () => void;
};

const checkers = new WeakMap<MatrixClient, Checker>();

const newestRevisionTs = (event: MatrixEvent): number => {
  const bundled = event.getServerAggregatedRelation<Partial<IEvent>>(RelationType.Replace);
  return Math.max(
    event.getTs(),
    event.replacingEvent()?.getTs() ?? 0,
    typeof bundled?.origin_server_ts === 'number' ? bundled.origin_server_ts : 0
  );
};

/** What the client may learn a stream from: a reply or edit with MindRoom stream metadata. */
const mayStream = (event: MatrixEvent): boolean => {
  if (event.isEncrypted()) return true;
  const content = event.getContent();
  const newContent = content['m.new_content'] as Record<string, unknown> | undefined;
  return (
    getStreamStatusFromContent(content) !== undefined ||
    content[AI_RUN_METADATA_KEY] !== undefined ||
    newContent?.[AI_RUN_METADATA_KEY] !== undefined
  );
};

const isFinished = (event: MatrixEvent): boolean => {
  const status = getStreamStatusFromContent(event.getContent());
  return !!status && TERMINAL_STREAM_STATUSES.has(status);
};

const isUsableEdit = (target: MatrixEvent, edit: MatrixEvent): boolean => {
  const newContent = edit.getContent()['m.new_content'];
  return (
    !edit.isRedacted() &&
    !edit.isDecryptionFailure() &&
    edit.getType() === target.getType() &&
    !!newContent &&
    typeof newContent === 'object'
  );
};

/** The edit to put on the reply, when it is usable and newer than the one the reply shows. */
const newerEdit = (target: MatrixEvent, edit: MatrixEvent): MatrixEvent | undefined => {
  if (!isUsableEdit(target, edit)) return undefined;
  const current = target.replacingEvent();
  const newest = getLatestEdit(target, current ? [current, edit] : [edit]);
  return newest && newest !== current ? newest : undefined;
};

const httpStatusOf = (error: unknown): number | undefined => {
  const status = (error as { httpStatus?: unknown } | undefined)?.httpStatus;
  return typeof status === 'number' ? status : undefined;
};

/**
 * Whether a reply that says it streams may be shown as streaming; asks the server about it when
 * the client cannot vouch for it. Without a running check (a client this module does not
 * follow), every such reply may.
 */
export const isStreamingReplyCurrent = (room: Room, event: MatrixEvent): boolean =>
  checkers.get(room.client)?.isCurrent(room, event) ?? true;

/**
 * Holds the room's checks while its thread list is read, which answers for many replies at once.
 * Call the returned function when the read ends, however it ends.
 */
export const holdStreamingChecks = (room: Room): (() => void) =>
  checkers.get(room.client)?.hold(room.roomId) ?? (() => undefined);

const threadOf = (event: MatrixEvent): string | undefined =>
  event.threadRootId ?? event.getRelation()?.event_id;

/** The reply an edit replaces, as the client holds it: in a timeline or as its thread's summary. */
const heldReply = (
  room: Room | null,
  edit: MatrixEvent,
  replyId: string
): MatrixEvent | undefined => {
  const summarized = getThreadSummaryReply(
    edit.threadRootId ? room?.getThread(edit.threadRootId) : undefined
  );
  return room?.findEventById(replyId) ?? (summarized?.getId() === replyId ? summarized : undefined);
};

/**
 * Follows the client's sync for the whole client life to vouch for streaming replies, and checks
 * the others with the server; call it before the client starts. Returns a function that stops it.
 */
export const keepStreamingRepliesChecked = (mx: MatrixClient): (() => void) => {
  const seen = new Map<string, Seen>();
  /** Per thread root, the newest event the room's thread list named; the oldest go first. */
  const listed = new Map<string, Listed>();
  /** Per room, how many sync gaps it had. */
  const gaps = new Map<string, number>();
  /** The first batch's replies until the SDK says whether they came from its saved sync. */
  let firstBatch: Array<[string, string, MatrixEvent | undefined]> | undefined = [];
  /** Replies the server could not tell about (gone or not for this account). */
  const unknown = new Set<string>();
  const checks = new Map<string, Check>();
  const queue: Check[] = [];
  let running = 0;
  /** Per room, the thread list reads in progress, which hold its checks. */
  const holds = new Map<string, number>();
  /** Replies shown as streaming: checked after a gap, and re-shown once they went idle. */
  const shown = new Map<string, { roomId: string; targets: Set<MatrixEvent> }>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const idleTimers = new Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>();
  let stopped = false;

  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
    return timer;
  };

  const gapsOf = (roomId: string) => gaps.get(roomId) ?? 0;

  /** The room's thread list named a newer event of the reply's thread. */
  const isOlderThanListed = (roomId: string, event: MatrixEvent): boolean => {
    const threadId = threadOf(event);
    const newest = threadId ? listed.get(threadId) : undefined;
    return (
      !!newest &&
      newest.roomId === roomId &&
      newest.eventId !== event.getId() &&
      event.getTs() < newest.ts
    );
  };

  const vouch = (roomId: string, eventId: string, edit?: MatrixEvent) => {
    const known = seen.get(eventId)?.edit;
    seen.delete(eventId);
    seen.set(eventId, {
      roomId,
      gap: gapsOf(roomId),
      edit: edit && (!known || isEventOrderedAfter(edit, known)) ? edit : known,
    });
    unknown.delete(eventId);
    if (seen.size > SEEN_LIMIT) {
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  };

  const announce = (room: Room, targets: Iterable<MatrixEvent>) => {
    const threadIds = new Set<string>();
    [...targets].forEach((target) => {
      const threadId = threadOf(target);
      if (threadId) threadIds.add(threadId);
    });
    threadIds.forEach((threadId) => {
      const thread = room.getThread(threadId);
      if (thread) thread.emit(ThreadEvent.Update, thread);
    });
  };

  const putEdit = (target: MatrixEvent, edit: MatrixEvent) => {
    const newer = newerEdit(target, edit);
    if (newer) target.makeReplaced(newer);
  };

  /** The newest edit by the reply's sender that the server bundled with a reply, decrypted. */
  const bundledEdit = async (
    roomId: string,
    rawReply: Partial<IEvent>
  ): Promise<MatrixEvent | undefined> => {
    const rawEdit = getSameSenderBundledEdit(rawReply);
    const edit = rawEdit && mx.getEventMapper()({ ...rawEdit, room_id: roomId });
    if (edit) await mx.decryptEventIfNeeded(edit);
    return edit;
  };

  /** The server's answer about a reply: its newest edit goes on every copy the check holds. */
  const answer = (room: Room, check: Check, edit: MatrixEvent | undefined) => {
    if (edit) check.targets.forEach((target) => putEdit(target, edit));
    // Only now: a card built before the edit is on the reply would still say it streams.
    vouch(check.roomId, check.eventId, edit);
    announce(room, check.targets);
  };

  /** Asks the server about one reply; false when it should be asked again later. */
  const run = async (check: Check): Promise<boolean> => {
    const room = mx.getRoom(check.roomId);
    // A reply that finished through /sync meanwhile needs no answer.
    if (!room || [...check.targets].every(isFinished)) return true;
    // The thread list or /sync told about the reply since it was asked.
    const known = seen.get(check.eventId);
    if (known && known.gap === gapsOf(check.roomId)) {
      answer(room, check, known.edit);
      return true;
    }
    let rawReply: Partial<IEvent>;
    try {
      rawReply = await mx.fetchRoomEvent(check.roomId, check.eventId);
    } catch (error) {
      const status = httpStatusOf(error);
      if (stopped || status === undefined || status < 400 || status >= 500 || status === 429)
        return false;
      unknown.add(check.eventId);
      announce(room, check.targets);
      return true;
    }
    const edit = await bundledEdit(check.roomId, rawReply);
    if (!stopped) answer(room, check, edit);
    return true;
  };

  const retryLater = (check: Check) => {
    check.attempts += 1;
    const delay = RETRY_DELAYS_MS[Math.min(check.attempts, RETRY_DELAYS_MS.length) - 1];
    later(delay ?? STREAM_IDLE_LIMIT_MS, () => {
      if (checks.get(check.eventId) !== check) return;
      queue.push(check);
      drain();
    });
  };

  const drain = () => {
    if (stopped || firstBatch) return;
    let index = 0;
    while (running < CHECKS_AT_ONCE && index < queue.length) {
      const check = queue[index];
      if (!check || holds.has(check.roomId)) {
        index += 1;
        continue;
      }
      queue.splice(index, 1);
      running += 1;
      check.running = true;
      void run(check)
        .catch(() => false)
        .then((done) => {
          check.running = false;
          if (stopped) return;
          if (done) checks.delete(check.eventId);
          else retryLater(check);
        })
        .finally(() => {
          running -= 1;
          drain();
        });
    }
  };

  const ask = (roomId: string, eventId: string, targets: Iterable<MatrixEvent>) => {
    const existing = checks.get(eventId);
    if (existing) {
      [...targets].forEach((target) => existing.targets.add(target));
      return;
    }
    const targetSet = new Set(targets);
    const [first] = targetSet;
    const check: Check = {
      roomId,
      eventId,
      threadId: first && threadOf(first),
      targets: targetSet,
      attempts: 0,
    };
    checks.set(eventId, check);
    later(CHECK_DELAY_MS, () => {
      if (checks.get(eventId) !== check) return;
      queue.push(check);
      drain();
    });
  };

  /** Shows the reply again when it goes idle, so its card stops streaming without other news. */
  const remindWhenIdle = (room: Room, event: MatrixEvent, eventId: string) => {
    const at = newestRevisionTs(event) + STREAM_IDLE_LIMIT_MS;
    const current = idleTimers.get(eventId);
    if (current?.at === at) return;
    if (current) {
      clearTimeout(current.timer);
      timers.delete(current.timer);
    }
    const timer = later(Math.max(0, at - Date.now()) + 1_000, () => {
      idleTimers.delete(eventId);
      shown.delete(eventId);
      announce(room, [event]);
    });
    idleTimers.set(eventId, { at, timer });
  };

  const isCurrent = (room: Room, event: MatrixEvent): boolean => {
    const eventId = event.getId();
    // A local echo is the user's own message on its way.
    if (!eventId || eventId.startsWith('~')) return true;
    if (Date.now() - newestRevisionTs(event) > STREAM_IDLE_LIMIT_MS) return false;
    if (unknown.has(eventId)) return false;
    const vouched = seen.get(eventId);
    // A reply never vouched for does not stream, and the list's word about its thread answers it.
    if (!vouched && isOlderThanListed(room.roomId, event)) return false;
    if (!vouched || vouched.gap !== gapsOf(room.roomId)) ask(room.roomId, eventId, [event]);
    if (!vouched) return false;
    // Another copy of the reply (a summary's, the cache's) may lack the edit the client knows.
    const known = vouched.edit && newerEdit(event, vouched.edit);
    if (known) {
      queueMicrotask(() => {
        putEdit(event, known);
        announce(room, [event]);
      });
      return false;
    }
    const showing = shown.get(eventId) ?? { roomId: room.roomId, targets: new Set<MatrixEvent>() };
    showing.targets.add(event);
    shown.set(eventId, showing);
    remindWhenIdle(room, event, eventId);
    return true;
  };

  const hold = (roomId: string) => {
    holds.set(roomId, (holds.get(roomId) ?? 0) + 1);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const count = (holds.get(roomId) ?? 1) - 1;
      if (count > 0) holds.set(roomId, count);
      else holds.delete(roomId);
      drain();
    };
  };

  /** Drops a check that is not asking the server yet; false for one that is. */
  const drop = (check: Check) => {
    if (check.running) return false;
    checks.delete(check.eventId);
    const index = queue.indexOf(check);
    if (index !== -1) queue.splice(index, 1);
    return true;
  };

  /** A thread list page: each root bundles its thread's newest event, with that event's newest edit. */
  const onListed = async (roomId: string, roots: Partial<IEvent>[]) => {
    const room = mx.getRoom(roomId);
    if (!room) return;
    await Promise.all(
      roots.map(async (root) => {
        const latest = root.unsigned?.['m.relations']?.['m.thread']?.latest_event as
          | Partial<IEvent>
          | undefined;
        const latestId = latest?.event_id;
        if (!root.event_id || !latestId) return;
        const latestTs = latest?.origin_server_ts;
        if (typeof latestTs === 'number') {
          listed.delete(root.event_id);
          listed.set(root.event_id, { roomId, eventId: latestId, ts: latestTs });
          if (listed.size > SEEN_LIMIT) {
            const oldest = listed.keys().next().value;
            if (oldest !== undefined) listed.delete(oldest);
          }
        }
        const stale = [...checks.values()].filter(
          (check) =>
            check.roomId === roomId &&
            check.threadId === root.event_id &&
            check.eventId !== latestId
        );
        // The list names another event as the thread's newest: these checks need no answer.
        stale.forEach((check) => {
          if (drop(check)) announce(room, check.targets);
        });
        const rawEdit = getSameSenderBundledEdit(latest);
        const listedMayStream = [latest, rawEdit].some(
          (event) =>
            event?.type === 'm.room.encrypted' ||
            getStreamStatusFromContent(event?.content ?? {}) !== undefined ||
            event?.content?.[AI_RUN_METADATA_KEY] !== undefined
        );
        if (!listedMayStream) return;
        const edit = await bundledEdit(roomId, latest);
        if (stopped) return;
        vouch(roomId, latestId, edit);
        const check = checks.get(latestId);
        if (check && drop(check)) answer(room, check, edit);
      })
    );
  };

  const listThreads = mx.createThreadListMessagesRequest.bind(mx);
  const listThreadsAnswering: MatrixClient['createThreadListMessagesRequest'] = async (
    roomId,
    ...rest
  ) => {
    const page = await listThreads(roomId, ...rest);
    // Before the SDK takes the page, so its cards find the replies answered. A page the checks
    // cannot read leaves them as they were.
    if (!stopped) await onListed(roomId, page.chunk as Partial<IEvent>[]).catch(() => undefined);
    return page;
  };
  mx.createThreadListMessagesRequest = listThreadsAnswering;

  const onEvent = (event: MatrixEvent) => {
    const roomId = event.getRoomId();
    if (!roomId || !mayStream(event)) return;
    const relation = event.getRelation();
    const eventId = relation?.rel_type === RelationType.Replace ? relation.event_id : event.getId();
    if (!eventId) return;
    const edit = relation?.rel_type === RelationType.Replace ? event : undefined;
    // Only a reply's sender can edit it, and the client must hold the reply to tell.
    if (edit && heldReply(mx.getRoom(roomId), edit, eventId)?.getSender() !== edit.getSender())
      return;
    if (firstBatch) firstBatch.push([roomId, eventId, edit]);
    else vouch(roomId, eventId, edit);
  };

  const onSync = (
    _state: SyncState,
    _previous: SyncState | null,
    data?: { fromCache?: boolean }
  ) => {
    if (!firstBatch) return;
    const batch = firstBatch;
    firstBatch = undefined;
    // The SDK replays its saved sync first; only what the server sent since vouches for a reply.
    if (!data?.fromCache) batch.forEach(([roomId, eventId, edit]) => vouch(roomId, eventId, edit));
    drain();
  };

  const onReset = (room: Room | undefined, timelineSet: EventTimelineSet | undefined) => {
    // Only the room's own timeline resets at a gap; a thread's timeline resets for other reasons.
    if (!room || timelineSet !== room.getUnfilteredTimelineSet()) return;
    gaps.set(room.roomId, gapsOf(room.roomId) + 1);
    // The replies shown as streaming may have finished in the gap.
    shown.forEach(({ roomId, targets }, eventId) => {
      if (roomId !== room.roomId) return;
      shown.delete(eventId);
      if (![...targets].every(isFinished)) ask(roomId, eventId, targets);
    });
  };

  mx.on(ClientEvent.Event, onEvent);
  mx.on(ClientEvent.Sync, onSync);
  mx.on(RoomEvent.TimelineReset, onReset);
  checkers.set(mx, { isCurrent, hold });

  return () => {
    stopped = true;
    mx.removeListener(ClientEvent.Event, onEvent);
    mx.removeListener(ClientEvent.Sync, onSync);
    mx.removeListener(RoomEvent.TimelineReset, onReset);
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    idleTimers.clear();
    queue.splice(0);
    checks.clear();
    holds.clear();
    if (mx.createThreadListMessagesRequest === listThreadsAnswering)
      mx.createThreadListMessagesRequest = listThreads;
    if (checkers.get(mx)?.isCurrent === isCurrent) checkers.delete(mx);
  };
};
