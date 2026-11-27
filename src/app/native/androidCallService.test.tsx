// @vitest-environment jsdom
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { activeCallAtom, type ActiveCall } from '../calls/callStore';
import type { CallPhase } from '../calls/RoomCall';
import { AndroidCallServiceFeature } from '../calls/CallFeatures';
import {
  isAndroidCallServiceAvailable,
  startAndroidCallService,
  stopAndroidCallService,
} from './androidCallService';

const pluginMocks = vi.hoisted(() => ({
  start: vi.fn<(options?: { roomName?: string }) => Promise<{ active?: boolean }>>(),
  stop: vi.fn<() => Promise<void>>(),
  rooms: new Map<string, { name: string }>(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web'),
    isPluginAvailable: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => ({
    start: pluginMocks.start,
    stop: pluginMocks.stop,
  })),
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getRoom: (roomId: string) => pluginMocks.rooms.get(roomId) ?? null,
  }),
}));

const enableAndroidPlugin = () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
  vi.mocked(Capacitor.isPluginAvailable).mockImplementation((name) => name === 'MindRoomCall');
};

const createFakeCall = (roomId: string, roomName: string, initialPhase: CallPhase) => {
  let phase: CallPhase = initialPhase;
  const listeners = new Set<() => void>();
  return {
    room: { roomId, name: roomName },
    getState: () => ({ phase }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setPhase(next: CallPhase) {
      phase = next;
      listeners.forEach((listener) => listener());
    },
  };
};

describe('androidCallService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pluginMocks.rooms.clear();
    pluginMocks.start.mockResolvedValue({ active: true });
    pluginMocks.stop.mockResolvedValue(undefined);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports availability only on native Android with MindRoomCall plugin', () => {
    expect(isAndroidCallServiceAvailable()).toBe(false);

    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    expect(isAndroidCallServiceAvailable()).toBe(false);

    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    expect(isAndroidCallServiceAvailable()).toBe(false);

    enableAndroidPlugin();
    expect(isAndroidCallServiceAvailable()).toBe(true);
  });

  it('swallows native start and stop failures with warnings', async () => {
    enableAndroidPlugin();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    pluginMocks.start.mockRejectedValueOnce(new Error('FGS blocked'));
    pluginMocks.stop.mockRejectedValueOnce(new Error('stop failed'));

    await expect(startAndroidCallService('Standup')).resolves.toBe(false);
    await expect(stopAndroidCallService()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(
      1,
      '[android-call] could not start call foreground service',
      expect.any(Error)
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      '[android-call] could not stop call foreground service',
      expect.any(Error)
    );
  });

  it('does nothing in AndroidCallServiceFeature outside native Android', async () => {
    const store = createStore();
    const call = createFakeCall('!room:example', 'General', 'connected');
    store.set(activeCallAtom, { kind: 'room', call } as unknown as ActiveCall);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <Provider store={store}>
          <AndroidCallServiceFeature />
        </Provider>
      );
    });

    expect(pluginMocks.start).not.toHaveBeenCalled();
    expect(pluginMocks.stop).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('starts on live calls, retries after denied start once connected, and stops on end/failed/unmount', async () => {
    enableAndroidPlugin();
    pluginMocks.start.mockResolvedValueOnce({ active: false }).mockResolvedValue({ active: true });
    const store = createStore();

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <Provider store={store}>
          <AndroidCallServiceFeature />
        </Provider>
      );
    });
    expect(pluginMocks.start).not.toHaveBeenCalled();
    expect(pluginMocks.stop).not.toHaveBeenCalled();

    // First call starts connecting before mic permission is granted -> resolves active: false.
    const call = createFakeCall('!room:example', 'Design Sync', 'connecting');
    await act(async () => {
      store.set(activeCallAtom, { kind: 'room', call } as unknown as ActiveCall);
    });
    expect(pluginMocks.start).toHaveBeenCalledTimes(1);
    expect(pluginMocks.start).toHaveBeenLastCalledWith({ roomName: 'Design Sync' });

    // Once connected after mic grant, retries start and succeeds.
    await act(async () => {
      call.setPhase('connected');
    });
    expect(pluginMocks.start).toHaveBeenCalledTimes(2);

    // Reconnecting while already active on native does not spam start.
    await act(async () => {
      call.setPhase('reconnecting');
    });
    expect(pluginMocks.start).toHaveBeenCalledTimes(2);

    // Entering failed stops the foreground service.
    await act(async () => {
      call.setPhase('failed');
    });
    expect(pluginMocks.stop).toHaveBeenCalledTimes(1);

    // Agent call prefers the origin room's display name and stops on unmount.
    pluginMocks.rooms.set('!origin:example', { name: 'Product Chat' });
    const agentCall = createFakeCall('!agent-call:example', 'Agent Call', 'connected');
    await act(async () => {
      store.set(activeCallAtom, {
        kind: 'agent',
        origin: { roomId: '!origin:example' },
        call: agentCall,
      } as unknown as ActiveCall);
    });
    expect(pluginMocks.start).toHaveBeenLastCalledWith({ roomName: 'Product Chat' });

    await act(async () => {
      renderer.unmount();
    });
    expect(pluginMocks.stop).toHaveBeenCalledTimes(2);
  });
});
