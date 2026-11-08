// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { putSession } from '../matrix/session/sessions';
import { forgetAccountInPlugins } from './forgetAccountInPlugins';
import { usePluginStorage } from './pluginStorage';

// Two plugins whose `forgetAccount` the tests set.
const forget = vi.hoisted(() => vi.fn<(pluginId: string, userId: string) => unknown>());
vi.mock('./pluginEntries', () => ({
  pluginEntries: ['notes', 'drafts'].map((id) => ({
    id,
    version: '1.0.0',
    plugin: { forgetAccount: (userId: string) => forget(id, userId) },
  })),
}));

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';
// A user ID that starts with Alice's names another account.
const LOOKALIKE = `${ALICE}.other`;

const signIn = (userId: string) =>
  putSession({
    baseUrl: 'https://matrix.example.org',
    userId,
    deviceId: 'DEVICE',
    accessToken: 'token',
  });

/** `pluginId`'s storage, as a component of it sees it while `userId` is signed in. */
const storageOf = (pluginId: string, userId: string) => {
  const client = { getSafeUserId: () => userId } as unknown as MatrixClient;
  return renderHook(() => usePluginStorage(pluginId), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MatrixClientProvider value={client}>{children}</MatrixClientProvider>
    ),
  }).result.current;
};

beforeEach(() => {
  [ALICE, BOB, LOOKALIKE].forEach(signIn);
});

afterEach(() => {
  localStorage.clear();
  forget.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('forgetAccountInPlugins', () => {
  it("deletes every plugin's values for the account and keeps everyone else's", async () => {
    storageOf('notes', ALICE).setItem('draft', 'Alice writes');
    storageOf('drafts', ALICE).setItem('draft', 'Alice again');
    storageOf('notes', BOB).setItem('draft', 'Bob writes');
    storageOf('notes', LOOKALIKE).setItem('draft', 'Someone else');
    localStorage.setItem('unrelated', 'kept');

    await forgetAccountInPlugins(ALICE);

    expect(storageOf('notes', ALICE).getItem('draft')).toBeNull();
    expect(storageOf('drafts', ALICE).getItem('draft')).toBeNull();
    expect(storageOf('notes', BOB).getItem('draft')).toBe('Bob writes');
    expect(storageOf('notes', LOOKALIKE).getItem('draft')).toBe('Someone else');
    expect(localStorage.getItem('unrelated')).toBe('kept');
    expect(forget.mock.calls).toEqual([
      ['notes', ALICE],
      ['drafts', ALICE],
    ]);
  });

  it('runs the other plugins and resolves when one throws or rejects, naming each', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    forget.mockImplementation((pluginId) => {
      if (pluginId === 'notes') throw new Error('notes broke');
      return Promise.reject(new Error('drafts broke'));
    });
    storageOf('notes', ALICE).setItem('draft', 'Alice writes');

    await forgetAccountInPlugins(ALICE);

    expect(storageOf('notes', ALICE).getItem('draft')).toBeNull();
    expect(logged.mock.calls.map(([message]) => message)).toEqual([
      '[plugin notes@1.0.0] forgetting an account failed',
      '[plugin drafts@1.0.0] forgetting an account failed',
    ]);
  });

  it('waits for a plugin that forgets asynchronously', async () => {
    let finish = () => {};
    forget.mockImplementation(
      (pluginId) =>
        pluginId === 'notes' &&
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    let done = false;
    const forgetting = forgetAccountInPlugins(ALICE).then(() => {
      done = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(done).toBe(false);
    finish();
    await forgetting;
    expect(done).toBe(true);
  });

  it('stops waiting for a plugin that does not finish within five seconds', async () => {
    vi.useFakeTimers();
    forget.mockReturnValue(new Promise(() => {}));
    let done = false;
    void forgetAccountInPlugins(ALICE).then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});
