import { describe, expect, it } from 'vitest';
import { JoinRule } from '../../../../types/matrix/room';
import { availableAccessChoices, joinRulesContent, versionAllows } from './joinRules';

describe('room access choices', () => {
  it('offers knocking and space members only to room versions that know them', () => {
    expect(versionAllows(JoinRule.Knock, '6')).toBe(false);
    expect(versionAllows(JoinRule.Knock, '7')).toBe(true);
    expect(versionAllows(JoinRule.Restricted, '7')).toBe(false);
    expect(versionAllows(JoinRule.Restricted, '8')).toBe(true);
    expect(versionAllows(JoinRule.KnockRestricted, '9')).toBe(false);
    expect(versionAllows(JoinRule.KnockRestricted, '12')).toBe(true);
    expect(versionAllows(JoinRule.Public, '1')).toBe(true);
    expect(versionAllows(JoinRule.Knock, 'org.example.unstable')).toBe(false);
  });

  it('leaves out the space member rules for a room outside every space', () => {
    expect(availableAccessChoices('11', false, 'invite')).toEqual(['invite', 'knock', 'public']);
    expect(availableAccessChoices('11', true, 'invite')).toEqual([
      'invite',
      'knock',
      'knock_restricted',
      'restricted',
      'public',
    ]);
  });

  it('keeps the current rule in the list even where it would not be offered', () => {
    expect(availableAccessChoices('11', false, 'restricted')).toEqual([
      'invite',
      'knock',
      'restricted',
      'public',
    ]);
  });
});

describe('join rules content', () => {
  it('drops the allow list for rules that do not use it', () => {
    const current = {
      join_rule: 'restricted',
      allow: [{ type: 'm.room_membership', room_id: '!s' }],
    };
    expect(joinRulesContent(JoinRule.Invite, current, ['!s'])).toEqual({ join_rule: 'invite' });
  });

  it('keeps the spaces a restricted room already admits from', () => {
    const allow = [{ type: 'm.room_membership', room_id: '!old' }];
    expect(
      joinRulesContent(JoinRule.KnockRestricted, { join_rule: 'restricted', allow }, ['!new'])
    ).toEqual({ join_rule: 'knock_restricted', allow });
  });

  it('admits the members of the given spaces when the room had no allow list', () => {
    expect(joinRulesContent(JoinRule.Restricted, { join_rule: 'invite' }, ['!a', '!b'])).toEqual({
      join_rule: 'restricted',
      allow: [
        { type: 'm.room_membership', room_id: '!a' },
        { type: 'm.room_membership', room_id: '!b' },
      ],
    });
  });
});
