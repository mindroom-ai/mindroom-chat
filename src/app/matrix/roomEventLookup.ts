import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';

// A room's lookups of events, kept until the task ends. The room's lookup of an event it does not
// hold searches every thread, and the views of a room's threads ask for events no timeline keeps
// once per thread: the event a receipt names, often a reply's terminal edit, or the edit bundled
// with a thread's newest reply. A room of hundreds of threads searched them all hundreds of times
// on every streamed edit.
type RoomLookups = {
  found: Map<string, MatrixEvent | undefined>;
  /** Every event the room's threads hold, by ID, read once on the first miss. */
  inThreads?: Map<string, MatrixEvent>;
};
let lookups: WeakMap<Room, RoomLookups> | undefined;

const readThreadEvents = (room: Room): Map<string, MatrixEvent> => {
  const events = new Map<string, MatrixEvent>();
  room.getThreads().forEach((thread) =>
    thread.timelineSet.getTimelines().forEach((timeline) =>
      timeline.getEvents().forEach((event) => {
        const eventId = event.getId();
        // The first thread that holds it, as `Room.findEventById` finds it.
        if (eventId && !events.has(eventId)) events.set(eventId, event);
      })
    )
  );
  return events;
};

const lookUp = (room: Room, roomLookups: RoomLookups, eventId: string): MatrixEvent | undefined => {
  // Room stand-ins in tests often hold their events only through `findEventById`.
  const main = room.getUnfilteredTimelineSet?.();
  if (typeof room.getThreads !== 'function' || typeof main?.findEventById !== 'function')
    return room.findEventById?.(eventId);
  const inMain = main.findEventById(eventId);
  if (inMain) return inMain;
  roomLookups.inThreads ??= readThreadEvents(room);
  return roomLookups.inThreads.get(eventId);
};

/**
 * `room.findEventById` at the cost of one read of the room's threads per task. A room that adds
 * an event, or gives a local echo its ID, forgets its lookups at once
 * (`keepRoomEventLookupsCurrent`), so a view that updates on it in the same task finds it.
 */
export const findRoomEvent = (room: Room, eventId: string): MatrixEvent | undefined => {
  if (!lookups) {
    lookups = new WeakMap();
    queueMicrotask(() => {
      lookups = undefined;
    });
  }
  let roomLookups = lookups.get(room);
  if (!roomLookups) {
    roomLookups = { found: new Map() };
    lookups.set(room, roomLookups);
  }
  const { found } = roomLookups;
  if (!found.has(eventId)) found.set(eventId, lookUp(room, roomLookups, eventId));
  return found.get(eventId);
};

/**
 * Has a room forget its lookups (`findRoomEvent`) whenever it adds an event, renames one or resets
 * a timeline.
 */
export const keepRoomEventLookupsCurrent = (mx: MatrixClient): (() => void) => {
  const forget = (room: Room | undefined) => {
    if (room) lookups?.delete(room);
  };
  const onEvent = (_event: MatrixEvent, room: Room | undefined) => forget(room);
  mx.prependListener(RoomEvent.Timeline, onEvent);
  mx.prependListener(RoomEvent.LocalEchoUpdated, onEvent);
  mx.prependListener(RoomEvent.TimelineReset, forget);
  return () => {
    mx.removeListener(RoomEvent.Timeline, onEvent);
    mx.removeListener(RoomEvent.LocalEchoUpdated, onEvent);
    mx.removeListener(RoomEvent.TimelineReset, forget);
  };
};
