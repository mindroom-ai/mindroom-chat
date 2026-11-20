import 'fake-indexeddb/auto';
import {
  DeviceId,
  OlmMachine,
  StoreHandle,
  UserId,
  initAsync,
} from '@matrix-org/matrix-sdk-crypto-wasm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissingCryptoStoreError } from '../../matrix/client/cryptoStoreContinuity';
import {
  getSessionRustCryptoStoreNames,
  getSessionRustCryptoStorePrefix,
  getSessionStore,
  markCryptoStoreInitialized,
  putSession,
} from '../../matrix/session/sessions';
import { initClient } from './initMatrix';

// With the real Rust crypto machine: a device's store that is still there when startup checks for
// it, and gone when the machine opens it (its deletion waited for another tab to close it), must
// not become a new store with new keys for the device.
describe('a crypto store that vanishes after the startup check', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stops before it syncs or uploads keys, instead of making new keys for the device', async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
    });
    const session = putSession({
      baseUrl: 'https://matrix.example',
      userId: '@alice:example',
      deviceId: 'EXISTING',
      accessToken: 'test-token',
    });
    await initAsync();
    const store = await StoreHandle.open(getSessionRustCryptoStorePrefix(session), undefined);
    const machine = await OlmMachine.initFromStore(
      new UserId(session.userId),
      new DeviceId(session.deviceId),
      store
    );
    const identity = machine.identityKeys.ed25519.toBase64();
    machine.free();
    store.free();
    markCryptoStoreInitialized(session.sessionId, identity);

    const listed = await indexedDB.databases();
    const [cryptoStoreName] = getSessionRustCryptoStoreNames(session);
    expect(listed.map(({ name }) => name)).toContain(cryptoStoreName);
    vi.spyOn(indexedDB, 'databases').mockResolvedValue(listed);
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(cryptoStoreName);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
    });
    // A homeserver without a key backup answers the lookup with 404. An empty object is no backup
    // info: matrix-js-sdk 45 no longer ignores one without a version and fails its background check.
    const request = vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname.endsWith('/room_keys/version')
        ? new Response(
            JSON.stringify({ errcode: 'M_NOT_FOUND', error: 'No current backup version' }),
            {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        : new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    vi.stubGlobal('fetch', request);

    await expect(initClient(session)).rejects.toBeInstanceOf(MissingCryptoStoreError);

    // Nothing syncs and no key goes to the homeserver (a key backup lookup may).
    const paths = request.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths.filter((path) => /\/(sync|keys\/upload)$/.test(path))).toEqual([]);
    expect(getSessionStore().sessions[0]?.deviceIdentityKey).toBe(identity);
  });
});
