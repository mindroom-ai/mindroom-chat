import {
  ATTACHMENTS_BY_ACCESS_BYTES_INDEX,
  ATTACHMENTS_STORE,
  ATTACHMENT_BYTES_SUMMARY_KEY,
  ROOM_LEDGER_STORE,
  type CachedAttachmentBytesSummaryRecord,
  type CachedRoomLedgerRecord,
} from './cacheStoreSchema';

type TxnSummaryState = {
  byteDelta: number;
  countDelta: number;
  onlyAdds: boolean;
  deletedKeys: Set<string>;
  // undefined = read/count in flight; null = unseeded non-empty store.
  base: CachedAttachmentBytesSummaryRecord | null | undefined;
};

const summaryStateByTransaction = new WeakMap<IDBTransaction, TxnSummaryState>();

const isValidSummary = (value: unknown): value is CachedAttachmentBytesSummaryRecord => {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<CachedAttachmentBytesSummaryRecord>;
  return (
    r.mxcUri === ATTACHMENT_BYTES_SUMMARY_KEY &&
    typeof r.totalBytes === 'number' &&
    Number.isFinite(r.totalBytes) &&
    r.totalBytes >= 0 &&
    typeof r.count === 'number' &&
    Number.isInteger(r.count) &&
    r.count >= 0
  );
};

const resolveSummaryBytes = (summary: unknown, indexCount: number): number | undefined => {
  if (indexCount === 0) return 0;
  return isValidSummary(summary) && summary.count === indexCount ? summary.totalBytes : undefined;
};

const putSummary = (
  blobs: IDBObjectStore,
  totalBytes: number,
  count: number
): CachedAttachmentBytesSummaryRecord => {
  const safeCount = Math.max(0, Math.trunc(count));
  const record: CachedAttachmentBytesSummaryRecord = {
    mxcUri: ATTACHMENT_BYTES_SUMMARY_KEY,
    totalBytes: safeCount === 0 ? 0 : Math.max(0, totalBytes),
    count: safeCount,
  };
  blobs.put(record);
  return record;
};

/** Writes the exact attachment byte/count summary inside an active readwrite transaction. */
export const writeAttachmentBytesSummary = (
  blobs: IDBObjectStore,
  totalBytes: number,
  count: number
): void => {
  summaryStateByTransaction.set(blobs.transaction, {
    byteDelta: 0,
    countDelta: 0,
    onlyAdds: false,
    deletedKeys: new Set(),
    base: putSummary(blobs, totalBytes, count),
  });
};

/**
 * Coalesces attachment byte/count deltas inside the caller's readwrite transaction on
 * `attachments`; `deletedKey` prevents double-subtracting concurrent prunes of one shared key.
 */
export const adjustAttachmentBytesSummary = (
  blobs: IDBObjectStore,
  byteDelta: number,
  countDelta: number,
  deletedKey?: string
): void => {
  if (byteDelta === 0 && countDelta === 0) return;
  const existing = summaryStateByTransaction.get(blobs.transaction);
  if (deletedKey !== undefined && existing?.deletedKeys.has(deletedKey)) return;
  const isAdd = countDelta > 0 && byteDelta >= 0;
  if (existing) {
    if (deletedKey !== undefined) existing.deletedKeys.add(deletedKey);
    existing.byteDelta += byteDelta;
    existing.countDelta += countDelta;
    if (!isAdd) existing.onlyAdds = false;
    if (existing.base) {
      putSummary(
        blobs,
        existing.base.totalBytes + existing.byteDelta,
        existing.base.count + existing.countDelta
      );
    }
    return;
  }
  const state: TxnSummaryState = {
    byteDelta,
    countDelta,
    onlyAdds: isAdd,
    deletedKeys: deletedKey !== undefined ? new Set([deletedKey]) : new Set(),
    base: undefined,
  };
  summaryStateByTransaction.set(blobs.transaction, state);
  const summaryRequest = blobs.get(ATTACHMENT_BYTES_SUMMARY_KEY);
  summaryRequest.onsuccess = () => {
    const summary: unknown = summaryRequest.result;
    if (isValidSummary(summary)) {
      state.base = summary;
      putSummary(blobs, summary.totalBytes + state.byteDelta, summary.count + state.countDelta);
      return;
    }
    if (!state.onlyAdds) {
      state.base = null;
      return;
    }
    const countRequest = blobs.index(ATTACHMENTS_BY_ACCESS_BYTES_INDEX).count();
    countRequest.onsuccess = () => {
      // Seed immediately only when every indexed attachment came from this transaction's adds.
      if (state.onlyAdds && countRequest.result === state.countDelta) {
        state.base = { mxcUri: ATTACHMENT_BYTES_SUMMARY_KEY, totalBytes: 0, count: 0 };
        putSummary(blobs, state.byteDelta, state.countDelta);
      } else {
        state.base = null;
      }
    };
  };
};

const sumLedgerBytes = (rows: readonly CachedRoomLedgerRecord[]): number =>
  rows.reduce((sum, row) => sum + row.approxBytes, 0);

const runTransaction = <T>(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  setup: (transaction: IDBTransaction, fail: (error: unknown) => void) => () => T
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    const fail = (error: unknown) => {
      try {
        transaction.abort();
      } catch {
        /* Already completed or aborted. */
      }
      reject(error);
    };
    let readResult: () => T;
    try {
      readResult = setup(transaction, fail);
    } catch (error) {
      fail(error);
      return;
    }
    transaction.oncomplete = () => resolve(readResult());
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const scanAttachments = (db: IDBDatabase, persist: boolean): Promise<number> =>
  runTransaction(db, ATTACHMENTS_STORE, persist ? 'readwrite' : 'readonly', (txn, fail) => {
    const blobs = txn.objectStore(ATTACHMENTS_STORE);
    let totalBytes = 0;
    const walk = () => {
      const cursorRequest = blobs.index(ATTACHMENTS_BY_ACCESS_BYTES_INDEX).openKeyCursor();
      let count = 0;
      cursorRequest.onsuccess = () => {
        try {
          const cursor = cursorRequest.result;
          if (!cursor) {
            if (persist) writeAttachmentBytesSummary(blobs, totalBytes, count);
            return;
          }
          totalBytes += (cursor.key as [number, number])[1];
          count += 1;
          cursor.continue();
        } catch (error) {
          fail(error);
        }
      };
    };
    if (!persist) {
      walk();
      return () => totalBytes;
    }
    const summaryRequest = blobs.get(ATTACHMENT_BYTES_SUMMARY_KEY);
    const countRequest = blobs.index(ATTACHMENTS_BY_ACCESS_BYTES_INDEX).count();
    let remaining = 2;
    const onCheckReady = () => {
      remaining -= 1;
      if (remaining > 0) return;
      try {
        const indexCount = countRequest.result;
        const resolved = resolveSummaryBytes(summaryRequest.result as unknown, indexCount);
        if (resolved !== undefined) {
          totalBytes = resolved;
          if (indexCount === 0) writeAttachmentBytesSummary(blobs, 0, 0);
          return;
        }
        walk();
      } catch (error) {
        fail(error);
      }
    };
    summaryRequest.onsuccess = onCheckReady;
    countRequest.onsuccess = onCheckReady;
    return () => totalBytes;
  });

/**
 * Reads total cached text and attachment bytes without scanning `attachments` when the
 * persisted summary matches the index count. Pre-existing databases without a summary run
 * one atomic seed scan on `attachments` only (leaving `room_ledger` unlocked), falling
 * back to a readonly scan if storage is full.
 */
export const readTotalCachedBytes = async (db: IDBDatabase): Promise<number> => {
  const fast = await runTransaction(
    db,
    [ATTACHMENTS_STORE, ROOM_LEDGER_STORE],
    'readonly',
    (txn) => {
      const ledgerRequest = txn.objectStore(ROOM_LEDGER_STORE).getAll();
      const blobs = txn.objectStore(ATTACHMENTS_STORE);
      const summaryRequest = blobs.get(ATTACHMENT_BYTES_SUMMARY_KEY);
      const countRequest = blobs.index(ATTACHMENTS_BY_ACCESS_BYTES_INDEX).count();
      return () => ({
        ledgerBytes: sumLedgerBytes(ledgerRequest.result as CachedRoomLedgerRecord[]),
        attachmentBytes: resolveSummaryBytes(summaryRequest.result as unknown, countRequest.result),
      });
    }
  );
  if (fast.attachmentBytes !== undefined) return fast.ledgerBytes + fast.attachmentBytes;
  const attachmentBytes = await scanAttachments(db, true).catch(() => scanAttachments(db, false));
  const ledgerBytes = await runTransaction(db, ROOM_LEDGER_STORE, 'readonly', (txn) => {
    const ledgerRequest = txn.objectStore(ROOM_LEDGER_STORE).getAll();
    return () => sumLedgerBytes(ledgerRequest.result as CachedRoomLedgerRecord[]);
  });
  return ledgerBytes + attachmentBytes;
};
