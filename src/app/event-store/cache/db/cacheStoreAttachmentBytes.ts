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
  deletedKeys: Set<string>;
  // undefined = summary read in flight; null = absent or invalidated on quota failure.
  base: CachedAttachmentBytesSummaryRecord | null | undefined;
};

const summaryStateByTransaction = new WeakMap<IDBTransaction, TxnSummaryState>();

const isQuotaExceededError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { name?: unknown }).name === 'QuotaExceededError';

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

const tryDeleteSummary = (blobs: IDBObjectStore): void => {
  try {
    const req = blobs.delete(ATTACHMENT_BYTES_SUMMARY_KEY);
    req.onerror = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
  } catch {
    /* Best-effort invalidation when storage is full or the transaction already aborted. */
  }
};

/**
 * Persists the derived summary record without letting a QuotaExceededError abort the
 * enclosing write or deletion transaction; on quota failure it drops any stale summary.
 */
const putSummaryQuotaSafe = (
  blobs: IDBObjectStore,
  totalBytes: number,
  count: number,
  onQuotaError?: () => void
): CachedAttachmentBytesSummaryRecord | null => {
  const safeCount = Math.max(0, Math.trunc(count));
  const record: CachedAttachmentBytesSummaryRecord = {
    mxcUri: ATTACHMENT_BYTES_SUMMARY_KEY,
    totalBytes: safeCount === 0 ? 0 : Math.max(0, totalBytes),
    count: safeCount,
  };
  const handleQuota = () => {
    onQuotaError?.();
    tryDeleteSummary(blobs);
  };
  try {
    const request = blobs.put(record);
    request.onerror = (event) => {
      if (!isQuotaExceededError(request.error)) return;
      event.preventDefault();
      event.stopPropagation();
      handleQuota();
    };
    return record;
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    handleQuota();
    return null;
  }
};

/** Writes the exact attachment byte/count summary inside an active readwrite transaction. */
export const writeAttachmentBytesSummary = (
  blobs: IDBObjectStore,
  totalBytes: number,
  count: number
): void => {
  const state: TxnSummaryState = {
    byteDelta: 0,
    countDelta: 0,
    deletedKeys: new Set(),
    base: null,
  };
  summaryStateByTransaction.set(blobs.transaction, state);
  state.base = putSummaryQuotaSafe(blobs, totalBytes, count, () => {
    state.base = null;
  });
};

/**
 * Coalesces attachment byte/count deltas inside the caller's readwrite transaction on
 * `attachments`. Leaves a missing summary absent so the first admission seeds it lazily;
 * `deletedKey` prevents double-subtracting concurrent prunes of one shared key.
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
  if (existing) {
    if (deletedKey !== undefined) existing.deletedKeys.add(deletedKey);
    existing.byteDelta += byteDelta;
    existing.countDelta += countDelta;
    if (existing.base) {
      putSummaryQuotaSafe(
        blobs,
        existing.base.totalBytes + existing.byteDelta,
        existing.base.count + existing.countDelta,
        () => {
          existing.base = null;
        }
      );
    }
    return;
  }
  const state: TxnSummaryState = {
    byteDelta,
    countDelta,
    deletedKeys: deletedKey !== undefined ? new Set([deletedKey]) : new Set(),
    base: undefined,
  };
  summaryStateByTransaction.set(blobs.transaction, state);
  const summaryRequest = blobs.get(ATTACHMENT_BYTES_SUMMARY_KEY);
  summaryRequest.onsuccess = () => {
    const summary: unknown = summaryRequest.result;
    if (!isValidSummary(summary)) {
      state.base = null;
      return;
    }
    state.base = summary;
    putSummaryQuotaSafe(
      blobs,
      summary.totalBytes + state.byteDelta,
      summary.count + state.countDelta,
      () => {
        state.base = null;
      }
    );
  };
};

const sumLedgerBytes = (rows: readonly CachedRoomLedgerRecord[]): number =>
  rows.reduce((sum, row) => sum + row.approxBytes, 0);

const scanAttachmentsReadonly = (db: IDBDatabase): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const transaction = db.transaction(ATTACHMENTS_STORE, 'readonly');
    const cursorRequest = transaction
      .objectStore(ATTACHMENTS_STORE)
      .index(ATTACHMENTS_BY_ACCESS_BYTES_INDEX)
      .openKeyCursor();
    let totalBytes = 0;
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      totalBytes += (cursor.key as [number, number])[1];
      cursor.continue();
    };
    transaction.oncomplete = () => resolve(totalBytes);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const seedAttachmentBytesSummary = (db: IDBDatabase): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const transaction = db.transaction(ATTACHMENTS_STORE, 'readwrite');
    const blobs = transaction.objectStore(ATTACHMENTS_STORE);
    const summaryRequest = blobs.get(ATTACHMENT_BYTES_SUMMARY_KEY);
    const countRequest = blobs.index(ATTACHMENTS_BY_ACCESS_BYTES_INDEX).count();
    let totalBytes = 0;
    let scanned = false;
    let remaining = 2;
    const fail = (error: unknown) => {
      try {
        transaction.abort();
      } catch {
        /* Already completed or aborted. */
      }
      reject(error);
    };
    const onCheckReady = () => {
      remaining -= 1;
      if (remaining > 0) return;
      try {
        const indexCount = countRequest.result;
        const resolved = resolveSummaryBytes(summaryRequest.result as unknown, indexCount);
        if (resolved !== undefined) {
          totalBytes = resolved;
          scanned = true;
          if (indexCount === 0) writeAttachmentBytesSummary(blobs, 0, 0);
          return;
        }
        const cursorRequest = blobs.index(ATTACHMENTS_BY_ACCESS_BYTES_INDEX).openKeyCursor();
        let count = 0;
        cursorRequest.onsuccess = () => {
          try {
            const cursor = cursorRequest.result;
            if (!cursor) {
              scanned = true;
              writeAttachmentBytesSummary(blobs, totalBytes, count);
              return;
            }
            totalBytes += (cursor.key as [number, number])[1];
            count += 1;
            cursor.continue();
          } catch (error) {
            fail(error);
          }
        };
      } catch (error) {
        fail(error);
      }
    };
    summaryRequest.onsuccess = onCheckReady;
    countRequest.onsuccess = onCheckReady;
    transaction.oncomplete = () => resolve(totalBytes);
    const onFailure = () => {
      // Cursor finished and only persisting the summary hit quota: return the scanned total.
      if (scanned && isQuotaExceededError(transaction.error)) {
        resolve(totalBytes);
        return;
      }
      reject(transaction.error);
    };
    transaction.onerror = onFailure;
    transaction.onabort = onFailure;
  });

/**
 * Reads total cached text and attachment bytes without scanning `attachments` when the
 * persisted summary matches the index count. Unseeded databases run one atomic seed scan
 * on `attachments` only (leaving `room_ledger` unlocked); if persisting the summary hits
 * quota after scanning, the already-computed total is returned without a second walk.
 */
export const readTotalCachedBytes = async (db: IDBDatabase): Promise<number> => {
  const fast = await new Promise<{ ledgerBytes: number; attachmentBytes: number | undefined }>(
    (resolve, reject) => {
      const transaction = db.transaction([ATTACHMENTS_STORE, ROOM_LEDGER_STORE], 'readonly');
      const ledgerRequest = transaction.objectStore(ROOM_LEDGER_STORE).getAll();
      const blobs = transaction.objectStore(ATTACHMENTS_STORE);
      const summaryRequest = blobs.get(ATTACHMENT_BYTES_SUMMARY_KEY);
      const countRequest = blobs.index(ATTACHMENTS_BY_ACCESS_BYTES_INDEX).count();
      transaction.oncomplete = () =>
        resolve({
          ledgerBytes: sumLedgerBytes(ledgerRequest.result as CachedRoomLedgerRecord[]),
          attachmentBytes: resolveSummaryBytes(
            summaryRequest.result as unknown,
            countRequest.result
          ),
        });
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    }
  );
  if (fast.attachmentBytes !== undefined) return fast.ledgerBytes + fast.attachmentBytes;
  const attachmentBytes = await seedAttachmentBytesSummary(db).catch((error: unknown) => {
    if (isQuotaExceededError(error)) return scanAttachmentsReadonly(db);
    throw error;
  });
  return fast.ledgerBytes + attachmentBytes;
};
