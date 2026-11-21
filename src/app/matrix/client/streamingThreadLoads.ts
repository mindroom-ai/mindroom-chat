import { ClientEvent, SyncState, type MatrixClient, type Room, type Thread } from 'matrix-js-sdk';
import {
  TERMINAL_STREAM_STATUSES,
  hasTerminalStreamMetadata,
  readStreamStatus,
} from '../protocol/aiRun';
import { getSameSenderBundledEdit } from '../editEvent';
import { isRecord } from '../../lib/isRecord';
import { watchRoomThreads } from '../watchRoomThreads';
import { isThreadSummaryContent } from '../protocol/threadSummary';
import { CHECK_DELAY_MS, streamingChecksHeld, wakeStreamingLoads } from './streamingReplies';

// Newer replies can hide a streaming placeholder in an unopened thread. After live sync and
// check delay, any check for its replies, and the thread-list hold, load a first page if the reply
// is the newest non-title reply, was sent within two hours and is not terminal on its newest
// same-sender revision. The SDK tail wins over the summary. A fetch never marks Working. A thread is
// tried once per reply: a failed page leaves the thread unopened and updates it, which would ask
// again at once. A sync that recovers from an error tries the threads again.

const RECENT_REPLY_MS = 2 * 60 * 60_000;

/** Where MindRoom's homeserver bundles a thread's newest reply that is not its title. */
const LATEST_REPLY_KEY = 'io.mindroom.latest_reply';

const eligibleReply = (room: Room, thread: Thread): string | undefined => {
  if (thread.initialEventsFetched || room.hasEncryptionStateEvent()) return undefined;
  const held = thread.lastReply(
    (event) => event.isRelation('m.thread') && !isThreadSummaryContent(event.getOriginalContent())
  );
  const relations = thread.rootEvent?.getUnsigned()?.['m.relations'];
  const summary = isRecord(relations) ? relations['m.thread'] : undefined;
  const reply =
    held?.event ??
    (isRecord(summary) ? summary[LATEST_REPLY_KEY] ?? summary.latest_event : undefined);
  if (!isRecord(reply) || typeof reply.event_id !== 'string' || !isRecord(reply.content))
    return undefined;
  if (reply.type === 'm.room.encrypted' || isThreadSummaryContent(reply.content)) return undefined;
  const shown = held ?? thread.replyToEvent;
  const edit = shown?.getId() === reply.event_id ? shown.replacingEvent() : null;
  const revision = (edit?.event ?? getSameSenderBundledEdit(reply))?.content;
  const content = revision && isRecord(revision['m.new_content']) ? revision : reply.content;
  const status = readStreamStatus(content);
  if (hasTerminalStreamMetadata(content) || (status && TERMINAL_STREAM_STATUSES.has(status)))
    return undefined;
  const ts = typeof reply.origin_server_ts === 'number' ? reply.origin_server_ts : 0;
  return Date.now() - ts <= RECENT_REPLY_MS ? reply.event_id : undefined;
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
    const replyId = eligibleReply(room, thread);
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

  wakeStreamingLoads.set(mx, drain);
  const stopRooms = watchRoomThreads(mx, { onThread: consider });
  mx.on(ClientEvent.Sync, onSync);

  return () => {
    stopped = true;
    wakeStreamingLoads.delete(mx);
    stopRooms();
    mx.removeListener(ClientEvent.Sync, onSync);
    queue.splice(0);
  };
};
