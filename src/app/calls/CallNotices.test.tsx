// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { NoticeSlot } from '../ui/noticeSlots';
import { activeCallAtom, callPanelRoomAtom, type ActiveCall } from './callStore';
import { CallStopNoticesOutOfView } from './CallNotices';
import type { CallState } from './RoomCall';
import { clearCallWindowStore, getCallWindowSettingsAtom } from './window/callWindowState';

// The stop notices of a call whose view is out of sight, in the app's notice places.

const USER = '@me:notices.test';
const CALL_ROOM = '!standup:notices.test';
const OTHER_ROOM = '!lounge:notices.test';

const navigation = vi.hoisted(() => ({ selected: undefined as string | undefined }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:notices.test' }),
}));
vi.mock('../navigation/useSelectedRoom', () => ({ useSelectedRoom: () => navigation.selected }));

const setScreenShare = vi.fn(async () => undefined);
const setCamera = vi.fn(async () => undefined);
const dismissStoppedInput = vi.fn();

type Scene = {
  size?: ScreenSize;
  /** The room whose call view is open; none while it is closed. */
  panel?: string;
  selected?: string;
  docked?: boolean;
  /** A phone's drawer is out, with its notice place. */
  drawer?: boolean;
  state: Partial<CallState>;
};

const renderScene = ({
  size = ScreenSize.Desktop,
  panel,
  selected,
  docked,
  drawer,
  state,
}: Scene) => {
  navigation.selected = selected;
  const callState = { phase: 'connected', participants: [], ...state } as unknown as CallState;
  const store = createStore();
  store.set(activeCallAtom, {
    kind: 'room',
    call: {
      room: { roomId: CALL_ROOM } as Room,
      subscribe: () => () => undefined,
      getState: () => callState,
      setScreenShare,
      setCamera,
      dismissStoppedInput,
    },
  } as unknown as ActiveCall);
  store.set(callPanelRoomAtom, panel);
  if (docked) store.set(getCallWindowSettingsAtom(USER), { mode: 'docked' });
  const phone = size === ScreenSize.Mobile;
  render(
    <Provider store={store}>
      <ScreenSizeProvider value={size}>
        <div data-testid="page-place">
          <NoticeSlot place="page" phone={phone} covered={drawer} />
        </div>
        {drawer && (
          <div data-testid="drawer-place">
            <NoticeSlot place="drawer" />
          </div>
        )}
        <CallStopNoticesOutOfView />
      </ScreenSizeProvider>
    </Provider>
  );
};

const placeText = (place: 'page' | 'drawer') => screen.getByTestId(`${place}-place`).textContent;
const pagePlace = () => screen.getByTestId('page-place').firstElementChild!;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  clearCallWindowStore(USER);
  vi.clearAllMocks();
});

describe('CallStopNoticesOutOfView', () => {
  it('shows a dead camera in the page place at desktop width while the call view is closed', () => {
    renderScene({ selected: OTHER_ROOM, state: { cameraStopped: true } });

    expect(placeText('page')).toContain('Your camera stopped.');
    fireEvent.click(screen.getByRole('button', { name: 'Turn back on' }));
    expect(setCamera).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(dismissStoppedInput).toHaveBeenCalledWith('camera');
  });

  it('shows the stopped share under a phone top bar, with Share again acting inside its click', () => {
    renderScene({
      size: ScreenSize.Mobile,
      selected: OTHER_ROOM,
      panel: CALL_ROOM,
      state: { screenShareStoppedInBackground: true },
    });

    expect(placeText('page')).toContain('Screen sharing stopped when you left the app.');
    // The picker needs the click itself: nothing waits between it and the call.
    fireEvent.click(screen.getByRole('button', { name: 'Share again' }));
    expect(setScreenShare).toHaveBeenCalledWith(true);
  });

  it('moves into the drawer of a phone while it covers the page, so its actions stay in reach', () => {
    renderScene({
      size: ScreenSize.Mobile,
      drawer: true,
      state: { screenShareStoppedInBackground: true, microphoneStopped: true },
    });

    expect(pagePlace().childElementCount).toBe(0);
    expect(placeText('drawer')).toContain('Screen sharing stopped when you left the app.');
    expect(placeText('drawer')).toContain('Your microphone stopped.');
    expect(screen.getByRole('button', { name: 'Share again' }).closest('[inert]')).toBeNull();
  });

  it('disables Share again while the call rejoins, which would drop the share', () => {
    renderScene({ state: { phase: 'reconnecting', screenShareStoppedInBackground: true } });

    const shareAgain = screen.getByRole<HTMLButtonElement>('button', { name: 'Share again' });
    expect(shareAgain.disabled).toBe(true);
    fireEvent.click(shareAgain);
    expect(setScreenShare).not.toHaveBeenCalled();
  });

  it.each<[string, Omit<Scene, 'state'>]>([
    [
      'the floating window shows the call over another page',
      { panel: CALL_ROOM, selected: OTHER_ROOM },
    ],
    [
      'the docked panel shows it in its room',
      { panel: CALL_ROOM, selected: CALL_ROOM, docked: true },
    ],
    ['a phone shows its panel', { size: ScreenSize.Mobile, panel: CALL_ROOM, selected: CALL_ROOM }],
  ])('leaves the notices to the call view while %s', (_where, scene) => {
    renderScene({ ...scene, state: { cameraStopped: true } });
    expect(pagePlace().childElementCount).toBe(0);
  });

  it('shows them for a docked call whose room is not on the page, and nothing while all is well', () => {
    renderScene({
      panel: CALL_ROOM,
      selected: OTHER_ROOM,
      docked: true,
      state: { cameraStopped: true },
    });
    expect(placeText('page')).toContain('Your camera stopped.');
    cleanup();

    renderScene({ selected: OTHER_ROOM, state: {} });
    expect(pagePlace().childElementCount).toBe(0);
  });
});
