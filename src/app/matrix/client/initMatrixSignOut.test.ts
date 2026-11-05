import type { MatrixClient } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredSession } from '../session/sessions';
import { clearAllCacheAndReload, logoutClient, removeStoredSession } from '../../account/lifecycle/initMatrix';

const lifecycle = vi.hoisted(() => ({
  clearAllCacheAndReload: vi.fn(async () => undefined),
  logoutClient: vi.fn(async () => undefined),
  removeStoredSession: vi.fn(async () => undefined),
  removeCurrentClientSessionAndReload: vi.fn(),
  removeSessionAndReload: vi.fn(),
}));
const clearFetchedAvatars = vi.hoisted(() => vi.fn());

vi.mock('../../account/lifecycle/sessionLifecycle', () => lifecycle);
vi.mock('../../avatars/avatarMedia', () => ({ clearFetchedAvatars }));

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

  it('drops every account’s avatars when the cache is cleared', async () => {
    await clearAllCacheAndReload(client);

    expect(clearFetchedAvatars).toHaveBeenCalledWith();
    expect(lifecycle.clearAllCacheAndReload).toHaveBeenCalledWith(client);
  });
});
