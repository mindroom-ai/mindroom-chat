import type { TFunction } from 'i18next';
import { atom } from 'jotai';
import { KnownMembership, type MatrixClient, type Room, type RoomMember } from 'matrix-js-sdk';
import { isUserId } from '../../matrix/matrix';
import {
  isMindroomAgentUserIdForViewer,
  isMindroomOwnerUserId,
} from '../../matrix/protocol/agentIdentity';
import { MINDROOM_ROUTER_STATE_EVENT } from '../../matrix/protocol/routerBinding';
import {
  MODERATOR_LEVEL,
  getPowersLevelFromMatrixEvent,
  readPowerLevel,
  type IPowerLevels,
} from '../../matrix/hooks/usePowerLevels';
import { getRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { getRoomPermissionsAPI } from '../../matrix/hooks/useRoomPermissions';
import { getStateEvent } from '../../matrix/room';
import { StateEvent } from '../../matrix/types/room';
import type { PowerLevelTags } from '../usePowerLevelTags';

/** Non-blocking alert shown at shell level if a dialog-submitted grant fails after unmount. */
export const detachedGrantErrorAtom = atom<{ readonly message: string } | undefined>(undefined);

// Room versions 10+ require integer power levels; v1-9 allow legacy integer strings.
const hasIntegerPowerLevels = (version: string): boolean =>
  /^\d+$/.test(version) && Number(version) >= 10;

const isEligibleAgent = (userId: string, viewerId: string) =>
  isUserId(userId) &&
  isMindroomAgentUserIdForViewer(userId, viewerId) &&
  !isMindroomOwnerUserId(userId);

const powerOf = (userId: string, levels: IPowerLevels, creators: ReadonlySet<string>) =>
  creators.has(userId) ? Infinity : readPowerLevel.user(levels, userId);

type ModeratorGrantDecision =
  | { readonly kind: 'grant'; readonly level: number }
  | { readonly kind: 'levelRaised'; readonly level: number }
  | { readonly kind: 'alreadySatisfied' }
  | { readonly kind: 'forbidden' };

/** Evaluates whether `viewerId` can grant `targetId` moderator rights in a v10+ non-Space room. */
export const evaluateModeratorGrant = (
  room: Pick<Room, 'isSpaceRoom' | 'getVersion'>,
  targetId: string,
  viewerId: string,
  levels: IPowerLevels,
  creators: ReadonlySet<string>,
  maxLevel?: number
): ModeratorGrantDecision => {
  if (
    room.isSpaceRoom() ||
    !hasIntegerPowerLevels(room.getVersion()) ||
    !isEligibleAgent(targetId, viewerId)
  ) {
    return { kind: 'forbidden' };
  }
  const level = Math.max(
    MODERATOR_LEVEL,
    readPowerLevel.state(levels, MINDROOM_ROUTER_STATE_EVENT)
  );
  if (powerOf(targetId, levels, creators) >= level) return { kind: 'alreadySatisfied' };
  if (maxLevel !== undefined && level > maxLevel) return { kind: 'levelRaised', level };
  if (
    !getRoomPermissionsAPI(creators, levels).stateEvent(StateEvent.RoomPowerLevels, viewerId) ||
    powerOf(viewerId, levels, creators) < level
  ) {
    return { kind: 'forbidden' };
  }
  return { kind: 'grant', level };
};

export const hasModeratorMindroomAgent = (
  members: readonly Pick<RoomMember, 'membership' | 'userId'>[],
  viewerId: string,
  levels: IPowerLevels,
  creators: ReadonlySet<string>,
  level: number
): boolean =>
  members.some(
    ({ membership, userId }) =>
      (membership === KnownMembership.Join || membership === KnownMembership.Invite) &&
      isEligibleAgent(userId, viewerId) &&
      powerOf(userId, levels, creators) >= level
  );

export const grantRoleName = (tags: PowerLevelTags, level: number, t: TFunction): string => {
  const name = tags[level]?.name;
  if (!name) return t('sharedUi.powerLevels.team', { power: level });
  return level > MODERATOR_LEVEL ? `${name} (${level})` : name;
};

export type GrantFailure =
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'levelRaised'; readonly level: number }
  | { readonly kind: 'failed'; readonly detail: string };

/** Re-reads synced power levels before writing; never lowers against synced state or exceeds the shown level. */
export const grantRoomModeratorRights = async (
  client: MatrixClient,
  room: Room,
  targetId: string,
  maxLevel: number
): Promise<GrantFailure | null> => {
  const levels = getPowersLevelFromMatrixEvent(getStateEvent(room, StateEvent.RoomPowerLevels));
  const createEvent = getStateEvent(room, StateEvent.RoomCreate);
  const creators = createEvent ? getRoomCreators(createEvent) : new Set<string>();
  const decision = evaluateModeratorGrant(
    room,
    targetId,
    client.getSafeUserId(),
    levels,
    creators,
    maxLevel
  );
  if (decision.kind === 'alreadySatisfied') return null;
  if (decision.kind !== 'grant') return decision;
  try {
    await client.setPowerLevel(room.roomId, targetId, decision.level);
    return null;
  } catch (error) {
    return {
      kind: 'failed',
      detail: error instanceof Error && error.message ? error.message : String(error),
    };
  }
};

export const formatGrantFailure = (
  failure: GrantFailure,
  user: string,
  displayedLevel: number,
  tags: PowerLevelTags,
  t: TFunction
): string => {
  let error: string;
  if (failure.kind === 'forbidden') error = t('errors.forbidden');
  else if (failure.kind === 'levelRaised') {
    error = t('sharedUi.inviteUserPrompt.roleRequirementChanged', {
      role: grantRoleName(tags, failure.level, t),
    });
  } else {
    error = failure.detail || t('errors.unknown');
  }
  return t('sharedUi.inviteUserPrompt.roleFailed', {
    user,
    role: grantRoleName(tags, displayedLevel, t),
    error,
  });
};
