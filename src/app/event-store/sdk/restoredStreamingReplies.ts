import { ClientEvent, MatrixEventEvent, RelationType, RoomEvent, ThreadEvent, type IEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import {
  ACTIVE_STREAM_STATUSES,
  getStreamStatusFromContent,
  TERMINAL_STREAM_STATUSES,
} from '../../matrix/protocol/aiRun';
import { holdCachedEditInUnopenedThread } from '../../matrix/client/unopenedThreadEdits';
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
// saved sync is replayed, before the app shows any room. In a thread nobody opened, the edit the
// reply then shows also counts among the edits the thread holds back (`unopenedThreadEdits.ts`),
// which every update of the thread puts back on the reply newest first: the SDK maps older copies
// of a reply onto it again (a root's bundled latest reply, read from a thread list mid-stream), and
// its event mapper applies such a copy's older edit.

type SavedEvent = Partial<IEvent> & { unsigned?: { 'm.relations'?: Record<string, unknown> } };

/** The SDK's sync accumulator: the saved timeline of each joined room. */
type SavedSync = { joinRooms?: Record<string, { _timeline?: { event: SavedEvent }[] }> };

/** A reply of the saved sync; `threadId` names the thread whose cache scope holds it. */
type SavedReply = { roomId: string; eventId: string; threadId?: string };

type SavedCopy = { roomId: string; threadId?: string; raw: Partial<IEvent> };


const dw = (e: MatrixEvent | undefined | null) => (String(e?.getContent()?.body ?? '').match(/word\d+/g) ?? []).length;
const dst = () => (new Error().stack ?? '').split('\n').slice(2, 9).map((l) => l.trim().replace(/^.*\/assets\//, '').slice(0, 40)).join(' < ');
// eslint-disable-next-line no-console
const dlog = (m: string) => console.info(`[restore-diag] t=${Math.round(performance.now())} ${m}`);
const installDiag = (mx: MatrixClient) => {
  const id = (window as unknown as { __diagReplyId?: string }).__diagReplyId;
  if (!id) return;
  const watched = new WeakSet<MatrixEvent>();
  const watch = (ev: MatrixEvent, how: string) => {
    if (ev.getId() !== id || watched.has(ev)) return;
    watched.add(ev);
    dlog(`seen ${how} words=${dw(ev)} status=${ev.status} ${dst()}`);
    ev.on(MatrixEventEvent.Replaced, () => dlog(`replaced inst=${how} words=${dw(ev)} edit=${ev.replacingEvent()?.getId()?.slice(0, 8)} ${dst()}`));
  };
  mx.on(ClientEvent.Event, (ev) => watch(ev, 'client-event'));
  mx.on(RoomEvent.Timeline, (ev) => watch(ev, 'timeline'));
  mx.on(ThreadEvent.NewReply, (_t, ev) => watch(ev, 'new-reply'));
  mx.once(ClientEvent.Sync, (state) => {
    mx.getRooms().forEach((room) => {
      const ev = room.findEventById(id);
      dlog(`first-sync ${state} found=${!!ev} words=${dw(ev)} threads=${room.getThreads().length}`);
      if (ev) watch(ev, 'first-sync');
      room.getThreads().forEach((th) => {
        if (th.replyToEvent?.getId() === id) { dlog(`summary words=${dw(th.replyToEvent)}`); watch(th.replyToEvent, 'summary'); }
      });
    });
  });
};
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
 * Reads the cache's copy of every reply the client's saved sync holds as still streaming, and has
 * the SDK's restored reply take the newer revision when the saved sync is replayed. Call it after
 * the sync store started and before the client starts; it never rejects.
 */
export const restoreStreamingRepliesFromCache = async (mx: MatrixClient): Promise<void> => {
  try {
    installDiag(mx);
    const replies = findSavedStreamingReplies(savedSyncOf(mx));
    dlog(`candidates ${replies.length}`);
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
          const mapEvent = createPreferLiveEventMapper(room, mx.getEventMapper());
          // The same merge a thread's cache read makes: the newer revision wins, never an older.
          const reply = mapEvent({ ...raw, room_id: roomId });
          const thread = threadId ? room.getThread(threadId) : null;
          const edit = reply.replacingEvent();
          dlog(`applied words=${dw(reply)} thread=${!!thread}`);
          if (thread && edit) holdCachedEditInUnopenedThread(thread, edit);
        } catch {
          // A copy that cannot be merged leaves the reply as the saved sync had it.
        }
      });
    });
  } catch {
    // Without the cache, the replies show as the saved sync had them until the server answers.
  }
};
