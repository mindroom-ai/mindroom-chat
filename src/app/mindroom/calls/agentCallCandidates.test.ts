import type { RoomMember } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getAgentCallCandidates } from './agentCallCandidates';

const VIEWER = '@alice:mindroom.test';
const VOICE_CALLS_STATUS = '🤖 Model: openai/gpt-5.5 | 📞 Voice calls';

const member = (userId: string, name: string, membership = 'join') =>
  ({ userId, name, membership } as RoomMember);

describe('getAgentCallCandidates', () => {
  it('keeps only joined same-homeserver agents that advertise voice calls', () => {
    const statuses: Record<string, string> = {
      '@bob:mindroom.test': VOICE_CALLS_STATUS,
      '@mindroom_voice:mindroom.test': VOICE_CALLS_STATUS,
      '@mindroom_invited:mindroom.test': VOICE_CALLS_STATUS,
      '@mindroom_left:mindroom.test': VOICE_CALLS_STATUS,
      '@mindroom_foreign:elsewhere.test': VOICE_CALLS_STATUS,
      '@mindroom_text:mindroom.test': '🤖 Model: openai/gpt-5.5',
    };
    const members = [
      member('@bob:mindroom.test', 'Bob'),
      member('@mindroom_voice:mindroom.test', 'Voice'),
      member('@mindroom_invited:mindroom.test', 'Invited', 'invite'),
      member('@mindroom_left:mindroom.test', 'Left', 'leave'),
      member('@mindroom_foreign:elsewhere.test', 'Foreign'),
      member('@mindroom_text:mindroom.test', 'Text only'),
      member('@mindroom_silent:mindroom.test', 'No presence'),
    ];

    expect(getAgentCallCandidates(members, VIEWER, (userId) => statuses[userId])).toEqual([
      { userId: '@mindroom_voice:mindroom.test', displayName: 'Voice' },
    ]);
  });

  it('sorts candidates by display name', () => {
    const members = [
      member('@mindroom_c:mindroom.test', 'Zeta'),
      member('@mindroom_a:mindroom.test', 'alpha'),
      member('@mindroom_b:mindroom.test', 'Beta'),
    ];

    expect(
      getAgentCallCandidates(members, VIEWER, () => VOICE_CALLS_STATUS).map(
        ({ displayName }) => displayName
      )
    ).toEqual(['alpha', 'Beta', 'Zeta']);
  });
});
