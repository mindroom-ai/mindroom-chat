import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MindroomAgentCallOrigin } from './agentCall';
import { useStartAgentCall } from './useStartAgentCall';

const mocks = vi.hoisted(() => ({
  createAgentVoiceRoom: vi.fn(),
  cleanupCreatedAgentCall: vi.fn(),
  waitForJoinedRoom: vi.fn(),
  requestMicrophoneAccess: vi.fn(),
  startCall: vi.fn(),
  callEmbed: undefined as unknown,
}));

vi.mock('./agentCall', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agentCall')>()),
  createAgentVoiceRoom: mocks.createAgentVoiceRoom,
  cleanupCreatedAgentCall: mocks.cleanupCreatedAgentCall,
}));

vi.mock('../matrix/waitForJoinedRoom', () => ({ waitForJoinedRoom: mocks.waitForJoinedRoom }));

vi.mock('../voice/microphoneAccess', () => ({
  requestMicrophoneAccess: mocks.requestMicrophoneAccess,
}));

const mx = {
  getUserId: () => '@alice:mindroom.test',
  getSafeUserId: () => '@alice:mindroom.test',
};

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mx,
}));

vi.mock('../../hooks/useClientConfig', () => ({
  useClientConfig: () => ({ createRoom: { defaultEncryption: true } }),
}));

vi.mock('../../hooks/useCallEmbed', () => ({
  useCallEmbed: () => mocks.callEmbed,
  useCallStart: () => mocks.startCall,
}));

vi.mock('../../hooks/useLivekitSupport', () => ({
  useLivekitSupport: () => true,
}));

vi.mock('../../utils/rtc', () => ({
  webRTCSupported: () => true,
}));

const AGENT = { userId: '@mindroom_helper:mindroom.test', displayName: 'Helper' };
const ORIGIN: MindroomAgentCallOrigin = { room_id: '!origin:mindroom.test', thread_id: '$root' };

type StartAgentCall = ReturnType<typeof useStartAgentCall>;

const renderHook = () => {
  const result = {} as { current: StartAgentCall };
  function Probe() {
    result.current = useStartAgentCall();
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Probe />);
  });
  return { result, renderer };
};

describe('useStartAgentCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callEmbed = undefined;
    mocks.requestMicrophoneAccess.mockResolvedValue(undefined);
    mocks.createAgentVoiceRoom.mockResolvedValue('!call:mindroom.test');
    mocks.waitForJoinedRoom.mockResolvedValue({ roomId: '!call:mindroom.test' });
  });

  it('creates the room with the origin and starts the call', async () => {
    const { result } = renderHook();
    let started: boolean | undefined;

    await act(async () => {
      started = await result.current.startAgentCall(AGENT, ORIGIN);
    });

    expect(started).toBe(true);
    expect(mocks.requestMicrophoneAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createAgentVoiceRoom.mock.invocationCallOrder[0]
    );
    expect(mocks.createAgentVoiceRoom).toHaveBeenCalledWith(
      mx,
      '@mindroom_helper:mindroom.test',
      'Helper',
      true,
      ORIGIN
    );
    expect(mocks.waitForJoinedRoom).toHaveBeenCalledWith(mx, '!call:mindroom.test');
    expect(mocks.startCall).toHaveBeenCalledWith(
      { roomId: '!call:mindroom.test' },
      { microphone: true, video: false, sound: true }
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('creates a room without an origin when none is given', async () => {
    const { result } = renderHook();

    await act(async () => {
      await result.current.startAgentCall(AGENT);
    });

    expect(mocks.createAgentVoiceRoom).toHaveBeenCalledWith(
      mx,
      '@mindroom_helper:mindroom.test',
      'Helper',
      true,
      undefined
    );
  });

  it('cleans up the room and reports the error when the call fails to start', async () => {
    mocks.startCall.mockImplementationOnce(() => {
      throw new Error('embed unavailable');
    });
    const { result } = renderHook();
    let started: boolean | undefined;

    await act(async () => {
      started = await result.current.startAgentCall(AGENT, ORIGIN);
    });

    expect(started).toBe(false);
    expect(mocks.cleanupCreatedAgentCall).toHaveBeenCalledWith(
      mx,
      '!call:mindroom.test',
      '@mindroom_helper:mindroom.test'
    );
    expect(result.current.error).toBe('embed unavailable');
    expect(result.current.loading).toBe(false);
  });

  it('cleans up the temporary room when joining fails', async () => {
    mocks.waitForJoinedRoom.mockRejectedValueOnce(new Error('sync failed'));
    const { result } = renderHook();

    await act(async () => {
      await result.current.startAgentCall(AGENT, ORIGIN);
    });

    expect(mocks.cleanupCreatedAgentCall).toHaveBeenCalledWith(
      mx,
      '!call:mindroom.test',
      '@mindroom_helper:mindroom.test'
    );
    expect(mocks.startCall).not.toHaveBeenCalled();
    expect(result.current.error).toBe('sync failed');
  });

  it('does not create a room when microphone access is denied', async () => {
    mocks.requestMicrophoneAccess.mockRejectedValueOnce(new Error('Microphone access is blocked.'));
    const { result } = renderHook();
    let started: boolean | undefined;

    await act(async () => {
      started = await result.current.startAgentCall(AGENT, ORIGIN);
    });

    expect(started).toBe(false);
    expect(mocks.createAgentVoiceRoom).not.toHaveBeenCalled();
    expect(mocks.cleanupCreatedAgentCall).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Microphone access is blocked.');
  });

  it('refuses to start while another call is embedded', async () => {
    mocks.callEmbed = {};
    const { result } = renderHook();
    let started: boolean | undefined;

    await act(async () => {
      started = await result.current.startAgentCall(AGENT, ORIGIN);
    });

    expect(started).toBe(false);
    expect(result.current.unavailableReason).toBeDefined();
    expect(mocks.requestMicrophoneAccess).not.toHaveBeenCalled();
    expect(mocks.createAgentVoiceRoom).not.toHaveBeenCalled();
    expect(mocks.startCall).not.toHaveBeenCalled();
  });

  it('cleans up without starting a call when unmounted during room sync', async () => {
    let resolveRoom!: (room: { roomId: string }) => void;
    mocks.waitForJoinedRoom.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRoom = resolve;
      })
    );
    const { result, renderer } = renderHook();
    let callPromise!: Promise<boolean>;

    await act(async () => {
      callPromise = result.current.startAgentCall(AGENT, ORIGIN);
      await Promise.resolve();
    });
    act(() => renderer.unmount());
    resolveRoom({ roomId: '!call:mindroom.test' });
    let started: boolean | undefined;
    await act(async () => {
      started = await callPromise;
    });

    expect(started).toBe(false);
    expect(mocks.cleanupCreatedAgentCall).toHaveBeenCalledWith(
      mx,
      '!call:mindroom.test',
      '@mindroom_helper:mindroom.test'
    );
    expect(mocks.startCall).not.toHaveBeenCalled();
  });
});
