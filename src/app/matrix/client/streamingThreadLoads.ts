import { ClientEvent, RelationType, SyncState } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room, Thread } from 'matrix-js-sdk';
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
import { STREAM_IDLE_LIMIT_MS } from './streamingReplies';
import { findReply } from './unopenedThreadEdits';

// A thread holds its replies only once it loads its first page, which the app does when it shows
// or opens the thread. After a reload, a thread whose newest event is its title notice (MindRoom
// posts it while the first reply streams) holds that reply nowhere: the root's summary names the
// title, and only MindRoom's homeserver bundle (`io.mindroom.latest_reply`) still names the reply.
// Its card then says nothing streams, and the thread waits in Needs you until it is opened. So a
// thread whose bundled reply streams loads its first page in the background, one at a time once
// live sync runs. A live streaming edit can also reveal a missing reply that the bundle omits.
// Loading only makes the reply available to the streaming checks; it does not vouch for it.

/** Where MindRoom's homeserver bundles a thread's newest reply that is not its title. */
const LATEST_REPLY_KEY = 'io.mindroom.latest_reply';

const streams = (content: Record<string, unknown>): boolean => {
  const status = readStreamStatus(content);
  return (
    (isAiRunStreaming(content) || (!!status && ACTIVE_STREAM_STATUSES.has(status))) &&
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
  if (!streams(content)) return undefined;
  const ts = Math.max(
    typeof reply.origin_server_ts === 'number' ? reply.origin_server_ts : 0,
    typeof edit?.origin_server_ts === 'number' ? edit.origin_server_ts : 0
  );
  return Date.now() - ts <= STREAM_IDLE_LIMIT_MS ? reply.event_id : undefined;
};

/**
 * Background-loads unopened threads with evidence of a hidden stream. Start before the client
 * starts; the returned function stops the loader.
 */
export const keepStreamingThreadsLoaded = (mx: MatrixClient): (() => void) => {
  const queue: Array<[Room, Thread]> = [];
  const queued = new WeakSet<Thread>();
  /** The bundled-reply path still retries after a sync error. */
  const tried = new WeakMap<Thread, string>();
  const triedTargets = new WeakMap<Thread, Set<string>>();
  const syncEdits: MatrixEvent[] = [];
  const liveEdits = new WeakSet<MatrixEvent>();
  let live = false;
  /** The sync failed since the last server answer: threads tried meanwhile are tried again. */
  let interrupted = false;
  let running = false;
  let stopped = false;

  const pending = (room: Room, thread: Thread): string | undefined => {
    const replyId = hiddenStreamingReply(room, thread);
    if (replyId && tried.get(thread) !== replyId) return replyId;
    const edits = thread.replayEvents;
    if (!edits?.length || thread.initialEventsFetched || room.hasEncryptionStateEvent()) return;
    for (const edit of edits) {
      if (!liveEdits.has(edit) || Date.now() - edit.getTs() > STREAM_IDLE_LIMIT_MS) continue;
      const target = edit.getAssociatedId();
      const content: unknown = edit.getOriginalContent()['m.new_content'];
      if (
        !target ||
        triedTargets.get(thread)?.has(target) ||
        !isRecord(content) ||
        !streams(content)
      )
        continue;
      // SDK replay drops older revisions on arrival, but keeps newer ones on out-of-order sync.
      const superseded = edits.some(
        (other) =>
          other.getTs() > edit.getTs() &&
          other.getAssociatedId() === target &&
          other.getSender() === edit.getSender() &&
          other.isRelation(RelationType.Replace)
      );
      if (!superseded && !findReply(thread, target)) return target;
    }
    return undefined;
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
    const targets = triedTargets.get(thread) ?? new Set<string>();
    targets.add(replyId);
    triedTargets.set(thread, targets);
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

  const onEvent = (event: MatrixEvent) => {
    if (
      event.isRelation(RelationType.Replace) &&
      !event.isState() &&
      isMindroomAgentUserId(event.getSender()) &&
      event.getThread()?.initialEventsFetched === false
    )
      syncEdits.push(event);
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
    if (state !== SyncState.Prepared && state !== SyncState.Syncing) return;
    // ClientEvent.Event precedes the sync notification, even for saved sync. Only a server
    // batch vouches for those exact edit objects, not everything already in replayEvents.
    const edits = syncEdits.splice(0);
    if (data?.fromCache) return;
    const recovered = interrupted;
    interrupted = false;
    live = true;
    edits.forEach((edit) => liveEdits.add(edit));
    if (recovered)
      mx.getRooms().forEach((room) =>
        room.getThreads().forEach((thread) => {
          tried.delete(thread);
          consider(room, thread);
        })
      );
    for (const edit of edits) {
      const thread = edit.getThread();
      if (thread) consider(thread.room, thread);
    }
    drain();
  };

  const stopRooms = watchRoomThreads(mx, { onThread: consider });
  mx.on(ClientEvent.Event, onEvent);
  mx.on(ClientEvent.Sync, onSync);

  return () => {
    stopped = true;
    stopRooms();
    mx.removeListener(ClientEvent.Event, onEvent);
    mx.removeListener(ClientEvent.Sync, onSync);
    syncEdits.splice(0);
    queue.splice(0);
  };
};
