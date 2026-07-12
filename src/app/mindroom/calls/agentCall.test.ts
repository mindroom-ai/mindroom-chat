import { ClientEvent, Room } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StateEvent } from '../../../types/matrix/room';
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
  eventSender = '@alice:mindroom.test'
): Room =>
  ({
    roomId: '!call:mindroom.test',
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

  it('does not try to forget a room when leaving fails', async () => {
    leave.mockRejectedValueOnce(new Error('leave failed'));

    await cleanupMindroomAgentCall(mx, ephemeralRoom());

    expect(forget).not.toHaveBeenCalled();
  });

  it('does not clean up a room created by someone else', async () => {
    await cleanupMindroomAgentCall(mx, ephemeralRoom('@bob:mindroom.test'));

    expect(kick).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });

  it('does not trust forged creator metadata from another event sender', async () => {
    await cleanupMindroomAgentCall(
      mx,
      ephemeralRoom('@alice:mindroom.test', '@mallory:mindroom.test')
    );

    expect(kick).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });
});
