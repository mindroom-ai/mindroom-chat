import { JoinRule } from '../../../matrix/types/room';

/** The access choices of the settings page, in the order the menu lists them. */
const ACCESS_CHOICES = [
  JoinRule.Invite,
  JoinRule.Knock,
  JoinRule.KnockRestricted,
  JoinRule.Restricted,
  JoinRule.Public,
] as const;

export type AccessChoice = (typeof ACCESS_CHOICES)[number];

/** The `sharedUi.joinRulesSwitcher` label of each choice. */
export const ACCESS_LABEL: Record<AccessChoice, string> = {
  [JoinRule.Invite]: 'option0',
  [JoinRule.Knock]: 'option1',
  [JoinRule.KnockRestricted]: 'option2',
  [JoinRule.Restricted]: 'option3',
  [JoinRule.Public]: 'option4',
};

// Matrix spec, "Room versions": knocking arrived in version 7, restricted joins in 8, and the two
// together (`knock_restricted`) in 10. Versions that are not plain numbers are unstable ones,
// which this client cannot judge, so it offers them only what every version has.
const FIRST_VERSION: Partial<Record<AccessChoice, number>> = {
  [JoinRule.Knock]: 7,
  [JoinRule.Restricted]: 8,
  [JoinRule.KnockRestricted]: 10,
};

const versionNumber = (version: string | undefined): number | undefined => {
  if (!version || !/^\d+$/.test(version)) return undefined;
  return Number(version);
};

/** Whether rooms of `version` know `choice`. */
export const versionAllows = (choice: AccessChoice, version: string | undefined): boolean => {
  const first = FIRST_VERSION[choice];
  if (first === undefined) return true;
  const number = versionNumber(version);
  return number !== undefined && number >= first;
};

/**
 * The choices to offer: those the room version knows, and the space-member ones only when the room
 * belongs to a space. The current rule always stays in the list so the menu can show it.
 */
export const availableAccessChoices = (
  version: string | undefined,
  hasSpaces: boolean,
  current: string | undefined
): AccessChoice[] =>
  ACCESS_CHOICES.filter((choice) => {
    if (choice === current) return true;
    const needsSpace = choice === JoinRule.Restricted || choice === JoinRule.KnockRestricted;
    if (needsSpace && !hasSpaces) return false;
    return versionAllows(choice, version);
  });

type AllowCondition = { type: string; room_id?: string };

export const readAllow = (content: Record<string, unknown> | undefined): AllowCondition[] => {
  const allow = content?.allow;
  if (!Array.isArray(allow)) return [];
  return allow.filter(
    (entry): entry is AllowCondition =>
      typeof entry === 'object' && entry !== null && typeof entry.type === 'string'
  );
};

/**
 * The `m.room.join_rules` content for `choice`. A space-member rule keeps the spaces the room
 * already admits from, or admits the members of `spaceIds` when it had none; other rules carry no
 * `allow` list.
 */
export const joinRulesContent = (
  choice: AccessChoice,
  current: Record<string, unknown> | undefined,
  spaceIds: string[]
): Record<string, unknown> => {
  if (choice !== JoinRule.Restricted && choice !== JoinRule.KnockRestricted) {
    return { join_rule: choice };
  }
  const kept = readAllow(current);
  const allow =
    kept.length > 0
      ? kept
      : spaceIds.map((roomId) => ({ type: 'm.room_membership', room_id: roomId }));
  return { join_rule: choice, allow };
};
