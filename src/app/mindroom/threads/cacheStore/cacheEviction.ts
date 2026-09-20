import { openCacheStore, revokeRoomCacheStoreWrites } from './cacheStoreDb';
import {
  ATTACHMENTS_STORE,
  ATTACHMENT_REFERENCES_STORE,
  ATTACHMENT_REFERENCES_BY_ROOM_INDEX,
  ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX,
  EVENTS_BY_SCOPE_TS_INDEX,
  EVENTS_STORE,
  EVICTION_CHECK_MIN_INTERVAL_MS,
  EVICTION_RECENT_OPEN_WINDOW_MS,
  EVICTION_TARGET_UTILIZATION,
  MAX_EVENT_ID,
  MAX_EVENT_TS,
  META_STORE,
  ROOM_LEDGER_STORE,
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  THREAD_SUMMARIES_STORE,
  getCacheStoreByteBudget,
  type CachedMetaRecord,
  type CachedRoomLedgerRecord,
  type CachedAttachmentRecord,
  type CachedAttachmentReferenceRecord,
} from './cacheStoreSchema';

const protectedRoomIds = new Set<string>();
export const setEvictionProtectedRoomIds = (roomIds: readonly string[]): void => {
  protectedRoomIds.clear();
  roomIds.forEach((id) => protectedRoomIds.add(id));
};
export const getEvictionProtectedRoomIds = (): string[] => [...protectedRoomIds];
const lastCheckAtBySession = new Map<string, number>();
export const __resetEvictionForTests = (): void => {
  protectedRoomIds.clear();
  lastCheckAtBySession.clear();
};

export const clearRoomCachedContent = async (
  sessionId: string,
  roomId: string
): Promise<number> => {
  revokeRoomCacheStoreWrites(sessionId, roomId);
  const db = await openCacheStore(sessionId);
  if (!db) return 0;
  return new Promise((resolve, reject) => {
    const txn = db.transaction(
      [
        EVENTS_STORE,
        META_STORE,
        ROOM_LEDGER_STORE,
        THREAD_SUMMARIES_STORE,
        ATTACHMENTS_STORE,
        ATTACHMENT_REFERENCES_STORE,
      ],
      'readwrite'
    );
    const eventsStore = txn.objectStore(EVENTS_STORE);
    const metaStore = txn.objectStore(META_STORE);
    const ledgerStore = txn.objectStore(ROOM_LEDGER_STORE);
    const summariesStore = txn.objectStore(THREAD_SUMMARIES_STORE);

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

    const references = txn.objectStore(ATTACHMENT_REFERENCES_STORE);
    const blobs = txn.objectStore(ATTACHMENTS_STORE);
    const roomReferences = references.index(ATTACHMENT_REFERENCES_BY_ROOM_INDEX).getAll(roomId);
    roomReferences.onsuccess = () => {
      const rows = roomReferences.result as CachedAttachmentReferenceRecord[];
      rows.forEach((row) => references.delete(row.referenceKey));
      new Set(rows.map((row) => row.mxcUri).filter(Boolean)).forEach((mxcUri) => {
        const remaining = references
          .index(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX)
          .getAll(mxcUri);
        remaining.onsuccess = () => {
          const shared = remaining.result as CachedAttachmentReferenceRecord[];
          if (!shared.length) blobs.delete(mxcUri);
          else {
            const blob = blobs.get(mxcUri);
            blob.onsuccess = () => {
              if (blob.result)
                blobs.put({ ...blob.result, essential: shared.some((row) => row.essential) });
            };
          }
        };
      });
    };
    // Ledger row: primary key.
    ledgerStore.delete(roomId);

    txn.oncomplete = () => resolve(deletedCount);
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });
};

export type EvictionResult = {
  bytesBefore: number;
  bytesAfter: number;
  evictedMxcUris: string[];
  underPressure: boolean;
};

/** Reclaim optional media only. Text, essential bodies and pinned rooms survive pressure. */
export const runCacheEvictionIfOverBudget = async (sessionId: string): Promise<EvictionResult> => {
  const db = await openCacheStore(sessionId);
  if (!db) return { bytesBefore: 0, bytesAfter: 0, evictedMxcUris: [], underPressure: false };
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [ATTACHMENTS_STORE, ATTACHMENT_REFERENCES_STORE, ROOM_LEDGER_STORE, META_STORE],
      'readwrite'
    );
    const blobs = transaction.objectStore(ATTACHMENTS_STORE);
    const refs = transaction.objectStore(ATTACHMENT_REFERENCES_STORE);
    const ledgerRequest = transaction.objectStore(ROOM_LEDGER_STORE).getAll();
    const metaRequest = transaction.objectStore(META_STORE).getAll();
    const referencesRequest = refs.getAll();
    const records: Omit<CachedAttachmentRecord, 'bytes'>[] = [];
    const cursorRequest = blobs.openCursor();
    let result: EvictionResult;
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        const { bytes: _bytes, ...metadata } = cursor.value as CachedAttachmentRecord;
        records.push(metadata);
        cursor.continue();
        return;
      }
      const ledger = ledgerRequest.result as CachedRoomLedgerRecord[];
      const references = referencesRequest.result as CachedAttachmentReferenceRecord[];
      const protectedIds = new Set(protectedRoomIds);
      ledger.filter((row) => row.pinned).forEach((row) => protectedIds.add(row.roomId));
      (metaRequest.result as CachedMetaRecord[])
        .filter((row) => (row.lastOpenedTs ?? 0) > Date.now() - EVICTION_RECENT_OPEN_WINDOW_MS)
        .forEach((row) => protectedIds.add(row.roomId));
      const bytesBefore =
        ledger.reduce((sum, row) => sum + row.approxBytes, 0) +
        records.reduce((sum, row) => sum + row.byteLength, 0);
      let bytesAfter = bytesBefore;
      const budget = getCacheStoreByteBudget();
      const evictedMxcUris: string[] = [];
      if (bytesBefore > budget) {
        records.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
        for (const record of records) {
          if (bytesAfter <= budget * EVICTION_TARGET_UTILIZATION) break;
          const owners = references.filter((row) => row.mxcUri === record.mxcUri);
          if (
            record.essential ||
            owners.some((row) => row.essential || protectedIds.has(row.roomId))
          )
            continue;
          blobs.delete(record.mxcUri);
          owners.forEach((row) => refs.put({ ...row, byteLength: 0, status: 'missing' }));
          bytesAfter -= record.byteLength;
          evictedMxcUris.push(record.mxcUri);
        }
      }
      result = { bytesBefore, bytesAfter, evictedMxcUris, underPressure: bytesAfter > budget };
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const maybeScheduleEvictionCheck = (sessionId: string): void => {
  const now = Date.now();
  if (now - (lastCheckAtBySession.get(sessionId) ?? 0) < EVICTION_CHECK_MIN_INTERVAL_MS) return;
  lastCheckAtBySession.set(sessionId, now);
  void runCacheEvictionIfOverBudget(sessionId).catch(() => undefined);
};
