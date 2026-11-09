import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createStore, Provider } from 'jotai';
import { MatrixError } from 'matrix-js-sdk';
import { ClientRoot } from './ClientRoot';
import { useActiveSession, useStoredSessions } from '../matrix/session/useSessionStore';
import type { StoredSession } from '../matrix/session/sessions';
import {
  DeviceIdentityVerificationError,
  MissingCryptoStoreError,
} from '../matrix/client/cryptoStoreContinuity';
import { initClient, logoutSessionWithoutStores } from '../account/lifecycle/initMatrix';

// The screen shown when an account cannot start says why in the app's language.

vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  Box: 'div',
  Button: 'button',
  Icon: 'span',
  IconButton: 'button',
  Icons: { VerticalDots: 'VerticalDots' },
  PopOut: 'div',
  Spinner: 'span',
  Text: 'span',
}));
vi.mock('../ui/glass/GlassPrimitives', () => ({
  Dialog: 'div',
  Menu: 'div',
  MenuItem: 'div',
}));
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('matrix-js-sdk/lib/http-api/interface', () => ({
  HttpApiEvent: { SessionLoggedOut: 'Session.logged_out' },
}));
vi.mock('../account/lifecycle/initMatrix', () => ({
  clearAllCacheAndReload: vi.fn(),
  initClient: vi.fn(),
  logoutClient: vi.fn(),
  logoutSessionWithoutStores: vi.fn(),
}));
vi.mock('../account/lifecycle/sessionLifecycle', () => ({
  removeCurrentClientSessionAndReload: vi.fn(),
  removeSessionAndReload: vi.fn(),
}));
vi.mock('../matrix/client/clientSyncPolicy', () => ({
  startClient: vi.fn(),
}));
vi.mock('../matrix/client/secretStorageKeys', () => ({ clearSecretStorageKeys: vi.fn() }));
vi.mock('../ui/splash/SplashScreen', () => ({
  SplashScreen: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
vi.mock('../ui/splash/BrandedSplashScreen', () => ({
  MindRoomSplashScreen: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
vi.mock('../matrix/ServerConfigsLoader', () => ({
  ServerConfigsLoader: ({ children }: { children: (configs: object) => React.ReactNode }) =>
    children({}),
}));
vi.mock('./SpecVersions', () => ({
  SpecVersions: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./SyncStatus', () => ({ SyncStatus: () => null }));
vi.mock('../event-store/engine', () => ({
  createSyncEngine: vi.fn(),
  SyncEngineProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../matrix/session/useSessionStore', () => ({
  useActiveSession: vi.fn(),
  useStoredSessions: vi.fn(),
}));
vi.mock('../config/useClientConfig', () => ({ useClientConfig: () => ({}) }));

const OTHER: StoredSession = {
  sessionId: 'session-bob',
  baseUrl: 'https://example.org',
  userId: '@bob:example.org',
  deviceId: 'DEVICE_bob',
  accessToken: 'token-bob',
  lastUsedAt: 2,
};

const SESSION: StoredSession = {
  sessionId: 'session-alice',
  baseUrl: 'https://example.org',
  userId: '@alice:example.org',
  deviceId: 'DEVICE_alice',
  accessToken: 'token-alice',
  lastUsedAt: 1,
};

describe('ClientRoot when an account cannot start', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.mocked(useActiveSession).mockReturnValue(SESSION);
    vi.mocked(useStoredSessions).mockReturnValue([SESSION]);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.clearAllMocks();
  });

  /** Starts the account with `initClient` failing, and returns the alert's text parts. */
  const failWith = async (error: unknown) => {
    vi.mocked(initClient).mockRejectedValue(error);
    await act(async () => {
      renderer = create(
        <Provider store={createStore()}>
          <MemoryRouter>
            <ClientRoot>
              <div>pages</div>
            </ClientRoot>
          </MemoryRouter>
        </Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const alert = renderer?.root.findByProps({ role: 'alert' });
    const parts = (alert?.children ?? []).map((child) =>
      typeof child === 'string' ? child : child.findAllByType('bdi')[0]?.children.join('')
    );
    return { sentence: parts[0], detail: parts[1] };
  };

  /** The text of a rendered node, interpolated values included. */
  const textOf = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map(textOf).join('');

  it.each([
    { others: [], login: '/login/https%3A%2F%2Fexample.org' },
    { others: [OTHER], login: '/login/https%3A%2F%2Fexample.org?addAccount=1' },
  ])(
    'asks to sign in again when the encryption keys are lost ($others.length other accounts)',
    async ({ others, login }) => {
      vi.mocked(useStoredSessions).mockReturnValue([SESSION, ...others]);
      await failWith(new MissingCryptoStoreError(SESSION.userId));
      const screen = renderer?.root;

      expect(textOf(screen!.findByProps({ as: 'h2' }))).toBe('Encryption keys lost');
      expect(textOf(screen!.findByProps({ role: 'alert' }))).toBe(
        'This browser lost the encryption keys of @alice:example.org. Encrypted messages ' +
          "can't be read here, and the server won't accept new keys for this sign-in. Sign in " +
          'again to continue as a new device; your other accounts stay signed in. Then verify ' +
          'the new device or use your recovery key to read earlier messages.'
      );
      // No retry or cache clearing: neither brings the keys back.
      const buttons = screen!.findAllByType('button');
      expect(buttons.map(textOf)).toEqual(['Sign in again', 'Remove Account']);

      // Signing in again ends in a reload, so it never settles here.
      vi.mocked(logoutSessionWithoutStores).mockReturnValue(new Promise(() => undefined));
      const [signInAgain] = buttons;
      await act(async () => {
        signInAgain?.props.onClick();
      });

      expect(logoutSessionWithoutStores).toHaveBeenCalledTimes(1);
      const [ended, href] = vi.mocked(logoutSessionWithoutStores).mock.calls[0] ?? [];
      expect(ended).toEqual({
        sessionId: SESSION.sessionId,
        baseUrl: SESSION.baseUrl,
        userId: SESSION.userId,
        deviceId: SESSION.deviceId,
        accessToken: SESSION.accessToken,
        refreshToken: undefined,
      });
      expect(href?.endsWith(login)).toBe(true);
      expect(screen!.findAllByType('button').every((button) => button.props.disabled)).toBe(true);
    }
  );

  it('says the device identity could not be checked', async () => {
    const { sentence } = await failWith(new DeviceIdentityVerificationError(SESSION.userId));

    expect(sentence).toContain("MindRoom couldn't safely check this account's encryption storage");
    expect(sentence).not.toContain('could not safely verify');
  });

  it("translates a server's refusal and keeps its code and explanation beside it", async () => {
    const { sentence, detail } = await failWith(
      new MatrixError({ errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid access token passed.' }, 401)
    );

    expect(sentence).toBe(
      'Failed to start account @alice:example.org. Your session has ended. Sign in again.'
    );
    expect(detail).toBe('M_UNKNOWN_TOKEN: Invalid access token passed.');
  });

  it("keeps any other error's own text under the translated sentence", async () => {
    const { sentence, detail } = await failWith(new Error('IndexedDB open failed'));

    expect(sentence?.trim()).toBe('Failed to start account @alice:example.org.');
    expect(detail).toBe('IndexedDB open failed');
  });
});
