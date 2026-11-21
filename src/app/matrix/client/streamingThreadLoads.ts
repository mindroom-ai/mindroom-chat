import {
  ClientEvent,
  MatrixEvent,
  RelationType,
  RoomEvent,
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
import { getLatestEdit } from '../room';
import { watchRoomThreads } from '../watchRoomThreads';
import { STREAM_IDLE_LIMIT_MS } from './streamingReplies';
import { getFinishingEdit } from './syncedEdits';
import { findReply } from './unopenedThreadEdits';

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

type StreamHint = { replyId: string; sender: string; timer: ReturnType<typeof setTimeout> };
const streamHints = new Map<Thread, StreamHint>();

/** Ends the thread's hint; its cards read the thread again, also when the hint only ran out. */
const dropHint = (thread: Thread): void => {
  clearTimeout(streamHints.get(thread)?.timer);
  streamHints.delete(thread);
  thread.emit(ThreadEvent.Update, thread);
};

/** Whether a live edit says that a reply the thread lacks streams, where it may still say so. */
export const hasStreamHint = (room: Room, thread: Thread | null): boolean => {
  const hint = thread && streamHints.get(thread);
  return (
    !!hint &&
    !findReply(thread, hint.replyId) &&
    !room.hasEncryptionStateEvent() &&
    !room.client.isUserIgnored(hint.sender)
  );
};

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

  /**
   * A live relation whose reply the SDK fetched to place it. The newest revision of the reply the
   * client knows (the relation, the edit bundled with the fetched reply, or one the client holds)
   * decides: if it ended the stream, the reply's hint goes; if it is the relation itself, an edit
   * by the reply's sender that says it streams and is not idle, the hint starts anew.
   */
  const onEvent = (relation: MatrixEvent) => {
    const thread = relation.getThread();
    const reply = thread?.room.fetchedRelationParents.get(relation);
    const replyId = reply?.getId();
    if (!thread || !reply || !replyId) return;
    const bundled = getSameSenderBundledEdit(reply.event);
    const held = thread.room.relations.getChildEventsForEvent(
      replyId,
      RelationType.Replace,
      reply.getType()
    );
    // Besides the relation: the edits a page of the thread brought, the edit the server bundled
    // with the fetched reply, and the synced edit that finished the reply.
    const finishing = getFinishingEdit(reply);
    const known = [relation, ...(held?.getRelations() ?? [])];
    if (bundled) known.push(new MatrixEvent(bundled));
    if (finishing) known.push(finishing);
    const newest = getLatestEdit(
      reply,
      known.filter(
        (event) =>
          event.isRelation(RelationType.Replace) &&
          event.getAssociatedId() === replyId &&
          event.getType() === reply.getType() &&
          !event.isRedacted()
      )
    );
    // An untrusted sender's stream status is stripped where the content is read.
    const content: unknown = newest?.getOriginalContent()['m.new_content'];
    if (!newest || !isRecord(content)) return;
    const status = readStreamStatus(content);
    if (hasTerminalStreamMetadata(content) || (status && TERMINAL_STREAM_STATUSES.has(status))) {
      if (streamHints.get(thread)?.replyId === replyId) dropHint(thread);
      return;
    }
    // The card's rule (`isEventStreaming`): the status must say that the reply streams.
    const streams =
      getAiRunInfo(content)?.status?.toLowerCase() === 'streaming' ||
      (!!status && ACTIVE_STREAM_STATUSES.has(status));
    if (newest !== relation || !streams || Date.now() - newest.getTs() > STREAM_IDLE_LIMIT_MS)
      return;
    clearTimeout(streamHints.get(thread)?.timer);
    const timer = setTimeout(() => dropHint(thread), STREAM_HINT_MS);
    streamHints.set(thread, { replyId, sender: newest.getSender() ?? '', timer });
    thread.emit(ThreadEvent.Update, thread);
  };

  /** The edit that ended a stream may have come in the room's sync gap. */
  const onReset = (room: Room | undefined, timelineSet: EventTimelineSet | undefined) => {
    if (room && timelineSet === room.getUnfilteredTimelineSet())
      streamHints.forEach((_hint, thread) => thread.room === room && dropHint(thread));
  };

  const stopRooms = watchRoomThreads(mx, { onThread: consider });
  mx.on(ClientEvent.Sync, onSync);
  mx.on(ClientEvent.Event, onEvent);
  mx.on(RoomEvent.TimelineReset, onReset);

  return () => {
    stopped = true;
    stopRooms();
    mx.removeListener(ClientEvent.Sync, onSync);
    mx.removeListener(ClientEvent.Event, onEvent);
    mx.removeListener(RoomEvent.TimelineReset, onReset);
    queue.splice(0);
  };
};
