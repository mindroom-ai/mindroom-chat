import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createStore, Provider } from 'jotai';
import { ClientRoot } from './ClientRoot';
import { ClientBindAtoms } from './ClientBindAtoms';
import { useActiveSession } from '../matrix/session/useSessionStore';
import type { StoredSession } from '../matrix/session/sessions';
import {
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  voiceAutoSendPendingAtom,
} from '../composer/roomInputDrafts';
import type { TUploadItem } from '../matrix/state/upload';
import { agentCallFailureAtom } from '../calls/agent/agentCaller';
import { initClient } from '../account/lifecycle/initMatrix';
import { removeCurrentClientSessionAndReload } from '../account/lifecycle/sessionLifecycle';
import { startClient } from '../matrix/client/clientSyncPolicy';

// What ClientRoot leaves behind when an account's session ends: a switch to another account
// must not carry composer state over, and a server logout removes the account once.

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
  initClient: vi.fn(),
}));
vi.mock('../account/lifecycle/sessionLifecycle', () => ({
  clearAllCacheAndReload: vi.fn(),
  logoutClient: vi.fn(),
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
vi.mock('../matrix/session/useSessionStore', () => ({ useActiveSession: vi.fn() }));
vi.mock('../config/useClientConfig', () => ({ useClientConfig: () => ({}) }));
// The pages' account atoms are seeded by binders this fake client cannot feed; the gate's
// teardown is what these tests follow.
vi.mock('./useBindAtoms', () => ({ useBindAtoms: vi.fn() }));
vi.mock('../event-store/engine', () => ({
  createSyncEngine: ({ mx }: { mx: unknown }) => ({ mx, start: vi.fn(), stop: vi.fn() }),
  SyncEngineProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const ROOM_ID = '!shared:example.org';

const sessionFor = (name: string): StoredSession => ({
  sessionId: `session-${name}`,
  baseUrl: 'https://example.org',
  userId: `@${name}:example.org`,
  deviceId: `DEVICE_${name}`,
  accessToken: `token-${name}`,
  lastUsedAt: 1,
});

type Listener = (...args: unknown[]) => void;

const createClient = () => {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on: vi.fn((event: string, listener: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(listener);
    }),
    removeListener: vi.fn((event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
    }),
    emit: (event: string, ...args: unknown[]) =>
      listeners.get(event)?.forEach((listener) => listener(...args)),
    stopClient: vi.fn(),
    store: {},
    getSyncState: vi.fn(() => null),
    getRooms: vi.fn(() => []),
  };
};

const stagedFile = (): TUploadItem => {
  const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
  return { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } };
};

type Rendered = ReturnType<ReactTestRenderer['toJSON']>;
const textOf = (node: Rendered | string): string => {
  if (node === null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return (node.children ?? []).map(textOf).join(' ');
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('ClientRoot when an account session ends', () => {
  let renderer: ReactTestRenderer | undefined;
  let active: StoredSession | undefined;
  let store: ReturnType<typeof createStore>;

  const tree = () => (
    <Provider store={store}>
      <MemoryRouter>
        <ClientRoot>
          <ClientBindAtoms>
            <div>pages</div>
          </ClientBindAtoms>
        </ClientRoot>
      </MemoryRouter>
    </Provider>
  );

  beforeEach(() => {
    store = createStore();
    vi.mocked(useActiveSession).mockImplementation(() => active);
    vi.mocked(startClient).mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    active = undefined;
    vi.clearAllMocks();
  });

  /** Signs `name` in and waits until the account's pages show. */
  const showPagesOf = async (name: string) => {
    const client = createClient();
    vi.mocked(initClient).mockResolvedValue(client as never);
    active = sessionFor(name);
    await act(async () => {
      if (renderer) renderer.update(tree());
      else renderer = create(tree());
      await flush();
    });
    await act(async () => {
      client.emit('sync', 'SYNCING', 'PREPARED');
      await flush();
    });
    expect(textOf(renderer?.toJSON() ?? null)).toContain('pages');
  };

  it('gives the next account empty composers in a room both accounts share', async () => {
    await showPagesOf('alice');

    // Alice picks a message to reply to and stages a file, then switches to Bob.
    store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), {
      userId: '@carol:example.org',
      eventId: '$question',
      body: 'Question',
    });
    store.set(roomIdToUploadItemsAtomFamily(ROOM_ID), { type: 'PUT', item: stagedFile() });
    store.set(voiceAutoSendPendingAtom, true);

    await showPagesOf('bob');

    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))).toBeUndefined();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);
  });

  it("does not show the next account why the last account's agent call did not start", async () => {
    await showPagesOf('alice');
    store.set(agentCallFailureAtom, { error: 'homeserver', id: 1 });

    await showPagesOf('bob');

    expect(store.get(agentCallFailureAtom)).toBeUndefined();
  });

  it('removes the account once when several requests report the server logout', async () => {
    const client = createClient();
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(removeCurrentClientSessionAndReload).mockReturnValue(new Promise(() => undefined));
    active = sessionFor('alice');
    await act(async () => {
      renderer = create(tree());
      await flush();
    });

    await act(async () => {
      client.emit('Session.logged_out');
      client.emit('Session.logged_out');
      client.emit('Session.logged_out');
      await flush();
    });

    expect(removeCurrentClientSessionAndReload).toHaveBeenCalledTimes(1);
    expect(removeCurrentClientSessionAndReload).toHaveBeenCalledWith(client, active);
  });

  it('shows the startup failure when removing the logged-out account fails', async () => {
    const client = createClient();
    vi.mocked(initClient).mockResolvedValue(client as never);
    vi.mocked(removeCurrentClientSessionAndReload).mockRejectedValue(
      new Error('The account list could not be saved')
    );
    active = sessionFor('alice');
    await act(async () => {
      renderer = create(tree());
      await flush();
    });
    await act(async () => {
      client.emit('sync', 'SYNCING', 'PREPARED');
      await flush();
    });
    expect(textOf(renderer?.toJSON() ?? null)).toContain('pages');

    await act(async () => {
      client.emit('Session.logged_out');
      await flush();
    });

    const rendered = textOf(renderer?.toJSON() ?? null);
    expect(rendered).not.toContain('pages');
    expect(rendered).toContain('The account list could not be saved');
  });
});
