import { ClientEvent, RelationType, type IEvent, type MatrixClient } from 'matrix-js-sdk';
import {
  ACTIVE_STREAM_STATUSES,
  getStreamStatusFromContent,
  TERMINAL_STREAM_STATUSES,
} from '../../matrix/protocol/aiRun';
import { getSameSenderBundledEdit } from '../../matrix/editEvent';
import { createSessionId } from '../../matrix/session/sessions';
import {
  createPreferLiveEventMapper,
  loadCachedRoomEvent,
  loadCachedThreadEvent,
} from '../cache/eventRepository';

type SavedEvent = Partial<IEvent>;
type SavedSync = { joinRooms?: Record<string, { _timeline?: { event: SavedEvent }[] }> };
type SavedReply = { roomId: string; eventId: string; threadId?: string };

const statusOf = (content: unknown): string | undefined =>
  content && typeof content === 'object'
    ? getStreamStatusFromContent(content as Record<string, unknown>)
    : undefined;

const relatedId = (event: SavedEvent, relType: string): string | undefined => {
  const rel = event.content?.['m.relates_to'] as
    | { rel_type?: string; event_id?: unknown }
    | undefined;
  return rel?.rel_type === relType && typeof rel.event_id === 'string' ? rel.event_id : undefined;
};

/** Saved-sync replies still holding an in-progress revision whose newer text may be in cache. */
export const findPendingCachedReplies = (sync: SavedSync | undefined): SavedReply[] =>
  Object.entries(sync?.joinRooms ?? {}).flatMap(([roomId, room]) => {
    const timeline = (room._timeline ?? []).map(({ event }) => event);
    const senders = new Map(timeline.map((event) => [event.event_id, event.sender]));
    const replies = new Map<string, string | undefined>();
    const active = new Set<string>();
    const finished = new Set<string>();
    const note = (id: string, status: string | undefined) => {
      if (status && ACTIVE_STREAM_STATUSES.has(status)) active.add(id);
      if (status && TERMINAL_STREAM_STATUSES.has(status)) finished.add(id);
    };
    timeline.forEach((event) => {
      const target = relatedId(event, RelationType.Replace);
      if (target) {
        if (senders.get(target) === event.sender) note(target, statusOf(event.content));
        return;
      }
      if (typeof event.event_id !== 'string') return;
      replies.set(event.event_id, relatedId(event, RelationType.Thread));
      note(event.event_id, statusOf(event.content));
      note(event.event_id, statusOf(getSameSenderBundledEdit(event)?.content));
    });
    return [...replies]
      .filter(([id]) => active.has(id) && !finished.has(id))
      .map(([eventId, threadId]) => ({ roomId, eventId, ...(threadId ? { threadId } : {}) }));
  });

/**
 * Overlays newer cached reply text over placeholder revisions restored from the SDK's saved sync,
 * before the first room renders. Never rejects.
 */
export const restoreCachedReplies = async (mx: MatrixClient): Promise<void> => {
  try {
    const sync = (mx.store as unknown as { backend?: { syncAccumulator?: SavedSync } }).backend
      ?.syncAccumulator;
    const replies = findPendingCachedReplies(sync);
    if (replies.length === 0) return;
    const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
    const copies = (
      await Promise.all(
        replies.flatMap(({ roomId, eventId, threadId }) =>
          [
            loadCachedRoomEvent(sessionId, roomId, eventId),
            ...(threadId ? [loadCachedThreadEvent(sessionId, roomId, threadId, eventId)] : []),
          ].map((read) =>
            read.then(
              (raw) => (raw ? { roomId, raw } : undefined),
              () => undefined
            )
          )
        )
      )
    ).filter((copy): copy is NonNullable<typeof copy> => copy !== undefined);
    if (copies.length === 0) return;
    mx.once(ClientEvent.Sync, () => {
      copies.forEach(({ roomId, raw }) => {
        const room = mx.getRoom(roomId);
        if (!room || !raw.event_id || !room.findEventById(raw.event_id)) return;
        try {
          createPreferLiveEventMapper(room, mx.getEventMapper())({ ...raw, room_id: roomId });
        } catch {
          // Leave the saved-sync reply as-is if the cached copy cannot be merged.
        }
      });
    });
  } catch {
    // Without cache access, saved-sync replies render as stored until /sync catches up.
  }
};
