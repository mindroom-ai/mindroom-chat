// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { ActiveCallTab } from './ActiveCallTab';
import { callPanelRoomAtom, type ActiveCall } from './callStore';
import type { CallState } from './RoomCall';
import {
  clearCallWindowStore,
  getCallWindowSettingsAtom,
  type CallWindowSettings,
} from './window/callWindowState';

const USER = '@me:tab.test';
const navigation = vi.hoisted(() => ({ navigateRoom: vi.fn(), navigateRoomThread: vi.fn() }));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:tab.test' }),
}));
vi.mock('../matrix/hooks/useRoomMeta', () => ({ useRoomName: () => 'Call with Helper' }));
vi.mock('../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => navigation }));
vi.mock('./callStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./callStore')>()),
  useCallState: (): Partial<CallState> => ({ microphone: true, participants: [] }),
}));

const ORIGIN = '!origin:tab.test';
const active = {
  call: { room: { roomId: '!agent-call:tab.test' } },
  kind: 'agent',
  origin: { roomId: ORIGIN, threadId: '$plan' },
} as unknown as ActiveCall;
const bar = { x: 1024, y: 828, width: 400, height: 56 };

let store = createStore();
const renderTab = (size: ScreenSize = 'Desktop') =>
  render(
    <Provider store={store}>
      <ScreenSizeProvider value={size}>
        <ActiveCallTab active={active} />
      </ScreenSizeProvider>
    </Provider>
  );
const settings = (): CallWindowSettings => store.get(getCallWindowSettingsAtom(USER));
const openCall = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Return to the call in Call with Helper' }));

beforeEach(() => {
  localStorage.clear();
  store = createStore();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
});

afterEach(() => {
  cleanup();
  clearCallWindowStore(USER);
  vi.clearAllMocks();
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

  it('goes back to the conversation while docked, and on phones', () => {
    store.set(getCallWindowSettingsAtom(USER), { mode: 'docked', rect: bar });
    renderTab();
    openCall();
    expect(store.get(callPanelRoomAtom)).toBe(ORIGIN);
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(ORIGIN, '$plan');
    expect(settings().rect).toEqual(bar);
    cleanup();
    vi.clearAllMocks();

    store = createStore();
    store.set(getCallWindowSettingsAtom(USER), { mode: 'floating', rect: bar });
    renderTab('Mobile');
    openCall();
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(ORIGIN, '$plan');
    expect(settings().rect).toEqual(bar);
  });
});
