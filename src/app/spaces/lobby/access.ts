import { JoinRule } from 'matrix-js-sdk';
import { Membership } from '../../matrix/types/room';

/** How a lobby item can be entered, from its hierarchy summary and any cached membership. */
export type LobbyItemAccess =
  | { kind: 'join'; joinRule: JoinRule }
  | { kind: 'knock'; joinRule: JoinRule }
  | { kind: 'unavailable' }
  | { kind: 'unknown' };

const KNOCK_RESTRICTED = 'knock_restricted' as JoinRule;

const KNOWN_JOIN_RULES = new Set<string>([
  JoinRule.Public,
  JoinRule.Restricted,
  JoinRule.Knock,
  KNOCK_RESTRICTED,
  JoinRule.Invite,
  JoinRule.Private,
]);

/**
 * A summary without a join rule describes a public room (the specification's
 * default). An unknown rule or a failed discovery never counts as public; a
 * cached invitation always lets the user join, and a cached ban never does.
 */
export const resolveLobbyItemAccess = (
  summaryJoinRule: string | undefined,
  hasSummary: boolean,
  membership: string | undefined
): LobbyItemAccess => {
  if (membership === Membership.Invite) return { kind: 'join', joinRule: JoinRule.Invite };
  if (membership === Membership.Ban) return { kind: 'unavailable' };
  if (!hasSummary) return { kind: 'unknown' };

  const joinRule = (summaryJoinRule ?? JoinRule.Public) as JoinRule;
  if (!KNOWN_JOIN_RULES.has(joinRule)) return { kind: 'unavailable' };
  if (joinRule === JoinRule.Knock || joinRule === KNOCK_RESTRICTED)
    return { kind: 'knock', joinRule };
  if (joinRule === JoinRule.Invite || joinRule === JoinRule.Private) return { kind: 'unavailable' };
  return { kind: 'join', joinRule };
};
