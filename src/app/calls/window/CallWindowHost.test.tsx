// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { activeCallAtom, callPanelRoomAtom, type ActiveCall } from '../callStore';
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

const { rooms, listeners, panelRenders, loading } = vi.hoisted(() => ({
  rooms: new Map<string, unknown>(),
  // While set, the call view waits for its code, as a lazy part does on its first load.
  loading: { until: undefined as Promise<void> | undefined },
  // What the client tells its listeners: a room it forgot, a membership of the person's own.
  listeners: new Map<string, Set<(...args: unknown[]) => void>>(),
  panelRenders: { count: 0 },
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@me:host.test',
    getRoom: (roomId: string) => rooms.get(roomId) ?? null,
    on: (name: string, listener: (...args: unknown[]) => void) => {
      listeners.set(name, (listeners.get(name) ?? new Set()).add(listener));
    },
    off: (name: string, listener: (...args: unknown[]) => void) => {
      listeners.get(name)?.delete(listener);
    },
  }),
}));
vi.mock('../../matrix/hooks/usePowerLevels', () => ({
  PowerLevelsContextProvider: ({ children }: { children: React.ReactNode }) => children,
  usePowerLevels: () => ({}),
}));
// The call view itself; the host only places it.
vi.mock('../CallPanel', () => ({
  CallPanel: ({ room }: { room: Room }) => {
    if (loading.until) throw loading.until;
    panelRenders.count += 1;
    return <p data-testid="call-panel">{room.roomId}</p>;
  },
}));

/** The client tells its listeners `name`, as sync does. */
const emit = (name: string, ...args: unknown[]) =>
  act(() => listeners.get(name)?.forEach((listener) => listener(...args)));

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
  listeners.clear();
  panelRenders.count = 0;
  loading.until = undefined;
});

describe('CallWindowHost', () => {
  it('floats the call view of the open call panel on desktop, in a window named as one', async () => {
    const store = createStore();
    store.set(callPanelRoomAtom, LOBBY);
    renderHost(store);

    expect(callWindow()?.getAttribute('aria-label')).toBe('Call window');
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

  it('shows a spinner in the window while the call view loads', async () => {
    let release = () => undefined as void;
    loading.until = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = createStore();
    store.set(callPanelRoomAtom, LOBBY);
    renderHost(store);
    const spinner = () => callWindow()?.querySelector('[data-call-window-loading]');
    expect(spinner()).not.toBeNull();
    expect(screen.queryByTestId('call-panel')).toBeNull();

    loading.until = undefined;
    await act(async () => release());
    expect((await screen.findByTestId('call-panel')).textContent).toBe(LOBBY);
    expect(spinner()).toBeNull();
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
    expect(screen.getByTestId('call-panel').textContent).toBe(DESK);
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

  it('goes when its room is forgotten or left, and stays for other rooms', () => {
    const store = createStore();
    store.set(callPanelRoomAtom, LOBBY);
    renderHost(store);

    emit('deleteRoom', DESK);
    emit('Room.myMembership', rooms.get(DESK), 'leave', 'join');
    emit('Room.myMembership', rooms.get(LOBBY), 'join', 'invite');
    expect(store.get(callPanelRoomAtom)).toBe(LOBBY);
    expect(callWindow()).not.toBeNull();

    emit('deleteRoom', LOBBY);
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
    expect(callWindow()).toBeNull();

    act(() => store.set(callPanelRoomAtom, DESK));
    expect(callWindow()).not.toBeNull();
    emit('Room.myMembership', rooms.get(DESK), 'leave', 'join');
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
    expect(callWindow()).toBeNull();

    act(() => store.set(callPanelRoomAtom, LOBBY));
    emit('Room.myMembership', rooms.get(LOBBY), 'ban', 'join');
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
  });

  const callIn = (roomId: string) =>
    ({ call: { room: { roomId } }, kind: 'room' } as unknown as ActiveCall);

  it('expands a stored bar when a call starts in the room it shows, and only there', () => {
    const store = createStore();
    settle(store, { mode: 'floating', rect: bar, expandedHeight: 300 });
    store.set(callPanelRoomAtom, LOBBY);
    renderHost(store);
    // Left from the bar, the room's call view stays open on the call to join, as the bar.
    settle(store, { mode: 'floating', rect: bar, expandedHeight: 300 });
    expect(callWindow()?.hasAttribute('data-bar')).toBe(true);

    act(() => store.set(activeCallAtom, callIn(DESK)));
    expect(stored().rect).toEqual(bar);

    act(() => store.set(activeCallAtom, undefined));
    act(() => store.set(activeCallAtom, callIn(LOBBY)));
    expect(stored().rect).toEqual(expanded);
    expect(callWindow()?.hasAttribute('data-bar')).toBe(false);
  });

  it('expands for an agent call started from the room it shows', () => {
    const store = createStore();
    settle(store, { mode: 'floating', rect: bar, expandedHeight: 300 });
    store.set(callPanelRoomAtom, LOBBY);
    renderHost(store);
    settle(store, { mode: 'floating', rect: bar, expandedHeight: 300 });

    const agentCall = { ...callIn('!agent:host.test'), kind: 'agent', origin: { roomId: LOBBY } };
    act(() => store.set(activeCallAtom, agentCall as ActiveCall));
    expect(stored().rect).toEqual(expanded);
  });

  it('closes when the call it shows ends here, and only that call', () => {
    const store = createStore();
    store.set(activeCallAtom, callIn(LOBBY));
    store.set(callPanelRoomAtom, LOBBY);
    renderHost(store);
    expect(callWindow()).not.toBeNull();

    // This device left, or dismissed the call that failed: the window does not stay over every
    // page on the room's call to join.
    act(() => store.set(activeCallAtom, undefined));
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
    expect(callWindow()).toBeNull();

    // A call in another room ending leaves this room's call view open.
    act(() => store.set(activeCallAtom, callIn(DESK)));
    act(() => store.set(callPanelRoomAtom, LOBBY));
    act(() => store.set(activeCallAtom, undefined));
    expect(store.get(callPanelRoomAtom)).toBe(LOBBY);
    expect(callWindow()).not.toBeNull();
  });

  it('closes when an agent call started from the room it shows ends', () => {
    const store = createStore();
    const agentCall = { ...callIn('!agent:host.test'), kind: 'agent', origin: { roomId: LOBBY } };
    store.set(activeCallAtom, agentCall as ActiveCall);
    store.set(callPanelRoomAtom, LOBBY);
    renderHost(store);
    act(() => store.set(activeCallAtom, undefined));
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
  });

  it('leaves the call view on the call to join again while docked or on phones', () => {
    const docked = createStore();
    settle(docked, { mode: 'docked' });
    docked.set(activeCallAtom, callIn(LOBBY));
    docked.set(callPanelRoomAtom, LOBBY);
    renderHost(docked);
    act(() => docked.set(activeCallAtom, undefined));
    expect(docked.get(callPanelRoomAtom)).toBe(LOBBY);
    cleanup();

    const phone = createStore();
    phone.set(activeCallAtom, callIn(LOBBY));
    phone.set(callPanelRoomAtom, LOBBY);
    renderHost(phone, 'Mobile');
    act(() => phone.set(activeCallAtom, undefined));
    expect(phone.get(callPanelRoomAtom)).toBe(LOBBY);
  });

  it('leaves the call view alone when the window only moves or resizes', async () => {
    const store = createStore();
    store.set(callPanelRoomAtom, LOBBY);
    renderHost(store);
    await screen.findByTestId('call-panel');
    const before = panelRenders.count;

    settle(store, { mode: 'floating', rect: { x: 100, y: 100, width: 500, height: 400 } });
    settle(store, { mode: 'floating', rect: { x: 116, y: 100, width: 500, height: 400 } });
    expect(callWindow()?.style.left).toBe('116px');
    expect(panelRenders.count).toBe(before);
  });
});
