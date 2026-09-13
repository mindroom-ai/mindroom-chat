import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentCallButton } from './AgentCallButton';

const mocks = vi.hoisted(() => ({
  createAgentVoiceRoom: vi.fn(),
  cleanupCreatedAgentCall: vi.fn(),
  waitForJoinedRoom: vi.fn(),
  requestMicrophoneAccess: vi.fn(),
  startCall: vi.fn(),
  navigateRoom: vi.fn(),
  closeProfile: vi.fn(),
}));

const VOICE_CALLS_STATUS = '🤖 Model: openai/gpt-5.5 | 📞 Voice calls';

vi.mock('./agentCall', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agentCall')>()),
  createAgentVoiceRoom: mocks.createAgentVoiceRoom,
  cleanupCreatedAgentCall: mocks.cleanupCreatedAgentCall,
  waitForJoinedRoom: mocks.waitForJoinedRoom,
}));

vi.mock('../voice/microphoneAccess', () => ({
  requestMicrophoneAccess: mocks.requestMicrophoneAccess,
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@alice:mindroom.test',
    getSafeUserId: () => '@alice:mindroom.test',
  }),
}));

vi.mock('../../hooks/useClientConfig', () => ({
  useClientConfig: () => ({ createRoom: { defaultEncryption: true } }),
}));

vi.mock('../../hooks/useCallEmbed', () => ({
  useCallEmbed: () => undefined,
  useCallStart: () => mocks.startCall,
}));

vi.mock('../../hooks/useLivekitSupport', () => ({
  useLivekitSupport: () => true,
}));

vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: mocks.navigateRoom }),
}));

vi.mock('../../utils/rtc', () => ({
  webRTCSupported: () => true,
}));

vi.mock('../../state/hooks/userRoomProfile', () => ({
  useCloseUserRoomProfile: () => mocks.closeProfile,
}));

describe('AgentCallButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestMicrophoneAccess.mockResolvedValue(undefined);
    mocks.createAgentVoiceRoom.mockResolvedValue('!call:mindroom.test');
    mocks.waitForJoinedRoom.mockResolvedValue({ roomId: '!call:mindroom.test' });
  });

  it('is only offered for a same-homeserver MindRoom agent', () => {
    const human = create(<AgentCallButton userId="@bob:mindroom.test" />);
    const foreignAgent = create(
      <AgentCallButton userId="@mindroom_helper:elsewhere.test" displayName="Helper" />
    );
    const localAgentWithoutCalls = create(
      <AgentCallButton
        userId="@mindroom_helper:mindroom.test"
        displayName="Helper"
        presenceStatus="🤖 Model: openai/gpt-5.5"
      />
    );
    const localVoiceAgent = create(
      <AgentCallButton
        userId="@mindroom_helper:mindroom.test"
        displayName="Helper"
        presenceStatus={VOICE_CALLS_STATUS}
      />
    );

    expect(human.toJSON()).toBeNull();
    expect(foreignAgent.toJSON()).toBeNull();
    expect(localAgentWithoutCalls.toJSON()).toBeNull();
    expect(JSON.stringify(localVoiceAgent.toJSON())).toContain('Call');
  });

  it('creates, opens, and immediately joins the private audio room', async () => {
    const renderer = create(
      <AgentCallButton
        userId="@mindroom_helper:mindroom.test"
        displayName="Helper"
        presenceStatus={VOICE_CALLS_STATUS}
      />
    );
    const button = renderer.root.findByType('button');

    await act(async () => {
      await button.props.onClick();
    });

    expect(mocks.requestMicrophoneAccess).toHaveBeenCalledOnce();
    expect(mocks.requestMicrophoneAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createAgentVoiceRoom.mock.invocationCallOrder[0]
    );
    expect(mocks.createAgentVoiceRoom).toHaveBeenCalledWith(
      expect.anything(),
      '@mindroom_helper:mindroom.test',
      'Helper',
      true
    );
    expect(mocks.waitForJoinedRoom).toHaveBeenCalledWith(expect.anything(), '!call:mindroom.test');
    expect(mocks.startCall).toHaveBeenCalledWith(
      { roomId: '!call:mindroom.test' },
      { microphone: true, video: false, sound: true }
    );
    expect(mocks.navigateRoom).toHaveBeenCalledWith('!call:mindroom.test');
    expect(mocks.closeProfile).toHaveBeenCalledOnce();
    expect(renderer.root.findByType('button').props.disabled).toBe(false);
  });

  it('does not create a call room when microphone access is denied', async () => {
    mocks.requestMicrophoneAccess.mockRejectedValueOnce(
      new Error(
        'Microphone access is blocked. Allow microphone access for MindRoom in iPhone settings and try again.'
      )
    );
    const renderer = create(
      <AgentCallButton
        userId="@mindroom_helper:mindroom.test"
        displayName="Helper"
        presenceStatus={VOICE_CALLS_STATUS}
      />
    );

    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });

    expect(mocks.createAgentVoiceRoom).not.toHaveBeenCalled();
    expect(mocks.startCall).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('Allow microphone access for MindRoom');
  });

  it('cleans up without starting a call when unmounted during room sync', async () => {
    let resolveRoom!: (room: { roomId: string }) => void;
    mocks.waitForJoinedRoom.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRoom = resolve;
      })
    );
    const renderer = create(
      <AgentCallButton
        userId="@mindroom_helper:mindroom.test"
        displayName="Helper"
        presenceStatus={VOICE_CALLS_STATUS}
      />
    );
    let callPromise!: Promise<void>;

    await act(async () => {
      callPromise = renderer.root.findByType('button').props.onClick();
      await Promise.resolve();
    });
    act(() => renderer.unmount());
    resolveRoom({ roomId: '!call:mindroom.test' });
    await act(async () => callPromise);

    expect(mocks.cleanupCreatedAgentCall).toHaveBeenCalledWith(
      expect.anything(),
      '!call:mindroom.test',
      '@mindroom_helper:mindroom.test'
    );
    expect(mocks.startCall).not.toHaveBeenCalled();
    expect(mocks.navigateRoom).not.toHaveBeenCalled();
    expect(mocks.closeProfile).not.toHaveBeenCalled();
  });

  it('cleans up the temporary room when joining fails', async () => {
    mocks.waitForJoinedRoom.mockRejectedValueOnce(new Error('sync failed'));
    const renderer = create(
      <AgentCallButton
        userId="@mindroom_helper:mindroom.test"
        displayName="Helper"
        presenceStatus={VOICE_CALLS_STATUS}
      />
    );

    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });

    expect(mocks.cleanupCreatedAgentCall).toHaveBeenCalledWith(
      expect.anything(),
      '!call:mindroom.test',
      '@mindroom_helper:mindroom.test'
    );
    expect(JSON.stringify(renderer.toJSON())).toContain('sync failed');
  });
});
