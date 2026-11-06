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
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    vi.stubGlobal('fetch', request);

    await expect(initClient(session)).rejects.toBeInstanceOf(MissingCryptoStoreError);

    // Nothing syncs and no key goes to the homeserver (a key backup lookup may).
    const paths = request.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths.filter((path) => /\/(sync|keys\/upload)$/.test(path))).toEqual([]);
    expect(getSessionStore().sessions[0].deviceIdentityKey).toBe(identity);
  });
});
