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
// account's, recorded once the kept ones are deleted) and the reload.
const steps = vi.hoisted(() => [] as string[]);
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

it('clearing the cache deletes every account’s avatars before the page reloads', async () => {
  const replace = vi.fn(() => steps.push('reload'));
  vi.stubGlobal('location', { ...window.location, replace });

  await clearAllCacheAndReload();

  expect(steps).toEqual(['avatars all', 'reload']);
});
