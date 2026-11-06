import { MatrixEvent, type IEvent, type Room } from 'matrix-js-sdk';
import { isThreadSummaryEvent } from '../../matrix/protocol/threadSummary';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Detached presentation events: reading a bundle must not load a thread or advance receipts. */
export const getBundledThreadPreviews = (
  room: Room,
  root: MatrixEvent | undefined
): { title?: MatrixEvent; reply?: MatrixEvent } => {
  if (!root || root.getType?.() === 'm.room.encrypted' || room.hasEncryptionStateEvent?.())
    return {};
  const rootId = root.getId();
  const relations: unknown = root.getUnsigned?.()?.['m.relations'];
  const bundle = object(relations) ? relations['m.thread'] : undefined;
  if (!rootId || !object(bundle)) return {};

  const read = (key: string, title: boolean): MatrixEvent | undefined => {
    const raw = bundle[key];
    if (
      !object(raw) ||
      !object(raw.content) ||
      typeof raw.event_id !== 'string' ||
      typeof raw.sender !== 'string' ||
      typeof raw.type !== 'string' ||
      typeof raw.origin_server_ts !== 'number' ||
      !Number.isFinite(raw.origin_server_ts) ||
      raw.state_key !== undefined
    )
      return undefined;
    const relation = raw.content['m.relates_to'];
    if (!object(relation) || relation.rel_type !== 'm.thread' || relation.event_id !== rootId)
      return undefined;
    const known = room.getThread(rootId)?.findEventById(raw.event_id);
    if (known?.isRedacted()) return undefined;
    const event = new MatrixEvent({ ...raw, room_id: room.roomId } as IEvent);
    if (event.isRedacted()) return undefined;
    const replacement: unknown = event.getUnsigned()['m.relations']?.['m.replace'];
    if (object(replacement) && object(replacement.content)) {
      const target = replacement.content['m.relates_to'];
      if (
        replacement.sender === raw.sender &&
        replacement.type === raw.type &&
        typeof replacement.event_id === 'string' &&
        typeof replacement.origin_server_ts === 'number' &&
        Number.isFinite(replacement.origin_server_ts) &&
        object(replacement.content['m.new_content']) &&
        object(target) &&
        target.rel_type === 'm.replace' &&
        target.event_id === raw.event_id
      ) {
        event.makeReplaced(new MatrixEvent({ ...replacement, room_id: room.roomId } as IEvent));
      }
    }
    // Servers authorize titles at event time. Current room power levels cannot repeat that check.
    if (title) return isThreadSummaryEvent(event) ? event : undefined;
    return raw.content['io.mindroom.thread_summary'] ||
      event.getContent()['io.mindroom.thread_summary']
      ? undefined
      : event;
  };
  return { title: read('io.mindroom.title', true), reply: read('io.mindroom.latest_reply', false) };
};

export const getThreadPreviewRevisionTs = (event: MatrixEvent): number =>
  event.replacingEventDate?.()?.getTime() ?? event.getTs();
