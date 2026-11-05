import { Membership } from '../../matrix/types/room';
import { matchesEnum } from '../../lib/matchesEnum';

/** What one member may do to another in a room, by the Matrix authorization rules. */
export type ModerationAbilities = {
  kick: boolean;
  ban: boolean;
  unban: boolean;
  invite: boolean;
  /** Change the target's power level (their own, or a lower member's). */
  changePower: boolean;
};

type AbilityInput = {
  /** The target's membership; undefined when they never were in the room. */
  membership: string | undefined;
  /** Power levels of the acting user and the target; room creators count as Infinity. */
  mine: number;
  theirs: number;
  /** The levels the room requires for each action. */
  required: { kick: number; ban: number; invite: number };
  isSelf: boolean;
  /** Whether the acting user may send `m.room.power_levels`. */
  canEditPowers: boolean;
};

/**
 * Matrix spec, "Authorization rules" for `m.room.member`: removing or banning someone needs the
 * action's level and a level above theirs; inviting needs the invite level and someone who is not
 * in the room and not banned. A level may be lowered on oneself, or set on a lower member.
 */
export const moderationAbilities = ({
  membership,
  mine,
  theirs,
  required,
  isSelf,
  canEditPowers,
}: AbilityInput): ModerationAbilities => {
  const outranks = !isSelf && mine > theirs;
  const present =
    membership === Membership.Join ||
    membership === Membership.Invite ||
    membership === Membership.Knock;
  const away = membership === undefined || matchesEnum(membership, Membership.Leave);
  const banned = membership === Membership.Ban;
  return {
    kick: outranks && present && mine >= required.kick,
    ban: outranks && !banned && mine >= required.ban,
    unban: outranks && banned && mine >= required.ban,
    invite: !isSelf && away && mine >= required.invite,
    changePower: canEditPowers && theirs !== Infinity && (isSelf || outranks),
  };
};

/** Why a level change needs confirming: losing one's own power, or granting one's own level. */
export type PowerChangeWarning = 'selfDemotion' | 'sharedPower' | undefined;

export const powerChangeWarning = (
  isSelf: boolean,
  mine: number,
  next: number
): PowerChangeWarning => {
  if (isSelf && next < mine) return 'selfDemotion';
  if (!isSelf && next === mine) return 'sharedPower';
  return undefined;
};
