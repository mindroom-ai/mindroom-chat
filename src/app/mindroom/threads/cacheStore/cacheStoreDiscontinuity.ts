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
import { buildMetaKey, META_STORE, ROOM_SCOPE, type CachedMetaRecord } from './cacheStoreSchema';

export type TailDiscontinuityMarker = {
  markedAt: number;
  prevBatch?: string | null;
  generation?: string;
  nextToken?: string | null;
  /** Event ids from the cached room tail before this gap-fill began. */
  overlapEventIds?: string[];
};

export const getTailDiscontinuityGeneration = (
  marker: Pick<TailDiscontinuityMarker, 'markedAt' | 'prevBatch' | 'generation'>
): string => marker.generation ?? `${marker.markedAt}:${marker.prevBatch ?? ''}`;

/**
 * Mark the room's tail as discontinuous. Idempotent — the newer
 * `markedAt` wins. If no meta row exists yet, a minimal one is
 * created (all optional fields undefined) so the marker survives.
 */
export const markRoomTailDiscontinuity = async (
  sessionId: string,
  roomId: string,
  marker: TailDiscontinuityMarker
): Promise<TailDiscontinuityMarker> => {
  const db = await openCacheStore(sessionId);
  if (!db) throw new Error('Tail-discontinuity storage is unavailable.');
  const metaKey = buildMetaKey(roomId, ROOM_SCOPE);
  let durableMarker: TailDiscontinuityMarker | undefined;

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readwrite');
    const metaStore = transaction.objectStore(META_STORE);
    const request = metaStore.get(metaKey);
    request.onsuccess = () => {
      const existing = request.result as CachedMetaRecord | undefined;
      const existingMarker = existing?.tailDiscontinuity;
      if (existingMarker && existingMarker.markedAt > marker.markedAt) {
        durableMarker = existingMarker;
        return;
      }
      // A newer reset supersedes the cursor, but both resets still belong to
      // the same unfinished gap. Keep the original pre-gap boundary so pages
      // written by an older in-flight fill cannot become a false completion
      // boundary for its successor. An empty array is also meaningful: it
      // records that no cached boundary existed when the gap was first seen.
      const nextMarker =
        existingMarker?.overlapEventIds === undefined
          ? marker
          : { ...marker, overlapEventIds: [...existingMarker.overlapEventIds] };
      const nextMeta: CachedMetaRecord = existing
        ? { ...existing, tailDiscontinuity: nextMarker, updatedAt: Date.now() }
        : {
            metaKey,
            roomId,
            scope: ROOM_SCOPE,
            updatedAt: Date.now(),
            tailDiscontinuity: nextMarker,
          };
      metaStore.put(nextMeta);
      durableMarker = nextMarker;
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  if (!durableMarker) throw new Error('Tail-discontinuity marker was not committed.');
  return durableMarker;
};

/**
 * Clear the room's tail-discontinuity marker. Called by the Phase 4
 * gap-fill executor after a successful fill. No-op if no marker or
 * no meta row exists.
 */
export const clearRoomTailDiscontinuity = async (
  sessionId: string,
  roomId: string,
  expectedGeneration?: string
): Promise<void> => {
  const db = await openCacheStore(sessionId);
  if (!db) throw new Error('Tail-discontinuity storage is unavailable.');
  const metaKey = buildMetaKey(roomId, ROOM_SCOPE);

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readwrite');
    const metaStore = transaction.objectStore(META_STORE);
    const request = metaStore.get(metaKey);
    request.onsuccess = () => {
      const existing = request.result as CachedMetaRecord | undefined;
      if (!existing?.tailDiscontinuity) {
        return;
      }
      if (
        expectedGeneration &&
        getTailDiscontinuityGeneration(existing.tailDiscontinuity) !== expectedGeneration
      ) {
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
  });
};

/** Advance a marker only when it still belongs to the running generation. */
export const checkpointRoomTailDiscontinuity = async (
  sessionId: string,
  roomId: string,
  expectedGeneration: string,
  nextToken: string | null,
  overlapEventIds?: readonly string[]
): Promise<boolean> => {
  const db = await openCacheStore(sessionId);
  if (!db) return false;
  const metaKey = buildMetaKey(roomId, ROOM_SCOPE);
  let matched = false;
  let committed = false;

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readwrite');
    const metaStore = transaction.objectStore(META_STORE);
    const request = metaStore.get(metaKey);
    request.onsuccess = () => {
      const existing = request.result as CachedMetaRecord | undefined;
      const marker = existing?.tailDiscontinuity;
      if (!existing || !marker) return;
      if (getTailDiscontinuityGeneration(marker) !== expectedGeneration) return;
      metaStore.put({
        ...existing,
        updatedAt: Date.now(),
        tailDiscontinuity: {
          ...marker,
          generation: expectedGeneration,
          nextToken,
          ...(overlapEventIds === undefined ? {} : { overlapEventIds: [...overlapEventIds] }),
        },
      } satisfies CachedMetaRecord);
      matched = true;
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  })
    .then(() => {
      committed = matched;
    })
    .catch(() => undefined);

  return committed;
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
  if (!db) throw new Error('Tail-discontinuity storage is unavailable.');
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
  });
};
