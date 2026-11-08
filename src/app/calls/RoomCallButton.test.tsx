// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { activeCallAtom, callPanelRoomAtom, type ActiveCall } from './callStore';
import { RoomCallButton } from './RoomCallButton';
import {
  clearCallWindowStore,
  getCallWindowSettingsAtom,
  type CallWindowSettings,
} from './window/callWindowState';

// The room header's call button with the floating window: it shows a call view minimized to
// the bar, where it would otherwise hide it.

const USER = '@me:button.test';
const room = { roomId: '!standup:button.test' } as Room;

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:button.test' }),
}));
vi.mock('./callStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./callStore')>()),
  useRoomCallMembers: () => [],
}));

const bar = { x: 1024, y: 828, width: 400, height: 56 };
let store = createStore();
const renderButton = (size: ScreenSize = 'Desktop') =>
  render(
    <Provider store={store}>
      <ScreenSizeProvider value={size}>
        <RoomCallButton room={room} />
      </ScreenSizeProvider>
    </Provider>
  );
const callButton = () => screen.getByRole('button');
const settings = (): CallWindowSettings => store.get(getCallWindowSettingsAtom(USER));

beforeEach(() => {
  localStorage.clear();
  store = createStore();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  // This device is in the room's call, and its call view is open.
  store.set(activeCallAtom, { call: { room }, kind: 'room' } as unknown as ActiveCall);
  store.set(callPanelRoomAtom, room.roomId);
});

afterEach(() => {
  cleanup();
  clearCallWindowStore(USER);
});

describe('RoomCallButton with the floating window', () => {
  it('shows the call minimized to the bar instead of hiding it', () => {
    store.set(getCallWindowSettingsAtom(USER), { mode: 'floating', rect: bar });
    renderButton();
    expect(callButton().getAttribute('aria-label')).toBe('Show the call');
    expect(callButton().getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(callButton());
    expect(store.get(callPanelRoomAtom)).toBe(room.roomId);
    expect(settings().rect).toEqual({ x: 1024, y: 404, width: 400, height: 480 });
    expect(callButton().getAttribute('aria-label')).toBe('Hide the call');
    expect(callButton().getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(callButton());
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
  });

  it('hides it as before while docked and on phones', () => {
    store.set(getCallWindowSettingsAtom(USER), { mode: 'docked', rect: bar });
    renderButton();
    expect(callButton().getAttribute('aria-label')).toBe('Hide the call');
    fireEvent.click(callButton());
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
    expect(settings().rect).toEqual(bar);
    cleanup();

    store.set(callPanelRoomAtom, room.roomId);
    store.set(getCallWindowSettingsAtom(USER), { mode: 'floating', rect: bar });
    renderButton('Mobile');
    fireEvent.click(callButton());
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
    expect(settings().rect).toEqual(bar);
  });
});
