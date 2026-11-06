import { describe, expect, it } from 'vitest';
import {
  SESSION_STORE_KEY,
  getRecordedDeviceIdentityKey,
  getSessionStore,
  markCryptoStoreInitialized,
  putSession,
} from './sessions';

const createStorage = () => {
  const state = new Map<string, string>();
  return {
    getItem: (key: string) => state.get(key) ?? null,
    setItem: (key: string, value: string) => {
      state.set(key, value);
    },
    removeItem: (key: string) => {
      state.delete(key);
    },
  };
};

const LOGIN = {
  baseUrl: 'https://example.com',
  userId: '@alice:example.com',
  deviceId: 'DEVICE_A',
  accessToken: 'token-a',
};

describe('the recorded device identity key', () => {
  it('is kept with the crypto store mark and forgotten when a new device replaces the login', () => {
    const storage = createStorage();
    const { sessionId } = putSession(LOGIN, undefined, storage);
    expect(getRecordedDeviceIdentityKey(sessionId, storage)).toBeUndefined();

    markCryptoStoreInitialized(sessionId, 'key-a', storage);
    putSession({ ...LOGIN, accessToken: 'token-b' }, undefined, storage);
    expect(getRecordedDeviceIdentityKey(sessionId, storage)).toBe('key-a');

    putSession({ ...LOGIN, deviceId: 'DEVICE_B', accessToken: 'token-c' }, undefined, storage);
    expect(getRecordedDeviceIdentityKey(sessionId, storage)).toBeUndefined();
    expect(getSessionStore(storage).sessions[0]?.cryptoStoreInitialized).toBeUndefined();
  });

  it('records the key of a store marked before keys were recorded', () => {
    const storage = createStorage();
    const { sessionId } = putSession(
      { ...LOGIN, cryptoStoreInitialized: true },
      undefined,
      storage
    );

    markCryptoStoreInitialized(sessionId, 'key-a', storage);

    expect(getRecordedDeviceIdentityKey(sessionId, storage)).toBe('key-a');
  });

  it('reads back after a reload, and ignores a stored value that is not text', () => {
    const storage = createStorage();
    const { sessionId } = putSession(LOGIN, undefined, storage);
    markCryptoStoreInitialized(sessionId, 'key-a', storage);
    const raw = JSON.parse(storage.getItem(SESSION_STORE_KEY) ?? '{}') as {
      sessions: { deviceIdentityKey?: unknown }[];
    };
    const [stored] = raw.sessions;
    expect(stored?.deviceIdentityKey).toBe('key-a');

    raw.sessions = [{ ...stored, deviceIdentityKey: 42 }];
    storage.setItem(SESSION_STORE_KEY, JSON.stringify(raw));

    expect(getRecordedDeviceIdentityKey(sessionId, storage)).toBeUndefined();
  });
});
