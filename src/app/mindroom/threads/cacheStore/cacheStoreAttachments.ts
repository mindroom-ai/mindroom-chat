import { isCacheWritable, reportCacheWriteError } from '../cacheHealth';
import {
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  openCacheStore,
  type CacheStoreWriteLease,
} from './cacheStoreDb';
import {
  ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX,
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
  options: Pick<CacheAttachmentWriteOptions, 'essential' | 'roomId' | 'signal'>
): Promise<void> => {
  const storeNames = options.roomId
    ? [ATTACHMENTS_STORE, ATTACHMENT_REFERENCES_STORE]
    : [ATTACHMENTS_STORE];
  const transaction = db.transaction(storeNames, 'readwrite');
  const abortTransaction = () => {
    try {
      transaction.abort();
    } catch {
      // The transaction already completed or aborted.
    }
  };
  options.signal?.addEventListener('abort', abortTransaction, { once: true });
  if (options.signal?.aborted) {
    abortTransaction();
    options.signal.removeEventListener('abort', abortTransaction);
    throw abortError();
  }
  const attachmentStore = transaction.objectStore(ATTACHMENTS_STORE);
  const previousAttachmentRequest = attachmentStore.get(input.mxcUri);
  previousAttachmentRequest.onsuccess = () => {
    const previous = previousAttachmentRequest.result as CachedAttachmentRecord | undefined;
    const now = Date.now();
    const record: CachedAttachmentRecord = {
      mxcUri: input.mxcUri,
      bytes: previous?.bytes ?? input.bytes,
      mimeType: previous?.mimeType || input.mimeType,
      byteLength: previous?.byteLength ?? input.bytes.byteLength,
      essential: previous?.essential === true || options.essential === true,
      storedAt: previous?.storedAt ?? now,
      lastAccessedAt: now,
    };
    attachmentStore.put(record);

    if (!options.roomId) return;
    const referenceStore = transaction.objectStore(ATTACHMENT_REFERENCES_STORE);
    const referenceKey = buildAttachmentReferenceKey(options.roomId, input.mxcUri);
    const previousReferenceRequest = referenceStore.get(referenceKey);
    previousReferenceRequest.onsuccess = () => {
      const previousReference = previousReferenceRequest.result as
        | CachedAttachmentReferenceRecord
        | undefined;
      const reference: CachedAttachmentReferenceRecord = {
        referenceKey,
        mxcUri: input.mxcUri,
        roomId: options.roomId as string,
        byteLength: record.byteLength,
        essential: previousReference?.essential === true || options.essential === true,
        status: 'cached',
        updatedAt: now,
      };
      referenceStore.put(reference);
    };
  };
  try {
    await transactionComplete(transaction);
    if (options.signal?.aborted) throw abortError();
  } finally {
    options.signal?.removeEventListener('abort', abortTransaction);
  }
};

export const putCachedAttachment = async (
  sessionId: string,
  input: Pick<CachedAttachmentRecord, 'bytes' | 'mimeType' | 'mxcUri'>,
  options: CacheAttachmentWriteOptions = {}
): Promise<CacheAttachmentWriteStatus> => {
  const writeLease = options.writeLease ?? captureCacheStoreWriteLease(sessionId);
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
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
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
