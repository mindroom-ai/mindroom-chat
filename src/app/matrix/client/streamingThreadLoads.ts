import { ClientEvent, SyncState, type MatrixClient, type Room, type Thread } from 'matrix-js-sdk';
import {
  ACTIVE_STREAM_STATUSES,
  TERMINAL_STREAM_STATUSES,
  hasTerminalStreamMetadata,
  isAiRunStreaming,
  readStreamStatus,
} from '../protocol/aiRun';
import { getSameSenderBundledEdit } from '../editEvent';
import { isRecord } from '../../lib/isRecord';
import { watchRoomThreads } from '../watchRoomThreads';
import { isMindroomAgentUserId } from '../protocol/agentIdentity';
import { isThreadSummaryContent } from '../protocol/threadSummary';
import {
  CHECK_DELAY_MS,
  STREAM_IDLE_LIMIT_MS,
  setStreamingLoadWake,
  streamingChecksHeld,
} from './streamingReplies';

// A title or newer reply can hide a streaming placeholder. Load first pages serially after
// live sync, a 2 s delay and the list/check holds. A fresh bundled stream is positive evidence;
// a recent agent reply without stream status can warrant a look if replies are missing. A thread is
// tried once per reply: a failed page leaves the thread unopened and updates it, which would ask
// again at once. A sync that recovers from an error tries the threads again.

/** Where MindRoom's homeserver bundles a thread's newest reply that is not its title. */
const LATEST_REPLY_KEY = 'io.mindroom.latest_reply';

/**
 * The id of the root's bundled reply, when it streams, is not the summary's newest event, is not
 * idle, and the thread does not hold it.
 */
const hiddenStreamingReply = (
  thread: Thread,
  summary: Record<string, unknown>
): string | undefined => {
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

const tsOf = (event: unknown): number =>
  isRecord(event) && typeof event.origin_server_ts === 'number' ? event.origin_server_ts : 0;

const speculativeReply = (thread: Thread, summary: Record<string, unknown> | undefined) => {
  const held = thread.lastReply(
    (event) => event.isRelation('m.thread') && !isThreadSummaryContent(event.getOriginalContent())
  );
  const listed = summary?.[LATEST_REPLY_KEY] ?? summary?.latest_event;
  const reply = held && held.getTs() >= tsOf(listed) ? held.event : listed;
  if (!isRecord(reply) || typeof reply.event_id !== 'string' || !isRecord(reply.content))
    return undefined;
  if (typeof reply.sender !== 'string' || !isMindroomAgentUserId(reply.sender)) return undefined;
  if (reply.type === 'm.room.encrypted' || isThreadSummaryContent(reply.content)) return undefined;
  if (Date.now() - tsOf(reply) > 2 * 60 * 60_000) return undefined;
  const shown = held?.getId() === reply.event_id ? held : thread.replyToEvent;
  const edit = shown?.getId() === reply.event_id ? shown.replacingEvent() : null;
  const revision = (edit?.event ?? getSameSenderBundledEdit(reply))?.content;
  const content = revision && isRecord(revision['m.new_content']) ? revision : reply.content;
  const status = readStreamStatus(content);
  if (
    isAiRunStreaming(content) ||
    hasTerminalStreamMetadata(content) ||
    (status && (ACTIVE_STREAM_STATUSES.has(status) || TERMINAL_STREAM_STATUSES.has(status)))
  )
    return undefined;
  const count = summary?.count;
  if (
    count === thread.length &&
    count <= thread.events.length &&
    count === thread.events.filter((event) => !event.status && event.isRelation('m.thread')).length
  )
    return undefined;
  return reply.event_id;
};

/**
 * Loads the first page of each eligible unopened thread, for the client's whole
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
    if (thread.initialEventsFetched || room.hasEncryptionStateEvent()) return undefined;
    const summary =
      thread.rootEvent?.getServerAggregatedRelation<Record<string, unknown>>('m.thread');
    const replyId =
      (isRecord(summary) ? hiddenStreamingReply(thread, summary) : undefined) ??
      speculativeReply(thread, summary);
    return replyId && tried.get(thread) !== replyId ? replyId : undefined;
  };

  const drain = () => {
    if (stopped || !live || running) return;
    const index = queue.findIndex(([room, thread]) => !streamingChecksHeld(room, thread.id));
    if (index < 0) return;
    const [room, thread] = queue.splice(index, 1)[0]!;
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
    setTimeout(() => {
      if (stopped) return;
      queue.push([room, thread]);
      drain();
    }, CHECK_DELAY_MS);
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

  setStreamingLoadWake(mx, drain);
  const stopRooms = watchRoomThreads(mx, { onThread: consider });
  mx.on(ClientEvent.Sync, onSync);

  return () => {
    stopped = true;
    setStreamingLoadWake(mx);
    stopRooms();
    mx.removeListener(ClientEvent.Sync, onSync);
    queue.splice(0);
  };
};
