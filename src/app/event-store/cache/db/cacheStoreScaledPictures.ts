import { isCacheWritable, reportCacheWriteError } from '../cacheHealth';
import {
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  openCacheStore,
} from './cacheStoreDb';
import {
  ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX,
  ATTACHMENT_REFERENCES_STORE,
  ATTACHMENTS_STORE,
  type CachedAttachmentRecord,
  type CachedAttachmentReferenceRecord,
} from './cacheStoreSchema';

/**
 * The homeserver's scaled copy of a picture, which the timeline shows for an unencrypted photo
 * without a sender thumbnail, is kept in the attachment store beside the picture's own bytes,
 * under the picture's MXC URI with this suffix (an MXC URI has no `#`).
 *
 * It has no references of its own; the picture's references own it:
 * - a write needs a live reference of the event that shows the picture;
 * - it goes when the picture's last reference goes (an edit to other media, a redaction, a
 *   cleared room);
 * - eviction weighs it with the picture's owners, and the cache's byte budget counts it.
 */
const SCALED_SUFFIX = '#scaled';

export const scaledPictureKey = (mxcUri: string): string => `${mxcUri}${SCALED_SUFFIX}`;

export const isScaledPictureKey = (key: string): boolean => key.endsWith(SCALED_SUFFIX);

/** The MXC URI whose references own a stored attachment: the key, or a scaled copy's picture. */
export const attachmentOwnerUri = (key: string): string =>
  isScaledPictureKey(key) ? key.slice(0, -SCALED_SUFFIX.length) : key;

/** The event revision that shows the picture, as its attachment references name it. */
export type ScaledPictureOwner = {
  roomId: string;
  eventId: string;
  revisionTs: number;
  revisionId?: string;
};

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const loadCachedScaledPicture = async (
  sessionId: string,
  mxcUri: string
): Promise<CachedAttachmentRecord | undefined> => {
  try {
    const db = await openCacheStore(sessionId);
    if (!db) return undefined;
    const transaction = db.transaction(ATTACHMENTS_STORE, 'readonly');
    return (await requestResult(
      transaction.objectStore(ATTACHMENTS_STORE).get(scaledPictureKey(mxcUri))
    )) as CachedAttachmentRecord | undefined;
  } catch {
    return undefined;
  }
};

/**
 * Saves the scaled copy of the picture at `mxcUri` while `owner` still references the picture.
 * Resolves whether it was saved; the caller schedules the eviction check.
 */
export const putCachedScaledPicture = async (
  sessionId: string,
  input: Pick<CachedAttachmentRecord, 'bytes' | 'mimeType' | 'mxcUri'>,
  owner: ScaledPictureOwner
): Promise<boolean> => {
  const writeLease = captureCacheStoreWriteLease(sessionId, owner.roomId);
  if (!isCacheStoreWriteLeaseCurrent(writeLease) || !isCacheWritable()) return false;
  try {
    const db = await openCacheStore(sessionId);
    if (!db || !isCacheStoreWriteLeaseCurrent(writeLease)) return false;
    const transaction = db.transaction(
      [ATTACHMENTS_STORE, ATTACHMENT_REFERENCES_STORE],
      'readwrite'
    );
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const references = (await requestResult(
      transaction
        .objectStore(ATTACHMENT_REFERENCES_STORE)
        .index(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX)
        .getAll(input.mxcUri)
    )) as CachedAttachmentReferenceRecord[];
    const owned = references.some(
      (row) =>
        row.roomId === owner.roomId &&
        row.eventId === owner.eventId &&
        row.revisionTs === owner.revisionTs &&
        (row.revisionId ?? '') === (owner.revisionId ?? '') &&
        !row.redacted
    );
    if (owned) {
      const now = Date.now();
      transaction.objectStore(ATTACHMENTS_STORE).put({
        mxcUri: scaledPictureKey(input.mxcUri),
        bytes: input.bytes,
        mimeType: input.mimeType,
        byteLength: input.bytes.byteLength,
        essential: false,
        storedAt: now,
        lastAccessedAt: now,
      } satisfies CachedAttachmentRecord);
    }
    await done;
    return owned;
  } catch (error) {
    if (isCacheStoreWriteLeaseCurrent(writeLease)) reportCacheWriteError('attachment.save', error);
    return false;
  }
};

/**
 * Deletes the scaled copies of the pictures at `mxcUris`, whose last reference went, in the
 * caller's transaction over the attachment store. Resolves with the bytes it freed.
 */
export const deleteScaledPictures = async (
  blobs: IDBObjectStore,
  mxcUris: Iterable<string>
): Promise<number> => {
  let freed = 0;
  for (const mxcUri of new Set(mxcUris)) {
    if (!mxcUri) continue;
    const key = scaledPictureKey(mxcUri);
    // eslint-disable-next-line no-await-in-loop
    const scaled = (await requestResult(blobs.get(key))) as CachedAttachmentRecord | undefined;
    if (!scaled) continue;
    blobs.delete(key);
    freed += scaled.byteLength;
  }
  return freed;
};
