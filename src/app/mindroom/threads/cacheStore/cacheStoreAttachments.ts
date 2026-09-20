import { isCacheWritable, reportCacheWriteError } from '../cacheHealth';
import {
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  openCacheStore,
  type CacheStoreWriteLease,
} from './cacheStoreDb';
import {
  ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX,
  ATTACHMENT_REFERENCES_BY_ROOM_INDEX,
  ROOM_LEDGER_STORE,
  type CachedRoomLedgerRecord,
  ATTACHMENT_REFERENCES_STORE,
  ATTACHMENTS_STORE,
  buildAttachmentReferenceKey,
  type CachedAttachmentRecord,
  type CachedAttachmentReferenceRecord,
} from './cacheStoreSchema';

export type CachedAttachmentMetadata = Omit<CachedAttachmentRecord, 'bytes'> & {
  references: CachedAttachmentReferenceRecord[];
};

export type CacheAttachmentWriteStatus = 'committed' | 'failed' | 'revoked' | 'unavailable';

export type CacheAttachmentWriteOptions = {
  essential?: boolean;
  roomId?: string;
  eventId?: string;
  revisionTs?: number;
  revisionId?: string;
  signal?: AbortSignal;
  writeLease?: CacheStoreWriteLease;
};

const abortError = (): DOMException => new DOMException('The operation was aborted', 'AbortError');

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionComplete = (transaction: IDBTransaction): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

export const loadCachedAttachment = async (
  sessionId: string,
  mxcUri: string
): Promise<CachedAttachmentRecord | undefined> => {
  try {
    const db = await openCacheStore(sessionId);
    if (!db) return undefined;
    const transaction = db.transaction(ATTACHMENTS_STORE, 'readonly');
    return (await requestResult(transaction.objectStore(ATTACHMENTS_STORE).get(mxcUri))) as
      | CachedAttachmentRecord
      | undefined;
  } catch {
    return undefined;
  }
};

const putAttachmentTransaction = async (
  db: IDBDatabase,
  input: Pick<CachedAttachmentRecord, 'bytes' | 'mimeType' | 'mxcUri'>,
  options: CacheAttachmentWriteOptions
): Promise<void> => {
  const transaction = db.transaction([ATTACHMENTS_STORE, ATTACHMENT_REFERENCES_STORE], 'readwrite');
  const done = transactionComplete(transaction);
  const abortTransaction = () => {
    try {
      transaction.abort();
    } catch {
      /* Already completed. */
    }
  };
  options.signal?.addEventListener('abort', abortTransaction, { once: true });
  try {
    if (options.signal?.aborted) throw abortError();
    const blobs = transaction.objectStore(ATTACHMENTS_STORE);
    const refs = transaction.objectStore(ATTACHMENT_REFERENCES_STORE);
    const [previous, references] = await Promise.all([
      requestResult(blobs.get(input.mxcUri)) as Promise<CachedAttachmentRecord | undefined>,
      requestResult(
        refs.index(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX).getAll(input.mxcUri)
      ) as Promise<CachedAttachmentReferenceRecord[]>,
    ]);
    if (options.signal?.aborted) throw abortError();
    if (
      !options.eventId ||
      references.some(
        (row) =>
          row.roomId === options.roomId &&
          row.eventId === options.eventId &&
          row.revisionTs === options.revisionTs &&
          (row.revisionId ?? '') === (options.revisionId ?? '') &&
          !row.redacted
      )
    ) {
      const now = Date.now();
      const record: CachedAttachmentRecord = {
        mxcUri: input.mxcUri,
        bytes: previous?.bytes ?? input.bytes,
        mimeType: previous?.mimeType || input.mimeType,
        byteLength: previous?.byteLength ?? input.bytes.byteLength,
        storedAt: previous?.storedAt ?? now,
        lastAccessedAt: now,
        essential: previous?.essential === true || options.essential === true,
      };
      const updated = references.map(
        (row): CachedAttachmentReferenceRecord => ({
          ...row,
          byteLength: record.byteLength,
          updatedAt: now,
          status:
            record.byteLength <= (row.maxBytes ?? Infinity) &&
            (!row.essential || options.essential || row.status === 'cached')
              ? 'cached'
              : 'missing',
        })
      );
      updated.forEach((row) => refs.put(row));
      if (references.length)
        record.essential = updated.some((row) => row.essential && row.status === 'cached');
      if (
        options.roomId &&
        !options.eventId &&
        !references.some((row) => row.roomId === options.roomId && row.eventId)
      ) {
        const referenceKey = buildAttachmentReferenceKey(options.roomId, input.mxcUri);
        const essential =
          references.some((row) => row.referenceKey === referenceKey && row.essential) ||
          options.essential === true;
        refs.put({
          referenceKey,
          roomId: options.roomId,
          mxcUri: input.mxcUri,
          byteLength: record.byteLength,
          essential,
          status: 'cached',
          updatedAt: now,
        });
        record.essential ||= essential;
      }
      blobs.put(record);
    }
    await done;
  } catch (error) {
    abortTransaction();
    await done.catch(() => undefined);
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', abortTransaction);
  }
};

export const putCachedAttachment = async (
  sessionId: string,
  input: Pick<CachedAttachmentRecord, 'bytes' | 'mimeType' | 'mxcUri'>,
  options: CacheAttachmentWriteOptions = {}
): Promise<CacheAttachmentWriteStatus> => {
  const writeLease = options.writeLease ?? captureCacheStoreWriteLease(sessionId, options.roomId);
  if (options.signal?.aborted) throw abortError();
  if (!isCacheStoreWriteLeaseCurrent(writeLease)) return 'revoked';
  if (!isCacheWritable()) return 'unavailable';

  try {
    const db = await openCacheStore(sessionId);
    if (!db) return 'unavailable';
    if (options.signal?.aborted) throw abortError();
    if (!isCacheStoreWriteLeaseCurrent(writeLease)) return 'revoked';

    await putAttachmentTransaction(db, input, options);
    return 'committed';
  } catch (error) {
    if (options.signal?.aborted) {
      throw abortError();
    }
    reportCacheWriteError('attachment.save', error);
    return 'failed';
  }
};

export const getCachedAttachmentMetadata = async (
  sessionId: string,
  mxcUri: string
): Promise<CachedAttachmentMetadata | undefined> => {
  try {
    const db = await openCacheStore(sessionId);
    if (!db) return undefined;
    const transaction = db.transaction(
      [ATTACHMENTS_STORE, ATTACHMENT_REFERENCES_STORE],
      'readonly'
    );
    const attachmentRequest = transaction.objectStore(ATTACHMENTS_STORE).get(mxcUri);
    const referenceRequest = transaction
      .objectStore(ATTACHMENT_REFERENCES_STORE)
      .index(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX)
      .getAll(mxcUri);
    const [record, references] = await Promise.all([
      requestResult(attachmentRequest),
      requestResult(referenceRequest),
    ]);
    if (!record) return undefined;
    const { bytes: _bytes, ...metadata } = record as CachedAttachmentRecord;
    return {
      ...metadata,
      references: references as CachedAttachmentReferenceRecord[],
    };
  } catch {
    return undefined;
  }
};

export type AttachmentReferenceInput = {
  mxcUri: string;
  essential: boolean;
  maxBytes?: number;
  validated?: boolean;
};

/** Replace one message's current references, including a tombstone after redaction.
 * Only identity and retention metadata enter this store; encryption keys stay in events.
 */
export const replaceCachedAttachmentReferences = async (
  sessionId: string,
  roomId: string,
  eventId: string,
  revisionTs: number,
  inputs: readonly AttachmentReferenceInput[],
  writeLease = captureCacheStoreWriteLease(sessionId, roomId),
  revision: {
    revisionId?: string;
    redacted?: boolean;
    merge?: boolean;
    /** Verified edit redactions supplied only after canonical relation repair. */
    retractedRevisionIds?: readonly string[];
  } = {}
): Promise<CacheAttachmentWriteStatus> => {
  if (!isCacheStoreWriteLeaseCurrent(writeLease)) return 'revoked';
  if (!isCacheWritable()) return 'unavailable';
  let transaction: IDBTransaction | undefined;
  let done: Promise<void> | undefined;
  try {
    const db = await openCacheStore(sessionId);
    if (!db) return 'unavailable';
    if (!isCacheStoreWriteLeaseCurrent(writeLease)) return 'revoked';
    transaction = db.transaction([ATTACHMENTS_STORE, ATTACHMENT_REFERENCES_STORE], 'readwrite');
    done = transactionComplete(transaction);
    const refs = transaction.objectStore(ATTACHMENT_REFERENCES_STORE);
    const blobs = transaction.objectStore(ATTACHMENTS_STORE);
    const previous = (await requestResult(
      refs.index(ATTACHMENT_REFERENCES_BY_ROOM_INDEX).getAll(roomId)
    )) as CachedAttachmentReferenceRecord[];
    const owned = previous.filter((row) => row.eventId === eventId);
    const retractedRevisionIds = new Set(
      [
        ...owned.flatMap((row) => row.retractedRevisionIds ?? []),
        ...(revision.retractedRevisionIds ?? []),
      ].filter(Boolean)
    );
    if (
      (!revision.redacted && retractedRevisionIds.has(revision.revisionId ?? '')) ||
      owned.some(
        (row) =>
          row.redacted ||
          (!revision.redacted &&
            !(row.revisionId && revision.retractedRevisionIds?.includes(row.revisionId)) &&
            ((row.revisionTs ?? 0) > revisionTs ||
              (row.revisionTs === revisionTs &&
                (row.revisionId ?? '') > (revision.revisionId ?? ''))))
      )
    ) {
      await done;
      return 'revoked';
    }
    // Individual consumers add sibling media only within the same authoritative revision.
    const merged = new Map<string, AttachmentReferenceInput>();
    if (revision.merge) {
      owned
        .filter(
          (row) =>
            row.mxcUri &&
            row.revisionTs === revisionTs &&
            (row.revisionId ?? '') === (revision.revisionId ?? '')
        )
        .forEach((row) => {
          merged.set(row.mxcUri, {
            mxcUri: row.mxcUri,
            essential: row.essential,
            maxBytes: row.maxBytes,
            validated: row.status === 'cached',
          });
        });
    }
    inputs.forEach((input) => {
      const previousInput = merged.get(input.mxcUri);
      merged.set(input.mxcUri, {
        ...input,
        essential: input.essential || previousInput?.essential === true,
        maxBytes: previousInput?.essential ? previousInput.maxBytes : input.maxBytes,
        validated: input.validated || previousInput?.validated,
      });
    });
    const entries: AttachmentReferenceInput[] = merged.size
      ? [...merged.values()]
      : [{ mxcUri: '', essential: false }];
    const removed = previous.filter(
      (row) =>
        row.eventId === eventId ||
        (!row.eventId && entries.some((entry) => entry.mxcUri === row.mxcUri))
    );
    removed.forEach((row) => refs.delete(row.referenceKey));
    for (const input of entries) {
      // eslint-disable-next-line no-await-in-loop
      const cached = (await requestResult(blobs.get(input.mxcUri))) as
        | CachedAttachmentRecord
        | undefined;
      refs.put({
        referenceKey: buildAttachmentReferenceKey(roomId, input.mxcUri, eventId),
        roomId,
        eventId,
        revisionTs,
        revisionId: revision.revisionId,
        retractedRevisionIds: [...retractedRevisionIds],
        redacted: revision.redacted,
        mxcUri: input.mxcUri,
        essential: input.essential,
        maxBytes: input.maxBytes,
        byteLength: cached?.byteLength ?? 0,
        status:
          cached &&
          (!input.essential || input.validated) &&
          cached.byteLength <= (input.maxBytes ?? Infinity)
            ? 'cached'
            : 'missing',
        updatedAt: Date.now(),
      } satisfies CachedAttachmentReferenceRecord);
    }
    for (const mxcUri of new Set(
      [...removed, ...entries].map((row) => row.mxcUri).filter(Boolean)
    )) {
      // eslint-disable-next-line no-await-in-loop
      const cached = (await requestResult(blobs.get(mxcUri))) as CachedAttachmentRecord | undefined;
      if (!cached) continue;
      // eslint-disable-next-line no-await-in-loop
      const remaining = (await requestResult(
        refs.index(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX).getAll(mxcUri)
      )) as CachedAttachmentReferenceRecord[];
      if (!remaining.length) blobs.delete(mxcUri);
      else
        blobs.put({
          ...cached,
          essential: remaining.some((row) => row.essential && row.status === 'cached'),
        });
    }
    await done;
    return 'committed';
  } catch (error) {
    try {
      transaction?.abort();
    } catch {
      /* Already completed. */
    }
    await done?.catch(() => undefined);
    reportCacheWriteError('attachment.references', error);
    return 'failed';
  }
};

export const readRoomAttachmentStorage = async (sessionId: string, roomId: string) => {
  const db = await openCacheStore(sessionId);
  if (!db) return { bytes: 0, saved: 0, missing: 0, missingEssential: 0, pinned: false };
  const transaction = db.transaction([ATTACHMENT_REFERENCES_STORE, ROOM_LEDGER_STORE], 'readonly');
  const [references, ledger] = await Promise.all([
    requestResult(
      transaction
        .objectStore(ATTACHMENT_REFERENCES_STORE)
        .index(ATTACHMENT_REFERENCES_BY_ROOM_INDEX)
        .getAll(roomId)
    ) as Promise<CachedAttachmentReferenceRecord[]>,
    requestResult(transaction.objectStore(ROOM_LEDGER_STORE).get(roomId)) as Promise<
      CachedRoomLedgerRecord | undefined
    >,
  ]);
  const byUri = new Map<
    string,
    { byteLength: number; saved: boolean; missingEssential: boolean }
  >();
  references
    .filter((row) => row.mxcUri)
    .forEach((row) => {
      const previous = byUri.get(row.mxcUri);
      byUri.set(row.mxcUri, {
        byteLength: Math.max(row.byteLength, previous?.byteLength ?? 0),
        saved: row.status === 'cached' && previous?.saved !== false,
        missingEssential:
          (row.essential && row.status === 'missing') || previous?.missingEssential === true,
      });
    });
  const rows = [...byUri.values()];
  return {
    bytes: rows.reduce((sum, row) => sum + row.byteLength, 0),
    saved: rows.filter((row) => row.saved).length,
    missing: rows.filter((row) => !row.saved).length,
    missingEssential: rows.filter((row) => row.missingEssential).length,
    pinned: ledger?.pinned === true,
  };
};

export const setRoomAttachmentPinned = async (
  sessionId: string,
  roomId: string,
  pinned: boolean
): Promise<void> => {
  const db = await openCacheStore(sessionId);
  if (!db) return;
  const transaction = db.transaction(ROOM_LEDGER_STORE, 'readwrite');
  const done = transactionComplete(transaction);
  const ledger = transaction.objectStore(ROOM_LEDGER_STORE);
  const previous = (await requestResult(ledger.get(roomId))) as CachedRoomLedgerRecord | undefined;
  ledger.put({
    ...previous,
    roomId,
    pinned,
    approxBytes: previous?.approxBytes ?? 0,
    eventCount: previous?.eventCount ?? 0,
    lastActivityTs: previous?.lastActivityTs ?? 0,
  });
  await done;
};
