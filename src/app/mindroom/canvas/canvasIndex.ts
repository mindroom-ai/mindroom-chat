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
import {
  CHAT_UI_ACTION_KEY,
  readCanvas,
  readCanvasVersion,
  readChatUiAction,
} from '../ui-actions/chatUiProtocol';
import { forgetCanvas, recordCanvas, recordCanvasUpdate } from './canvasIndexStore';

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
  if (!sender || event.isRedacted() || !event.getId()?.startsWith('$')) {
    return undefined;
  }
  if (event.isRedaction()) {
    const redacted = event.event.redacts ?? event.getContent().redacts;
    return typeof redacted === 'string' ? forgetCanvas(canvasSessionId(mx), redacted) : undefined;
  }
  const content = event.getOriginalContent<Record<string, unknown>>();
  const relation = event.getRelation();
  if (relation?.rel_type === RelationType.Replace) {
    const newContent = content['m.new_content'];
    const update = isRecord(newContent) ? newContent[CHAT_UI_ACTION_KEY] : undefined;
    const canvas = isRecord(update) && update.action === 'show_canvas' && readCanvas(update.canvas);
    if (!canvas || !relation.event_id) return undefined;
    return recordCanvasUpdate(
      canvasSessionId(mx),
      relation.event_id,
      sender,
      canvas.title,
      event.getTs()
    );
  }
  if (!isRecord(content[CHAT_UI_ACTION_KEY])) return undefined;
  const room = mx.getRoom(event.getRoomId());
  const action = room ? readChatUiAction(event, mx.getSafeUserId(), room) : undefined;
  if (!room || action?.action !== 'show_canvas') return undefined;
  const shown = action.revisionEventId === action.eventId ? event : event.replacingEvent();
  return recordCanvas(canvasSessionId(mx), {
    canvasId: action.eventId,
    roomId: room.roomId,
    ...(action.threadId ? { threadId: action.threadId } : {}),
    agentUserId: action.agentUserId,
    title: action.canvas.title,
    createdTs: event.getTs(),
    updatedTs: shown?.getTs() ?? event.getTs(),
    shared: !!action.shareState,
  });
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
