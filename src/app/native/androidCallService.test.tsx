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
  onAppStateChange: undefined as ((state: { isActive: boolean }) => void) | undefined,
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

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (event: string, listener: (state: { isActive: boolean }) => void) => {
      if (event === 'appStateChange') pluginMocks.onAppStateChange = listener;
      return {
        remove: vi.fn(async () => {
          if (event === 'appStateChange' && pluginMocks.onAppStateChange === listener) {
            pluginMocks.onAppStateChange = undefined;
          }
        }),
      };
    }),
  },
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

type FakeCallState = {
  phase: CallPhase;
  microphone: boolean;
  microphoneTrack?: { id: string };
};

const createFakeCall = (roomId: string, roomName: string, initialState: FakeCallState) => {
  let state: FakeCallState = initialState;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    room: { roomId, name: roomName },
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(patch: Partial<FakeCallState>) {
      state = { ...state, ...patch };
      notify();
    },
  };
};

describe('androidCallService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pluginMocks.rooms.clear();
    pluginMocks.onAppStateChange = undefined;
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
    const call = createFakeCall('!room:example', 'General', {
      phase: 'connected',
      microphone: true,
    });
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

  it('retries start once microphone becomes active after connected on Android 14+ and stops on end/unmount', async () => {
    enableAndroidPlugin();
    // RoomCall connects BEFORE requesting RECORD_AUDIO, so initial connecting + connected starts
    // return { active: false }, then publishing the microphone track retries and succeeds.
    pluginMocks.start
      .mockResolvedValueOnce({ active: false })
      .mockResolvedValueOnce({ active: false })
      .mockResolvedValue({ active: true });
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

    const call = createFakeCall('!room:example', 'Design Sync', {
      phase: 'connecting',
      microphone: true,
    });
    await act(async () => {
      store.set(activeCallAtom, { kind: 'room', call } as unknown as ActiveCall);
    });
    expect(pluginMocks.start).toHaveBeenCalledTimes(1);
    expect(pluginMocks.start).toHaveBeenLastCalledWith({ roomName: 'Design Sync' });

    // RoomCall enters connected while RECORD_AUDIO prompt is still pending -> still active: false.
    await act(async () => {
      call.update({ phase: 'connected' });
    });
    expect(pluginMocks.start).toHaveBeenCalledTimes(2);

    // Microphone permission is granted and the local audio track is published -> retries and succeeds.
    await act(async () => {
      call.update({ microphoneTrack: { id: 'mic-track-1' } });
    });
    expect(pluginMocks.start).toHaveBeenCalledTimes(3);

    // Further state updates while already active on native do not spam start.
    await act(async () => {
      call.update({ phase: 'reconnecting' });
    });
    expect(pluginMocks.start).toHaveBeenCalledTimes(3);

    // Entering failed stops the foreground service.
    await act(async () => {
      call.update({ phase: 'failed' });
    });
    expect(pluginMocks.stop).toHaveBeenCalledTimes(1);

    // Agent call prefers origin room name, retries on foreground return if denied initially, and stops on unmount.
    pluginMocks.rooms.set('!origin:example', { name: 'Product Chat' });
    pluginMocks.start.mockResolvedValueOnce({ active: false }).mockResolvedValue({ active: true });
    const agentCall = createFakeCall('!agent-call:example', 'Agent Call', {
      phase: 'connected',
      microphone: false,
    });
    await act(async () => {
      store.set(activeCallAtom, {
        kind: 'agent',
        origin: { roomId: '!origin:example' },
        call: agentCall,
      } as unknown as ActiveCall);
    });
    expect(pluginMocks.start).toHaveBeenLastCalledWith({ roomName: 'Product Chat' });

    await act(async () => {
      pluginMocks.onAppStateChange?.({ isActive: true });
    });
    expect(pluginMocks.start).toHaveBeenCalledTimes(5);

    await act(async () => {
      renderer.unmount();
    });
    expect(pluginMocks.stop).toHaveBeenCalledTimes(2);
  });
});
