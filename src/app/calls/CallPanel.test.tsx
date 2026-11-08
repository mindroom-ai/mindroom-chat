// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveCall } from './callStore';
import type { CallState } from './RoomCall';
import { CallPanel } from './CallPanel';

const room = { roomId: '!agent-call:panel.test' } as Room;

const calls = vi.hoisted(() => ({
  active: undefined as ActiveCall | undefined,
  state: undefined as CallState | undefined,
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:panel.test' }),
}));
vi.mock('../matrix/hooks/useRoomMeta', () => ({ useRoomName: () => 'Call with Helper' }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => [] }));
vi.mock('./agent/useCallFailureNotice', () => ({ useCallFailureNotice: () => undefined }));
vi.mock('./agent/useCallFailureDismissal', () => ({
  useCallFailureDismissal: () => ({ visibleFailure: undefined, dismissFailure: () => undefined }),
}));
vi.mock('./callSupport', () => ({
  browserSharesScreens: () => true,
  browserSupportsCalls: () => true,
  useCallSupport: () => 'supported',
}));
vi.mock('./callStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./callStore')>()),
  useActiveCall: () => calls.active,
  useCallState: () => calls.state,
  useCallActions: () => ({ endCall: async () => undefined, dismissCall: () => undefined }),
}));
vi.mock('./CallStage', () => ({ CallStage: () => null }));
vi.mock('./CallTile', () => ({
  CallMemberAvatar: () => null,
  CallTile: () => null,
  ScreenTile: () => null,
}));

const joined: CallState = {
  phase: 'connected',
  microphone: true,
  camera: false,
  screenShare: false,
  sound: true,
  audioBlocked: false,
  devices: {},
  participants: [],
};

afterEach(() => {
  cleanup();
  calls.active = undefined;
  calls.state = undefined;
});

describe('CallPanel controls', () => {
  it('offers the camera and screen sharing in an agent call too', () => {
    calls.active = {
      call: { room } as ActiveCall['call'],
      kind: 'agent',
      agentUserId: '@mindroom_helper:panel.test',
    };
    calls.state = joined;

    render(<CallPanel room={room} onClose={() => undefined} />);

    const controls = screen.getByRole('toolbar', { name: 'Call with Helper' });
    expect(controls.querySelector('[aria-label="Start Camera"]')).not.toBeNull();
    expect(controls.querySelector('[aria-label="Start Screenshare"]')).not.toBeNull();
  });
});
