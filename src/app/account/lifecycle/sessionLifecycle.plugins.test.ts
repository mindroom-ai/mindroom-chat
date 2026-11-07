// @vitest-environment jsdom
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { putSession } from '../../matrix/session/sessions';
import { removeCurrentClientSessionAndReload, removeStoredSession } from './sessionLifecycle';

// What happened, in order: a plugin forgetting an account (`forget <user>`, which
// `forgetAccountInPlugins` asks for once it deleted the account's plugin storage) and the reload.
const steps = vi.hoisted(() => [] as string[]);
vi.mock('../../plugins/pluginEntries', () => ({
  pluginEntries: [
    {
      id: 'notes',
      version: '1.0.0',
      plugin: {
        // Finishes a little later, as deleting its own database would.
        forgetAccount: (userId: string) =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              steps.push(`forget ${userId}`);
              resolve();
            }, 10);
          }),
      },
    },
  ],
}));
vi.mock('../../routes/pathUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../routes/pathUtils')>()),
  reloadAppAt: () => {
    steps.push('reload');
  },
}));

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';

const signIn = (userId: string, baseUrl = 'https://matrix.example.org') =>
  putSession({ baseUrl, userId, deviceId: `${userId}-DEVICE`, accessToken: 'token' });

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
});

describe('the plugins forget an account with its local data', () => {
  it('when the account is removed from this browser', async () => {
    const alice = signIn(ALICE);
    signIn(BOB);

    await removeStoredSession(alice);

    expect(steps).toEqual([`forget ${ALICE}`]);
  });

  it('not while another login of the account stays', async () => {
    const alice = signIn(ALICE);
    signIn(ALICE, 'https://other.example.org');

    await removeStoredSession(alice);

    expect(steps).toEqual([]);
  });

  it('before the page reloads after a sign-out', async () => {
    const alice = signIn(ALICE);

    await removeCurrentClientSessionAndReload(clientOf(ALICE, alice.deviceId), alice);

    expect(steps).toEqual([`forget ${ALICE}`, 'reload']);
  });

  it('before the page reloads after a sign-out of a client without its device', async () => {
    signIn(ALICE);

    await removeCurrentClientSessionAndReload(clientOf(ALICE, null));

    expect(steps).toEqual([`forget ${ALICE}`, 'reload']);
  });
});
