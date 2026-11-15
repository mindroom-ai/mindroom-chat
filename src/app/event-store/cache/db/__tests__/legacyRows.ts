import type { IEvent } from 'matrix-js-sdk';
import { openCacheStore } from '../cacheStoreDb';
import {
  EVENTS_STORE,
  META_STORE,
  buildEventCacheKey,
  buildMetaKey,
  type CachedEventRecord,
  type CachedMetaRecord,
} from '../cacheStoreSchema';

/**
 * Writes rows as an earlier version could, which the saves now refuse: another room's events, or
 * a thread whose root names another room, under this room's keys. `scope` is '' for the room's
 * own scope and the thread's root ID for a thread.
 */
export const putLegacyRows = async (
  sessionId: string,
  roomId: string,
  rows: {
    events?: { scope: string; rawEvent: Partial<IEvent> }[];
    roots?: { scope: string; rootEvent: Partial<IEvent> }[];
  }
): Promise<void> => {
  const db = await openCacheStore(sessionId);
  if (!db) throw new Error('No cache store');
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([EVENTS_STORE, META_STORE], 'readwrite');
    rows.events?.forEach(({ scope, rawEvent }) => {
      transaction.objectStore(EVENTS_STORE).put({
        cacheKey: buildEventCacheKey(roomId, scope, rawEvent.event_id!),
        roomId,
        scope,
        eventId: rawEvent.event_id!,
        ts: rawEvent.origin_server_ts ?? 0,
        rawEvent,
        approxBytes: 0,
      } satisfies CachedEventRecord);
    });
    rows.roots?.forEach(({ scope, rootEvent }) => {
      // The whole meta row, as an older build wrote it: a save's tokens and flags before it go.
      transaction.objectStore(META_STORE).put({
        metaKey: buildMetaKey(roomId, scope),
        roomId,
        scope,
        rootEvent,
        updatedAt: 0,
      } satisfies CachedMetaRecord);
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};
