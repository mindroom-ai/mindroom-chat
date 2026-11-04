import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createStore, Provider } from 'jotai';
import { ClientRoot } from './ClientRoot';
import { useActiveSession } from '../../hooks/useSessionStore';
import type { StoredSession } from '../../state/sessions';
import {
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  voiceAutoSendPendingAtom,
  type TUploadItem,
} from '../../state/room/roomInputDrafts';
import {
  initClient,
  removeCurrentClientSessionAndReload,
  startClient,
} from '../../../client/initMatrix';

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
vi.mock('../../hooks/useSessionStore', () => ({ useActiveSession: vi.fn() }));
vi.mock('../../hooks/useClientConfig', () => ({ useClientConfig: () => ({}) }));
vi.mock('../../mindroom/engine', () => ({
  createMindroomSyncEngine: ({ mx }: { mx: unknown }) => ({ mx, start: vi.fn(), stop: vi.fn() }),
  MindroomSyncEngineProvider: ({ children }: { children: React.ReactNode }) => children,
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
          <div>pages</div>
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

  it('gives the next account empty composers in a room both accounts share', async () => {
    vi.mocked(initClient).mockImplementation(async () => createClient() as never);
    active = sessionFor('alice');
    await act(async () => {
      renderer = create(tree());
      await flush();
    });

    // Alice picks a message to reply to and stages a file, then switches to Bob.
    store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), {
      userId: '@carol:example.org',
      eventId: '$question',
      body: 'Question',
    });
    store.set(roomIdToUploadItemsAtomFamily(ROOM_ID), { type: 'PUT', item: stagedFile() });
    store.set(voiceAutoSendPendingAtom, true);

    active = sessionFor('bob');
    await act(async () => {
      renderer?.update(tree());
      await flush();
    });

    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))).toBeUndefined();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);
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
