// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { setImperativeJotaiStore } from '../lib/state/jotaiStore';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { ActiveCallTab } from './ActiveCallTab';
import { activeCallAtom, callPanelRoomAtom, type ActiveCall } from './callStore';
import type { CallState } from './RoomCall';
import {
  clearCallWindowStore,
  focusHandOffAtom,
  getCallWindowSettingsAtom,
  type CallWindowSettings,
} from './window/callWindowState';

const USER = '@me:tab.test';
const navigation = vi.hoisted(() => ({ navigateRoom: vi.fn(), navigateRoomThread: vi.fn() }));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@me:tab.test',
    getRoom: (roomId: string) => (roomId === ORIGIN ? { roomId } : null),
  }),
}));
vi.mock('../matrix/hooks/useRoomMeta', () => ({
  useRoomName: ({ roomId }: { roomId: string }) =>
    roomId === ORIGIN ? 'Planning Room' : 'Call with Helper',
}));
vi.mock('../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => navigation }));
vi.mock('./callStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./callStore')>()),
  useCallState: () => state,
}));

const ORIGIN = '!origin:tab.test';
const state: Pick<CallState, 'phase' | 'microphone' | 'participants'> = {
  phase: 'connected',
  microphone: true,
  participants: [],
};
const active = {
  call: { room: { roomId: '!agent-call:tab.test' }, getState: () => state },
  kind: 'agent',
  origin: { roomId: ORIGIN, threadId: '$plan' },
} as unknown as ActiveCall;
const bar = { x: 1024, y: 828, width: 400, height: 56 };

let store = createStore();
const renderTab = (size: ScreenSize = 'Desktop', route = '/home/') =>
  render(
    <Provider store={store}>
      <ScreenSizeProvider value={size}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/home/:roomIdOrAlias?" element={<ActiveCallTab active={active} />} />
          </Routes>
        </MemoryRouter>
      </ScreenSizeProvider>
    </Provider>
  );
const settings = (): CallWindowSettings => store.get(getCallWindowSettingsAtom(USER));
const returnButton = () =>
  screen.getByRole('button', { name: 'Return to the call in Planning Room' });
const openCall = () => fireEvent.click(returnButton());

beforeEach(() => {
  localStorage.clear();
  state.phase = 'connected';
  store = createStore();
  store.set(activeCallAtom, active);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
});

afterEach(() => {
  cleanup();
  clearCallWindowStore(USER);
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("the rail's call button", () => {
  it('opens the floating window on desktop and expands its bar, staying on the page', () => {
    store.set(getCallWindowSettingsAtom(USER), { mode: 'floating', rect: bar });
    renderTab();
    openCall();

    expect(store.get(callPanelRoomAtom)).toBe(ORIGIN);
    expect(settings().rect).toEqual({ x: 1024, y: 404, width: 400, height: 480 });
    expect(navigation.navigateRoom).not.toHaveBeenCalled();
    expect(navigation.navigateRoomThread).not.toHaveBeenCalled();
  });

  it('expands a bar whose call view is already open', () => {
    store.set(getCallWindowSettingsAtom(USER), { mode: 'floating', rect: bar });
    store.set(callPanelRoomAtom, ORIGIN);
    renderTab();
    openCall();
    expect(settings().rect?.height).toBe(480);
  });

  it('leaves a window that is not minimized where it is', () => {
    const rect = { x: 200, y: 100, width: 500, height: 400 };
    store.set(getCallWindowSettingsAtom(USER), { mode: 'floating', rect });
    renderTab('Tablet');
    openCall();
    expect(settings().rect).toEqual(rect);
    expect(navigation.navigateRoomThread).not.toHaveBeenCalled();
  });

  it("hands its focus to the floating window's handle when floating", () => {
    store.set(getCallWindowSettingsAtom(USER), { mode: 'floating', rect: bar });
    renderTab();
    const button = returnButton();
    button.focus();
    openCall();
    expect(store.get(focusHandOffAtom)).toEqual({ to: 'window', from: button });
  });

  it('closes the phone drawer even when the call is already in the shown thread', () => {
    store.set(phoneNavDrawerOpenAtom, true);
    renderTab('Mobile', `/home/${encodeURIComponent(ORIGIN)}/?threadId=%24plan`);
    const button = returnButton();
    openCall();
    expect(store.get(focusHandOffAtom)).toEqual({ to: 'panel', roomId: ORIGIN, from: button });
    expect(store.get(callPanelRoomAtom)).toBe(ORIGIN);
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    expect(navigation.navigateRoomThread).not.toHaveBeenCalled();
  });

  it.each(['cleared', 'failed'] as const)(
    'abandons a queued return if the call is %s',
    (reason) => {
      vi.useFakeTimers();
      const clearImperativeStore = setImperativeJotaiStore(store);
      const { container } = renderTab('Mobile');
      container.setAttribute('data-phone-stage', '');
      store.set(phoneNavDrawerOpenAtom, true);
      try {
        openCall();
        expect(store.get(callPanelRoomAtom)).toBeUndefined();
        act(() => {
          if (reason === 'cleared') store.set(activeCallAtom, undefined);
          else state.phase = 'failed';
          vi.runOnlyPendingTimers();
        });
        expect(store.get(callPanelRoomAtom)).toBeUndefined();
        expect(store.get(focusHandOffAtom)).toBeUndefined();
        expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
        expect(navigation.navigateRoomThread).not.toHaveBeenCalled();
        expect(navigation.navigateRoom).not.toHaveBeenCalled();
      } finally {
        clearImperativeStore();
      }
    }
  );

  it('returns focus to the menu if the call heading never appears', () => {
    vi.useFakeTimers();
    const { container } = renderTab('Mobile');
    const menu = document.createElement('button');
    menu.id = 'phone-nav-menu-button';
    container.append(menu);
    store.set(phoneNavDrawerOpenAtom, true);
    openCall();
    expect(store.get(focusHandOffAtom)?.to).toBe('panel');
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(store.get(focusHandOffAtom)).toBeUndefined();
    expect(menu).toBe(document.activeElement);
  });

  it('can reopen an already failed call to dismiss it', () => {
    state.phase = 'failed';
    renderTab('Mobile');
    openCall();
    expect(store.get(callPanelRoomAtom)).toBe(ORIGIN);
  });

  it('goes back to the conversation while docked, and on phones', () => {
    store.set(getCallWindowSettingsAtom(USER), { mode: 'docked', rect: bar });
    renderTab();
    const button = returnButton();
    openCall();
    expect(store.get(callPanelRoomAtom)).toBe(ORIGIN);
    expect(store.get(focusHandOffAtom)).toEqual({ to: 'panel', roomId: ORIGIN, from: button });
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(ORIGIN, '$plan');
    expect(settings().rect).toEqual(bar);
    cleanup();
    vi.clearAllMocks();

    store = createStore();
    store.set(activeCallAtom, active);
    store.set(getCallWindowSettingsAtom(USER), { mode: 'floating', rect: bar });
    renderTab('Mobile');
    openCall();
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(ORIGIN, '$plan');
    expect(settings().rect).toEqual(bar);
  });
});
