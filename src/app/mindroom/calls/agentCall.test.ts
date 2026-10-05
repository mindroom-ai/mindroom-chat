import { Room } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StateEvent } from '../../../types/matrix/room';
import {
  cleanupMindroomAgentCall,
  createAgentVoiceRoom,
  hasMindroomVoiceCallsPresence,
} from './agentCall';

const createRoom = vi.fn();
const kick = vi.fn();
const leave = vi.fn();
const forget = vi.fn();

const mx = {
  createRoom,
  getSafeUserId: () => '@alice:mindroom.test',
  getUserId: () => '@alice:mindroom.test',
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

  it('stamps the originating room and thread on the call state when given', async () => {
    const origin = { room_id: '!origin:mindroom.test', thread_id: '$root' };

    await createAgentVoiceRoom(mx, '@mindroom_helper:mindroom.test', 'Helper', true, origin);

    const { initial_state: initialState } = createRoom.mock.calls[0][0];
    expect(
      initialState.find((event: { type: string }) => event.type === StateEvent.MindroomAgentCall)
        .content
    ).toEqual({
      version: 1,
      agent_user_id: '@mindroom_helper:mindroom.test',
      creator_user_id: '@alice:mindroom.test',
      ephemeral: true,
      origin,
    });
  });

  it('keeps a null thread id in the stamped origin', async () => {
    const origin = { room_id: '!origin:mindroom.test', thread_id: null };

    await createAgentVoiceRoom(mx, '@mindroom_helper:mindroom.test', 'Helper', false, origin);

    const { initial_state: initialState } = createRoom.mock.calls[0][0];
    expect(initialState[1].content.origin).toEqual(origin);
  });

  it('omits the origin key when no origin is given', async () => {
    await createAgentVoiceRoom(mx, '@mindroom_helper:mindroom.test', 'Helper', true);

    const { initial_state: initialState } = createRoom.mock.calls[0][0];
    const content = initialState.find(
      (event: { type: string }) => event.type === StateEvent.MindroomAgentCall
    ).content;
    expect(content).not.toHaveProperty('origin');
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
