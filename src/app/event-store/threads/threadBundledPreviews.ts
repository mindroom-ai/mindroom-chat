import { MatrixEvent, type IEvent, type Room } from 'matrix-js-sdk';
import { getSameSenderBundledEdit } from '../../matrix/editEvent';
import { isKnownRedactedEventId } from '../../matrix/eventRevision';
import { isThreadSummaryEvent } from '../../matrix/protocol/threadSummary';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Detached presentation events: reading a bundle must not load a thread or advance receipts. */
export const getBundledThreadPreviews = (
  room: Room,
  root: MatrixEvent | undefined
): {
  title?: MatrixEvent;
  reply?: MatrixEvent;
  /** The bundle's own latest thread event and its revision time: when the server sorted it. */
  latest?: { id: string; ts: number };
} => {
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
    // As the server sorts them: any sender's m.notice whose own content has a truthy marker is a
    // title, every other thread event a reply. A marker added only by an edit makes no title.
    const marked =
      raw.content.msgtype === 'm.notice' && !!raw.content['io.mindroom.thread_summary'];
    if (marked !== title) return undefined;
    const known = room.getThread(rootId)?.findEventById(raw.event_id);
    if (known?.isRedacted()) return undefined;
    const event = new MatrixEvent({ ...raw, room_id: room.roomId } as IEvent);
    if (event.isRedacted()) return undefined;
    const replacement: unknown = event.getUnsigned()['m.relations']?.['m.replace'];
    // A root's summary keeps the edits of its events as the server sent them: the room may hold
    // one as an event and have redacted it since, and a copy of the root the room does not hold
    // keeps every edit (eventRevision.ts).
    if (object(replacement) && object(replacement.content)) {
      const target = replacement.content['m.relates_to'];
      if (
        replacement.sender === raw.sender &&
        replacement.type === raw.type &&
        typeof replacement.event_id === 'string' &&
        !isKnownRedactedEventId(room, replacement.event_id) &&
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
    // The client's own title rule reads the edited content, as it does for loaded events.
    return isThreadSummaryEvent(event) === title ? event : undefined;
  };
  const latest = bundle.latest_event;
  const editTs = object(latest) ? getSameSenderBundledEdit(latest)?.origin_server_ts : undefined;
  const latestTs =
    object(latest) && typeof latest.origin_server_ts === 'number'
      ? Math.max(latest.origin_server_ts, typeof editTs === 'number' ? editTs : -Infinity)
      : undefined;
  return {
    title: read('io.mindroom.title', true),
    reply: read('io.mindroom.latest_reply', false),
    ...(object(latest) && typeof latest.event_id === 'string' && latestTs !== undefined
      ? { latest: { id: latest.event_id, ts: latestTs } }
      : {}),
  };
};

export const getThreadPreviewRevisionTs = (event: MatrixEvent): number =>
  event.replacingEventDate?.()?.getTime() ?? event.getTs();
