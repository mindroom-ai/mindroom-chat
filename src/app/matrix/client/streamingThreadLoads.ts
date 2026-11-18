import { ClientEvent, SyncState, type MatrixClient, type Room, type Thread } from 'matrix-js-sdk';
import {
  ACTIVE_STREAM_STATUSES,
  hasTerminalStreamMetadata,
  isAiRunStreaming,
  readStreamStatus,
} from '../protocol/aiRun';
import { getSameSenderBundledEdit } from '../editEvent';
import { isRecord } from '../../lib/isRecord';
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
  if (!streams || hasTerminalStreamMetadata(content)) return undefined;
  const ts = Math.max(
    typeof reply.origin_server_ts === 'number' ? reply.origin_server_ts : 0,
    typeof edit?.origin_server_ts === 'number' ? edit.origin_server_ts : 0
  );
  return Date.now() - ts <= STREAM_IDLE_LIMIT_MS ? reply.event_id : undefined;
};

/**
 * Loads the first page of each unopened thread whose bundled reply streams, for the client's whole
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

  const stopRooms = watchRoomThreads(mx, { onThread: consider });
  mx.on(ClientEvent.Sync, onSync);

  return () => {
    stopped = true;
    stopRooms();
    mx.removeListener(ClientEvent.Sync, onSync);
    queue.splice(0);
  };
};
