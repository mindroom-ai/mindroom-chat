import { countCacheProbe } from '../cacheProbe';
import { openCacheStore } from './cacheStoreDb';
import { readLedgerSnapshot } from './cacheStoreLedger';
import {
  EVENTS_BY_SCOPE_TS_INDEX,
  EVENTS_STORE,
  EVICTION_CHECK_MIN_INTERVAL_MS,
  EVICTION_RECENT_OPEN_WINDOW_MS,
  EVICTION_TARGET_UTILIZATION,
  MAX_EVENT_ID,
  MAX_EVENT_TS,
  META_STORE,
  ROOM_LEDGER_STORE,
  THREAD_HEIGHTS_BY_ROOM_INDEX,
  THREAD_HEIGHTS_STORE,
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  THREAD_SUMMARIES_STORE,
  getCacheStoreByteBudget,
  type CachedMetaRecord,
  type CachedRoomLedgerRecord,
} from './cacheStoreSchema';

// CINNY-207 P2.2 commit 3 (D9/AC7): cache eviction job.
//
// Policy (D9):
//   1. Compute total bytes from the ledger snapshot.
//   2. If sum <= budget, no-op.
//   3. Build the eviction candidate list from the ledger, excluding:
//        - rooms in the protected registry (set by the sync engine's
//          `noteRoomFocused` in Phase 3/4; empty today because LRU
//          order naturally keeps the active room last)
//        - rooms with any meta.lastOpenedTs inside
//          EVICTION_RECENT_OPEN_WINDOW_MS ("never evict recently
//          opened threads" — v1 interpretation: whole-room, any
//          thread scope counting)
//   4. Sort: federated===true first, then ascending lastActivityTs
//      (LRU inside each priority class).
//   5. Evict rooms in that order until sum drops to
//      budget * EVICTION_TARGET_UTILIZATION (10% headroom).
//
// Auto-trigger: `maybeScheduleEvictionCheck(sessionId)` is called
// from the save paths in `cacheStoreEvents`. It's cheap: a
// module-level timestamp dedupes back-to-back checks at
// EVICTION_CHECK_MIN_INTERVAL_MS. No timers are held open —
// re-entering after the interval simply schedules the next check.

// ------- Protected registry (set by the sync engine in Phase 3/4) -------

const protectedRoomIds = new Set<string>();

export const setEvictionProtectedRoomIds = (roomIds: readonly string[]): void => {
  protectedRoomIds.clear();
  roomIds.forEach((id) => protectedRoomIds.add(id));
};

export const getEvictionProtectedRoomIds = (): string[] => Array.from(protectedRoomIds);

// ------- Debounce state -------

const lastCheckAtBySession = new Map<string, number>();

/**
 * Reset module-level state (protected registry + debounce timestamps).
 * Test-only.
 */
export const __resetEvictionForTests = (): void => {
  protectedRoomIds.clear();
  lastCheckAtBySession.clear();
};

// ------- Meta scan for the recent-open guard -------

const readMetaLastOpenedByRoom = (
  db: IDBDatabase
): Promise<Map<string, number>> =>
  new Promise((resolve, reject) => {
    const txn = db.transaction(META_STORE, 'readonly');
    const store = txn.objectStore(META_STORE);
    const cursorRequest = store.openCursor();
    const perRoom = new Map<string, number>();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const record = cursor.value as CachedMetaRecord;
      if (typeof record.lastOpenedTs === 'number' && record.lastOpenedTs > 0) {
        const previous = perRoom.get(record.roomId) ?? 0;
        if (record.lastOpenedTs > previous) {
          perRoom.set(record.roomId, record.lastOpenedTs);
        }
      }
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
    txn.oncomplete = () => resolve(perRoom);
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });

// ------- Room-eviction transaction -------

const evictRoom = (db: IDBDatabase, roomId: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const txn = db.transaction(
      [EVENTS_STORE, META_STORE, ROOM_LEDGER_STORE, THREAD_SUMMARIES_STORE, THREAD_HEIGHTS_STORE],
      'readwrite'
    );
    const eventsStore = txn.objectStore(EVENTS_STORE);
    const metaStore = txn.objectStore(META_STORE);
    const ledgerStore = txn.objectStore(ROOM_LEDGER_STORE);
    const summariesStore = txn.objectStore(THREAD_SUMMARIES_STORE);
    const heightsStore = txn.objectStore(THREAD_HEIGHTS_STORE);

    let deletedCount = 0;

    // Events: delete all records for this room across all scopes via
    // the by_scope_ts index.
    const eventsIndex = eventsStore.index(EVENTS_BY_SCOPE_TS_INDEX);
    const eventsRange = IDBKeyRange.bound(
      [roomId, '', 0, ''],
      [roomId, MAX_EVENT_ID, MAX_EVENT_TS, MAX_EVENT_ID]
    );
    const eventsCursor = eventsIndex.openCursor(eventsRange);
    eventsCursor.onsuccess = () => {
      const cursor = eventsCursor.result;
      if (!cursor) return;
      cursor.delete();
      deletedCount += 1;
      cursor.continue();
    };
    eventsCursor.onerror = () => reject(eventsCursor.error);

    // Meta: the primary key is `${roomId}|${scope}`, so a bounded key
    // range confines the cursor to this room's rows instead of walking
    // the whole meta store. Upper bound uses U+FFFF as a sentinel above
    // any valid scope character (matches the sentinel used for the
    // events-by-scope index in the eviction sweep above).
    // CINNY-207 P2 review: was `openCursor()` (full-store walk).
    const metaRange = IDBKeyRange.bound(`${roomId}|`, `${roomId}|￿`);
    const metaCursor = metaStore.openCursor(metaRange);
    metaCursor.onsuccess = () => {
      const cursor = metaCursor.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    metaCursor.onerror = () => reject(metaCursor.error);

    // Thread summaries: has by_room index.
    const summariesIndex = summariesStore.index(THREAD_SUMMARIES_BY_ROOM_INDEX);
    const summariesCursor = summariesIndex.openCursor(IDBKeyRange.only(roomId));
    summariesCursor.onsuccess = () => {
      const cursor = summariesCursor.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    summariesCursor.onerror = () => reject(summariesCursor.error);

    // Thread heights: has by_room index (schema v4).
    const heightsIndex = heightsStore.index(THREAD_HEIGHTS_BY_ROOM_INDEX);
    const heightsCursor = heightsIndex.openCursor(IDBKeyRange.only(roomId));
    heightsCursor.onsuccess = () => {
      const cursor = heightsCursor.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    heightsCursor.onerror = () => reject(heightsCursor.error);

    // Ledger row: primary key.
    ledgerStore.delete(roomId);

    txn.oncomplete = () => resolve(deletedCount);
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });

// ------- Candidate ordering -------

type EvictionCandidate = CachedRoomLedgerRecord;

const compareEvictionOrder = (a: EvictionCandidate, b: EvictionCandidate): number => {
  const aFed = a.federated === true ? 1 : 0;
  const bFed = b.federated === true ? 1 : 0;
  // Federated first (higher priority for eviction).
  if (aFed !== bFed) return bFed - aFed;
  // Then LRU: ascending lastActivityTs (oldest first).
  return a.lastActivityTs - b.lastActivityTs;
};

// ------- Public entry points -------

export type EvictionResult = {
  bytesBefore: number;
  bytesAfter: number;
  evictedRoomIds: string[];
  skippedRoomIds: string[];
  eventsDeleted: number;
};

/**
 * Run the eviction pass once. Returns a result summary; if not
 * over-budget, `evictedRoomIds` is empty.
 */
export const runCacheEvictionIfOverBudget = async (
  sessionId: string
): Promise<EvictionResult> => {
  const db = await openCacheStore(sessionId);
  if (!db) {
    return {
      bytesBefore: 0,
      bytesAfter: 0,
      evictedRoomIds: [],
      skippedRoomIds: [],
      eventsDeleted: 0,
    };
  }

  const ledger = await readLedgerSnapshot(db);
  const bytesBefore = ledger.reduce((sum, row) => sum + row.approxBytes, 0);
  const budget = getCacheStoreByteBudget();

  if (bytesBefore <= budget) {
    return {
      bytesBefore,
      bytesAfter: bytesBefore,
      evictedRoomIds: [],
      skippedRoomIds: [],
      eventsDeleted: 0,
    };
  }

  // Below-target threshold (10% headroom).
  const target = Math.floor(budget * EVICTION_TARGET_UTILIZATION);

  // Build skip set from protected registry + recent-open guard.
  const recentOpenByRoom = await readMetaLastOpenedByRoom(db);
  const recentCutoff = Date.now() - EVICTION_RECENT_OPEN_WINDOW_MS;
  const skipped = new Set<string>();
  const candidates: EvictionCandidate[] = [];
  ledger.forEach((row) => {
    if (protectedRoomIds.has(row.roomId)) {
      skipped.add(row.roomId);
      return;
    }
    const lastOpenedTs = recentOpenByRoom.get(row.roomId);
    if (typeof lastOpenedTs === 'number' && lastOpenedTs > recentCutoff) {
      skipped.add(row.roomId);
      return;
    }
    candidates.push(row);
  });

  candidates.sort(compareEvictionOrder);

  let bytesRemaining = bytesBefore;
  const evictedRoomIds: string[] = [];
  let totalDeleted = 0;

  for (const candidate of candidates) {
    if (bytesRemaining <= target) break;
    // eslint-disable-next-line no-await-in-loop
    const deletedCount = await evictRoom(db, candidate.roomId);
    evictedRoomIds.push(candidate.roomId);
    totalDeleted += deletedCount;
    bytesRemaining -= candidate.approxBytes;
    if (deletedCount > 0) countCacheProbe('eventDeletes', deletedCount);
  }

  return {
    bytesBefore,
    bytesAfter: Math.max(0, bytesRemaining),
    evictedRoomIds,
    skippedRoomIds: Array.from(skipped),
    eventsDeleted: totalDeleted,
  };
};

/**
 * Save-path auto-trigger. Fire-and-forget with a module-level debounce
 * so a burst of saves does not schedule many overlapping eviction
 * passes. Errors are swallowed (best-effort cleanup) and the next
 * scheduled check will retry.
 */
export const maybeScheduleEvictionCheck = (sessionId: string): void => {
  const now = Date.now();
  const last = lastCheckAtBySession.get(sessionId) ?? 0;
  if (now - last < EVICTION_CHECK_MIN_INTERVAL_MS) return;
  lastCheckAtBySession.set(sessionId, now);
  void runCacheEvictionIfOverBudget(sessionId).catch(() => undefined);
};

