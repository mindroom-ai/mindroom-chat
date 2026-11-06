import type { IEvent, MatrixEvent, Room } from 'matrix-js-sdk';

type EventMapper = (rawEvent: IEvent) => MatrixEvent;

/** Keeps the event's thread id, but takes it off the thread's listeners. */
const detachFromThread = (event: MatrixEvent): void => {
  const thread = event.getThread();
  if (!thread) return;
  event.setThread(undefined);
  event.setThreadId(thread.id);
};

/**
 * Wraps the SDK's event mapper for events that are only read and then dropped, such as cached
 * pages a thread's card takes its preview and time from. The SDK attaches every event it creates
 * to the room's thread for it, and the thread then keeps the event through a listener for good:
 * one event per thread at every visit of a room's Compact view. A mapped event the room does not
 * hold (and an edit bundled with it) keeps its thread id and leaves the thread alone.
 */
export const readOnlyEventMapper =
  (room: Room, mapper: EventMapper): EventMapper =>
  (rawEvent) => {
    const event = mapper(rawEvent);
    [event, event.replacingEvent()].forEach((mapped) => {
      const eventId = mapped?.getId();
      if (mapped && eventId && room.findEventById(eventId) !== mapped) detachFromThread(mapped);
    });
    return event;
  };
