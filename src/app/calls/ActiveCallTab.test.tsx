// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { useRef } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { PHONE_NAV_MENU_BUTTON_ID, phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { playLiveSlide, skipActiveLiveSlide } from '../navigation/phonePageSlide';
import { ActiveCallTab } from './ActiveCallTab';
import {
  activeCallAtom,
  callPanelRequestAtom,
  callPanelRoomAtom,
  type ActiveCall,
} from './callStore';
import type { CallState } from './RoomCall';
import {
  clearCallWindowStore,
  focusHandOffAtom,
  getCallWindowSettingsAtom,
  useFocusHandOff,
  type CallWindowSettings,
} from './window/callWindowState';

const USER = '@me:tab.test';
const navigation = vi.hoisted(() => ({
  navigateRoom: vi.fn(),
  navigateRoomThread: vi.fn(),
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@me:tab.test',
    getRoom: (roomId: string) => (roomId === ORIGIN ? originRoom : null),
    getRooms: () => [originRoom],
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
const ALIAS = '#planning:tab.test';
const originRoom = { roomId: ORIGIN, getCanonicalAlias: () => ALIAS };
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
const renderTab = (size: ScreenSize = 'Desktop', route = '/home/') => {
  const router = createMemoryRouter(
    [{ path: '/home/:roomIdOrAlias?', element: <ActiveCallTab active={active} /> }],
    { initialEntries: ['/home/', route] }
  );
  return {
    ...render(
      <Provider store={store}>
        <ScreenSizeProvider value={size}>
          <RouterProvider router={router} />
        </ScreenSizeProvider>
      </Provider>
    ),
    router,
  };
};

function LateHeading() {
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusHandOff('panel', () => heading.current?.focus(), ORIGIN);
  return (
    <h2 ref={heading} tabIndex={-1}>
      Planning Room
    </h2>
  );
}
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
  skipActiveLiveSlide();
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

  it('cancels an active phone live slide and opens the call immediately on mobile', () => {
    const { container } = renderTab('Mobile');
    store.set(phoneNavDrawerOpenAtom, true);

    const stage = document.createElement('div');
    const under = document.createElement('div');
    const over = document.createElement('div');
    stage.append(under, over);
    container.append(stage);
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      width: 390,
      height: 800,
      top: 0,
      left: 0,
      right: 390,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const pendingAnim = {
      finished: new Promise<void>(() => undefined),
      cancel: vi.fn(),
    } as unknown as Animation;
    over.animate = vi.fn(() => pendingAnim);
    under.animate = vi.fn(() => pendingAnim);

    const onCommit = vi.fn();
    const exit = vi.fn();
    playLiveSlide({ direction: 'back', stage, over, under, exit, onCommit });

    openCall();

    expect(onCommit).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(false);
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    expect(store.get(callPanelRoomAtom)).toBe(ORIGIN);
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(ORIGIN, '$plan');
  });

  it.each([
    'waits',
    'gets a canonical address',
    'moves focus',
    'goes back then forward',
    'reopens the drawer',
    'times out',
    'starts a newer hand-off',
  ] as const)('handles a late heading when the user %s', async (action) => {
    vi.useFakeTimers();
    const target = `/home/${encodeURIComponent(ORIGIN)}?threadId=%24plan`;
    const alias = `/home/${encodeURIComponent(ALIAS)}?threadId=%24plan`;
    const { container, router } = renderTab(
      'Mobile',
      action === 'gets a canonical address' ? alias : target
    );
    const menu = document.createElement('button');
    menu.id = PHONE_NAV_MENU_BUTTON_ID;
    container.append(menu);
    store.set(phoneNavDrawerOpenAtom, true);
    openCall();
    expect(navigation.navigateRoomThread).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(menu).toBe(document.activeElement);
    expect(store.get(focusHandOffAtom)?.to).toBe('panel');

    const newer = { to: 'window', from: menu } as const;
    if (action === 'moves focus') {
      const elsewhere = returnButton();
      elsewhere.focus();
      expect(store.get(focusHandOffAtom)).toBeUndefined();
      // Returning to the menu must not revive a cancelled hand-off.
      menu.focus();
    } else if (action === 'gets a canonical address') {
      await act(async () => router.navigate(target, { replace: true }));
    } else if (action === 'goes back then forward') {
      // MemoryRouter moves the route but does not emit the browser's traversal event.
      for (const delta of [-1, 1]) {
        await act(async () => {
          window.dispatchEvent(new PopStateEvent('popstate'));
          await router.navigate(delta);
        });
      }
    } else if (action === 'reopens the drawer') {
      act(() => store.set(phoneNavDrawerOpenAtom, true));
    } else if (action === 'times out') {
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
    } else if (action === 'starts a newer hand-off') {
      act(() => store.set(focusHandOffAtom, newer));
    }
    const shouldFocus = action === 'waits' || action === 'gets a canonical address';
    if (!shouldFocus && action !== 'starts a newer hand-off') {
      expect(store.get(focusHandOffAtom)).toBeUndefined();
      expect(store.get(callPanelRequestAtom)).toEqual({ roomId: ORIGIN });
    }
    render(
      <Provider store={store}>
        <LateHeading />
      </Provider>
    );
    expect(document.activeElement).toBe(shouldFocus ? screen.getByRole('heading') : menu);
    expect(store.get(focusHandOffAtom)).toBe(
      action === 'starts a newer hand-off' ? newer : undefined
    );
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
