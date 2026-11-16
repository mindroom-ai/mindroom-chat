import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';

// The room's lookup of an event it does not hold searches every thread, and the views of a room's
// threads ask for events no timeline keeps once per thread: the event a receipt names, often a
// reply's terminal edit, or the edit bundled with a thread's newest reply. A room of hundreds of
// threads searched them all hundreds of times on every streamed edit. So the IDs a room's threads
// hold are read once per task, and an event that neither its main timelines nor a thread holds is
// answered without the search. The room answers every other lookup itself: its search remembers
// the thread that held an event (the SDK patch), so it stays quick, and it stays the room's answer
// for an event a timeline replaced in place or an ID two threads hold.
let threadEventIds: WeakMap<Room, Set<string> | null> | undefined;

/**
 * The IDs a thread holds, as its `findEventById` reads them: the SDK's private index, which also
 * covers a timeline `getTimelines()` no longer lists, such as one a page filled after a reset.
 */
const heldEventIds = (thread: Thread): IterableIterator<string> | undefined => {
  const index: unknown = (thread.timelineSet as unknown as { _eventIdToTimeline?: unknown })
    ._eventIdToTimeline;
  return index instanceof Map ? (index as Map<string, unknown>).keys() : undefined;
};

/** The IDs every thread of the room holds; null when a thread's index cannot be read. */
const readThreadEventIds = (room: Room): Set<string> | null => {
  const eventIds = new Set<string>();
  for (const thread of room.getThreads()) {
    const held = heldEventIds(thread);
    if (!held) return null;
    for (const eventId of held) eventIds.add(eventId);
  }
  return eventIds;
};

const threadsHold = (room: Room, eventId: string): boolean => {
  if (!threadEventIds) {
    threadEventIds = new WeakMap();
    queueMicrotask(() => {
      threadEventIds = undefined;
    });
  }
  let eventIds = threadEventIds.get(room);
  if (eventIds === undefined) {
    eventIds = readThreadEventIds(room);
    threadEventIds.set(room, eventIds);
  }
  // An index this cannot read: the room's search decides.
  return eventIds?.has(eventId) ?? true;
};

/**
 * `room.findEventById`, without its search of every thread for an event no thread holds. A room
 * that adds an event, gives a local echo its ID or resets a timeline forgets the IDs its threads
 * hold at once (`keepRoomEventLookupsCurrent`), so a view that updates on it in the same task
 * finds the event.
 */
export const findRoomEvent = (room: Room, eventId: string): MatrixEvent | undefined => {
  // Room stand-ins in tests often hold their events only through `findEventById`.
  const main = room.getUnfilteredTimelineSet?.();
  if (
    typeof room.getThreads === 'function' &&
    typeof main?.findEventById === 'function' &&
    !main.findEventById(eventId) &&
    !threadsHold(room, eventId)
  )
    return undefined;
  return room.findEventById?.(eventId);
};

/**
 * Has a room forget the IDs its threads hold (`findRoomEvent`) whenever it adds or removes an
 * event, renames one or resets a timeline.
 */
export const keepRoomEventLookupsCurrent = (mx: MatrixClient): (() => void) => {
  const forget = (room: Room | undefined) => {
    if (room) threadEventIds?.delete(room);
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
