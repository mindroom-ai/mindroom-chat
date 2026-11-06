import { ThreadEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { hydrateCachedEvents } from '../cache/eventCacheEditUtils';
import {
  createPreferLiveEventMapper,
  loadCachedThreadRootsForRoom,
} from '../cache/eventRepository';
import type { EnginePersistFacade } from '../engine/enginePersistFacade';

// Roots this page took from the event cache; saving them back would only repeat what is there.
const adoptedRoots = new WeakSet<MatrixEvent>();
// Roots this page saved, by the SDK object: a later revision of a root is a new object.
const savedRoots = new WeakSet<MatrixEvent>();

/**
 * Gives a thread the SDK knows only from its replies the root the event cache holds. A thread
 * whose replies came from the saved sync has no root until the SDK fetches it, which it cannot do
 * offline; without one the thread has no title and its root's sender is missing from its people.
 * A thread that has its root, or that the SDK does not know, is left alone.
 */
export const adoptCachedThreadRoot = (room: Room, rootEvent: MatrixEvent): void => {
  const thread = room.getThread(rootEvent.getId() ?? '');
  if (!thread || thread.rootEvent) return;
  hydrateCachedEvents({ room, events: [rootEvent] });
  adoptedRoots.add(rootEvent);
  thread.rootEvent = rootEvent;
  thread.setEventMetadata(rootEvent);
  thread.emit(ThreadEvent.Update, thread);
};

// Thread roots each room was asked for, and the room reads queued but not started yet.
const requestedRoots = new WeakMap<Room, Set<string>>();
const queuedReads = new WeakMap<Room, Promise<void>>();

/**
 * Asks the event cache once per page for the root of a thread that has none. Requests of one
 * room made together share a single read, which adopts the root of every rootless thread of the
 * room.
 */
export const requestCachedThreadRoot = (
  mx: MatrixClient,
  sessionId: string,
  room: Room,
  threadId: string
): void => {
  let requested = requestedRoots.get(room);
  if (!requested) {
    requested = new Set();
    requestedRoots.set(room, requested);
  }
  if (requested.has(threadId)) return;
  requested.add(threadId);
  if (queuedReads.has(room)) return;
  const read = Promise.resolve()
    .then(async () => {
      queuedReads.delete(room);
      const roots = await loadCachedThreadRootsForRoom(sessionId, room.roomId);
      const mapper = createPreferLiveEventMapper(room, mx.getEventMapper());
      roots.forEach(({ rootEvent }) => {
        const thread = rootEvent.event_id ? room.getThread(rootEvent.event_id) : null;
        if (thread && !thread.rootEvent) adoptCachedThreadRoot(room, mapper(rootEvent));
      });
    })
    .catch(() => {
      // A cache that cannot be read leaves the row as it was; the server fills it in later.
    });
  queuedReads.set(room, read);
};

/**
 * Saves a thread's root to the event cache once per page, so an offline start can name the
 * thread even when its room's thread list was never loaded. Roots taken from the cache are not
 * written back.
 */
export const saveThreadRoot = (
  persist: EnginePersistFacade,
  room: Room,
  threadId: string,
  rootEvent: MatrixEvent
): void => {
  if (adoptedRoots.has(rootEvent) || savedRoots.has(rootEvent)) return;
  if (rootEvent.isSending() || rootEvent.isDecryptionFailure() || rootEvent.isBeingDecrypted()) {
    return;
  }
  savedRoots.add(rootEvent);
  persist.persistThreadEventCache(room, threadId, [], rootEvent);
};
