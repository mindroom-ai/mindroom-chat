import { ClientEvent, RelationType, SyncState, ThreadEvent } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room, Thread } from 'matrix-js-sdk';
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
// The bundle names only the thread's newest reply. A reply that streams behind newer messages (an
// agent posts text and files mid-turn) is named nowhere, and a page of the thread need not reach it
// either: a long stream's edits fill the newest page. Its edits still arrive, and to place one the
// SDK fetches the reply. `revealStreamingReply` keeps that copy beside the thread, without a request
// of its own; the streaming checks read it with the thread's tail and decide, as for any reply. A
// redaction reaches no copy outside the timelines, so `forgetRedactedReply` drops the copy.

/** Where MindRoom's homeserver bundles a thread's newest reply that is not its title. */
const LATEST_REPLY_KEY = 'io.mindroom.latest_reply';

// The bundle keeps its rule, by which a run without a status streams. A revealed reply follows the
// card (`isEventStreaming`), which needs the status to say so.
const streams = (content: Record<string, unknown>, source: 'bundle' | 'revealed'): boolean => {
  const status = readStreamStatus(content);
  const runStreams =
    source === 'revealed'
      ? getAiRunInfo(content)?.status?.toLowerCase() === 'streaming'
      : isAiRunStreaming(content);
  return (
    (runStreams || (!!status && ACTIVE_STREAM_STATUSES.has(status))) &&
    !hasTerminalStreamMetadata(content) &&
    !(status && TERMINAL_STREAM_STATUSES.has(status))
  );
};

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
  if (!streams(content, 'bundle')) return undefined;
  const ts = Math.max(
    typeof reply.origin_server_ts === 'number' ? reply.origin_server_ts : 0,
    typeof edit?.origin_server_ts === 'number' ? edit.origin_server_ts : 0
  );
  return Date.now() - ts <= STREAM_IDLE_LIMIT_MS ? reply.event_id : undefined;
};

/**
 * Per thread, a reply that streams behind what the thread holds, known by a live edit of it. The
 * copy is in no timeline, so no page of the thread moves or replaces it; the streaming checks read
 * it with the thread's tail.
 */
export const revealedReplies = new WeakMap<Thread, MatrixEvent>();

/** Drops the revealed replies of the room's threads that `gone` names. */
const forgetReplies = (room: Room, gone: (reply: MatrixEvent) => boolean): void =>
  room.getThreads().forEach((thread) => {
    const reply = revealedReplies.get(thread);
    if (reply && gone(reply) && revealedReplies.delete(thread))
      thread.emit(ThreadEvent.Update, thread);
  });

/**
 * Keeps the reply the SDK fetched to place a live `relation` as its thread's revealed reply, when
 * the server's newest word on the reply (the edit it bundles, or the relation) is an edit that
 * streams, sent within the idle limit, and the client knows no newer one. An untrusted sender's
 * stream status is stripped where the content is read (`installEventContentGuard`). The SDK
 * fetches the reply again for each further edit; the revealed copy then takes the newest revision
 * known, whatever it says, and is dropped when the server holds the reply redacted.
 */
const revealStreamingReply = (mx: MatrixClient, relation: MatrixEvent): void => {
  const room = mx.getRoom(relation.getRoomId());
  const fetched = room?.fetchedRelationParents.get(relation);
  const replyId = fetched?.getId();
  if (!room || !fetched || !replyId) return;
  if (fetched.isRedacted()) {
    // A redacted reply names no thread any more, so the relation found none.
    forgetReplies(room, (reply) => reply.getId() === replyId);
    return;
  }
  const thread = relation.getThread();
  if (!thread || room.hasEncryptionStateEvent() || mx.isUserIgnored(fetched.getSender() ?? ''))
    return;
  const revealed = revealedReplies.get(thread);
  const known = revealed?.getId() === replyId ? revealed : undefined;
  // The server's copy as of this relation, on the edit the server bundles with it.
  const fresh = mx.getEventMapper()({ ...fetched.event, room_id: room.roomId });
  const reply = known ?? fresh;
  const isEdit = (event: MatrixEvent | null): event is MatrixEvent =>
    !!event?.isRelation(RelationType.Replace) &&
    event.getAssociatedId() === replyId &&
    event.getType() === reply.getType() &&
    !event.isRedacted();
  const shown = reply.replacingEvent();
  const evidence = getLatestEdit(reply, [fresh.replacingEvent(), relation].filter(isEdit));
  // Older news never makes a stream: the edit the copy shows, the edits that wait in an unopened
  // thread, and those the room's relations hold (an opened thread's, and cached ones that no
  // thread took) only tell that a newer revision exists.
  const newest = getLatestEdit(
    reply,
    [
      evidence ?? null,
      shown,
      ...(thread.replayEvents ?? []),
      ...(room.relations
        .getChildEventsForEvent(replyId, RelationType.Replace, reply.getType())
        ?.getRelations() ?? []),
    ].filter(isEdit)
  );
  if (!newest) return;
  if (!known) {
    const content: unknown = newest.getOriginalContent()['m.new_content'];
    if (
      newest !== evidence ||
      !isRecord(content) ||
      !streams(content, 'revealed') ||
      Date.now() - newest.getTs() > STREAM_IDLE_LIMIT_MS
    )
      return;
    revealedReplies.set(thread, reply);
  }
  if (newest !== shown) reply.makeReplaced(newest);
  thread.emit(ThreadEvent.Update, thread);
};

/**
 * Drops the revealed reply that `redaction` names, or whose shown edit it names (the newest the
 * copy has, so its bundled one too): the next live edit reveals the reply again, as the server
 * holds it then. By the rule of the SDK patch (`Room.mayRedact`), the reply standing in for its
 * sender's edits: the redaction's sender is on the reply's sender's server, or may redact here.
 */
const forgetRedactedReply = (mx: MatrixClient, redaction: MatrixEvent): void => {
  const room = mx.getRoom(redaction.getRoomId());
  const redactedId = redaction.getAssociatedId();
  const sender = redaction.getSender();
  if (!room || !redactedId || !sender) return;
  const server = (userId?: string) => userId?.slice(userId.indexOf(':') + 1);
  forgetReplies(
    room,
    (reply) =>
      [reply.getId(), reply.replacingEventId()].includes(redactedId) &&
      (server(sender) === server(reply.getSender()) ||
        room.currentState.maySendRedactionForEvent(reply, sender))
  );
};

/**
 * Loads the first page of each unopened thread whose bundled reply streams, and remembers the
 * reply a live edit reveals (`revealStreamingReply`), for the client's whole life; call it before
 * the client starts. Returns a function that stops it.
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

  const onEvent = (event: MatrixEvent) => {
    // A throw here would cost the sync the rest of its batch.
    try {
      if (event.isRedaction()) forgetRedactedReply(mx, event);
      else revealStreamingReply(mx, event);
    } catch (error) {
      console.warn('[streamingThreadLoads] could not follow a hidden reply', error);
    }
  };

  const stopRooms = watchRoomThreads(mx, { onThread: consider });
  mx.on(ClientEvent.Sync, onSync);
  mx.on(ClientEvent.Event, onEvent);

  return () => {
    stopped = true;
    stopRooms();
    mx.removeListener(ClientEvent.Sync, onSync);
    mx.removeListener(ClientEvent.Event, onEvent);
    queue.splice(0);
  };
};
