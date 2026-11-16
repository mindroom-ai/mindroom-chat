import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';

// A room's lookups of events, kept until the task ends. The room's lookup of an event it does not
// hold searches every thread, and the views of a room's threads ask for events no timeline keeps
// once per thread: the event a receipt names, often a reply's terminal edit, or the edit bundled
// with a thread's newest reply. A room of hundreds of threads searched them all hundreds of times
// on every streamed edit.
type RoomLookups = {
  found: Map<string, MatrixEvent | undefined>;
  /** The thread that holds each event, read once on the first miss; null when unreadable. */
  inThreads?: Map<string, Thread> | null;
};
let lookups: WeakMap<Room, RoomLookups> | undefined;

/**
 * The IDs a thread holds, as its `findEventById` reads them: the SDK's private index, which also
 * covers a timeline `getTimelines()` no longer lists, such as one a page filled after a reset.
 */
const heldEventIds = (thread: Thread): IterableIterator<string> | undefined => {
  const index: unknown = (thread.timelineSet as unknown as { _eventIdToTimeline?: unknown })
    ._eventIdToTimeline;
  return index instanceof Map ? (index as Map<string, unknown>).keys() : undefined;
};

const readThreadIndex = (room: Room): Map<string, Thread> | null => {
  const byEventId = new Map<string, Thread>();
  for (const thread of room.getThreads()) {
    const eventIds = heldEventIds(thread);
    if (!eventIds) return null;
    // The first thread that holds it, as `Room.findEventById` searches them.
    for (const eventId of eventIds) if (!byEventId.has(eventId)) byEventId.set(eventId, thread);
  }
  return byEventId;
};

const lookUp = (room: Room, roomLookups: RoomLookups, eventId: string): MatrixEvent | undefined => {
  // Room stand-ins in tests often hold their events only through `findEventById`.
  const main = room.getUnfilteredTimelineSet?.();
  if (typeof room.getThreads !== 'function' || typeof main?.findEventById !== 'function')
    return room.findEventById?.(eventId);
  const inMain = main.findEventById(eventId);
  if (inMain) return inMain;
  if (roomLookups.inThreads === undefined) roomLookups.inThreads = readThreadIndex(room);
  // An SDK whose index this cannot read: its own search.
  if (!roomLookups.inThreads) return room.findEventById(eventId);
  const thread = roomLookups.inThreads.get(eventId);
  // A held ID its timeline no longer shows: the SDK's search decides, as it would.
  return thread && (thread.findEventById(eventId) ?? room.findEventById(eventId));
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
