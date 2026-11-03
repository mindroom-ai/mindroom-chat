import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_STORE_KEY,
  SessionStoreWriteError,
  getSessionStore,
  putSession,
  updateSessionCredentials,
} from './sessions';

const createStorage = (seed: Record<string, string> = {}) => {
  const state = new Map(Object.entries(seed));
  return {
    state,
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      state.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      state.delete(key);
    }),
  };
};

const login = {
  baseUrl: 'https://example.com',
  userId: '@alice:example.com',
  deviceId: 'DEVICE',
  accessToken: 'secret-access',
  refreshToken: 'secret-refresh',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('session registry safety', () => {
  it.each([
    ['malformed JSON', '{not json'],
    ['a sessions field that is not a list', JSON.stringify({ version: 1, sessions: {} })],
    ['a newer format', JSON.stringify({ version: 2, sessions: [] })],
  ])('keeps a registry with %s instead of overwriting it', (_label, raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = createStorage({ [SESSION_STORE_KEY]: raw });

    expect(() => putSession(login, undefined, storage)).toThrow(SessionStoreWriteError);
    expect(storage.state.get(SESSION_STORE_KEY)).toBe(raw);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('writes back entries it cannot read', () => {
    const unknownEntry = { sessionId: 'future', format: 'from a newer build' };
    const storage = createStorage({
      [SESSION_STORE_KEY]: JSON.stringify({ version: 1, sessions: [unknownEntry] }),
    });

    putSession(login, undefined, storage);

    const stored = JSON.parse(storage.state.get(SESSION_STORE_KEY) ?? '{}');
    expect(stored.sessions).toHaveLength(2);
    expect(stored.sessions).toContainEqual(unknownEntry);
    expect(getSessionStore(storage).sessions.map((session) => session.userId)).toEqual([
      login.userId,
    ]);
  });

  it('keeps a token refresh working when storage refuses the write, without logging tokens', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = createStorage();
    const session = putSession(login, undefined, storage);
    storage.setItem.mockImplementation(() => {
      throw new Error('blocked storage');
    });

    expect(
      updateSessionCredentials(
        session.sessionId,
        { accessToken: 'secret-access-2', refreshToken: 'secret-refresh-2' },
        storage
      )
    ).toBeUndefined();

    expect(getSessionStore(storage).sessions[0].accessToken).toBe('secret-access');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });
});
