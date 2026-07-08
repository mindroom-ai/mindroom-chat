/**
 * CINNY-207 P3.2: tail-discontinuity markers on the room-timeline
 * meta row.
 *
 * When the SDK reports a limited sync (RoomEvent.TimelineReset on the
 * room's unfiltered timelineSet), events between our last sync token
 * and the server's current state may have been dropped. We can't fetch
 * them from RoomEvent.Timeline because the SDK never fired for them.
 * The engine's gap tracker records the fact into the cache so the
 * Phase 4 backfill scheduler can execute a fill for the room later —
 * this module owns the read/write of that marker.
 *
 * The marker lives on the room-timeline meta row (roomId, scope=='')
 * as an optional additive field (`tailDiscontinuity`), so the schema
 * version does not change and older readers ignore it.
 */

import { openCacheStore } from './cacheStoreDb';
import {
  buildMetaKey,
  META_STORE,
  ROOM_SCOPE,
  type CachedMetaRecord,
} from './cacheStoreSchema';

export type TailDiscontinuityMarker = {
  markedAt: number;
  prevBatch?: string | null;
};

/**
 * Mark the room's tail as discontinuous. Idempotent — the newer
 * `markedAt` wins. If no meta row exists yet, a minimal one is
 * created (all optional fields undefined) so the marker survives.
 */
export const markRoomTailDiscontinuity = async (
  sessionId: string,
  roomId: string,
  marker: TailDiscontinuityMarker
): Promise<void> => {
  const db = await openCacheStore(sessionId);
  if (!db) return;
  const metaKey = buildMetaKey(roomId, ROOM_SCOPE);

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readwrite');
    const metaStore = transaction.objectStore(META_STORE);
    const request = metaStore.get(metaKey);
    request.onsuccess = () => {
      const existing = request.result as CachedMetaRecord | undefined;
      const nextMeta: CachedMetaRecord = existing
        ? { ...existing, tailDiscontinuity: marker, updatedAt: Date.now() }
        : {
            metaKey,
            roomId,
            scope: ROOM_SCOPE,
            updatedAt: Date.now(),
            tailDiscontinuity: marker,
          };
      metaStore.put(nextMeta);
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }).catch(() => undefined);
};

/**
 * Clear the room's tail-discontinuity marker. Called by the Phase 4
 * gap-fill executor after a successful fill. No-op if no marker or
 * no meta row exists.
 */
export const clearRoomTailDiscontinuity = async (
  sessionId: string,
  roomId: string
): Promise<void> => {
  const db = await openCacheStore(sessionId);
  if (!db) return;
  const metaKey = buildMetaKey(roomId, ROOM_SCOPE);

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readwrite');
    const metaStore = transaction.objectStore(META_STORE);
    const request = metaStore.get(metaKey);
    request.onsuccess = () => {
      const existing = request.result as CachedMetaRecord | undefined;
      if (!existing?.tailDiscontinuity) {
        resolve();
        return;
      }
      const { tailDiscontinuity: _drop, ...rest } = existing;
      const nextMeta: CachedMetaRecord = { ...rest, updatedAt: Date.now() };
      metaStore.put(nextMeta);
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }).catch(() => undefined);
};

/**
 * Read the marker for a room. Returns `undefined` when the row or the
 * marker is absent. Used by the gap-fill executor and by tests.
 */
export const loadRoomTailDiscontinuity = async (
  sessionId: string,
  roomId: string
): Promise<TailDiscontinuityMarker | undefined> => {
  const db = await openCacheStore(sessionId);
  if (!db) return undefined;
  const metaKey = buildMetaKey(roomId, ROOM_SCOPE);

  return new Promise<TailDiscontinuityMarker | undefined>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readonly');
    const metaStore = transaction.objectStore(META_STORE);
    const request = metaStore.get(metaKey);
    request.onsuccess = () => {
      const existing = request.result as CachedMetaRecord | undefined;
      resolve(existing?.tailDiscontinuity);
    };
    request.onerror = () => reject(request.error);
  }).catch(() => undefined);
};
