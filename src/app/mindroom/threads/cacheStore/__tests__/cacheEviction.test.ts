/**
 * CINNY-207 P2.2 commit 3 (D9 / AC7): cache eviction integration test.
 *
 * Uses `__setCacheStoreByteBudgetForTests` to shrink the budget to a
 * few KB, seeds three rooms via the real save paths (so the ledger
 * populates through the same code paths the eviction reads), then
 * runs `runCacheEvictionIfOverBudget` and asserts:
 *
 *   1. Rooms are evicted in policy order: federated first, then LRU.
 *   2. Protected rooms and rooms with `lastOpenedTs` inside the recent
 *      window are never evicted.
 *   3. Eviction stops once total bytes drop below
 *      `budget * EVICTION_TARGET_UTILIZATION`.
 *   4. Evicted rooms' events, meta, thread_summaries, and ledger row
 *      are all cleaned up.
 *
 * A red-first probe (assertion that over-budget state persists without
 * calling the job) is included for AC7's "prove eviction is doing
 * something" requirement.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CACHE_STORE_DB_VERSION,
  EVENTS_BY_SCOPE_TS_INDEX,
  EVENTS_STORE,
  META_STORE,
  ROOM_LEDGER_STORE,
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  THREAD_SUMMARIES_STORE,
  type CachedRoomLedgerRecord,
} from '../cacheStoreSchema';

vi.mock('../cacheStoreLegacyWipe', () => ({
  performLegacyDbWipe: vi.fn(async () => undefined),
  shouldAttemptLegacySingletonWipe: () => false,
}));

const SESSION_ID = 'eviction-test-session';
// Three rooms: `!federated`, `!lru-old`, `!recent-active`.
const FED_ROOM = '!federated:remote.org';
const LRU_ROOM = '!lru-old:example.org';
const RECENT_ROOM = '!recent-active:example.org';

// A body payload large enough to make each event ~200-400 bytes so a
// few-KB budget is easy to overshoot.
const largeBody = (bodyLen = 200) => ({
  event_id: `$evt-${Math.random().toString(36).slice(2, 10)}`,
  type: 'm.room.message',
  sender: '@alice:example.org',
  content: { body: 'x'.repeat(bodyLen) },
});

const makeRoomEvent = (
  eventId: string,
  ts: number,
  bodyLen = 200
): {
  event_id: string;
  origin_server_ts: number;
  type: string;
  sender: string;
  content: { body: string };
} => ({
  ...largeBody(bodyLen),
  event_id: eventId,
  origin_server_ts: ts,
});

const openTestDb = (dbName: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, CACHE_STORE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const eventsStore = db.createObjectStore(EVENTS_STORE, { keyPath: 'cacheKey' });
      eventsStore.createIndex(EVENTS_BY_SCOPE_TS_INDEX, ['roomId', 'scope', 'ts', 'eventId'], {
        unique: false,
      });
      db.createObjectStore(META_STORE, { keyPath: 'metaKey' });
      db.createObjectStore(ROOM_LEDGER_STORE, { keyPath: 'roomId' });
      const summariesStore = db.createObjectStore(THREAD_SUMMARIES_STORE, {
        keyPath: 'cacheKey',
      });
      summariesStore.createIndex(THREAD_SUMMARIES_BY_ROOM_INDEX, 'roomId', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readAllLedger = async (db: IDBDatabase): Promise<CachedRoomLedgerRecord[]> =>
  new Promise((resolve, reject) => {
    const txn = db.transaction(ROOM_LEDGER_STORE, 'readonly');
    const store = txn.objectStore(ROOM_LEDGER_STORE);
    const rows: CachedRoomLedgerRecord[] = [];
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      rows.push(c.value as CachedRoomLedgerRecord);
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
    txn.oncomplete = () => resolve(rows);
    txn.onerror = () => reject(txn.error);
  });

const countRoomEvents = async (db: IDBDatabase, roomId: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const txn = db.transaction(EVENTS_STORE, 'readonly');
    const store = txn.objectStore(EVENTS_STORE);
    const index = store.index(EVENTS_BY_SCOPE_TS_INDEX);
    const range = IDBKeyRange.bound(
      [roomId, '', 0, ''],
      [roomId, '￿', Number.MAX_SAFE_INTEGER, '￿']
    );
    let count = 0;
    const cursor = index.openCursor(range);
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      count += 1;
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
    txn.oncomplete = () => resolve(count);
    txn.onerror = () => reject(txn.error);
  });

const countRoomMeta = async (db: IDBDatabase, roomId: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const txn = db.transaction(META_STORE, 'readonly');
    const store = txn.objectStore(META_STORE);
    let count = 0;
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      if ((c.value as { roomId?: string }).roomId === roomId) count += 1;
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
    txn.oncomplete = () => resolve(count);
    txn.onerror = () => reject(txn.error);
  });

const countRoomSummaries = async (db: IDBDatabase, roomId: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const txn = db.transaction(THREAD_SUMMARIES_STORE, 'readonly');
    const store = txn.objectStore(THREAD_SUMMARIES_STORE);
    const index = store.index(THREAD_SUMMARIES_BY_ROOM_INDEX);
    let count = 0;
    const cursor = index.openCursor(IDBKeyRange.only(roomId));
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      count += 1;
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
    txn.oncomplete = () => resolve(count);
    txn.onerror = () => reject(txn.error);
  });

// Directly set the ledger's federated flag for the federated room —
// nothing in the CacheStore populates this today (the Phase 3/4 sync
// engine does it via D3 homeserver detection). The eviction policy
// reads it via the ledger snapshot.
const markLedgerFederated = async (
  db: IDBDatabase,
  roomId: string,
  federated: boolean
): Promise<void> =>
  new Promise((resolve, reject) => {
    const txn = db.transaction(ROOM_LEDGER_STORE, 'readwrite');
    const store = txn.objectStore(ROOM_LEDGER_STORE);
    const request = store.get(roomId);
    request.onsuccess = () => {
      const current = request.result as CachedRoomLedgerRecord | undefined;
      if (!current) {
        resolve();
        return;
      }
      store.put({ ...current, federated });
    };
    request.onerror = () => reject(request.error);
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
  });

describe('CINNY-207 P2.2 commit 3 (D9 / AC7): cache eviction', () => {
  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = new IDBFactory();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const seedThreeRooms = async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    // Deterministic activity ts: federated=100, lru-old=200,
    // recent=300. LRU-old is the oldest homeserver-scoped room.
    await cacheStore.saveRoomEventsToCache(SESSION_ID, FED_ROOM, [
      makeRoomEvent('$f1', 100, 300),
      makeRoomEvent('$f2', 110, 300),
    ]);
    await cacheStore.saveRoomEventsToCache(SESSION_ID, LRU_ROOM, [
      makeRoomEvent('$l1', 200, 300),
      makeRoomEvent('$l2', 210, 300),
    ]);
    await cacheStore.saveRoomEventsToCache(SESSION_ID, RECENT_ROOM, [
      makeRoomEvent('$r1', 300, 300),
    ]);

    // Add a thread summary in every room so we can prove eviction
    // sweeps it.
    for (const roomId of [FED_ROOM, LRU_ROOM, RECENT_ROOM]) {
      // eslint-disable-next-line no-await-in-loop
      await cacheStore.saveCachedThreadSummary(SESSION_ID, roomId, `${roomId}/root`, {
        summaryText: `summary of ${roomId}`,
      });
    }

    // Mark the federated room. This mimics the Phase 3/4 sync engine
    // populating `ledger.federated === true` via D3 detection.
    const db = await openTestDb(dbName);
    await markLedgerFederated(db, FED_ROOM, true);
    db.close();
    cacheStore.resetCacheStoreForTesting();

    // Protect the recent room via BOTH mechanisms (protected registry
    // + recent-open guard). Either one alone would suffice; using both
    // documents each independent path.
    cacheStore.setEvictionProtectedRoomIds([RECENT_ROOM]);
    await cacheStore.noteRoomOpened(SESSION_ID, RECENT_ROOM);

    return { cacheStore, dbName };
  };

  it('AC7: eviction respects policy order and preserves protected rooms', async () => {
    const { cacheStore, dbName } = await seedThreeRooms();

    // Shrink the budget so we're guaranteed to be over. First read
    // the total to size the budget precisely.
    let db = await openTestDb(dbName);
    const beforeLedger = await readAllLedger(db);
    const totalBytes = beforeLedger.reduce((s, r) => s + r.approxBytes, 0);
    db.close();
    expect(totalBytes).toBeGreaterThan(0);

    // Pick a budget just below the federated room's size, forcing at
    // least the federated room to evict.
    const fedRow = beforeLedger.find((r) => r.roomId === FED_ROOM)!;
    const budget = Math.max(500, totalBytes - fedRow.approxBytes - 100);
    cacheStore.__setCacheStoreByteBudgetForTests(budget);

    // Red-first: prove that WITHOUT calling the job, the DB stays
    // over-budget (no background magic).
    db = await openTestDb(dbName);
    const stillOver = (await readAllLedger(db)).reduce(
      (s, r) => s + r.approxBytes,
      0
    );
    db.close();
    expect(stillOver).toBeGreaterThan(budget);

    const result = await cacheStore.runCacheEvictionIfOverBudget(SESSION_ID);

    // Federated should be first out.
    expect(result.evictedRoomIds[0]).toBe(FED_ROOM);
    // Protected room must NOT be evicted.
    expect(result.evictedRoomIds).not.toContain(RECENT_ROOM);
    expect(result.skippedRoomIds).toContain(RECENT_ROOM);

    // Under-budget stop condition (10% headroom).
    expect(result.bytesAfter).toBeLessThanOrEqual(budget * 0.9 + 1);

    // Cleanup: evicted room's events/meta/summaries/ledger all gone.
    db = await openTestDb(dbName);
    for (const evicted of result.evictedRoomIds) {
      // eslint-disable-next-line no-await-in-loop
      expect(await countRoomEvents(db, evicted)).toBe(0);
      // eslint-disable-next-line no-await-in-loop
      expect(await countRoomMeta(db, evicted)).toBe(0);
      // eslint-disable-next-line no-await-in-loop
      expect(await countRoomSummaries(db, evicted)).toBe(0);
    }
    const afterLedger = await readAllLedger(db);
    result.evictedRoomIds.forEach((roomId) => {
      expect(afterLedger.find((r) => r.roomId === roomId)).toBeUndefined();
    });
    // Protected room's data is completely intact.
    expect(await countRoomEvents(db, RECENT_ROOM)).toBeGreaterThan(0);
    db.close();
  });

  it('no-op when under budget', async () => {
    const { cacheStore } = await seedThreeRooms();
    cacheStore.__setCacheStoreByteBudgetForTests(1_000_000_000);
    const result = await cacheStore.runCacheEvictionIfOverBudget(SESSION_ID);
    expect(result.evictedRoomIds).toEqual([]);
    expect(result.eventsDeleted).toBe(0);
    expect(result.bytesBefore).toBe(result.bytesAfter);
  });

  it('recent-open guard alone protects a homeserver room without a registry entry', async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    // Two homeserver rooms; the "recent" one has lastOpenedTs stamped
    // but is NOT in the protected registry.
    await cacheStore.saveRoomEventsToCache(SESSION_ID, LRU_ROOM, [
      makeRoomEvent('$l', 100, 300),
    ]);
    await cacheStore.saveRoomEventsToCache(SESSION_ID, RECENT_ROOM, [
      makeRoomEvent('$r', 200, 300),
    ]);
    await cacheStore.noteRoomOpened(SESSION_ID, RECENT_ROOM);

    // Registry stays empty — recent room is protected purely by
    // meta.lastOpenedTs being inside EVICTION_RECENT_OPEN_WINDOW_MS
    // (24h). `noteRoomOpened` stamps Date.now(), so it's inside.
    cacheStore.__resetEvictionForTests();

    const db = await openTestDb(dbName);
    const totalBytes = (await readAllLedger(db)).reduce(
      (s, r) => s + r.approxBytes,
      0
    );
    db.close();
    // Budget forces exactly one room out; the recent one should be
    // preserved by the guard.
    cacheStore.__setCacheStoreByteBudgetForTests(Math.floor(totalBytes / 2));

    const result = await cacheStore.runCacheEvictionIfOverBudget(SESSION_ID);
    expect(result.evictedRoomIds).toContain(LRU_ROOM);
    expect(result.evictedRoomIds).not.toContain(RECENT_ROOM);
    expect(result.skippedRoomIds).toContain(RECENT_ROOM);
  });

  it('debounced auto-trigger: back-to-back calls inside the window collapse to one runner invocation', async () => {
    // The debounce guard in `maybeScheduleEvictionCheck` skips before
    // the runner is invoked at all — this is observable by spying on
    // `readLedgerSnapshot` (the runner's first IDB operation). We
    // observe: three consecutive schedules → readLedgerSnapshot fires
    // at most once.
    const cacheStore = await import('../index');
    const ledgerModule = await import('../cacheStoreLedger');
    cacheStore.__resetEvictionForTests();
    cacheStore.__setCacheStoreByteBudgetForTests(1_000_000_000);

    // Seed one event so the DB actually opens and the runner has
    // something to snapshot.
    await cacheStore.saveRoomEventsToCache(SESSION_ID, LRU_ROOM, [
      makeRoomEvent('$seed', 100),
    ]);

    // Reset debounce state so the counter starts clean for the
    // observation window.
    cacheStore.__resetEvictionForTests();
    const snapshotSpy = vi.spyOn(ledgerModule, 'readLedgerSnapshot');

    // Three back-to-back schedules inside the same tick.
    const { maybeScheduleEvictionCheck } = await import('../cacheEviction');
    maybeScheduleEvictionCheck(SESSION_ID);
    maybeScheduleEvictionCheck(SESSION_ID);
    maybeScheduleEvictionCheck(SESSION_ID);

    // Let the fire-and-forget promise settle.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(snapshotSpy.mock.calls.length).toBeLessThanOrEqual(1);

    snapshotSpy.mockRestore();
  });
});
