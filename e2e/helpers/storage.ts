import { Page } from '@playwright/test';

type SessionLike = {
  sessionId: string;
  deviceId?: string;
};

const LEGACY_SESSION_STORAGE_KEYS = [
  'cinny_access_token',
  'cinny_device_id',
  'cinny_user_id',
  'cinny_hs_base_url',
] as const;

export const readIndexedDbNames = async (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const databases = await indexedDB.databases();
    return databases
      .map((database) => database.name)
      .filter((name): name is string => typeof name === 'string')
      .sort();
  });

const THREAD_SUMMARY_CACHE_DB = 'mindroom-thread-summary-cache';
const SESSION_DB_PREFIX = '::';

export const getThreadSummaryCacheDbName = (sessionId: string): string =>
  `${THREAD_SUMMARY_CACHE_DB}${SESSION_DB_PREFIX}${sessionId}`;

export const createIndexedDbNames = async (page: Page, names: string[]): Promise<void> => {
  await page.evaluate(async (dbNames) => {
    const openDatabase = (name: string) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onerror = () => reject(request.error ?? new Error(`Failed to open ${name}`));
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('store')) {
            db.createObjectStore('store');
          }
        };
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      });

    await Promise.all(dbNames.map((name) => openDatabase(name)));
  }, names);
};

export const seedThreadSummaryCache = async ({
  page,
  sessionId,
  roomId,
  threadRootId,
  summaryText,
  generatedTs,
  messageCount,
}: {
  page: Page;
  sessionId: string;
  roomId: string;
  threadRootId: string;
  summaryText: string;
  generatedTs?: number;
  messageCount?: number;
}): Promise<void> => {
  await page.evaluate(
    async ({ dbName, room, rootId, summary, generatedAt, count }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('thread_summaries')) {
            const store = db.createObjectStore('thread_summaries', { keyPath: 'cacheKey' });
            store.createIndex('by_room', 'roomId', { unique: false });
          }
        };

        request.onerror = () => reject(request.error ?? new Error(`Failed to open ${dbName}`));
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('thread_summaries', 'readwrite');
          const store = transaction.objectStore('thread_summaries');

          store.put({
            cacheKey: `${room}|${rootId}`,
            roomId: room,
            threadRootId: rootId,
            summaryText: summary,
            generatedTs: generatedAt,
            messageCount: count,
            updatedAt: Date.now(),
          });

          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () =>
            reject(transaction.error ?? new Error('Failed to seed cache'));
          transaction.onabort = () => reject(transaction.error ?? new Error('Seeding aborted'));
        };
      });
    },
    {
      dbName: getThreadSummaryCacheDbName(sessionId),
      room: roomId,
      rootId: threadRootId,
      summary: summaryText,
      generatedAt: generatedTs,
      count: messageCount,
    }
  );
};

export const seedLegacySessionStorage = async (
  page: Page,
  values: Partial<Record<typeof LEGACY_SESSION_STORAGE_KEYS[number], string>> = {}
): Promise<void> => {
  await page.evaluate(
    ({ keys, seededValues }) => {
      keys.forEach((key) => {
        window.localStorage.setItem(key, seededValues[key] ?? `seeded-${key}`);
      });
    },
    { keys: LEGACY_SESSION_STORAGE_KEYS, seededValues: values }
  );
};

export const readLegacySessionStorage = async (
  page: Page
): Promise<Record<typeof LEGACY_SESSION_STORAGE_KEYS[number], string | null>> =>
  page.evaluate((keys) => {
    const entries = keys.map((key) => [key, window.localStorage.getItem(key)] as const);
    return Object.fromEntries(entries) as Record<typeof keys[number], string | null>;
  }, LEGACY_SESSION_STORAGE_KEYS);

export const getExpectedSessionDbNames = (session: SessionLike): string[] => {
  const names = [`matrix-js-sdk:web-sync-store::${session.sessionId}`];

  if (session.deviceId) {
    const rustPrefix = `matrix-js-sdk::${session.sessionId}::${encodeURIComponent(
      session.deviceId
    )}`;
    names.push(`${rustPrefix}::matrix-sdk-crypto`);
  }

  return names;
};

const findMindroomCacheDbNames = async (page: Page, dbPrefix: string): Promise<string[]> =>
  page.evaluate(async (prefix) => {
    const databases = await indexedDB.databases();
    return databases
      .map((database) => database.name)
      .filter((name): name is string => typeof name === 'string' && name.startsWith(prefix));
  }, dbPrefix);

const readStoreRecords = async (
  page: Page,
  dbNames: string[],
  storeName: string
): Promise<Record<string, unknown>[]> =>
  page.evaluate(
    async ({ names, store }) => {
      const readAll = (dbName: string) =>
        new Promise<Record<string, unknown>[]>((resolve, reject) => {
          const request = indexedDB.open(dbName);
          request.onerror = () => reject(request.error ?? new Error(`Failed to open ${dbName}`));
          request.onsuccess = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(store)) {
              db.close();
              resolve([]);
              return;
            }
            const transaction = db.transaction(store, 'readonly');
            const getAllRequest = transaction.objectStore(store).getAll();
            getAllRequest.onerror = () =>
              reject(getAllRequest.error ?? new Error(`Failed to read ${store}`));
            transaction.oncomplete = () => {
              db.close();
              resolve((getAllRequest.result ?? []) as Record<string, unknown>[]);
            };
            transaction.onerror = () => reject(transaction.error ?? new Error('read failed'));
          };
        });

      const recordLists = await Promise.all(names.map((name) => readAll(name)));
      return recordLists.flat();
    },
    { names: dbNames, store: storeName }
  );

export const readThreadEventCacheRecords = async (
  page: Page,
  roomId: string,
  threadId: string
): Promise<{ eventId: string; eventType?: string }[]> => {
  const dbNames = await findMindroomCacheDbNames(page, 'mindroom-thread-event-cache');
  const records = await readStoreRecords(page, dbNames, 'thread_events');
  return records
    .filter((record) => record.roomId === roomId && record.threadId === threadId)
    .map((record) => ({
      eventId: String(record.eventId ?? ''),
      eventType: (record.rawEvent as { type?: string } | undefined)?.type,
    }));
};

export const readRoomEventCacheEventIds = async (page: Page, roomId: string): Promise<string[]> => {
  const dbNames = await findMindroomCacheDbNames(page, 'mindroom-room-event-cache');
  const records = await readStoreRecords(page, dbNames, 'room_events');
  return records
    .filter((record) => record.roomId === roomId)
    .map((record) => String(record.eventId ?? ''));
};
