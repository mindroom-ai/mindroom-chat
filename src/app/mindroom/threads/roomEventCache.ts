// CINNY-207 P2.1: this module is now a pure re-export shim over the
// unified `cacheStore` module. The DB-per-domain implementation was
// consolidated into a single schema-v3 IndexedDB with a shared
// scoped-cursor core (see `./cacheStore/`). The legacy DB name string
// `mindroom-room-event-cache` is retained (re-exported from
// `legacyCacheDbNames`) for logout cleanup on installs that never
// opened v3, and for the P2.1/D8 wipe list.
//
// Direct imports of this file are supported for compatibility only. New
// callers should import from `./cacheStore` (or through the arch-guarded
// `eventRepository.ts` seam). Phase 2.3 flips remaining direct callers
// off the shims and Phase 7 deletes them entirely.
//
// Behavior contract preserved by the shim flip is pinned by the
// parameterized suite in `./cacheStore/__tests__/cacheContract.test.ts`.

export { LEGACY_MINDROOM_ROOM_EVENT_CACHE_DB_NAME as MINDROOM_ROOM_EVENT_CACHE_DB_NAME } from './cacheStore/legacyCacheDbNames';
export { getLegacyRoomEventCacheDbName as getRoomEventCacheDbName } from './cacheStore/legacyCacheDbNames';

export {
  deleteRoomEventsFromCache,
  getRoomCursorAnchor,
  loadCachedRoomEvent,
  loadCachedRoomEventsBefore,
  loadCachedRoomPaginationToken,
  loadLatestCachedRoomEvents,
  normalizeCachedRoomEvents,
  saveRoomEventsToCache,
  type CachedRoomEvent,
  type CachedRoomEventPage,
} from './cacheStore';

import { deleteCacheStoreDb } from './cacheStore';

/**
 * Legacy delete-cache API. The unified store now owns the underlying
 * DB, so `deleteRoomEventCache(sessionId)` deletes the whole unified DB
 * for that session — the room and thread slices always shared a
 * lifecycle in practice (both are wiped together during logout via
 * `deleteMindroomSessionCaches`), so collapsing the delete has no
 * observable effect on callers.
 */
export const deleteRoomEventCache = (sessionId: string): Promise<void> =>
  deleteCacheStoreDb(sessionId);
