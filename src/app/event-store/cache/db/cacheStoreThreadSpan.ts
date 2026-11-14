import type { IEvent } from 'matrix-js-sdk';
import { openCacheStore } from './cacheStoreDb';
import {
  EVENTS_BY_SCOPE_TS_INDEX,
  EVENTS_STORE,
  MAX_EVENT_ID,
  MAX_EVENT_TS,
  META_STORE,
  ROOM_SCOPE,
  buildMetaKey,
  type CachedEventRecord,
  type CachedMetaRecord,
} from './cacheStoreSchema';
import type { CursorAnchor } from './cacheStoreNormalize';
import { isOtherRoomEvent } from './cacheStoreEvents';

/**
 * Every event the cache holds in a room's thread scopes from `from` (inclusive) to `before`
 * (exclusive) in cache order (sent time, then event ID): the thread replies, edits and reactions of
 * a span of the room's history. Without `before`, everything from `from` on. Thread roots, which
 * the room's own scope holds, are left out, and so are events that name another room.
 */
export const loadCachedThreadEventsInSpan = async (
  sessionId: string,
  roomId: string,
  from: CursorAnchor,
  before?: CursorAnchor
): Promise<Partial<IEvent>[]> => {
  // An empty span: nothing lies from `from` up to `before`.
  if (before && (from.ts > before.ts || (from.ts === before.ts && from.eventId >= before.eventId)))
    return [];
  const db = await openCacheStore(sessionId);
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([EVENTS_STORE, META_STORE], 'readonly');
    const events: Partial<IEvent>[] = [];
    // One meta row per thread scope names the room's cached threads.
    const metas = transaction
      .objectStore(META_STORE)
      .getAll(
        IDBKeyRange.bound(buildMetaKey(roomId, ROOM_SCOPE), buildMetaKey(roomId, MAX_EVENT_ID))
      );
    metas.onsuccess = () => {
      (metas.result as CachedMetaRecord[]).forEach(({ roomId: metaRoomId, scope }) => {
        if (metaRoomId !== roomId || !scope.startsWith('$')) return;
        const span = IDBKeyRange.bound(
          [roomId, scope, from.ts, from.eventId],
          before
            ? [roomId, scope, before.ts, before.eventId]
            : [roomId, scope, MAX_EVENT_TS, MAX_EVENT_ID],
          false,
          !!before
        );
        const request = transaction
          .objectStore(EVENTS_STORE)
          .index(EVENTS_BY_SCOPE_TS_INDEX)
          .getAll(span);
        request.onsuccess = () => {
          (request.result as CachedEventRecord[]).forEach(({ rawEvent }) => {
            // An older build could save another room's events under this room's thread scopes.
            if (rawEvent.event_id !== scope && !isOtherRoomEvent(rawEvent, roomId)) {
              events.push(rawEvent);
            }
          });
        };
      });
    };
    transaction.oncomplete = () => resolve(events);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};
