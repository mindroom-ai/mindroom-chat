// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { putSession } from '../../matrix/session/sessions';
import { usePluginStorage } from '../../plugins/pluginStorage';
import { reloadAppAt } from '../../routes/pathUtils';
import { removeCurrentClientSessionAndReload, removeStoredSession } from './sessionLifecycle';

// What happened, in order: a plugin forgetting an account (`forget <user>`) and the reload.
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
  reloadAppAt: vi.fn(() => steps.push('reload')),
}));

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';

const signIn = (userId: string, baseUrl = 'https://matrix.example.org') =>
  putSession({ baseUrl, userId, deviceId: `${userId}-DEVICE`, accessToken: 'token' });

/** The plugin's storage as it shows while `userId` is signed in. */
const notesOf = (userId: string) => {
  const client = { getSafeUserId: () => userId } as unknown as MatrixClient;
  return renderHook(() => usePluginStorage('notes'), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MatrixClientProvider value={client}>{children}</MatrixClientProvider>
    ),
  }).result.current;
};

/** A started client of `userId`'s login; `deviceId` null for one that never learned its device. */
const clientOf = (userId: string, deviceId: string | null) =>
  ({
    getHomeserverUrl: () => 'https://matrix.example.org',
    getSafeUserId: () => userId,
    getDeviceId: () => deviceId,
    stopClient: vi.fn(),
    clearStores: vi.fn(() => Promise.resolve()),
  } as unknown as MatrixClient);

afterEach(() => {
  localStorage.clear();
  steps.length = 0;
  vi.mocked(reloadAppAt).mockClear();
});

describe('the plugins forget an account with its local data', () => {
  it('when the account is removed from this browser', async () => {
    const alice = signIn(ALICE);
    signIn(BOB);
    notesOf(ALICE).setItem('draft', 'Alice writes');
    notesOf(BOB).setItem('draft', 'Bob writes');

    await removeStoredSession(alice);

    expect(steps).toEqual([`forget ${ALICE}`]);
    expect(notesOf(ALICE).getItem('draft')).toBeNull();
    expect(notesOf(BOB).getItem('draft')).toBe('Bob writes');
  });

  it('not while another login of the account stays', async () => {
    const alice = signIn(ALICE);
    signIn(ALICE, 'https://other.example.org');
    notesOf(ALICE).setItem('draft', 'Alice writes');

    await removeStoredSession(alice);

    expect(steps).toEqual([]);
    expect(notesOf(ALICE).getItem('draft')).toBe('Alice writes');
  });

  it('before the page reloads after a sign-out', async () => {
    const alice = signIn(ALICE);
    notesOf(ALICE).setItem('draft', 'Alice writes');

    await removeCurrentClientSessionAndReload(clientOf(ALICE, alice.deviceId), alice);

    expect(steps).toEqual([`forget ${ALICE}`, 'reload']);
    expect(notesOf(ALICE).getItem('draft')).toBeNull();
  });

  it('before the page reloads after a sign-out of a client without its device', async () => {
    signIn(ALICE);
    notesOf(ALICE).setItem('draft', 'Alice writes');

    await removeCurrentClientSessionAndReload(clientOf(ALICE, null));

    expect(steps).toEqual([`forget ${ALICE}`, 'reload']);
    expect(notesOf(ALICE).getItem('draft')).toBeNull();
  });
});
