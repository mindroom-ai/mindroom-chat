import type { IEvent, MatrixEvent, Room } from 'matrix-js-sdk';

type EventMapper = (rawEvent: IEvent) => MatrixEvent;

/** Keeps the event's thread id, but points the event at no thread. */
const detachFromThread = (event: MatrixEvent): void => {
  const thread = event.getThread();
  if (!thread) return;
  event.setThread(undefined);
  event.setThreadId(thread.id);
};

const threadSummaryOf = (event: MatrixEvent): unknown =>
  event.getUnsigned()['m.relations']?.['m.thread'];

/**
 * Wraps an event mapper for cached copies so that an event the room holds keeps its own thread
 * summary. For such an event the SDK's mapper hands back the room's own event with the copy's
 * unsigned written into it, and the event cache's merge keeps the larger count. A cached root's
 * summary can date from before a reply it counts was redacted, while the room's root no longer
 * counts that reply, so the room's root keeps its summary; everything else the copy brings is
 * applied as before.
 */
export const keepHeldThreadSummaries =
  <Raw extends Partial<IEvent>>(room: Room, mapper: (rawEvent: Raw) => MatrixEvent) =>
  (rawEvent: Raw): MatrixEvent => {
    const held = rawEvent.event_id ? room.findEventById(rawEvent.event_id) : undefined;
    const heldSummary = held && threadSummaryOf(held);
    const event = mapper(rawEvent);
    if (held && event === held && heldSummary && threadSummaryOf(held) !== heldSummary) {
      const unsigned = held.getUnsigned();
      held.setUnsigned({
        ...unsigned,
        'm.relations': { ...unsigned['m.relations'], 'm.thread': heldSummary },
      });
    }
    return event;
  };

/**
 * Wraps the SDK's event mapper for events that are only read and then dropped, such as cached
 * pages a thread's card takes its preview and time from. The SDK points every event it creates at
 * the room's thread for it (`setThread`), so a copy would answer `getThread()` with the live
 * thread as if it were one of the thread's events. A mapped event the room does not hold (and an
 * edit bundled with it) keeps its thread id and points at no thread, and one it holds keeps its
 * thread summary (`keepHeldThreadSummaries`).
 */
export const readOnlyEventMapper = (room: Room, mapper: EventMapper): EventMapper => {
  const keepSummaries = keepHeldThreadSummaries(room, mapper);
  return (rawEvent) => {
    const event = keepSummaries(rawEvent);
    [event, event.replacingEvent()].forEach((mapped) => {
      const eventId = mapped?.getId();
      if (mapped && eventId && room.findEventById(eventId) !== mapped) detachFromThread(mapped);
    });
    return event;
  };
};
