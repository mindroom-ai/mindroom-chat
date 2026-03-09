import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRoot } from './ClientRoot';
import { useActiveSession } from '../../hooks/useSessionStore';
import {
  initClient,
  removeCurrentClientSessionAndReload,
  startClient,
} from '../../../client/initMatrix';

const { passthrough } = vi.hoisted(() => ({
  passthrough: 'div',
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  return {
    ...actual,
    Box: passthrough,
    Button: passthrough,
    Dialog: passthrough,
    Icon: passthrough,
    IconButton: passthrough,
    Icons: {
      VerticalDots: 'VerticalDots',
    },
    Menu: passthrough,
    MenuItem: passthrough,
    PopOut: passthrough,
    Spinner: passthrough,
    Text: passthrough,
    config: {
      ...actual.config,
      space: {
        ...actual.config.space,
        S100: '4px',
        S400: '16px',
      },
    },
  };
});

vi.mock('matrix-js-sdk', () => ({
  HttpApiEvent: {
    SessionLoggedOut: 'SessionLoggedOut',
  },
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('../../../client/initMatrix', () => ({
  clearCacheAndReload: vi.fn(),
  clearLoginData: vi.fn().mockResolvedValue(undefined),
  initClient: vi.fn(),
  logoutClient: vi.fn().mockResolvedValue(undefined),
  removeCurrentClientSessionAndReload: vi.fn().mockResolvedValue(undefined),
  removeSessionAndReload: vi.fn().mockResolvedValue(undefined),
  startClient: vi.fn(),
}));

vi.mock('../../components/splash-screen', () => ({
  SplashScreen: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('../../components/ServerConfigsLoader', () => ({
  ServerConfigsLoader: ({
    mx,
    children,
  }: {
    mx?: unknown;
    children: (config: unknown) => React.ReactNode;
  }) => {
    if (!mx) {
      throw new Error('ServerConfigsLoader missing mx prop');
    }

    return React.createElement(
      'div',
      null,
      children({ capabilities: {}, mediaConfig: {}, authMetadata: undefined })
    );
  },
}));

vi.mock('../../hooks/useCapabilities', () => ({
  CapabilitiesProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../hooks/useMediaConfig', () => ({
  MediaConfigProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  MatrixClientProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('./SpecVersions', () => ({
  SpecVersions: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('../../hooks/useSyncState', () => ({
  useSyncState: vi.fn(),
}));

vi.mock('./SyncStatus', () => ({
  SyncStatus: () => React.createElement('div', null, 'sync'),
}));

vi.mock('../../hooks/useAuthMetadata', () => ({
  AuthMetadataProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../hooks/useSessionStore', () => ({
  useActiveSession: vi.fn(),
}));

let currentSession:
  | {
      sessionId: string;
      baseUrl: string;
      userId: string;
      deviceId: string;
      accessToken: string;
      lastUsedAt: number;
    }
  | undefined;

const flushEffects = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const toBootstrapSession = (session: {
  sessionId: string;
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
}) => ({
  sessionId: session.sessionId,
  baseUrl: session.baseUrl,
  userId: session.userId,
  deviceId: session.deviceId,
  accessToken: session.accessToken,
});

describe('ClientRoot', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
    currentSession = undefined;
    vi.restoreAllMocks();
  });

  it('switches clients when the active session changes', async () => {
    const clientA = {
      stopClient: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const clientB = {
      stopClient: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };

    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockImplementation(async (session) =>
      session.sessionId === 'session-a' ? (clientA as never) : (clientB as never)
    );
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(
        React.createElement(ClientRoot, null, React.createElement('div', null, 'child'))
      );
      await flushEffects();
    });

    expect(vi.mocked(initClient)).toHaveBeenCalledWith(toBootstrapSession(currentSession));
    expect(vi.mocked(startClient)).toHaveBeenCalledTimes(1);

    currentSession = {
      sessionId: 'session-b',
      baseUrl: 'https://matrix.org',
      userId: '@bob:matrix.org',
      deviceId: 'DEVICE_B',
      accessToken: 'token-b',
      lastUsedAt: 2,
    };

    await act(async () => {
      renderer?.update(
        React.createElement(ClientRoot, null, React.createElement('div', null, 'child'))
      );
      await flushEffects();
    });

    expect(vi.mocked(initClient)).toHaveBeenLastCalledWith(toBootstrapSession(currentSession));
    expect(vi.mocked(startClient)).toHaveBeenCalledTimes(2);
    expect(clientA.stopClient).toHaveBeenCalledTimes(1);
    expect(clientB.stopClient).not.toHaveBeenCalled();
  });

  it('does not restart the client when only session metadata changes', async () => {
    const client = {
      stopClient: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
      lastKnownPath: '/home/',
      lastKnownDisplayName: 'Alice',
    } as typeof currentSession & {
      lastKnownPath?: string;
      lastKnownDisplayName?: string;
    };

    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(
        React.createElement(ClientRoot, null, React.createElement('div', null, 'child'))
      );
      await flushEffects();
    });

    currentSession = {
      ...currentSession,
      lastUsedAt: 2,
      lastKnownPath: '/home/create/',
      lastKnownDisplayName: 'Alice Updated',
    };

    await act(async () => {
      renderer?.update(
        React.createElement(ClientRoot, null, React.createElement('div', null, 'child'))
      );
      await flushEffects();
    });

    expect(vi.mocked(initClient)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startClient)).toHaveBeenCalledTimes(1);
    expect(client.stopClient).not.toHaveBeenCalled();
  });

  it('does not initialize a client when there is no active session', async () => {
    vi.mocked(useActiveSession).mockReturnValue(undefined);

    await act(async () => {
      renderer = create(
        React.createElement(ClientRoot, null, React.createElement('div', null, 'child'))
      );
      await flushEffects();
    });

    expect(vi.mocked(initClient)).not.toHaveBeenCalled();
    expect(vi.mocked(startClient)).not.toHaveBeenCalled();
  });

  it('uses the session-aware cleanup helper when the server logs the client out', async () => {
    let logoutHandler:
      | (() => Promise<void>)
      | undefined;
    const client = {
      stopClient: vi.fn(),
      on: vi.fn((event: string, handler: () => Promise<void>) => {
        if (event === 'SessionLoggedOut') {
          logoutHandler = handler;
        }
      }),
      removeListener: vi.fn(),
    };

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    };

    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(
        React.createElement(ClientRoot, null, React.createElement('div', null, 'child'))
      );
      await flushEffects();
    });

    expect(logoutHandler).toBeTypeOf('function');

    await act(async () => {
      await logoutHandler?.();
    });

    expect(vi.mocked(removeCurrentClientSessionAndReload)).toHaveBeenCalledWith(
      client,
      currentSession
    );
  });
});
