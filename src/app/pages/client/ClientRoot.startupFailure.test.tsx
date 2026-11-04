import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createStore, Provider } from 'jotai';
import { MatrixError } from 'matrix-js-sdk';
import { ClientRoot } from './ClientRoot';
import { useActiveSession } from '../../hooks/useSessionStore';
import type { StoredSession } from '../../state/sessions';
import {
  DeviceIdentityVerificationError,
  MissingCryptoStoreError,
} from '../../mindroom/matrix/cryptoStoreContinuity';
import { initClient } from '../../../client/initMatrix';

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
vi.mock('../../components/glass/GlassPrimitives', () => ({
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
vi.mock('../../../client/initMatrix', () => ({
  clearAllCacheAndReload: vi.fn(),
  initClient: vi.fn(),
  logoutClient: vi.fn(),
  removeCurrentClientSessionAndReload: vi.fn(),
  removeSessionAndReload: vi.fn(),
  startClient: vi.fn(),
}));
vi.mock('../../../client/secretStorageKeys', () => ({ clearSecretStorageKeys: vi.fn() }));
vi.mock('../../components/splash-screen', () => ({
  SplashScreen: ({ children }: { children?: React.ReactNode }) => children ?? null,
  MindRoomSplashScreen: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
vi.mock('../../components/ServerConfigsLoader', () => ({
  ServerConfigsLoader: ({ children }: { children: (configs: object) => React.ReactNode }) =>
    children({}),
}));
vi.mock('./SpecVersions', () => ({
  SpecVersions: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./SyncStatus', () => ({ SyncStatus: () => null }));
vi.mock('../../mindroom/engine', () => ({
  createMindroomSyncEngine: vi.fn(),
  MindroomSyncEngineProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../hooks/useSessionStore', () => ({ useActiveSession: vi.fn() }));
vi.mock('../../hooks/useClientConfig', () => ({ useClientConfig: () => ({}) }));

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

  it('says what to do when the encryption storage is missing, in words the app translates', async () => {
    const { sentence, detail } = await failWith(new MissingCryptoStoreError(SESSION.userId));

    expect(sentence).toBe(
      "Failed to start account @alice:example.org. This account's encryption storage is missing, " +
        "but its device sign-in is still here. Continuing would replace this device's identity " +
        'and make encrypted messages and calls unreadable on other devices. Remove this account, ' +
        'then sign in again.'
    );
    expect(detail).toBeUndefined();
  });

  it('says the device identity could not be checked', async () => {
    const { sentence } = await failWith(new DeviceIdentityVerificationError(SESSION.userId));

    expect(sentence).toContain("MindRoom couldn't safely check this account's encryption storage");
    expect(sentence).not.toContain('MindRoom Chat');
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
