import { useEffect } from 'react';
import {
  ClientEvent,
  Direction,
  EventType,
  MatrixEventEvent,
  RelationType,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { createSessionId } from '../../state/sessions';
import { isRecord } from '../../utils/isRecord';
import { isEventOrderedAfter } from '../../utils/room';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import {
  CHAT_UI_ACTION_KEY,
  readCanvasEdit,
  readCanvasVersion,
  readChatUiAction,
} from '../ui-actions/chatUiProtocol';
import {
  type CanvasListEntry,
  forgetCanvas,
  listCanvases,
  recordCanvas,
  recordCanvasUpdate,
  replaceDeletedVersion,
} from './canvasIndexStore';

export const canvasSessionId = (mx: MatrixClient): string =>
  createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());

/**
 * Lists a canvas made for this user, applies an update of a listed one, or forgets a deleted one;
 * other events are ignored. Updates and deletions can arrive long after their canvas left memory,
 * where no timeline takes them, so they are applied to the listed entry.
 */
export const recordCanvasEvent = (
  mx: MatrixClient,
  event: MatrixEvent
): Promise<void> | undefined => {
  const sender = event.getSender();
  const eventId = event.getId();
  if (!sender || !eventId?.startsWith('$')) return undefined;
  // Only deletions that may be of a canvas reach the store: agents delete a reaction after every reply.
  const maybeCanvas = (deleted: MatrixEvent) =>
    deleted.getType() === EventType.RoomMessage &&
    isMindroomAgentUserIdForViewer(deleted.getSender() ?? '', mx.getSafeUserId());
  // A canvas can also turn up already deleted, in history loaded after a missed deletion.
  if (event.isRedacted()) return maybeCanvas(event) ? forgetDeleted(mx, eventId) : undefined;
  if (event.isRedaction()) {
    const redacted = event.event.redacts ?? event.getContent().redacts;
    if (typeof redacted !== 'string') return undefined;
    const target = mx.getRoom(event.getRoomId())?.findEventById(redacted);
    return !target || maybeCanvas(target) ? forgetDeleted(mx, redacted) : undefined;
  }
  const content = event.getOriginalContent<Record<string, unknown>>();
  const relation = event.getRelation();
  if (relation?.rel_type === RelationType.Replace) {
    const newContent = content['m.new_content'];
    // Only canvas updates reach the store; agents stream many other edits.
    if (!relation.event_id || !isRecord(newContent) || !isRecord(newContent[CHAT_UI_ACTION_KEY])) {
      return undefined;
    }
    // The panel's rule for an update, held against the authority the listed request carries.
    return recordCanvasUpdate(canvasSessionId(mx), relation.event_id, event.getTs(), (known) => {
      const version = readCanvasEdit(event, known.agentUserId, {
        version: 1,
        action: 'show_canvas',
        requester_id: mx.getSafeUserId(),
        agent_user_id: known.agentUserId,
        room_id: known.roomId,
        thread_id: known.threadId ?? null,
        ...(known.shared ? { share_state: true } : {}),
      });
      return version && { title: version.canvas.title, revisionId: version.revisionEventId };
    });
  }
  if (!isRecord(content[CHAT_UI_ACTION_KEY])) return undefined;
  const entry = readCanvasEntry(mx, event);
  return entry && recordCanvas(canvasSessionId(mx), entry);
};

/** The row for a canvas request made for this user, at the version it shows. */
const readCanvasEntry = (mx: MatrixClient, event: MatrixEvent): CanvasListEntry | undefined => {
  const room = mx.getRoom(event.getRoomId());
  const action = room ? readChatUiAction(event, mx.getSafeUserId(), room) : undefined;
  if (!room || action?.action !== 'show_canvas') return undefined;
  const shown = action.revisionEventId === action.eventId ? event : event.replacingEvent();
  return {
    canvasId: action.eventId,
    roomId: room.roomId,
    ...(action.threadId ? { threadId: action.threadId } : {}),
    agentUserId: action.agentUserId,
    title: action.canvas.title,
    revisionId: action.revisionEventId,
    createdTs: event.getTs(),
    updatedTs: shown?.getTs() ?? event.getTs(),
    shared: !!action.shareState,
  };
};

/**
 * A deleted canvas leaves the list; a deleted update that a row shows falls back to the canvas's
 * surviving version (Element can remove one version from a message's edit history).
 */
const forgetDeleted = async (mx: MatrixClient, deletedId: string): Promise<void> => {
  const sessionId = canvasSessionId(mx);
  await forgetCanvas(sessionId, deletedId);
  const shown = (await listCanvases(sessionId)).find((entry) => entry.revisionId === deletedId);
  const room = shown && mx.getRoom(shown.roomId);
  const canvas = room ? await loadCanvasEvent(mx, room, shown.canvasId) : undefined;
  const entry = canvas && readCanvasEntry(mx, canvas);
  // Only while the row still shows the deleted version: a newer update or a deletion may have
  // come in while the canvas loaded.
  if (entry) await replaceDeletedVersion(sessionId, deletedId, entry);
};

/** Keeps the Canvases page's list current with every canvas this client sees, on any route. */
export function useCanvasIndexRecorder(mx: MatrixClient, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const onEvent = (event: MatrixEvent) => {
      recordCanvasEvent(mx, event)?.catch(() => undefined);
    };
    // Canvases loaded before this started (the cached sync) are in the timelines already.
    mx.getRooms().forEach((room) => {
      room.getLiveTimeline().getEvents().forEach(onEvent);
      room.getThreads().forEach((thread) => thread.events.forEach(onEvent));
    });
    // Sync reports every event, also one about a canvas whose thread is not loaded, which no
    // timeline takes; timelines add the events loaded later (history, threads opened).
    mx.on(ClientEvent.Event, onEvent);
    mx.on(RoomEvent.Timeline, onEvent);
    mx.on(MatrixEventEvent.Decrypted, onEvent);
    mx.on(MatrixEventEvent.Replaced, onEvent);
    return () => {
      mx.off(ClientEvent.Event, onEvent);
      mx.off(RoomEvent.Timeline, onEvent);
      mx.off(MatrixEventEvent.Decrypted, onEvent);
      mx.off(MatrixEventEvent.Replaced, onEvent);
    };
  }, [mx, enabled]);
}

/**
 * A canvas request by ID: the loaded copy, or else the server's with its newest valid update
 * applied, so a canvas from long ago still opens at its latest version.
 */
export const loadCanvasEvent = async (
  mx: MatrixClient,
  room: Room,
  canvasId: string
): Promise<MatrixEvent | undefined> => {
  const loaded = room.findEventById(canvasId);
  if (loaded) return loaded;
  try {
    // The SDK decrypts both in encrypted rooms and drops edits by anyone but the request's sender.
    const { originalEvent, events } = await mx.relations(
      room.roomId,
      canvasId,
      RelationType.Replace,
      EventType.RoomMessage,
      { dir: Direction.Backward, limit: 50 }
    );
    if (!originalEvent) return undefined;
    const newest = events
      .filter((edit) => readCanvasVersion(originalEvent, edit))
      .reduce<MatrixEvent | undefined>(
        (latest, edit) => (!latest || isEventOrderedAfter(edit, latest) ? edit : latest),
        undefined
      );
    if (newest) originalEvent.makeReplaced(newest);
    return originalEvent;
  } catch {
    return undefined;
  }
};
