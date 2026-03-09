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

export const seedLegacySessionStorage = async (
  page: Page,
  values: Partial<Record<(typeof LEGACY_SESSION_STORAGE_KEYS)[number], string>> = {}
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
): Promise<Record<(typeof LEGACY_SESSION_STORAGE_KEYS)[number], string | null>> =>
  page.evaluate((keys) => {
    const entries = keys.map((key) => [key, window.localStorage.getItem(key)] as const);
    return Object.fromEntries(entries) as Record<(typeof keys)[number], string | null>;
  }, LEGACY_SESSION_STORAGE_KEYS);

export const getExpectedSessionDbNames = (session: SessionLike): string[] => {
  const names = [
    `matrix-js-sdk:web-sync-store::${session.sessionId}`,
  ];

  if (session.deviceId) {
    const rustPrefix = `matrix-js-sdk::${session.sessionId}::${encodeURIComponent(
      session.deviceId
    )}`;
    names.push(`${rustPrefix}::matrix-sdk-crypto`);
  }

  return names;
};
