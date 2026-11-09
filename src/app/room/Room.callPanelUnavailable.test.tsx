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

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useLocation: () => ({ pathname: '/home/', search: '', hash: '' }),
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
const navigate = vi.hoisted(() => ({ navigateRoom: vi.fn(), navigateRoomThread: vi.fn() }));
vi.mock('../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => navigate }));

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

  it("keeps the floating window's title bar, and its line with Expand when minimized", async () => {
    const { call } = liveCall(room.roomId);
    await renderRoomWithCallPanel({ call, kind: 'room' }, 'window');
    const callWindow = screen.getByTestId('call-window');
    // The title bar moves the window and names it after the room.
    const titleBar = within(callWindow).getByRole('group', { name: 'Move call window' });
    expect(within(titleBar).getByRole('heading', { name: 'Standup' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Standup' })).toBe(callWindow);

    fireEvent.click(within(titleBar).getByRole('button', { name: 'Minimize' }));
    expect(callWindow.getAttribute('data-bar')).toBe('true');
    const bar = within(callWindow).getByRole('group', { name: 'Move minimized call window' });
    expect(within(bar).getByRole('button', { name: 'Close call view' })).toBeTruthy();
    expect(callWindow.textContent).not.toContain("This couldn't load");

    fireEvent.click(within(bar).getByRole('button', { name: 'Expand' }));
    expect(callWindow.getAttribute('data-bar')).toBeNull();
    expect(callWindow.textContent).toContain("This couldn't load");
    expect(within(callWindow).getByRole('button', { name: 'End' })).toBeTruthy();
  });

  it("docks an agent call's view into the thread the call started from", async () => {
    const { call } = liveCall('!agent-call:example.org');
    const origin = { roomId: room.roomId, threadId: '$thread' };
    const store = await renderRoomWithCallPanel({ call, kind: 'agent', origin }, 'window');

    fireEvent.click(screen.getByRole('button', { name: 'Dock to the side' }));

    expect(store.get(getCallWindowSettingsAtom(mx.getSafeUserId())).mode).toBe('docked');
    expect(navigate.navigateRoomThread).toHaveBeenCalledWith(room.roomId, '$thread');
  });

  it("docks the view of an agent call's own room into the conversation the call started from", async () => {
    const { call } = liveCall(room.roomId);
    const origin = { roomId: '!origin:example.org', threadId: '$thread' };
    await renderRoomWithCallPanel({ call, kind: 'agent', origin }, 'window');

    fireEvent.click(screen.getByRole('button', { name: 'Dock to the side' }));

    expect(navigate.navigateRoomThread).toHaveBeenCalledWith(origin.roomId, '$thread');
  });

  it("docks a room's view into the room, not into the thread of an agent call elsewhere", async () => {
    const { call } = liveCall('!agent-call:example.org');
    const origin = { roomId: '!elsewhere:example.org', threadId: '$thread' };
    await renderRoomWithCallPanel({ call, kind: 'agent', origin }, 'window');

    fireEvent.click(screen.getByRole('button', { name: 'Dock to the side' }));

    expect(navigate.navigateRoom).toHaveBeenCalledWith(room.roomId);
    expect(navigate.navigateRoomThread).not.toHaveBeenCalled();
  });

  it('shows no title bar of its own in the side panel', async () => {
    await renderRoomWithCallPanel();
    expect(screen.queryByRole('group', { name: 'Move call window' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close call view' })).toBeNull();
  });
});
