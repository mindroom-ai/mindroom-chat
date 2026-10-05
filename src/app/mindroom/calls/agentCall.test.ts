import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StateEvent } from '../../../types/matrix/room';
import { agentCallState, ALICE, fakeRoom, HELPER } from '../../test-utils/agentCallRoom';
import {
  cleanupMindroomAgentCall,
  createAgentVoiceRoom,
  findAgentCallRoom,
  hasMindroomVoiceCallsPresence,
  toAgentCallOrigin,
} from './agentCall';

const setRoomArchived = vi.hoisted(() => vi.fn());
vi.mock('../rooms/archivedRooms', () => ({ setRoomArchived }));

const createRoom = vi.fn();
const addPushRule = vi.fn();
const kick = vi.fn();
const leave = vi.fn();
const forget = vi.fn();
const sendStateEvent = vi.fn();
let rooms: ReturnType<typeof fakeRoom>[] = [];

const mx = {
  createRoom,
  addPushRule,
  getRooms: () => rooms,
  getSafeUserId: () => ALICE,
  getUserId: () => ALICE,
  kick,
  leave,
  forget,
  sendStateEvent,
} as any;

const ephemeralRoom = (creatorUserId = ALICE, eventSender = ALICE) =>
  fakeRoom({
    call: agentCallState({ creator_user_id: creatorUserId, ephemeral: true }),
    callSender: eventSender,
  });

describe('MindRoom agent calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rooms = [];
    createRoom.mockResolvedValue({ room_id: '!call:mindroom.test' });
    addPushRule.mockResolvedValue({});
    // Archiving waits for its sync echo, which never arrives here; the room must not wait for it.
    setRoomArchived.mockReturnValue(new Promise(() => {}));
    kick.mockResolvedValue({});
    leave.mockResolvedValue({});
    forget.mockResolvedValue({});
    sendStateEvent.mockResolvedValue({});
  });

  it('creates a private encrypted, muted, archived voice room tagged as a permanent call with one agent', async () => {
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
            ephemeral: false,
          },
        },
      ],
    });
    expect(addPushRule).toHaveBeenCalledWith('global', 'override', '!call:mindroom.test', {
      conditions: [{ kind: 'event_match', key: 'room_id', pattern: '!call:mindroom.test' }],
      actions: [],
    });
    expect(setRoomArchived).toHaveBeenCalledWith(mx, '!call:mindroom.test', true);
  });

  it('still returns the new room when muting and archiving it fail', async () => {
    addPushRule.mockRejectedValueOnce(new Error('push rules unavailable'));
    setRoomArchived.mockRejectedValueOnce(new Error('account data unavailable'));

    await expect(createAgentVoiceRoom(mx, HELPER, 'Helper', true)).resolves.toBe(
      '!call:mindroom.test'
    );
  });

  it.each([
    ['$root', '$root'],
    [undefined, null],
    ['~!room:mindroom.test:m1791165951526.3', null],
  ])('builds an origin from thread %s with thread id %s', (threadId, expected) => {
    expect(toAgentCallOrigin('!room:mindroom.test', threadId)).toEqual({
      room_id: '!room:mindroom.test',
      thread_id: expected,
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

  it('finds my permanent call room with the agent', () => {
    const callRoom = fakeRoom({ call: agentCallState() });
    rooms = [fakeRoom({ roomId: '!plain:mindroom.test', callRoom: false }), callRoom];

    expect(findAgentCallRoom(mx, HELPER)).toBe(callRoom);
  });

  it.each([
    [
      'created by someone else',
      { call: agentCallState({ creator_user_id: '@bob:mindroom.test' }) },
    ],
    [
      'with another agent',
      { call: agentCallState({ agent_user_id: '@mindroom_other:mindroom.test' }) },
    ],
    ['that is ephemeral', { call: agentCallState({ ephemeral: true }) }],
    ['stamped by another sender', { call: agentCallState(), callSender: '@mallory:mindroom.test' }],
    ['that I have left', { call: agentCallState(), membership: 'leave' }],
    ['without the call room type', { call: agentCallState(), callRoom: false }],
    ['with another state version', { call: agentCallState({ version: 2 }) }],
  ])('ignores a call room %s', (_case, options) => {
    rooms = [fakeRoom(options)];

    expect(findAgentCallRoom(mx, HELPER)).toBeUndefined();
  });

  it('picks the oldest of duplicate call rooms, then the lowest room id', () => {
    const room = (roomId: string, createdTs: number) =>
      fakeRoom({ roomId, createdTs, call: agentCallState() });
    rooms = [room('!c:mindroom.test', 2), room('!b:mindroom.test', 1), room('!a:mindroom.test', 1)];

    expect(findAgentCallRoom(mx, HELPER)?.roomId).toBe('!a:mindroom.test');
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

  it('keeps a permanent call room on hang-up and drops its origin', async () => {
    const origin = { room_id: '!room:mindroom.test', thread_id: '$root' };
    await cleanupMindroomAgentCall(mx, fakeRoom({ call: agentCallState({ origin }) }));

    expect(kick).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
    expect(sendStateEvent).toHaveBeenCalledWith(
      '!call:mindroom.test',
      StateEvent.MindroomAgentCall,
      agentCallState(),
      ''
    );
  });

  it('does not rewrite a permanent call room without an origin on hang-up', async () => {
    await cleanupMindroomAgentCall(mx, fakeRoom({ call: agentCallState() }));

    expect(sendStateEvent).not.toHaveBeenCalled();
  });
});
