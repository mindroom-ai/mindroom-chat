import { describe, expect, it } from 'vitest';
import { copyLegacyIndexedDbIfTargetStoreEmpty } from './cacheDbMigrationUtils';

type MockStoreState = Record<string, unknown[]>;

const createRequest = <T>(result: T) => {
  const request: {
    result: T;
    error: null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
  } = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
  };

  queueMicrotask(() => {
    request.onsuccess?.();
  });

  return request;
};

const createMockDb = (state: MockStoreState): Pick<IDBDatabase, 'transaction'> =>
  ({
    transaction: ([primaryStoreName, secondaryStoreName]: string[], _mode: string) => {
      const transaction: {
        error: null;
        onabort: (() => void) | null;
        oncomplete: (() => void) | null;
        onerror: (() => void) | null;
        objectStore: (storeName: string) => {
          count: () => ReturnType<typeof createRequest<number>>;
          getAll: () => ReturnType<typeof createRequest<unknown[]>>;
          put: (value: unknown) => void;
        };
      } = {
        error: null,
        onabort: null,
        oncomplete: null,
        onerror: null,
        objectStore: (storeName: string) => ({
          count: () => createRequest((state[storeName] ?? []).length),
          getAll: () => createRequest([...(state[storeName] ?? [])]),
          put: (value: unknown) => {
            if (!state[storeName]) {
              state[storeName] = [];
            }
            state[storeName].push(value);
          },
        }),
      };

      if (!state[primaryStoreName]) {
        state[primaryStoreName] = [];
      }
      if (secondaryStoreName && !state[secondaryStoreName]) {
        state[secondaryStoreName] = [];
      }

      queueMicrotask(() => {
        transaction.oncomplete?.();
      });

      return transaction;
    },
  } as unknown as Pick<IDBDatabase, 'transaction'>);

describe('copyLegacyIndexedDbIfTargetStoreEmpty', () => {
  it('copies legacy records into an empty target database', async () => {
    const legacyState = {
      events: [{ id: 'event-1' }],
      meta: [{ id: 'meta-1' }],
    };
    const targetState = {
      events: [],
      meta: [],
    };

    const didCopy = await copyLegacyIndexedDbIfTargetStoreEmpty({
      targetDb: createMockDb(targetState),
      legacyDb: createMockDb(legacyState),
      primaryStoreName: 'events',
      secondaryStoreName: 'meta',
    });

    expect(didCopy).toBe(true);
    expect(targetState).toEqual(legacyState);
  });

  it('does not overwrite an already populated target database', async () => {
    const legacyState = {
      events: [{ id: 'legacy-event' }],
      meta: [{ id: 'legacy-meta' }],
    };
    const targetState = {
      events: [{ id: 'target-event' }],
      meta: [],
    };

    const didCopy = await copyLegacyIndexedDbIfTargetStoreEmpty({
      targetDb: createMockDb(targetState),
      legacyDb: createMockDb(legacyState),
      primaryStoreName: 'events',
      secondaryStoreName: 'meta',
    });

    expect(didCopy).toBe(false);
    expect(targetState).toEqual({
      events: [{ id: 'target-event' }],
      meta: [],
    });
  });

  it('does nothing when the legacy database is missing or empty', async () => {
    const targetState = {
      events: [],
      meta: [],
    };

    expect(
      await copyLegacyIndexedDbIfTargetStoreEmpty({
        targetDb: createMockDb(targetState),
        legacyDb: undefined,
        primaryStoreName: 'events',
        secondaryStoreName: 'meta',
      })
    ).toBe(false);

    expect(
      await copyLegacyIndexedDbIfTargetStoreEmpty({
        targetDb: createMockDb(targetState),
        legacyDb: createMockDb({ events: [], meta: [] }),
        primaryStoreName: 'events',
        secondaryStoreName: 'meta',
      })
    ).toBe(false);
    expect(targetState).toEqual({
      events: [],
      meta: [],
    });
  });
});
