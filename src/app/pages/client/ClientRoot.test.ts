import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ClientEvent, SyncState } from 'matrix-js-sdk';
import { ClientRoot, hasCachedClientShell } from './ClientRoot';
import { useActiveSession } from '../../hooks/useSessionStore';
import { StoredSession } from '../../state/sessions';
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

vi.mock('matrix-js-sdk/lib/http-api/interface', () => ({
  HttpApiEvent: {
    SessionLoggedOut: 'Session.logged_out',
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

let currentSession: StoredSession | undefined;

type MockClient = {
  stopClient: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  getRooms: ReturnType<typeof vi.fn>;
  getSyncState: ReturnType<typeof vi.fn>;
  store: {
    getSyncToken: ReturnType<typeof vi.fn>;
  };
  emitSync: (current?: SyncState | null, previous?: SyncState | null | undefined) => void;
};

const createMockClient = (options: { cachedRooms?: number; syncToken?: string | null } = {}): MockClient => {
  let syncHandler: ((current?: SyncState | null, previous?: SyncState | null | undefined) => void) | undefined;
  const cachedRooms = options.cachedRooms ?? 0;
  const syncToken = options.syncToken ?? null;
  let syncState: SyncState | null = null;

  return {
    stopClient: vi.fn(),
    on: vi.fn((event: string, handler: (current?: SyncState | null, previous?: SyncState | null | undefined) => void) => {
      if (event === ClientEvent.Sync) syncHandler = handler;
    }),
    once: vi.fn(),
    removeListener: vi.fn((event: string, handler: () => void) => {
      if (event === ClientEvent.Sync && syncHandler === handler) {
        syncHandler = undefined;
      }
    }),
    getRooms: vi.fn(() => Array.from({ length: cachedRooms }, (_, index) => ({ roomId: `!room${index}` }))),
    getSyncState: vi.fn(() => syncState),
    store: {
      getSyncToken: vi.fn(() => syncToken),
    },
    emitSync: (current = SyncState.Syncing, previous = SyncState.Prepared) => {
      syncState = current;
      syncHandler?.(current, previous);
    },
  };
};

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

const renderClientRoot = () =>
  React.createElement(
    MemoryRouter,
    {
      initialEntries: ['/home/'],
    },
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: '/login/*',
        element: React.createElement(React.Fragment, null, 'login page'),
      }),
      React.createElement(Route, {
        path: '*',
        element: React.createElement(
          ClientRoot,
          null,
          React.createElement('div', null, 'child')
        ),
      })
    )
  );

const hasRenderedText = (
  renderer: ReactTestRenderer | undefined,
  text: string
): boolean =>
  !!renderer?.root.findAll(
    (node) => typeof node.type === 'string' && node.children.includes(text)
  ).length;

describe('ClientRoot', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
    currentSession = undefined;
    vi.restoreAllMocks();
  });

  it('switches clients when the active session changes', async () => {
    const clientA = createMockClient();
    const clientB = createMockClient();

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
      renderer = create(renderClientRoot());
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
        renderClientRoot()
      );
      await flushEffects();
    });

    expect(vi.mocked(initClient)).toHaveBeenLastCalledWith(toBootstrapSession(currentSession));
    expect(vi.mocked(startClient)).toHaveBeenCalledTimes(2);
    expect(clientA.stopClient).toHaveBeenCalledTimes(1);
    expect(clientB.stopClient).not.toHaveBeenCalled();
  });

  it('does not restart the client when only session metadata changes', async () => {
    const client = createMockClient();

    currentSession = {
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
      lastKnownPath: '/home/',
      lastKnownDisplayName: 'Alice',
    };

    vi.mocked(useActiveSession).mockImplementation(() => currentSession);
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(startClient).mockResolvedValue(undefined);

    await act(async () => {
      renderer = create(renderClientRoot());
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
        renderClientRoot()
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
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    expect(vi.mocked(initClient)).not.toHaveBeenCalled();
    expect(vi.mocked(startClient)).not.toHaveBeenCalled();
    expect(renderer?.toJSON()).toEqual('login page');
  });

  it('uses the session-aware cleanup helper when the server logs the client out', async () => {
    let logoutHandler:
      | (() => Promise<void>)
      | undefined;
    const client = {
      stopClient: vi.fn(),
      on: vi.fn((event: string, handler: () => Promise<void>) => {
        if (event === 'Session.logged_out') {
          logoutHandler = handler;
        }
      }),
      once: vi.fn(),
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
      renderer = create(renderClientRoot());
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

  it('redirects to login if the active session disappears after startup', async () => {
    const client = createMockClient();

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
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    currentSession = undefined;

    await act(async () => {
      renderer?.update(renderClientRoot());
      await flushEffects();
    });

    expect(renderer?.toJSON()).toEqual('login page');
  });

  it('keeps the loading screen rendered until the first sync arrives', async () => {
    const client = createMockClient();

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
    let resolveStartClient: (() => void) | undefined;
    vi.mocked(startClient).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStartClient = resolve;
        })
    );

    await act(async () => {
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'child')).toBe(false);
    expect(hasRenderedText(renderer, 'Catching up...')).toBe(true);
    expect(hasRenderedText(renderer, 'sync')).toBe(false);

    await act(async () => {
      resolveStartClient?.();
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'child')).toBe(false);
    expect(hasRenderedText(renderer, 'Catching up...')).toBe(true);
  });

  it('renders cached UI immediately after startup when cached rooms are restored from the store', async () => {
    const client = createMockClient({ cachedRooms: 1 });

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
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'child')).toBe(true);
    expect(hasRenderedText(renderer, 'Catching up...')).toBe(true);
    expect(hasRenderedText(renderer, 'Heating up')).toBe(false);
  });

  it('treats a saved sync token as resumable cached state even without loaded rooms', () => {
    const client = createMockClient({ syncToken: 's123' });

    expect(hasCachedClientShell(client as never)).toBe(true);
  });

  it('renders cached UI after the first sync event arrives', async () => {
    const client = createMockClient();

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
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'child')).toBe(false);
    expect(hasRenderedText(renderer, 'Catching up...')).toBe(true);

    await act(async () => {
      client.emitSync();
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'child')).toBe(true);
    expect(hasRenderedText(renderer, 'sync')).toBe(true);
  });

  it('keeps cached UI rendered after startClient resolves once the client has synced', async () => {
    const client = createMockClient();

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
      renderer = create(renderClientRoot());
      await flushEffects();
    });

    await act(async () => {
      client.emitSync();
      await flushEffects();
    });

    expect(hasRenderedText(renderer, 'child')).toBe(true);
    expect(hasRenderedText(renderer, 'sync')).toBe(true);
  });
});
