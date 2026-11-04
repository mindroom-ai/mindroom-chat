import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import type { StartCallOptions } from '../../features/calls/callStore';
import { cleanupMindroomAgentCall, prepareAgentCallRoom } from './agentCall';
import { startAgentCall } from './agentCaller';

vi.mock('./agentCall', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agentCall')>()),
  prepareAgentCallRoom: vi.fn(async () => undefined),
  cleanupMindroomAgentCall: vi.fn(async () => undefined),
}));

const mx = {} as MatrixClient;
const room = { roomId: '!callroom:calls.test' } as Room;
const target = {
  room,
  agentUserId: '@mindroom_helper:calls.test',
  origin: { roomId: '!planning:calls.test', threadId: '$thread' },
};

describe('startAgentCall', () => {
  it('writes the call room origin only when the call may start', async () => {
    // Another tab of this session is in a call: the start answers busy before preparing.
    const startCall = vi.fn(async () => 'busy' as const);

    await expect(startAgentCall(mx, startCall, target)).resolves.toBe('busy');

    expect(prepareAgentCallRoom).not.toHaveBeenCalled();
  });

  it('prepares the call room with the origin and clears it again when the call ends', async () => {
    const startCall = vi.fn(async (options: StartCallOptions) => {
      await options.prepare?.();
      await options.onEnded?.();
      return 'started' as const;
    });

    await expect(startAgentCall(mx, startCall, target)).resolves.toBe('started');

    expect(startCall).toHaveBeenCalledWith(
      expect.objectContaining({
        room,
        kind: 'agent',
        agentUserId: target.agentUserId,
        origin: target.origin,
        video: false,
      })
    );
    expect(prepareAgentCallRoom).toHaveBeenCalledWith(mx, room, target.agentUserId, {
      room_id: '!planning:calls.test',
      thread_id: '$thread',
    });
    expect(cleanupMindroomAgentCall).toHaveBeenCalledWith(mx, room);
  });
});
