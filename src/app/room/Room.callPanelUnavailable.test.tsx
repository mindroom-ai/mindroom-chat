// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomCall } from '../calls/RoomCall';
import { type ActiveCall, activeCallAtom, callPanelRoomAtom } from '../calls/callStore';
import { CallWindowHost } from '../calls/window/CallWindowHost';
import {
  type CallWindowMode,
  clearCallWindowStore,
  getCallWindowSettingsAtom,
} from '../calls/window/callWindowState';
import { importBeforeTests } from '../../test/utils/importBeforeTests';

// The call panel's code is a chunk of its own; here it cannot load, as offline or after a deploy.
vi.mock('../calls/CallPanel', () => {
  throw new TypeError('Failed to fetch dynamically imported module');
});

const { mx, room } = vi.hoisted(() => {
  const listeners = { on: () => undefined, off: () => undefined, removeListener: () => undefined };
  const room = { roomId: '!room:example.org', name: 'Standup', ...listeners };
  return {
    mx: {
      getSafeUserId: () => '@alice:example.org',
      getHomeserverUrl: () => 'https://example.org',
      getRoom: (roomId: string) => (roomId === room.roomId ? room : null),
      ...listeners,
    },
    room,
  };
});

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('./RoomView', () => ({ RoomView: () => null }));
vi.mock('../members/MembersDrawer', () => ({ MembersDrawer: () => null }));
vi.mock('../computer/ComputerPanel', () => ({ ComputerPanel: () => null }));
vi.mock('../canvas/RoomCanvasPanel', () => ({ RoomCanvasPanel: () => null }));
vi.mock('../matrix/hooks/useRoom', () => ({ useRoom: () => room }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => [] }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({
  PowerLevelsContextProvider: ({ children }: { children: React.ReactNode }) => children,
  usePowerLevels: () => ({}),
}));
vi.mock('../config/useClientConfig', () => ({ useClientConfig: () => ({ mindroom: {} }) }));
vi.mock('../computer/useAgentServers', () => ({
  useRoomAgentServers: () => [],
  useBindsOpenIdTokens: () => false,
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: 'threaded', setViewMode: () => undefined }),
}));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: () => undefined, navigateRoomThread: () => undefined }),
}));

importBeforeTests(() => import('./Room'));

/** A call this device is in, in `roomId`, that records its leave. */
const liveCall = (roomId: string) => {
  const leave = vi.fn(() => Promise.resolve());
  const call = {
    room: { roomId },
    subscribe: () => () => undefined,
    getState: () => ({ phase: 'connected' }),
    leave,
  } as unknown as RoomCall;
  return { call, leave };
};

type Place = 'docked' | 'window';

/**
 * The call view of `room` with `active` on: docked beside the room, or in the floating window,
 * which shows over every page (`CallWindowHost`).
 */
const renderRoomWithCallPanel = async (active?: ActiveCall, place: Place = 'docked') => {
  const store = createStore();
  const mode: CallWindowMode = place === 'docked' ? 'docked' : 'floating';
  store.set(getCallWindowSettingsAtom(mx.getSafeUserId()), { mode });
  store.set(activeCallAtom, active);
  store.set(callPanelRoomAtom, room.roomId);
  const { Room } = await import('./Room');
  render(<Provider store={store}>{place === 'docked' ? <Room /> : <CallWindowHost />}</Provider>);
  await screen.findByRole('button', { name: 'Retry' });
  return store;
};

describe('the call panel when its code cannot load', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}

        disconnect() {}
      }
    );
  });

  afterEach(() => {
    cleanup();
    clearCallWindowStore(mx.getSafeUserId());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('ends the call in this room, which the panel would otherwise be the only way to end', async () => {
    const { call, leave } = liveCall(room.roomId);
    const store = await renderRoomWithCallPanel({ call, kind: 'room' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'End' }));
    });

    expect(leave).toHaveBeenCalledOnce();
    await waitFor(() => expect(store.get(activeCallAtom)).toBeUndefined());
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
  });

  it('ends an agent call started from this conversation', async () => {
    const { call, leave } = liveCall('!agent-call:example.org');
    await renderRoomWithCallPanel({ call, kind: 'agent', origin: { roomId: room.roomId } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'End' }));
    });

    expect(leave).toHaveBeenCalledOnce();
  });

  it('offers no End without a call here', async () => {
    await renderRoomWithCallPanel();
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
    cleanup();

    const { call } = liveCall('!elsewhere:example.org');
    await renderRoomWithCallPanel({ call, kind: 'room' });
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
  });

  it('says so in the floating window, which ends the call and closes there too', async () => {
    const { call, leave } = liveCall(room.roomId);
    const store = await renderRoomWithCallPanel({ call, kind: 'room' }, 'window');
    const callWindow = screen.getByTestId('call-window');
    expect(callWindow.textContent).toContain("This couldn't load");

    await act(async () => {
      fireEvent.click(within(callWindow).getByRole('button', { name: 'End' }));
    });
    expect(leave).toHaveBeenCalledOnce();

    await act(async () => {
      fireEvent.click(within(callWindow).getByRole('button', { name: 'Close' }));
    });
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
    expect(screen.queryByTestId('call-window')).toBeNull();
  });
});
