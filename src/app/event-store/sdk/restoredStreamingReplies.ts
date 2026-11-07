import {
  ClientEvent,
  RelationType,
  ThreadEvent,
  type IEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import {
  ACTIVE_STREAM_STATUSES,
  getStreamStatusFromContent,
  TERMINAL_STREAM_STATUSES,
} from '../../matrix/protocol/aiRun';
import { createSessionId } from '../../matrix/session/sessions';
import {
  createPreferLiveEventMapper,
  loadCachedRoomEvent,
  loadCachedThreadEvent,
} from '../cache/eventRepository';

// The SDK saves its sync after the first sync of a session and then about every five minutes, so a
// reload restores a streaming reply as it was then: often its "Thinking" placeholder, and in a
// thread nobody opened without the edits that came after the save. The event cache saves each
// reply's newest edit within seconds. A thread opened after the reload painted the restored
// placeholder until its cache read or the server answered (415 to 570 ms in one run of three), and
// a card showed it as long as its thread stayed closed.
//
// So the replies the saved sync holds as still streaming are read from the event cache while the
// client's stores open, and each restored reply takes the cache's newer revision as soon as the
// saved sync is replayed, before the app shows any room. In a thread nobody opened, the cached
// edit joins the edits the thread holds back (`replayEvents`): `unopenedThreadEdits.ts` shows the
// newest of them on every update of the thread, also after the SDK maps an older summary of the
// reply again (a root's bundled latest reply, which puts its older edit back on the reply), and
// the SDK replays them when the thread opens.

type SavedEvent = Partial<IEvent> & { unsigned?: { 'm.relations'?: Record<string, unknown> } };

/** The SDK's sync accumulator: the saved timeline of each joined room. */
type SavedSync = { joinRooms?: Record<string, { _timeline?: { event: SavedEvent }[] }> };

/** A reply of the saved sync; `threadId` names the thread whose cache scope holds it. */
type SavedReply = { roomId: string; eventId: string; threadId?: string };

type SavedCopy = { roomId: string; threadId?: string; raw: Partial<IEvent> };

const savedSyncOf = (mx: MatrixClient): SavedSync | undefined =>
  (mx.store as unknown as { backend?: { syncAccumulator?: SavedSync } }).backend?.syncAccumulator;

const streamStatusOf = (content: unknown): string | undefined =>
  content && typeof content === 'object'
    ? getStreamStatusFromContent(content as Record<string, unknown>)
    : undefined;

/** The id of the event `event` relates to with `relType`, if it does. */
const relatedId = (event: SavedEvent, relType: string): string | undefined => {
  const relation = event.content?.['m.relates_to'] as
    | { rel_type?: string; event_id?: unknown }
    | undefined;
  return relation?.rel_type === relType && typeof relation.event_id === 'string'
    ? relation.event_id
    : undefined;
};

/**
 * The replies of the saved sync that no revision it holds (the reply, an edit bundled with it, or
 * an edit in its room's saved timeline) shows finished, while one shows them streaming.
 */
export const findSavedStreamingReplies = (sync: SavedSync | undefined): SavedReply[] =>
  Object.entries(sync?.joinRooms ?? {}).flatMap(([roomId, room]) => {
    const replies = new Map<string, string | undefined>();
    const streaming = new Set<string>();
    const finished = new Set<string>();
    const note = (eventId: string, status: string | undefined) => {
      if (status && ACTIVE_STREAM_STATUSES.has(status)) streaming.add(eventId);
      if (status && TERMINAL_STREAM_STATUSES.has(status)) finished.add(eventId);
    };
    (room._timeline ?? []).forEach(({ event }) => {
      const target = relatedId(event, RelationType.Replace);
      if (target) {
        note(target, streamStatusOf(event.content));
        return;
      }
      const eventId = event.event_id;
      if (typeof eventId !== 'string') return;
      replies.set(eventId, relatedId(event, RelationType.Thread));
      note(eventId, streamStatusOf(event.content));
      const bundled = event.unsigned?.['m.relations']?.[RelationType.Replace] as
        | SavedEvent
        | undefined;
      note(eventId, streamStatusOf(bundled?.content));
    });
    return [...replies]
      .filter(([eventId]) => streaming.has(eventId) && !finished.has(eventId))
      .map(([eventId, threadId]) => ({ roomId, eventId, ...(threadId ? { threadId } : {}) }));
  });

/**
 * Adds the edit bundled with a cached reply to the edits its unopened thread holds back, and
 * announces the thread so the newest of them shows. Returns false when the thread has opened (or
 * is unknown), or the copy carries no edit.
 */
const holdBackInUnopenedThread = (
  mx: MatrixClient,
  room: Room,
  threadId: string | undefined,
  raw: SavedEvent
): boolean => {
  const thread = threadId ? room.getThread(threadId) : null;
  const edit = raw.unsigned?.['m.relations']?.[RelationType.Replace] as SavedEvent | undefined;
  if (!thread || thread.initialEventsFetched || !thread.replayEvents || !edit?.event_id) {
    return false;
  }
  if (!thread.replayEvents.some((held) => held.getId() === edit.event_id)) {
    thread.replayEvents.push(mx.getEventMapper()({ ...edit, room_id: room.roomId }));
  }
  thread.emit(ThreadEvent.Update, thread);
  return true;
};

/**
 * Reads the cache's copy of every reply the client's saved sync holds as still streaming, and has
 * the SDK's restored reply take the newer revision when the saved sync is replayed. Call it after
 * the sync store started and before the client starts; it never rejects.
 */
export const restoreStreamingRepliesFromCache = async (mx: MatrixClient): Promise<void> => {
  try {
    const replies = findSavedStreamingReplies(savedSyncOf(mx));
    if (replies.length === 0) return;
    const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
    // A reply's copy can be in its thread's scope, in the room's, or in both; the merge below keeps
    // the newest of them.
    const reads = replies.flatMap(({ roomId, eventId, threadId }) => {
      const scopes: Promise<Partial<IEvent> | undefined>[] = [
        loadCachedRoomEvent(sessionId, roomId, eventId),
        ...(threadId ? [loadCachedThreadEvent(sessionId, roomId, threadId, eventId)] : []),
      ];
      return scopes.map((read) =>
        read.then(
          (raw): SavedCopy | undefined => (raw ? { roomId, threadId, raw } : undefined),
          () => undefined
        )
      );
    });
    const copies = (await Promise.all(reads)).filter(
      (copy): copy is SavedCopy => copy !== undefined
    );
    if (copies.length === 0) return;
    // The SDK replays the saved sync before its first sync state; the rooms show after that.
    mx.once(ClientEvent.Sync, () => {
      copies.forEach(({ roomId, threadId, raw }) => {
        const room = mx.getRoom(roomId);
        if (!room || !raw.event_id || !room.findEventById(raw.event_id)) return;
        try {
          if (!holdBackInUnopenedThread(mx, room, threadId, raw)) {
            // The same merge a thread's cache read makes: the newer revision wins, never an older.
            createPreferLiveEventMapper(room, mx.getEventMapper())({ ...raw, room_id: roomId });
          }
        } catch {
          // A copy that cannot be merged leaves the reply as the saved sync had it.
        }
      });
    });
  } catch {
    // Without the cache, the replies show as the saved sync had them until the server answers.
  }
};
