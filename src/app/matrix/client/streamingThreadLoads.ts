import { ClientEvent, type IEvent, type MatrixClient, type Room, type Thread } from 'matrix-js-sdk';
import { ACTIVE_STREAM_STATUSES, getStreamStatusFromContent } from '../protocol/aiRun';
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
// the live sync runs; the streaming checks then see the reply as they see any other.

/** Where MindRoom's homeserver bundles a thread's newest reply that is not its title. */
const LATEST_REPLY_KEY = 'io.mindroom.latest_reply';

/** The root's bundled reply, when it streams, is not the summary's newest event, and is not idle. */
const hasHiddenStreamingReply = (thread: Thread): boolean => {
  const relations = thread.rootEvent?.getUnsigned()?.['m.relations'];
  const summary = isRecord(relations) ? relations['m.thread'] : undefined;
  if (!isRecord(summary)) return false;
  const reply = summary[LATEST_REPLY_KEY];
  const latest = summary.latest_event;
  if (!isRecord(reply) || typeof reply.event_id !== 'string') return false;
  // The summary's own reply is the thread's to show: the streaming checks read it.
  if (isRecord(latest) && latest.event_id === reply.event_id) return false;
  // A loaded thread holds the reply; initialize() does nothing for it.
  if (thread.findEventById(reply.event_id)) return false;
  const edit = getSameSenderBundledEdit(reply);
  const newest = (edit ?? reply) as Partial<IEvent>;
  const status = getStreamStatusFromContent(isRecord(newest.content) ? newest.content : {});
  const ts = Math.max(
    typeof reply.origin_server_ts === 'number' ? reply.origin_server_ts : 0,
    typeof edit?.origin_server_ts === 'number' ? edit.origin_server_ts : 0
  );
  return !!status && ACTIVE_STREAM_STATUSES.has(status) && Date.now() - ts <= STREAM_IDLE_LIMIT_MS;
};

/**
 * Loads the first page of each unopened thread whose bundled reply streams, for the client's whole
 * life; call it before the client starts. Returns a function that stops it.
 */
export const keepStreamingThreadsLoaded = (mx: MatrixClient): (() => void) => {
  const queue: Thread[] = [];
  const queued = new WeakSet<Thread>();
  let live = false;
  let running = false;
  let stopped = false;

  const drain = () => {
    if (stopped || !live || running) return;
    const thread = queue.shift();
    if (!thread) return;
    queued.delete(thread);
    if (!hasHiddenStreamingReply(thread)) {
      drain();
      return;
    }
    running = true;
    void Promise.resolve(thread.initialize())
      .catch(() => undefined)
      .finally(() => {
        running = false;
        drain();
      });
  };

  const consider = (_room: Room, thread: Thread) => {
    if (queued.has(thread) || !hasHiddenStreamingReply(thread)) return;
    queued.add(thread);
    queue.push(thread);
    drain();
  };

  const onSync = (_state: unknown, _previous: unknown, data?: { fromCache?: boolean }) => {
    // The saved sync replays first; loading waits for the server's own answer.
    if (live || data?.fromCache) return;
    live = true;
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
