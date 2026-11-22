import {
  ClientEvent,
  MatrixEvent,
  RelationType,
  RoomEvent,
  RoomStateEvent,
  SyncState,
  ThreadEvent,
} from 'matrix-js-sdk';
import type { EventTimelineSet, MatrixClient, Room, Thread } from 'matrix-js-sdk';
import {
  ACTIVE_STREAM_STATUSES,
  TERMINAL_STREAM_STATUSES,
  getAiRunInfo,
  hasTerminalStreamMetadata,
  isAiRunStreaming,
  readStreamStatus,
} from '../protocol/aiRun';
import { getSameSenderBundledEdit } from '../editEvent';
import { isRecord } from '../../lib/isRecord';
import { isTrustedAgentSender } from '../protocol/untrustedContent';
import { isEventOrderedAfter } from '../room';
import { watchRoomThreads } from '../watchRoomThreads';
import { STREAM_IDLE_LIMIT_MS } from './streamingReplies';
import { getFinishingEdit } from './syncedEdits';

// A thread holds its replies only once it loads its first page, which the app does when it shows
// or opens the thread. After a reload, a thread whose newest event is its title notice (MindRoom
// posts it while the first reply streams) holds that reply nowhere: the root's summary names the
// title, and only MindRoom's homeserver bundle (`io.mindroom.latest_reply`) still names the reply.
// Its card then says nothing streams, and the thread waits in Needs you until it is opened. So a
// thread whose bundled reply streams loads its first page in the background, one at a time once
// the live sync runs; the streaming checks then see the reply as they see any other. A thread is
// tried once per reply: a failed page leaves the thread unopened and updates it, which would ask
// again at once. A sync that recovers from an error tries the threads again.
//
// The bundle names only the thread's newest reply. One that streams behind newer messages (an agent
// posts text and files mid-turn) is named nowhere, and a long stream's edits can fill the thread's
// newest page. To place such a reply's live edit the SDK fetches the reply, so each such edit that
// says it streams hints, for STREAM_HINT_MS, that the thread works. The hint holds no copy of the
// reply, and counts only until the thread holds it, where the streaming checks judge it.

/** Where MindRoom's homeserver bundles a thread's newest reply that is not its title. */
const LATEST_REPLY_KEY = 'io.mindroom.latest_reply';

/**
 * The id of the root's bundled reply, when it streams, is not the summary's newest event, is not
 * idle, and the thread does not hold it.
 */
const hiddenStreamingReply = (room: Room, thread: Thread): string | undefined => {
  // An encrypted room's bundle is unreadable, whatever cleartext status it carries.
  if (room.hasEncryptionStateEvent()) return undefined;
  const relations = thread.rootEvent?.getUnsigned()?.['m.relations'];
  const summary = isRecord(relations) ? relations['m.thread'] : undefined;
  if (!isRecord(summary)) return undefined;
  const reply = summary[LATEST_REPLY_KEY];
  const latest = summary.latest_event;
  if (!isRecord(reply) || typeof reply.event_id !== 'string' || !isRecord(reply.content))
    return undefined;
  if (reply.type === 'm.room.encrypted') return undefined;
  // The summary's own reply is the thread's to show: the streaming checks read it.
  if (isRecord(latest) && latest.event_id === reply.event_id) return undefined;
  // A loaded thread holds the reply; initialize() does nothing for it.
  if (thread.findEventById(reply.event_id)) return undefined;
  const edit = getSameSenderBundledEdit(reply);
  const newContent = edit && isRecord(edit.content) ? edit.content['m.new_content'] : undefined;
  // An edit without readable new content says nothing about where the reply is.
  if (edit && !isRecord(newContent)) return undefined;
  // The card's rule, on the reply's newest content.
  const content = isRecord(newContent) ? newContent : reply.content;
  const status = readStreamStatus(content);
  const streams = isAiRunStreaming(content) || (!!status && ACTIVE_STREAM_STATUSES.has(status));
  if (
    !streams ||
    hasTerminalStreamMetadata(content) ||
    (status && TERMINAL_STREAM_STATUSES.has(status))
  )
    return undefined;
  const ts = Math.max(
    typeof reply.origin_server_ts === 'number' ? reply.origin_server_ts : 0,
    typeof edit?.origin_server_ts === 'number' ? edit.origin_server_ts : 0
  );
  return Date.now() - ts <= STREAM_IDLE_LIMIT_MS ? reply.event_id : undefined;
};

/** How long a live streaming edit of a reply its thread lacks says that the thread works. */
export const STREAM_HINT_MS = 5 * 60_000;

/** The edit that hints, and what ends the hint when its time runs out. */
type StreamHint = { thread: Thread; edit: MatrixEvent; timer: ReturnType<typeof setTimeout> };
/** Per client, by reply ID: replies of one thread stream at once. */
const clientHints = new WeakMap<MatrixClient, Map<string, StreamHint>>();

/** What an edit puts on its reply; an untrusted sender's stream status is stripped where it is read. */
const newContentOf = (edit: MatrixEvent): Record<string, unknown> => {
  const content: unknown = edit.getOriginalContent()['m.new_content'];
  return isRecord(content) ? content : {};
};

/** As `syncedEdits` reads a finish: the status may sit on the edit, beside its new content. */
const endsStream = (edit: MatrixEvent): boolean => {
  const content = edit.getOriginalContent<Record<string, unknown>>();
  const status = readStreamStatus(content);
  return hasTerminalStreamMetadata(content) || (!!status && TERMINAL_STREAM_STATUSES.has(status));
};

/**
 * The edits the client knows of the reply `edit` replaces, by the same sender: those of `others`,
 * and those that the thread (waiting, unopened) or its room (as from a page) holds.
 */
const revisionsOf = (
  thread: Thread,
  edit: MatrixEvent,
  others: Array<MatrixEvent | undefined> = []
): MatrixEvent[] => {
  const replyId = edit.getAssociatedId();
  const held = thread.room.relations.getChildEventsForEvent(
    replyId ?? '',
    RelationType.Replace,
    edit.getType()
  );
  return [...others, ...(thread.replayEvents ?? []), ...(held?.getRelations() ?? [])].filter(
    (other): other is MatrixEvent =>
      !!other &&
      other.isRelation(RelationType.Replace) &&
      other.getAssociatedId() === replyId &&
      other.getSender() === edit.getSender() &&
      other.getType() === edit.getType()
  );
};

/** Whether one of `revisions` since `edit` ended the stream; an edit after that one changes nothing. */
const finishedSince = (revisions: MatrixEvent[], edit: MatrixEvent): boolean =>
  revisions.some((other) => endsStream(other) && !isEventOrderedAfter(edit, other));

/** Whether a live edit says that a reply the thread lacks streams, where it may still say so. */
export const hasStreamHint = (room: Room, thread: Thread | null): boolean =>
  !!thread &&
  [...(clientHints.get(room.client) ?? [])].some(
    ([replyId, hint]) =>
      hint.thread === thread &&
      // As the card reads the thread: its timeline, or else the reply its summary names.
      !thread.findEventById(replyId) &&
      thread.replyToEvent?.getId() !== replyId &&
      !finishedSince(revisionsOf(thread, hint.edit), hint.edit)
  );

/**
 * Loads the first page of each unopened thread whose bundled reply streams, and keeps the hints of
 * the replies that stream where no thread holds them (`hasStreamHint`), for the client's whole
 * life; call it before the client starts. Returns a function that stops it.
 */
export const keepStreamingThreadsLoaded = (mx: MatrixClient): (() => void) => {
  const queue: Array<[Room, Thread]> = [];
  const queued = new WeakSet<Thread>();
  /** Per thread, the reply it was loaded for. */
  const tried = new WeakMap<Thread, string>();
  let live = false;
  /** The sync failed since the last server answer: threads tried meanwhile are tried again. */
  let interrupted = false;
  let running = false;
  let stopped = false;

  const pending = (room: Room, thread: Thread): string | undefined => {
    const replyId = hiddenStreamingReply(room, thread);
    return replyId && tried.get(thread) !== replyId ? replyId : undefined;
  };

  const drain = () => {
    if (stopped || !live || running) return;
    const next = queue.shift();
    if (!next) return;
    const [room, thread] = next;
    queued.delete(thread);
    const replyId = pending(room, thread);
    if (!replyId) {
      drain();
      return;
    }
    tried.set(thread, replyId);
    running = true;
    void Promise.resolve(thread.initialize())
      .catch(() => undefined)
      .finally(() => {
        running = false;
        drain();
      });
  };

  const consider = (room: Room, thread: Thread) => {
    if (queued.has(thread) || !pending(room, thread)) return;
    queued.add(thread);
    queue.push([room, thread]);
    drain();
  };

  const onSync = (
    state: SyncState,
    _previous: SyncState | null,
    data?: { fromCache?: boolean }
  ) => {
    if (state === SyncState.Error || state === SyncState.Reconnecting) {
      interrupted = true;
      return;
    }
    // The saved sync replays first, and catching up after an error is no answer yet.
    if ((state !== SyncState.Prepared && state !== SyncState.Syncing) || data?.fromCache) return;
    const recovered = interrupted;
    interrupted = false;
    if (live && !recovered) return;
    live = true;
    if (recovered)
      mx.getRooms().forEach((room) =>
        room.getThreads().forEach((thread) => {
          tried.delete(thread);
          consider(room, thread);
        })
      );
    drain();
  };

  const streamHints = new Map<string, StreamHint>();
  clientHints.set(mx, streamHints);
  /** Ends hints; unless `quiet`, their threads' cards read the threads again. */
  const dropHints = (gone: (hint: StreamHint, replyId: string) => boolean, quiet = false) =>
    streamHints.forEach((hint, replyId) => {
      if (!gone(hint, replyId)) return;
      clearTimeout(hint.timer);
      streamHints.delete(replyId);
      if (!quiet) hint.thread.emit(ThreadEvent.Update, hint.thread);
    });

  /** No hint in an encrypted room, and none of a sender the reader ignores. */
  const barred = (room: Room, sender = '') =>
    room.hasEncryptionStateEvent() || mx.isUserIgnored(sender);

  /**
   * An edit the sync brought. The revisions of its reply that the client knows decide: the edit,
   * the one the server bundled with the reply the SDK fetched to place the edit, the synced edit
   * that finished the reply, and those the thread or the room holds. If one since the hint's edit
   * ended the stream, the reply's hint goes. If the edit is the newest, live, by the fetched
   * reply's sender (an agent the reader trusts), says that the reply streams and is not idle, the
   * hint starts anew.
   */
  const onEvent = (edit: MatrixEvent) => {
    const room = mx.getRoom(edit.getRoomId());
    // Taken out: the SDK would keep the reply for as long as it keeps the relation.
    const reply = room?.fetchedRelationParents.get(edit);
    room?.fetchedRelationParents.delete(edit);
    const replyId = edit.getAssociatedId();
    const hint = replyId ? streamHints.get(replyId) : undefined;
    // Another relation, as a reaction, starts no hint; the reply fetched for it may end one.
    const tells = edit.isRelation(RelationType.Replace) || (!!hint && !!reply);
    if (!room || !replyId || !tells || barred(room, edit.getSender())) return;
    const thread = hint?.thread ?? edit.getThread();
    if (!thread || (!hint && edit.getSender() !== reply?.getSender())) return;
    const bundled = reply && getSameSenderBundledEdit(reply.event);
    const finishing = reply && getFinishingEdit(reply);
    const from = hint?.edit ?? edit;
    const known = revisionsOf(thread, from, [edit, bundled && new MatrixEvent(bundled), finishing]);
    if (finishedSince(known, from)) {
      dropHints((_hint, id) => id === replyId);
      return;
    }
    const newest = known.reduce((a, b) => (isEventOrderedAfter(b, a) ? b : a), from);
    if (!reply || newest !== edit || edit.getType() !== reply.getType()) return;
    const content = newContentOf(edit);
    // The card's rule (`isEventStreaming`): the status must say that the reply streams.
    const streams =
      getAiRunInfo(content)?.status?.toLowerCase() === 'streaming' ||
      ACTIVE_STREAM_STATUSES.has(readStreamStatus(content) ?? '');
    if (!streams || edit.isRedacted() || !isTrustedAgentSender(edit.getSender())) return;
    if (Date.now() - edit.getTs() > STREAM_IDLE_LIMIT_MS) return;
    clearTimeout(hint?.timer);
    const timer = setTimeout(() => dropHints((_hint, id) => id === replyId), STREAM_HINT_MS);
    streamHints.set(replyId, { thread, edit, timer });
    thread.emit(ThreadEvent.Update, thread);
  };

  /** The edit that ended a stream may have come in the room's sync gap. */
  const onReset = (room: Room | undefined, timelineSet: EventTimelineSet | undefined) => {
    if (room && timelineSet === room.getUnfilteredTimelineSet())
      dropHints(({ thread }) => thread.room === room);
  };
  /** Room state or account data changed, as when a room turns encryption on: the cards hear of it. */
  const onBarred = () => dropHints(({ thread, edit }) => barred(thread.room, edit.getSender()));
  const onDeleteRoom = (roomId: string) =>
    dropHints(({ thread }) => thread.roomId === roomId, true);
  const onDeleteThread = (gone: Thread) => dropHints(({ thread }) => thread === gone, true);
  const onRoom = (room: Room) => {
    room.on(ThreadEvent.Delete, onDeleteThread);
    return () => room.removeListener(ThreadEvent.Delete, onDeleteThread);
  };

  const stopRooms = watchRoomThreads(mx, { onThread: consider, onRoom });
  mx.on(ClientEvent.Sync, onSync);
  mx.on(ClientEvent.Event, onEvent);
  mx.on(RoomEvent.TimelineReset, onReset);
  mx.on(ClientEvent.DeleteRoom, onDeleteRoom);
  mx.on(RoomStateEvent.Events, onBarred);
  mx.on(ClientEvent.AccountData, onBarred);

  return () => {
    stopped = true;
    stopRooms();
    mx.removeListener(ClientEvent.Sync, onSync);
    mx.removeListener(ClientEvent.Event, onEvent);
    mx.removeListener(RoomEvent.TimelineReset, onReset);
    mx.removeListener(ClientEvent.DeleteRoom, onDeleteRoom);
    mx.removeListener(RoomStateEvent.Events, onBarred);
    mx.removeListener(ClientEvent.AccountData, onBarred);
    dropHints(() => true, true);
    queue.splice(0);
  };
};
