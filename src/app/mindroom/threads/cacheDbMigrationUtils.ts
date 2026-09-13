type RequestLike<T> = Pick<IDBRequest<T>, 'result' | 'error' | 'onsuccess' | 'onerror'>;
type TransactionLike = Pick<
  IDBTransaction,
  'error' | 'objectStore' | 'onabort' | 'oncomplete' | 'onerror'
>;
type DatabaseLike = Pick<IDBDatabase, 'transaction'>;

export const runIdbRequest = async <T>(request: RequestLike<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const waitForIdbTransaction = async (transaction: TransactionLike): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const countObjectStoreRecords = async (
  db: DatabaseLike,
  storeName: string
): Promise<number> => {
  const transaction = db.transaction([storeName], 'readonly');
  const completion = waitForIdbTransaction(transaction);
  const count = await runIdbRequest(transaction.objectStore(storeName).count());
  await completion;
  return count;
};

const getAllObjectStoreRecords = async <T>(
  db: DatabaseLike,
  storeName: string
): Promise<T[]> => {
  const transaction = db.transaction([storeName], 'readonly');
  const completion = waitForIdbTransaction(transaction);
  const records = await runIdbRequest(transaction.objectStore(storeName).getAll() as RequestLike<T[]>);
  await completion;
  return records;
};

export const copyLegacyIndexedDbIfTargetStoreEmpty = async <
  PrimaryRecord,
  SecondaryRecord,
>({
  targetDb,
  legacyDb,
  primaryStoreName,
  secondaryStoreName,
}: {
  targetDb: DatabaseLike;
  legacyDb: DatabaseLike | undefined;
  primaryStoreName: string;
  secondaryStoreName: string;
}): Promise<boolean> => {
  if (!legacyDb) return false;
  if ((await countObjectStoreRecords(targetDb, primaryStoreName)) > 0) {
    return false;
  }

  const [primaryRecords, secondaryRecords] = await Promise.all([
    getAllObjectStoreRecords<PrimaryRecord>(legacyDb, primaryStoreName),
    getAllObjectStoreRecords<SecondaryRecord>(legacyDb, secondaryStoreName),
  ]);
  if (primaryRecords.length === 0 && secondaryRecords.length === 0) {
    return false;
  }

  const transaction = targetDb.transaction([primaryStoreName, secondaryStoreName], 'readwrite');
  const completion = waitForIdbTransaction(transaction);
  const primaryStore = transaction.objectStore(primaryStoreName);
  const secondaryStore = transaction.objectStore(secondaryStoreName);

  primaryRecords.forEach((record) => {
    primaryStore.put(record);
  });
  secondaryRecords.forEach((record) => {
    secondaryStore.put(record);
  });

  await completion;
  return true;
};

export const openExistingDatabase = async (dbName: string): Promise<IDBDatabase | undefined> => {
  if (typeof indexedDB === 'undefined') return undefined;

  return new Promise<IDBDatabase | undefined>((resolve, reject) => {
    let createdFresh = false;
    const request = indexedDB.open(dbName);

    request.onupgradeneeded = (event) => {
      createdFresh = event.oldVersion === 0;
    };

    request.onsuccess = () => {
      const db = request.result;
      if (!createdFresh) {
        resolve(db);
        return;
      }

      db.close();
      const deleteRequest = indexedDB.deleteDatabase(dbName);
      deleteRequest.onsuccess = () => resolve(undefined);
      deleteRequest.onerror = () => reject(deleteRequest.error);
      deleteRequest.onblocked = () => resolve(undefined);
    };
    request.onerror = () => reject(request.error);
  });
};
