import { useEffect, useState } from 'react';
import { ThreadEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useActiveSession } from '../../matrix/session/useSessionStore';
import { hydrateCachedEvents } from '../cache/eventCacheEditUtils';
import {
  createPreferLiveEventMapper,
  loadCachedThreadEvent,
  loadCachedThreadRootsForRoom,
} from '../cache/eventRepository';
import { hydrateLoadedEvent } from '../cache/useRoomEvent';
import type { EnginePersistFacade } from '../engine/enginePersistFacade';
import { isConfirmedMatrixEventId } from '../threads/threadRouteUtils';

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

/**
 * The root of thread `threadId` from the event cache while the SDK holds none (`liveRoot`): an
 * offline start whose saved sync names neither the root nor a reply has no SDK thread to adopt a
 * cached root. Read from the cache only, never the server, which gives the SDK the root online.
 */
export const useCachedThreadRoot = (
  room: Room,
  threadId: string,
  liveRoot: MatrixEvent | null | undefined
): MatrixEvent | undefined => {
  const mx = useMatrixClient();
  const sessionId = useActiveSession()?.sessionId;
  const [cached, setCached] = useState<{ room: Room; threadId: string; root: MatrixEvent }>();
  const wanted = !liveRoot && !!sessionId && isConfirmedMatrixEventId(threadId);
  useEffect(() => {
    if (!wanted || !sessionId) return undefined;
    let active = true;
    loadCachedThreadEvent(sessionId, room.roomId, threadId, threadId)
      .then(async (raw) => {
        if (!raw) return;
        const root = await hydrateLoadedEvent(mx, { room_id: room.roomId, ...raw });
        if (active) setCached({ room, threadId, root });
      })
      .catch(() => {
        // A cache that cannot be read leaves the thread unnamed until the server names it.
      });
    return () => {
      active = false;
    };
  }, [mx, room, sessionId, threadId, wanted]);
  return wanted && cached?.room === room && cached.threadId === threadId ? cached.root : undefined;
};
