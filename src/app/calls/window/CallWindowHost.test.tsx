// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { callPanelRoomAtom } from '../callStore';
import {
  callWindowStorageKey,
  clearCallWindowStore,
  getCallWindowSettingsAtom,
  type CallWindowSettings,
} from './callWindowState';
import { CallWindowHost } from './CallWindowHost';

const USER = '@me:host.test';
const LOBBY = '!lobby:host.test';
const DESK = '!desk:host.test';

const rooms = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@me:host.test',
    getRoom: (roomId: string) => rooms.get(roomId) ?? null,
  }),
}));
vi.mock('../../matrix/hooks/usePowerLevels', () => ({
  PowerLevelsContextProvider: ({ children }: { children: React.ReactNode }) => children,
  usePowerLevels: () => ({}),
}));
vi.mock('../../matrix/hooks/useRoomMeta', () => ({
  useRoomName: (room: { name: string }) => room.name,
}));
// The call view itself; the host only places it.
vi.mock('../CallPanel', () => ({
  CallPanel: ({ room }: { room: Room }) => <p data-testid="call-panel">{room.roomId}</p>,
}));

const fakeRoom = (roomId: string, name: string) => ({ roomId, name } as unknown as Room);

let location = '';
let navigate: ReturnType<typeof useNavigate> | undefined;
/** Reads the route and keeps a way to change it, as another page's link would. */
function Route() {
  location = useLocation().pathname;
  navigate = useNavigate();
  return null;
}

const renderHost = (store: Store, size: ScreenSize = 'Desktop') =>
  render(
    <Provider store={store}>
      <ScreenSizeProvider value={size}>
        <MemoryRouter initialEntries={['/home/']}>
          <Route />
          <CallWindowHost />
        </MemoryRouter>
      </ScreenSizeProvider>
    </Provider>
  );

type Store = ReturnType<typeof createStore>;
/** Sets the account's window settings in `store`, as the window and its buttons write them. */
const settle = (store: Store, settings: CallWindowSettings) =>
  act(() => store.set(getCallWindowSettingsAtom(USER), settings));
const stored = (): CallWindowSettings =>
  JSON.parse(localStorage.getItem(callWindowStorageKey(USER)) ?? 'null') as CallWindowSettings;
const callWindow = () => screen.queryByTestId('call-window');

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  rooms.set(LOBBY, fakeRoom(LOBBY, 'Lobby'));
  rooms.set(DESK, fakeRoom(DESK, 'Help desk'));
});

afterEach(() => {
  cleanup();
  clearCallWindowStore(USER);
  rooms.clear();
});

describe('CallWindowHost', () => {
  it('floats the call view of the open call panel on desktop, labelled with its room', async () => {
    const store = createStore();
    store.set(callPanelRoomAtom, LOBBY);
    renderHost(store);

    expect(callWindow()?.getAttribute('aria-label')).toBe('Lobby');
    expect((await screen.findByTestId('call-panel')).textContent).toBe(LOBBY);
    expect(callWindow()?.contains(screen.getByTestId('call-panel'))).toBe(true);
  });

  it('shows nothing without an open call panel, on phones, while docked, or for an unknown room', () => {
    const store = createStore();
    renderHost(store);
    expect(callWindow()).toBeNull();
    cleanup();

    store.set(callPanelRoomAtom, LOBBY);
    renderHost(store, 'Mobile');
    expect(callWindow()).toBeNull();
    cleanup();

    const docked = createStore();
    settle(docked, { mode: 'docked' });
    docked.set(callPanelRoomAtom, LOBBY);
    renderHost(docked);
    expect(callWindow()).toBeNull();
    cleanup();

    const gone = createStore();
    gone.set(callPanelRoomAtom, '!gone:host.test');
    renderHost(gone);
    expect(callWindow()).toBeNull();
  });

  it('shows the window on a tablet too', () => {
    const store = createStore();
    store.set(callPanelRoomAtom, LOBBY);
    renderHost(store, 'Tablet');
    expect(callWindow()).not.toBeNull();
  });

  it('stays while the route changes', async () => {
    const store = createStore();
    store.set(callPanelRoomAtom, LOBBY);
    renderHost(store);
    const shown = callWindow();
    await screen.findByTestId('call-panel');

    act(() => navigate?.('/direct/'));
    expect(location).toBe('/direct/');
    expect(callWindow()).toBe(shown);
    expect(screen.getByTestId('call-panel').textContent).toBe(LOBBY);
  });

  it('goes when the call panel closes or the call view docks', () => {
    const store = createStore();
    store.set(callPanelRoomAtom, LOBBY);
    renderHost(store);
    settle(store, { mode: 'docked' });
    expect(callWindow()).toBeNull();
    settle(store, { mode: 'floating' });
    expect(callWindow()).not.toBeNull();
    act(() => store.set(callPanelRoomAtom, undefined));
    expect(callWindow()).toBeNull();
  });

  const bar = { x: 1024, y: 828, width: 400, height: 56 };
  const expanded = { x: 1024, y: 584, width: 400, height: 300 };

  it('expands a stored bar when a call panel opens, from none or from another room', () => {
    const store = createStore();
    settle(store, { mode: 'floating', rect: bar, expandedHeight: 300 });
    renderHost(store);

    act(() => store.set(callPanelRoomAtom, LOBBY));
    expect(stored().rect).toEqual(expanded);
    expect(callWindow()?.hasAttribute('data-bar')).toBe(false);

    // Minimized, the same room's call view stays a bar; another room's opens expanded.
    settle(store, { mode: 'floating', rect: bar, expandedHeight: 300 });
    expect(callWindow()?.hasAttribute('data-bar')).toBe(true);
    act(() => store.set(callPanelRoomAtom, DESK));
    expect(stored().rect).toEqual(expanded);
    expect(callWindow()?.getAttribute('aria-label')).toBe('Help desk');
  });

  it('leaves a stored bar alone while docked or on phones', () => {
    const store = createStore();
    settle(store, { mode: 'docked', rect: bar });
    renderHost(store);
    act(() => store.set(callPanelRoomAtom, LOBBY));
    expect(stored().rect).toEqual(bar);
    cleanup();

    const phone = createStore();
    settle(phone, { mode: 'floating', rect: bar });
    renderHost(phone, 'Mobile');
    act(() => phone.set(callPanelRoomAtom, LOBBY));
    expect(stored().rect).toEqual(bar);
  });
});
