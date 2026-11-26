import { MatrixEvent, RelationType, type IEvent } from 'matrix-js-sdk';
import { isRecord } from '../../../lib/isRecord';
import { getSerializedRelationEvent, isSameSenderEditEvent } from '../../../matrix/editEvent';
import {
  getThreadSummaryEventInfo,
  isThreadSummaryEvent,
  type ThreadSummaryInfo,
} from '../../../matrix/protocol/threadSummary';
import { isCacheWritable, reportCacheWriteError } from '../cacheHealth';
import {
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  openCacheStore,
} from './cacheStoreDb';
import { isOtherRoomEvent } from './cacheStoreNormalize';
import {
  ENCRYPTED_THREAD_SUMMARY_META_PREFIX,
  EVENTS_STORE,
  META_STORE,
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  THREAD_SUMMARIES_STORE,
  buildEncryptedThreadSummaryMetaKey,
  buildEventCacheKey,
  buildMetaKey,
  buildRedactedRelationMetaKey,
  type CachedEventRecord,
  type CachedMetaRecord,
} from './cacheStoreSchema';
import {
  loadCachedThreadSummaries as loadSummaries,
  saveCachedThreadSummary as saveSummary,
} from './cacheStoreSummaries';

// The offline cache keeps encrypted rooms as the server sends them: events and attachments stay
// ciphertext on disk, and the client decrypts them again after a reload. A thread's title comes
// out of a decrypted notice, and the cache kept it in the clear (P2-e2ee-F011). Encrypted rooms
// now store only a plaintext-free pointer `(threadRootId -> summaryEventId)` in `meta` and
// re-decrypt the cached ciphertext notice from `events` on load.

type EncryptedRoomCheck = (roomId: string) => boolean;
type EncryptedEventDecryptor = (event: MatrixEvent) => Promise<void>;

const sessions = new Map<
  string,
  { check: EncryptedRoomCheck; decryptEvent?: EncryptedEventDecryptor }
>();

/**
 * Lets the cache of `sessionId` ask its client whether a room is encrypted and decrypt cached
 * summary notices on load. Returns a function that forgets this registration again.
 */
export const registerEncryptedRoomCheck = (
  sessionId: string,
  check: EncryptedRoomCheck,
  decryptEvent?: EncryptedEventDecryptor
): (() => void) => {
  const entry = { check, decryptEvent };
  sessions.set(sessionId, entry);
  return () => {
    if (sessions.get(sessionId) === entry) sessions.delete(sessionId);
  };
};

const isEncryptedRoom = (sessionId: string, roomId: string): boolean =>
  sessions.get(sessionId)?.check(roomId) ?? false;

const isValidEventId = (eventId: unknown): eventId is string =>
  typeof eventId === 'string' && eventId.length > 0 && !eventId.startsWith('~');

const decodeThreadRootId = (scope: unknown): string | undefined => {
  if (typeof scope !== 'string' || !scope.startsWith(ENCRYPTED_THREAD_SUMMARY_META_PREFIX)) {
    return undefined;
  }
  try {
    return (
      decodeURIComponent(scope.slice(ENCRYPTED_THREAD_SUMMARY_META_PREFIX.length)) || undefined
    );
  } catch {
    return undefined;
  }
};

const tryDecrypt = (event: MatrixEvent, decryptEvent: EncryptedEventDecryptor): Promise<void> =>
  Promise.resolve()
    .then(() => decryptEvent(event))
    .catch(() => undefined);

/** Deletes the plaintext titles the cache holds for a room, also those an older version kept. */
const forgetRoomSummaries = async (sessionId: string, roomId: string): Promise<void> => {
  const db = await openCacheStore(sessionId);
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(THREAD_SUMMARIES_STORE, 'readwrite');
    const request = transaction
      .objectStore(THREAD_SUMMARIES_STORE)
      .index(THREAD_SUMMARIES_BY_ROOM_INDEX)
      .openCursor(IDBKeyRange.only(roomId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

const decryptCachedSummaryEvent = async (
  roomId: string,
  threadRootId: string,
  rawEvent: Partial<IEvent> | undefined,
  decryptEvent: EncryptedEventDecryptor | undefined
): Promise<ThreadSummaryInfo | undefined> => {
  if (!rawEvent || isOtherRoomEvent(rawEvent, roomId) || rawEvent.unsigned?.redacted_because) {
    return undefined;
  }
  const event = new MatrixEvent({ ...rawEvent, room_id: roomId });
  if (event.isRedacted()) return undefined;

  if (event.getType() === 'm.room.encrypted' || event.isEncrypted()) {
    if (!decryptEvent) return undefined;
    await tryDecrypt(event, decryptEvent);
    if (event.isDecryptionFailure() || event.getType() === 'm.room.encrypted') return undefined;
  }

  if (event.getId() === threadRootId) return undefined;
  const relatesTo = event.getContent()['m.relates_to'];
  const decryptedThreadRootId =
    isRecord(relatesTo) &&
    relatesTo.rel_type === RelationType.Thread &&
    typeof relatesTo.event_id === 'string'
      ? relatesTo.event_id
      : undefined;
  if ((decryptedThreadRootId ?? event.threadRootId) !== threadRootId) return undefined;

  const replacement = getSerializedRelationEvent(event, RelationType.Replace);
  const unsigned = event.getUnsigned();
  const relations = unsigned['m.relations'];
  if (isRecord(relations) && RelationType.Replace in relations) {
    const otherRelations = { ...relations };
    delete otherRelations[RelationType.Replace];
    event.setUnsigned({ ...unsigned, 'm.relations': otherRelations });
  }
  if (
    replacement &&
    !isOtherRoomEvent(replacement.event, roomId) &&
    isSameSenderEditEvent(event, replacement) &&
    !replacement.isRedacted() &&
    !replacement.getUnsigned()?.redacted_because
  ) {
    replacement.event.room_id = roomId;
    if (
      decryptEvent &&
      (replacement.getType() === 'm.room.encrypted' || replacement.isEncrypted())
    ) {
      await tryDecrypt(replacement, decryptEvent);
    }
    if (
      !replacement.isRedacted() &&
      !replacement.isDecryptionFailure() &&
      replacement.getType() !== 'm.room.encrypted'
    ) {
      event.makeReplaced(replacement);
    }
  }

  if (!isThreadSummaryEvent(event)) return undefined;
  const info = getThreadSummaryEventInfo(event);
  return info?.summaryText ? info : undefined;
};

/** Saves a thread's title, storing only an event-ID pointer for encrypted rooms. */
export const saveCachedThreadSummary = async (
  sessionId: string,
  roomId: string,
  threadRootId: string,
  info: ThreadSummaryInfo
): Promise<void> => {
  if (!isEncryptedRoom(sessionId, roomId)) {
    await saveSummary(sessionId, roomId, threadRootId, info);
    return;
  }
  const lease = captureCacheStoreWriteLease(sessionId, roomId);
  await forgetRoomSummaries(sessionId, roomId).catch((error: unknown) =>
    reportCacheWriteError('threadSummaryCache.forget', error)
  );
  if (!threadRootId || !isValidEventId(info.eventId)) return;
  if (!isCacheWritable() || !isCacheStoreWriteLeaseCurrent(lease)) return;

  const { eventId } = info;
  try {
    const db = await openCacheStore(sessionId);
    if (!db || !isCacheStoreWriteLeaseCurrent(lease)) return;
    const scope = `${ENCRYPTED_THREAD_SUMMARY_META_PREFIX}${encodeURIComponent(threadRootId)}`;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(META_STORE, 'readwrite');
      const metaStore = transaction.objectStore(META_STORE);
      const redactedReq = metaStore.get(buildRedactedRelationMetaKey(roomId, eventId));
      redactedReq.onsuccess = () => {
        if (redactedReq.result) return;
        const record: CachedMetaRecord = {
          metaKey: buildEncryptedThreadSummaryMetaKey(roomId, threadRootId),
          roomId,
          scope,
          summaryEventId: eventId,
          updatedAt: Date.now(),
        };
        metaStore.put(record);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    if (isCacheStoreWriteLeaseCurrent(lease)) {
      reportCacheWriteError('threadSummaryCache.savePointer', error);
    }
  }
};

/** The titles the cache holds for a room; for encrypted rooms, decrypted from cached pointers. */
export const loadCachedThreadSummaries = async (
  sessionId: string,
  roomId: string
): Promise<Map<string, ThreadSummaryInfo>> => {
  const session = sessions.get(sessionId);
  if (!session?.check(roomId)) return loadSummaries(sessionId, roomId);

  const lease = captureCacheStoreWriteLease(sessionId, roomId);
  const db = await openCacheStore(sessionId);
  if (!db || !isCacheStoreWriteLeaseCurrent(lease)) return new Map();

  const { legacyCount, candidates } = await new Promise<{
    legacyCount: number;
    candidates: Array<{ threadRootId: string; rawEvent: Partial<IEvent> }>;
  }>((resolve, reject) => {
    const transaction = db.transaction(
      [META_STORE, EVENTS_STORE, THREAD_SUMMARIES_STORE],
      'readonly'
    );
    const metaStore = transaction.objectStore(META_STORE);
    const eventStore = transaction.objectStore(EVENTS_STORE);
    const legacyCountReq = transaction
      .objectStore(THREAD_SUMMARIES_STORE)
      .index(THREAD_SUMMARIES_BY_ROOM_INDEX)
      .count(IDBKeyRange.only(roomId));
    const pointersReq = metaStore.getAll(
      IDBKeyRange.bound(
        buildMetaKey(roomId, ENCRYPTED_THREAD_SUMMARY_META_PREFIX),
        buildMetaKey(roomId, `${ENCRYPTED_THREAD_SUMMARY_META_PREFIX}\uffff`)
      )
    );
    const pending: Array<{
      threadRootId: string;
      eventReq: IDBRequest<CachedEventRecord | undefined>;
      redactedReq: IDBRequest<CachedMetaRecord | undefined>;
    }> = [];

    pointersReq.onsuccess = () => {
      (pointersReq.result as CachedMetaRecord[]).forEach((meta) => {
        if (meta.roomId !== roomId) return;
        const threadRootId = decodeThreadRootId(meta.scope);
        if (!threadRootId || !isValidEventId(meta.summaryEventId)) return;
        pending.push({
          threadRootId,
          eventReq: eventStore.get(
            buildEventCacheKey(roomId, threadRootId, meta.summaryEventId)
          ) as IDBRequest<CachedEventRecord | undefined>,
          redactedReq: metaStore.get(
            buildRedactedRelationMetaKey(roomId, meta.summaryEventId)
          ) as IDBRequest<CachedMetaRecord | undefined>,
        });
      });
    };
    transaction.oncomplete = () =>
      resolve({
        legacyCount: legacyCountReq.result,
        candidates: pending.flatMap(({ threadRootId, eventReq, redactedReq }) =>
          !redactedReq.result && eventReq.result?.rawEvent
            ? [{ threadRootId, rawEvent: eventReq.result.rawEvent }]
            : []
        ),
      });
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  if (legacyCount > 0) await forgetRoomSummaries(sessionId, roomId);
  if (!isCacheStoreWriteLeaseCurrent(lease)) return new Map();

  const result = new Map<string, ThreadSummaryInfo>();
  await Promise.all(
    candidates.map(async ({ threadRootId, rawEvent }) => {
      const info = await decryptCachedSummaryEvent(
        roomId,
        threadRootId,
        rawEvent,
        session.decryptEvent
      );
      if (info) result.set(threadRootId, info);
    })
  );
  return isCacheStoreWriteLeaseCurrent(lease) ? result : new Map();
};
