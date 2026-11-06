import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import { initClient } from './initMatrix';
import { MissingCryptoStoreError } from '../../matrix/client/cryptoStoreContinuity';
import { createMatrixClient } from '../../matrix/client/matrixClientFactory';
import {
  getSessionRustCryptoStoreNames,
  getSessionStore,
  markCryptoStoreInitialized,
  putSession,
} from '../../matrix/session/sessions';

// After the Rust store opens, startup checks that it holds the device's own identity key, so a
// store made anew after the device's was lost never syncs or uploads keys for the device.

vi.mock('matrix-js-sdk/lib/store/indexeddb', () => ({ IndexedDBStore: vi.fn() }));
vi.mock('matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store', () => ({
  IndexedDBCryptoStore: vi.fn(),
}));
vi.mock('../../matrix/client/secretStorageKeys', () => ({
  clearSecretStorageKeys: vi.fn(),
  cryptoCallbacks: {},
}));
vi.mock('../../matrix/client/matrixClientFactory', () => ({ createMatrixClient: vi.fn() }));

const createStorageMock = () => {
  const state = new Map<string, string>();
  const storage = {
    getItem: (key: string) => state.get(key) ?? null,
    setItem: (key: string, value: string) => {
      state.set(key, value);
    },
    removeItem: (key: string) => {
      state.delete(key);
    },
  };
  return { storage };
};

/** The identity key of the Rust stores the client mocks open. */
const OWN_KEY = 'own-ed25519-key';

const ownCrypto = () => ({
  getOwnDeviceKeys: vi.fn().mockResolvedValue({ ed25519: OWN_KEY, curve25519: 'own-curve' }),
});

describe('initClient checks the identity key of the store it opens', () => {
  beforeEach(() => {
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('stops before syncing when the store that opens is not the device store it recorded', async () => {
    const { storage } = createStorageMock();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@user:example.com',
        deviceId: 'DEVICE',
        accessToken: 'token',
      },
      undefined,
      storage
    );
    markCryptoStoreInitialized(session.sessionId, 'lost-device-key', storage);
    const [cryptoStoreName] = getSessionRustCryptoStoreNames(session);
    vi.stubGlobal('localStorage', storage);
    // The check still finds the store: its deletion waits for another tab to let go of it, and
    // the Rust machine then opens a new, empty one and makes new keys in it.
    vi.stubGlobal('indexedDB', {
      databases: vi.fn().mockResolvedValue([{ name: cryptoStoreName }]),
    });
    const destroy = vi.fn().mockResolvedValue(undefined);
    vi.mocked(IndexedDBStore).mockImplementation(
      () =>
        ({ startup: vi.fn().mockResolvedValue(undefined), destroy } as unknown as IndexedDBStore)
    );
    vi.mocked(IndexedDBCryptoStore).mockImplementation(
      () => ({} as unknown as IndexedDBCryptoStore)
    );
    const authedRequest = vi.fn();
    const stopClient = vi.fn();
    const setMaxListeners = vi.fn();
    vi.mocked(createMatrixClient).mockReturnValue({
      getCrypto: ownCrypto,
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      http: { authedRequest },
      stopClient,
      setMaxListeners,
    } as never);

    await expect(initClient(session)).rejects.toBeInstanceOf(MissingCryptoStoreError);

    expect(stopClient).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(setMaxListeners).not.toHaveBeenCalled();
    expect(authedRequest).not.toHaveBeenCalled();
    expect(getSessionStore(storage).sessions[0].deviceIdentityKey).toBe('lost-device-key');
  });

  it.each([
    { answer: 'the same key', serverKey: OWN_KEY, starts: true, recorded: OWN_KEY },
    { answer: 'no keys', serverKey: undefined, starts: true, recorded: OWN_KEY },
    { answer: 'other keys', serverKey: 'lost-device-key', starts: false, recorded: undefined },
    { answer: 'nothing', serverKey: null, starts: true, recorded: undefined },
  ])(
    'checks a store opened before keys were recorded with the homeserver, which has $answer',
    async ({ serverKey, starts, recorded }) => {
      const { storage } = createStorageMock();
      const session = putSession(
        {
          baseUrl: 'https://example.com',
          userId: '@user:example.com',
          deviceId: 'DEVICE',
          accessToken: 'token',
          cryptoStoreInitialized: true,
        },
        undefined,
        storage
      );
      const [cryptoStoreName] = getSessionRustCryptoStoreNames(session);
      vi.stubGlobal('localStorage', storage);
      vi.stubGlobal('indexedDB', {
        databases: vi.fn().mockResolvedValue([{ name: cryptoStoreName }]),
      });
      vi.mocked(IndexedDBStore).mockImplementation(
        () =>
          ({
            startup: vi.fn().mockResolvedValue(undefined),
            destroy: vi.fn().mockResolvedValue(undefined),
          } as unknown as IndexedDBStore)
      );
      vi.mocked(IndexedDBCryptoStore).mockImplementation(
        () => ({} as unknown as IndexedDBCryptoStore)
      );
      const authedRequest =
        serverKey === null
          ? vi.fn().mockRejectedValue(new Error('offline'))
          : vi.fn().mockResolvedValue({
              device_keys: {
                '@user:example.com': serverKey
                  ? { DEVICE: { keys: { 'ed25519:DEVICE': serverKey, 'curve25519:DEVICE': 'c' } } }
                  : {},
              },
            });
      const setMaxListeners = vi.fn();
      vi.mocked(createMatrixClient).mockReturnValue({
        getCrypto: ownCrypto,
        initRustCrypto: vi.fn().mockResolvedValue(undefined),
        http: { authedRequest },
        stopClient: vi.fn(),
        setMaxListeners,
      } as never);

      const started = initClient(session);
      if (starts) await started;
      else await expect(started).rejects.toBeInstanceOf(MissingCryptoStoreError);

      expect(authedRequest).toHaveBeenCalledWith(
        'POST',
        '/keys/query',
        undefined,
        { device_keys: { '@user:example.com': ['DEVICE'] } },
        { localTimeoutMs: 10_000 }
      );
      expect(setMaxListeners).toHaveBeenCalledTimes(starts ? 1 : 0);
      expect(getSessionStore(storage).sessions[0].deviceIdentityKey).toBe(recorded);

      // Once recorded, the key decides without asking the homeserver again.
      if (recorded) {
        await initClient(session);
        expect(authedRequest).toHaveBeenCalledTimes(1);
      }
    }
  );

  it('records the key of a store it finds without a mark, without asking the homeserver', async () => {
    const { storage } = createStorageMock();
    const session = putSession(
      {
        baseUrl: 'https://example.com',
        userId: '@user:example.com',
        deviceId: 'DEVICE',
        accessToken: 'token',
      },
      undefined,
      storage
    );
    const [cryptoStoreName] = getSessionRustCryptoStoreNames(session);
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('indexedDB', {
      databases: vi.fn().mockResolvedValue([{ name: cryptoStoreName }]),
    });
    vi.mocked(IndexedDBStore).mockImplementation(
      () => ({ startup: vi.fn().mockResolvedValue(undefined) } as unknown as IndexedDBStore)
    );
    const authedRequest = vi.fn();
    vi.mocked(createMatrixClient).mockReturnValue({
      getCrypto: ownCrypto,
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      http: { authedRequest },
      setMaxListeners: vi.fn(),
    } as never);

    await initClient(session);

    expect(authedRequest).not.toHaveBeenCalled();
    expect(getSessionStore(storage).sessions[0].deviceIdentityKey).toBe(OWN_KEY);
    expect(getSessionStore(storage).sessions[0].cryptoStoreInitialized).toBe(true);
  });
});
