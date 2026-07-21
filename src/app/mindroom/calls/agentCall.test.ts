import { ClientEvent, MatrixError, Room } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StateEvent } from '../../../types/matrix/room';
import { isCallRoomRetired } from '../../plugins/call/rtcMembershipCleanup';
import {
  cleanupMindroomAgentCall,
  createAgentVoiceRoom,
  hasMindroomVoiceCallsPresence,
  waitForJoinedRoom,
} from './agentCall';

const createRoom = vi.fn();
const kick = vi.fn();
const leave = vi.fn();
const forget = vi.fn();

const mx = {
  createRoom,
  getSafeUserId: () => '@alice:mindroom.test',
  getUserId: () => '@alice:mindroom.test',
  getRoom: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  kick,
  leave,
  forget,
} as any;

const ephemeralRoom = (
  creatorUserId = '@alice:mindroom.test',
  eventSender = '@alice:mindroom.test',
  roomId = '!call:mindroom.test'
): Room =>
  ({
    roomId,
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (eventType: string) =>
          eventType === StateEvent.MindroomAgentCall
            ? {
                getSender: () => eventSender,
                getContent: () => ({
                  version: 1,
                  agent_user_id: '@mindroom_helper:mindroom.test',
                  creator_user_id: creatorUserId,
                  ephemeral: true,
                }),
              }
            : undefined,
      }),
    }),
  } as unknown as Room);

describe('MindRoom agent calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createRoom.mockResolvedValue({ room_id: '!call:mindroom.test' });
    kick.mockResolvedValue({});
    leave.mockResolvedValue({});
    forget.mockResolvedValue({});
  });

  it('creates a private encrypted voice room tagged for one invited agent', async () => {
    await expect(
      createAgentVoiceRoom(mx, '@mindroom_helper:mindroom.test', 'Helper', true)
    ).resolves.toBe('!call:mindroom.test');

    expect(createRoom).toHaveBeenCalledWith({
      name: 'Call with Helper',
      invite: ['@mindroom_helper:mindroom.test'],
      visibility: 'private',
      preset: 'private_chat',
      creation_content: { type: 'org.matrix.msc3417.call' },
      power_level_content_override: {
        events: { 'org.matrix.msc3401.call.member': 0 },
      },
      initial_state: [
        {
          type: 'm.room.encryption',
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        },
        { type: 'org.matrix.msc3401.call', state_key: '', content: {} },
        {
          type: StateEvent.MindroomAgentCall,
          state_key: '',
          content: {
            version: 1,
            agent_user_id: '@mindroom_helper:mindroom.test',
            creator_user_id: '@alice:mindroom.test',
            ephemeral: true,
          },
        },
      ],
    });
  });

  it('creates an unencrypted room when client policy disables encryption', async () => {
    await createAgentVoiceRoom(mx, '@mindroom_helper:mindroom.test', undefined, false);

    expect(createRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Call with mindroom_helper',
        initial_state: [
          { type: 'org.matrix.msc3401.call', state_key: '', content: {} },
          expect.objectContaining({ type: StateEvent.MindroomAgentCall }),
        ],
      })
    );
  });

  it('requires the exact voice-call presence capability', () => {
    expect(hasMindroomVoiceCallsPresence('🤖 Model: openai/gpt-5.5 | 📞 Voice calls')).toBe(true);
    expect(hasMindroomVoiceCallsPresence('💼 Discusses voice calls')).toBe(false);
    expect(hasMindroomVoiceCallsPresence(undefined)).toBe(false);
  });

  it('waits for the created room to arrive through sync', async () => {
    mx.getRoom.mockReturnValue(null);
    const pending = waitForJoinedRoom(mx, '!call:mindroom.test', 1_000);
    const listener = mx.on.mock.calls.find(
      ([event]: [ClientEvent]) => event === ClientEvent.Room
    )?.[1];
    const room = ephemeralRoom();

    listener(room);

    await expect(pending).resolves.toBe(room);
    expect(mx.removeListener).toHaveBeenCalledWith(ClientEvent.Room, listener);
  });

  it('kicks the agent, leaves, and forgets a creator-owned ephemeral room', async () => {
    await cleanupMindroomAgentCall(mx, ephemeralRoom());

    expect(kick).toHaveBeenCalledWith(
      '!call:mindroom.test',
      '@mindroom_helper:mindroom.test',
      'MindRoom agent call ended'
    );
    expect(leave).toHaveBeenCalledWith('!call:mindroom.test');
    expect(forget).toHaveBeenCalledWith('!call:mindroom.test');
  });

  it('keeps a permanent kick 403 non-blocking and still leaves and forgets', async () => {
    // Ending a call after the creator already left the room makes the kick
    // return M_FORBIDDEN (incident trace operation 572); it must stay caught
    // and must not stop the leave/forget sequence.
    kick.mockRejectedValueOnce(
      new MatrixError({ errcode: 'M_FORBIDDEN', error: 'You cannot kick user' }, 403)
    );

    await expect(cleanupMindroomAgentCall(mx, ephemeralRoom())).resolves.toBeUndefined();

    expect(leave).toHaveBeenCalledWith('!call:mindroom.test');
    expect(forget).toHaveBeenCalledWith('!call:mindroom.test');
  });

  it('retires the room synchronously before the first destructive request', async () => {
    // Kick/leave/forget cannot be aborted or undone once on the wire, so the
    // race-freedom guarantee is retirement: the room becomes permanently
    // unusable for new call embeds *before* the kick is dispatched, and the
    // sequence then runs to completion unguarded.
    const roomId = '!retire-midkick:mindroom.test';
    let settleKick!: () => void;
    kick.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settleKick = resolve;
        })
    );

    const pending = cleanupMindroomAgentCall(
      mx,
      ephemeralRoom('@alice:mindroom.test', '@alice:mindroom.test', roomId)
    );
    expect(kick).toHaveBeenCalledTimes(1);
    expect(isCallRoomRetired(roomId)).toBe(true);

    settleKick();
    await pending;

    expect(leave).toHaveBeenCalledWith(roomId);
    expect(forget).toHaveBeenCalledWith(roomId);
  });

  it('does not try to forget a room when leaving fails', async () => {
    leave.mockRejectedValueOnce(new Error('leave failed'));

    await cleanupMindroomAgentCall(mx, ephemeralRoom());

    expect(forget).not.toHaveBeenCalled();
  });

  it('does not clean up — or retire — a room created by someone else', async () => {
    const roomId = '!foreign-creator:mindroom.test';
    await cleanupMindroomAgentCall(
      mx,
      ephemeralRoom('@bob:mindroom.test', '@alice:mindroom.test', roomId)
    );

    expect(kick).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
    expect(isCallRoomRetired(roomId)).toBe(false);
  });

  it('does not trust forged creator metadata from another event sender', async () => {
    const roomId = '!forged-creator:mindroom.test';
    await cleanupMindroomAgentCall(
      mx,
      ephemeralRoom('@alice:mindroom.test', '@mallory:mindroom.test', roomId)
    );

    expect(kick).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
    expect(isCallRoomRetired(roomId)).toBe(false);
  });
});
