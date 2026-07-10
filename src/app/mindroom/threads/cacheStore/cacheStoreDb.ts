import { getSessionScopedStorageKey, listSessions } from '../../../state/sessions';
import {
  CACHE_STORE_DB_VERSION,
  EVENTS_BY_SCOPE_TS_INDEX,
  EVENTS_STORE,
  META_STORE,
  MINDROOM_CACHE_DB_BASE_NAME,
  ROOM_LEDGER_STORE,
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  THREAD_SUMMARIES_STORE,
} from './cacheStoreSchema';
import { performLegacyDbWipe } from './cacheStoreLegacyWipe';

// CINNY-207 P2.1: single DB, schema v3. The opener follows the corruption
// self-heal pattern from the legacy `threadEventCache` — if a v3 open
// succeeds but any of the four expected stores is missing (partial
// upgrade, prior interrupted create), delete the DB and recreate it
// exactly once (`allowRecovery` flag).
//
// The D8 legacy-wipe step (P2.1 commit 3) is invoked here between open
// success and resolving the memoized promise so the wipe runs exactly
// once per session.

const dbPromiseByName = new Map<string, Promise<IDBDatabase | undefined>>();

export const getCacheStoreDbName = (sessionId: string): string =>
  getSessionScopedStorageKey(sessionId, MINDROOM_CACHE_DB_BASE_NAME);

const REQUIRED_STORES = [
  EVENTS_STORE,
  META_STORE,
  ROOM_LEDGER_STORE,
  THREAD_SUMMARIES_STORE,
] as const;

export class CacheStoreBlockedError extends Error {
  constructor(operation: 'open' | 'delete', dbName: string) {
    super(`IndexedDB ${operation} blocked for ${dbName}`);
    this.name = 'CacheStoreBlockedError';
  }
}

const hasRequiredCacheStoreStores = (
  db: Pick<IDBDatabase, 'objectStoreNames'>
): boolean => REQUIRED_STORES.every((store) => db.objectStoreNames.contains(store));

const deleteIndexedDb = async (dbName: string): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new CacheStoreBlockedError('delete', dbName));
  });
};

const applyUpgrade = (db: IDBDatabase): void => {
  if (!db.objectStoreNames.contains(EVENTS_STORE)) {
    const eventsStore = db.createObjectStore(EVENTS_STORE, { keyPath: 'cacheKey' });
    eventsStore.createIndex(EVENTS_BY_SCOPE_TS_INDEX, ['roomId', 'scope', 'ts', 'eventId'], {
      unique: false,
    });
  }
  if (!db.objectStoreNames.contains(META_STORE)) {
    db.createObjectStore(META_STORE, { keyPath: 'metaKey' });
  }
  if (!db.objectStoreNames.contains(ROOM_LEDGER_STORE)) {
    // CINNY-207 P2.2 preparation: created empty in v3. Filled by the
    // eviction ledger in the next step. Room id is the natural primary key.
    db.createObjectStore(ROOM_LEDGER_STORE, { keyPath: 'roomId' });
  }
  if (!db.objectStoreNames.contains(THREAD_SUMMARIES_STORE)) {
    const summariesStore = db.createObjectStore(THREAD_SUMMARIES_STORE, {
      keyPath: 'cacheKey',
    });
    summariesStore.createIndex(THREAD_SUMMARIES_BY_ROOM_INDEX, 'roomId', { unique: false });
  }
};

/**
 * Hook for the D8 legacy-wipe step. Runs after schema-v3 open success
 * and before we hand the DB out to callers. The default implementation
 * (`performLegacyDbWipe`) deletes the three legacy DB names once per
 * session and writes an idempotency marker into the meta store, so a
 * second open is a cheap marker read.
 */
type LegacyWipeHook = (sessionId: string, db: IDBDatabase) => Promise<void>;

const DEFAULT_LEGACY_WIPE_HOOK: LegacyWipeHook = (sessionId, db) =>
  performLegacyDbWipe(sessionId, db);

let legacyWipeHook: LegacyWipeHook = DEFAULT_LEGACY_WIPE_HOOK;

export const __setLegacyWipeHookForTests = (hook: LegacyWipeHook | undefined): void => {
  legacyWipeHook = hook ?? DEFAULT_LEGACY_WIPE_HOOK;
};

export const setLegacyWipeHook = (hook: LegacyWipeHook): void => {
  legacyWipeHook = hook;
};

// Retained for callers that want the currently open DB (for deleteDatabase
// coordination) without re-opening it.
export const getOpenCacheStoreDbPromise = (
  sessionId: string
): Promise<IDBDatabase | undefined> | undefined => {
  const dbName = getCacheStoreDbName(sessionId);
  return dbPromiseByName.get(dbName);
};

export const openCacheStore = (
  sessionId: string,
  allowRecovery = true
): Promise<IDBDatabase | undefined> => {
  const dbName = getCacheStoreDbName(sessionId);
  const currentPromise = dbPromiseByName.get(dbName);
  if (currentPromise) return currentPromise;
  if (typeof indexedDB === 'undefined') {
    const missing = Promise.resolve(undefined);
    dbPromiseByName.set(dbName, missing);
    return missing;
  }

  const dbPromise = new Promise<IDBDatabase | undefined>((resolve, reject) => {
    const request = indexedDB.open(dbName, CACHE_STORE_DB_VERSION);
    let blocked = false;

    request.onupgradeneeded = () => {
      applyUpgrade(request.result);
    };

    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      if (!hasRequiredCacheStoreStores(db)) {
        // Corruption self-heal — delete and recreate once.
        db.close();
        dbPromiseByName.delete(dbName);

        if (allowRecovery) {
          deleteIndexedDb(dbName)
            .catch(() => undefined)
            .then(() => openCacheStore(sessionId, false))
            .then(resolve)
            .catch(reject);
          return;
        }
        // Recovery already attempted — give up and yield undefined so
        // callers skip cache writes gracefully.
        resolve(undefined);
        return;
      }

      db.onversionchange = () => {
        db.close();
        dbPromiseByName.delete(dbName);
      };
      // D8 wipe hook runs after the schema is confirmed and before we
      // hand the DB out to callers.
      legacyWipeHook(sessionId, db)
        .catch(() => undefined)
        .finally(() => resolve(db));
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new CacheStoreBlockedError('open', dbName));
    };
  });

  // CINNY-207 P2 review: on rejection, evict the memo entry so the next
  // caller retries a fresh open instead of receiving the cached
  // rejected promise forever (one transient open failure would brick
  // the cache for the session otherwise). The corruption self-heal
  // path above uses its own `allowRecovery=false` recursion so this
  // eviction does not create an infinite retry loop — it only enables
  // retry on the NEXT top-level `openCacheStore` call.
  dbPromise.catch(() => {
    if (dbPromiseByName.get(dbName) === dbPromise) {
      dbPromiseByName.delete(dbName);
    }
  });

  dbPromiseByName.set(dbName, dbPromise);
  return dbPromise;
};

export const deleteCacheStoreDb = async (sessionId: string): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;

  const dbName = getCacheStoreDbName(sessionId);
  const currentDb = await dbPromiseByName.get(dbName)?.catch(() => undefined);
  currentDb?.close();
  dbPromiseByName.delete(dbName);
  await deleteIndexedDb(dbName);
};

/**
 * Testing utility — drop all memoized dbPromise entries and restore the
 * legacy-wipe hook to its default (`performLegacyDbWipe`). Combined
 * with a fresh `IDBFactory`, this makes each test start from a clean
 * slate.
 */
export const resetCacheStoreForTesting = (): void => {
  dbPromiseByName.clear();
  legacyWipeHook = DEFAULT_LEGACY_WIPE_HOOK;
};

// Re-exported so the wipe hook (P2.1 commit 3) can iterate stored
// sessions to gate the singleton-DB wipe.
export { listSessions };
