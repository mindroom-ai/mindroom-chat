import type { MatrixClient } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredSession } from '../session/sessions';
import {
  clearAllCacheAndReload,
  logoutClient,
  logoutStoredSession,
  removeStoredSession,
} from '../../account/lifecycle/initMatrix';

const lifecycle = vi.hoisted(() => ({
  clearAllCacheAndReload: vi.fn(async () => undefined),
  logoutClient: vi.fn(async () => undefined),
  removeStoredSession: vi.fn(async () => undefined),
  removeCurrentClientSessionAndReload: vi.fn(),
  removeSessionAndReload: vi.fn(),
}));
const clearFetchedAvatars = vi.hoisted(() => vi.fn());
const server = vi.hoisted(() => ({
  logout: vi.fn(async (_stopClient?: boolean): Promise<object> => ({})),
  createMatrixClient: vi.fn(),
}));

vi.mock('../../account/lifecycle/sessionLifecycle', () => lifecycle);
vi.mock('../../avatars/avatarMedia', () => ({ clearFetchedAvatars }));
vi.mock('./matrixClientFactory', () => ({
  createMatrixClient: server.createMatrixClient.mockImplementation(() => ({
    logout: server.logout,
  })),
}));
vi.mock('../../native/cloudflareAccess', () => ({
  renewExpiredCloudflareAccess: vi.fn(async () => undefined),
}));

const client = { getSafeUserId: () => '@alice:hs.test' } as unknown as MatrixClient;
const session = { sessionId: 'bob-session', userId: '@bob:hs.test' } as StoredSession;

describe('signing out drops the avatars the account fetched', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs out, then drops the account’s avatars', async () => {
    await logoutClient(client);

    expect(lifecycle.logoutClient).toHaveBeenCalledWith(client);
    expect(clearFetchedAvatars).toHaveBeenCalledWith('@alice:hs.test');
  });

  it('drops every account’s avatars when the client has no account', async () => {
    const anonymous = {
      getSafeUserId: () => {
        throw new Error('no user');
      },
    } as unknown as MatrixClient;

    await logoutClient(anonymous);

    expect(clearFetchedAvatars).toHaveBeenCalledWith(undefined);
  });

  it('drops them also when the logout fails', async () => {
    lifecycle.logoutClient.mockRejectedValueOnce(new Error('offline'));

    await expect(logoutClient(client)).rejects.toThrow('offline');
    expect(clearFetchedAvatars).toHaveBeenCalledWith('@alice:hs.test');
  });

  it('drops the avatars of a removed account and keeps the others', async () => {
    await removeStoredSession(session);

    expect(lifecycle.removeStoredSession).toHaveBeenCalledWith(session);
    expect(clearFetchedAvatars).toHaveBeenCalledTimes(1);
    expect(clearFetchedAvatars).toHaveBeenCalledWith('@bob:hs.test');
  });

  it('logs an inactive account out on the server, then removes it and its avatars', async () => {
    const order: string[] = [];
    server.logout.mockImplementationOnce(async () => {
      order.push('server logout');
      return {};
    });
    lifecycle.removeStoredSession.mockImplementationOnce(async () => {
      order.push('removed here');
    });
    const stored = { ...session, baseUrl: 'https://hs.test', deviceId: 'BOB', accessToken: 'b' };

    await logoutStoredSession(stored);

    expect(server.createMatrixClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://hs.test', accessToken: 'b', deviceId: 'BOB' })
    );
    expect(server.logout).toHaveBeenCalledWith(true);
    expect(order).toEqual(['server logout', 'removed here']);
    expect(clearFetchedAvatars).toHaveBeenCalledWith('@bob:hs.test');
  });

  it('removes an inactive account also when its server logout fails', async () => {
    server.logout.mockRejectedValueOnce(new Error('offline'));

    await logoutStoredSession(session);

    expect(lifecycle.removeStoredSession).toHaveBeenCalledWith(session);
  });

  it('drops every account’s avatars when the cache is cleared', async () => {
    await clearAllCacheAndReload(client);

    expect(clearFetchedAvatars).toHaveBeenCalledWith();
    expect(lifecycle.clearAllCacheAndReload).toHaveBeenCalledWith(client);
  });
});
