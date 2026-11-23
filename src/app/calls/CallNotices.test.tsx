// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoticeSlot } from '../ui/noticeSlots';
import { activeCallAtom, callNoticesInViewAtom, type ActiveCall } from './callStore';
import { CallStopNoticesOutOfView } from './CallNotices';
import type { CallState } from './RoomCall';

// The stop notices of a call no view shows, in the app's notice places. Which view counts as
// showing them (folded, covered, minimized) is the call view's to say: CallPanel.window.test.tsx.

const setScreenShare = vi.fn(async () => undefined);
const setCamera = vi.fn(async () => undefined);
const dismissStoppedInput = vi.fn();

type Scene = {
  /** A phone's page place, under its top bar; a desktop's floats over the page. */
  phone?: boolean;
  /** A phone's drawer is out, with its notice place. */
  drawer?: boolean;
  /** A call view shows the notices itself. */
  inView?: boolean;
  state: Partial<CallState>;
};

const renderScene = ({ phone = false, drawer = false, inView = false, state }: Scene) => {
  const callState = { phase: 'connected', participants: [], ...state } as unknown as CallState;
  const store = createStore();
  store.set(activeCallAtom, {
    kind: 'room',
    call: {
      room: { roomId: '!standup:notices.test' } as Room,
      subscribe: () => () => undefined,
      getState: () => callState,
      setScreenShare,
      setCamera,
      dismissStoppedInput,
    },
  } as unknown as ActiveCall);
  store.set(callNoticesInViewAtom, inView ? 1 : 0);
  render(
    <Provider store={store}>
      <div data-testid="page-place">
        <NoticeSlot place="page" phone={phone} covered={drawer} />
      </div>
      {drawer && (
        <div data-testid="drawer-place">
          <NoticeSlot place="drawer" />
        </div>
      )}
      <CallStopNoticesOutOfView />
    </Provider>
  );
};

const placeText = (place: 'page' | 'drawer') => screen.getByTestId(`${place}-place`).textContent;
const pagePlace = () => screen.getByTestId('page-place').firstElementChild!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CallStopNoticesOutOfView', () => {
  it('shows a dead camera in the page place of a desktop while no call view shows it', () => {
    renderScene({ state: { cameraStopped: true } });

    expect(placeText('page')).toContain('Your camera stopped.');
    fireEvent.click(screen.getByRole('button', { name: 'Turn back on' }));
    expect(setCamera).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(dismissStoppedInput).toHaveBeenCalledWith('camera');
  });

  it('shows the stopped share under a phone top bar, with Share again acting inside its click', () => {
    renderScene({ phone: true, state: { screenShareStoppedInBackground: true } });

    expect(placeText('page')).toContain('Screen sharing stopped when you left the app.');
    // The picker needs the click itself: nothing waits between it and the call.
    fireEvent.click(screen.getByRole('button', { name: 'Share again' }));
    expect(setScreenShare).toHaveBeenCalledWith(true);
  });

  it('moves into the drawer of a phone while it covers the page, so its actions stay in reach', () => {
    renderScene({
      phone: true,
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

  it('leaves the notices to a call view that shows them, and the place empty while all is well', () => {
    renderScene({ inView: true, state: { cameraStopped: true } });
    expect(pagePlace().childElementCount).toBe(0);
    cleanup();

    renderScene({ state: {} });
    expect(pagePlace().childElementCount).toBe(0);
  });
});
