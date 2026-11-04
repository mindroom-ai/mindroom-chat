import { describe, expect, it } from 'vitest';
import { moderationAbilities, powerChangeWarning } from './profileModeration';

const required = { kick: 50, ban: 50, invite: 0 };
const base = { required, isSelf: false, canEditPowers: true };

describe('moderation abilities', () => {
  it('lets a moderator remove or ban a lower member', () => {
    expect(moderationAbilities({ ...base, membership: 'join', mine: 50, theirs: 0 })).toEqual({
      kick: true,
      ban: true,
      unban: false,
      invite: false,
      changePower: true,
    });
  });

  it('gives nothing over a member of the same level', () => {
    expect(moderationAbilities({ ...base, membership: 'join', mine: 50, theirs: 50 })).toEqual({
      kick: false,
      ban: false,
      unban: false,
      invite: false,
      changePower: false,
    });
  });

  it('offers unban for a banned member and invite for someone who left', () => {
    const banned = moderationAbilities({ ...base, membership: 'ban', mine: 100, theirs: 0 });
    expect(banned.unban).toBe(true);
    expect(banned.ban).toBe(false);
    expect(banned.invite).toBe(false);
    const left = moderationAbilities({ ...base, membership: 'leave', mine: 0, theirs: 0 });
    expect(left.invite).toBe(true);
    expect(left.kick).toBe(false);
  });

  it('cancels an invite by removing the invited member', () => {
    expect(moderationAbilities({ ...base, membership: 'invite', mine: 50, theirs: 0 }).kick).toBe(
      true
    );
  });

  it('never outranks a room creator, and lets anyone change only their own level downwards', () => {
    expect(
      moderationAbilities({ ...base, membership: 'join', mine: 100, theirs: Infinity }).changePower
    ).toBe(false);
    const self = moderationAbilities({
      ...base,
      isSelf: true,
      membership: 'join',
      mine: 50,
      theirs: 50,
    });
    expect(self).toMatchObject({ kick: false, ban: false, changePower: true });
  });
});

describe('power change warnings', () => {
  it('warns before lowering oneself or sharing one level', () => {
    expect(powerChangeWarning(true, 100, 50)).toBe('selfDemotion');
    expect(powerChangeWarning(false, 100, 100)).toBe('sharedPower');
    expect(powerChangeWarning(false, 100, 50)).toBeUndefined();
  });
});
