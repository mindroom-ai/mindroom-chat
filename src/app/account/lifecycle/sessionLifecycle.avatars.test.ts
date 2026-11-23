// @vitest-environment jsdom
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { putSession } from '../../matrix/session/sessions';
import {
  clearAllCacheAndReload,
  removeCurrentClientSessionAndReload,
  removeSessionAndReload,
  removeStoredSession,
} from './sessionLifecycle';

// What happened, in order: the avatars dropped (`avatars <user>`, `avatars all` for every
// account's, recorded once the kept ones are deleted; `notification avatars` for the ones the
// iOS app keeps) and the reload.
const steps = vi.hoisted(() => [] as string[]);
const defaultClearAvatarCache = vi.hoisted(() => async () => {
  steps.push('notification avatars');
});
/** `clearNativeNotificationAvatarCache`, which a test replaces. */
const native = vi.hoisted(() => ({
  clearAvatarCache: defaultClearAvatarCache,
}));
vi.mock('../../native/nativeNotifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../native/nativeNotifications')>()),
  clearNativeNotificationAvatarCache: () => native.clearAvatarCache(),
}));
vi.mock('../../avatars/avatarMedia', () => ({
  // Finishes a little later, as deleting the kept avatars' cache would.
  clearFetchedAvatars: (userId?: string) =>
    new Promise<void>((resolve) => {
      setTimeout(() => {
        steps.push(`avatars ${userId ?? 'all'}`);
        resolve();
      }, 10);
    }),
}));
vi.mock('../../routes/pathUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../routes/pathUtils')>()),
  reloadAppAt: () => {
    steps.push('reload');
  },
}));

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';

const signIn = (userId: string) =>
  putSession({
    baseUrl: 'https://matrix.example.org',
    userId,
    deviceId: `${userId}-DEVICE`,
    accessToken: 'token',
  });

/** A started client of `userId`'s login; `deviceId` null for one that never learned its device. */
const clientOf = (userId: string, deviceId: string | null) =>
  ({
    getHomeserverUrl: () => 'https://matrix.example.org',
    getSafeUserId: () => userId,
    getDeviceId: () => deviceId,
    stopClient: () => undefined,
    clearStores: () => Promise.resolve(),
  } as unknown as MatrixClient);

afterEach(() => {
  localStorage.clear();
  steps.length = 0;
  vi.unstubAllGlobals();
});

describe('removing an account deletes the avatars before the page reloads', () => {
  it('after the server logged the device out', async () => {
    const alice = signIn(ALICE);

    await removeCurrentClientSessionAndReload(clientOf(ALICE, alice.deviceId), alice);

    expect(steps).toEqual([`avatars ${ALICE}`, 'reload']);
  });

  it('of a client without its device', async () => {
    signIn(ALICE);

    await removeCurrentClientSessionAndReload(clientOf(ALICE, null));

    expect(steps).toEqual([`avatars ${ALICE}`, 'reload']);
  });

  it('of a client without its device whose stores could not be cleared', async () => {
    signIn(ALICE);
    const client = clientOf(ALICE, null);
    client.clearStores = () => Promise.reject(new Error('blocked'));

    await expect(removeCurrentClientSessionAndReload(client)).rejects.toThrow('blocked');

    expect(steps).toEqual([`avatars ${ALICE}`]);
  });

  it('without a client, as Cancel on the connecting screen does', async () => {
    const alice = signIn(ALICE);

    await removeSessionAndReload(alice);

    expect(steps).toEqual([`avatars ${ALICE}`, 'reload']);
  });

  it('of an inactive account, without a reload', async () => {
    const bob = signIn(BOB);
    signIn(ALICE);

    await removeStoredSession(bob);

    expect(steps).toEqual([`avatars ${BOB}`]);
  });
});

describe('clearing the cache', () => {
  const stubReload = () => {
    const replace = vi.fn(() => steps.push('reload'));
    vi.stubGlobal('location', { ...window.location, replace });
  };

  afterEach(() => {
    native.clearAvatarCache = defaultClearAvatarCache;
    vi.useRealTimers();
  });

  it('deletes every account’s avatars, also the ones the iOS app keeps for notifications, before the page reloads', async () => {
    stubReload();

    await clearAllCacheAndReload();

    expect(steps).toEqual(['notification avatars', 'avatars all', 'reload']);
  });

  it('reloads although the iOS app could not clear its notification avatars', async () => {
    stubReload();
    native.clearAvatarCache = () => Promise.reject(new Error('no plugin'));

    await clearAllCacheAndReload();

    expect(steps).toEqual(['avatars all', 'reload']);
  });

  it('reloads after a while although the iOS app never answers', async () => {
    stubReload();
    // A callback of iOS that is never called.
    native.clearAvatarCache = () => new Promise<void>(() => undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const clearing = clearAllCacheAndReload();
    await vi.advanceTimersByTimeAsync(4900);
    expect(steps).toEqual([]);

    await vi.advanceTimersByTimeAsync(200);
    await clearing;
    expect(steps).toEqual(['avatars all', 'reload']);
  });
});
