import type { IEvent, MatrixEvent, Room } from 'matrix-js-sdk';

type EventMapper = (rawEvent: IEvent) => MatrixEvent;

/** Keeps the event's thread id, but takes it off the thread's listeners. */
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
 * pages a thread's card takes its preview and time from. The SDK attaches every event it creates
 * to the room's thread for it, and the thread then keeps the event through a listener for good:
 * one event per thread at every visit of a room's Compact view. A mapped event the room does not
 * hold (and an edit bundled with it) keeps its thread id and leaves the thread alone, and one it
 * holds keeps its thread summary (`keepHeldThreadSummaries`).
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
