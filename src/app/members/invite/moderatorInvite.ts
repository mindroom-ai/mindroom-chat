import { KnownMembership, type Room, type RoomMember } from 'matrix-js-sdk';
import { readPowerLevel, type IPowerLevels } from '../../matrix/hooks/usePowerLevels';
import { getRoomPermissionsAPI } from '../../matrix/hooks/useRoomPermissions';
import { isUserId } from '../../matrix/matrix';
import {
  isMindroomAgentUserIdForViewer,
  isMindroomOwnerUserId,
} from '../../matrix/protocol/agentIdentity';
import { MINDROOM_ROUTER_STATE_EVENT } from '../../matrix/protocol/routerBinding';
import { StateEvent } from '../../matrix/types/room';

const MODERATOR_LEVEL = 50;

/** Level an agent needs to write `io.mindroom.router` and other moderator state (at least 50). */
export const moderatorGrantLevel = (powerLevels: IPowerLevels): number =>
  Math.max(MODERATOR_LEVEL, readPowerLevel.state(powerLevels, MINDROOM_ROUTER_STATE_EVENT));

const isEligibleAgent = (userId: string, viewerId: string): boolean =>
  isUserId(userId) &&
  isMindroomAgentUserIdForViewer(userId, viewerId) &&
  !isMindroomOwnerUserId(userId);

const powerOf = (
  userId: string,
  powerLevels: IPowerLevels,
  creators: ReadonlySet<string>
): number => (creators.has(userId) ? Infinity : readPowerLevel.user(powerLevels, userId));

/**
 * Whether the viewer may grant moderator rights to `targetUserId` in `room`.
 * False in Spaces, for non-agents or the demoted owner account, when the target already holds
 * moderator power, or when the viewer cannot send `m.room.power_levels` at that level.
 */
export const canOfferModeratorGrant = (
  room: Pick<Room, 'isSpaceRoom'>,
  targetUserId: string,
  viewerId: string,
  powerLevels: IPowerLevels,
  creators: ReadonlySet<string>
): boolean => {
  if (room.isSpaceRoom()) return false;
  if (!isEligibleAgent(targetUserId, viewerId)) return false;
  const level = moderatorGrantLevel(powerLevels);
  const may = getRoomPermissionsAPI(creators, powerLevels);
  if (!may.stateEvent(StateEvent.RoomPowerLevels, viewerId)) return false;
  if (powerOf(viewerId, powerLevels, creators) < level) return false;
  return powerOf(targetUserId, powerLevels, creators) < level;
};

/**
 * Whether any joined or invited MindRoom agent in the room already holds moderator power
 * (at least `moderatorGrantLevel(powerLevels)`). Excludes the demoted owner account.
 */
export const hasModeratorMindroomAgent = (
  members: readonly Pick<RoomMember, 'membership' | 'userId'>[],
  viewerId: string,
  powerLevels: IPowerLevels,
  creators: ReadonlySet<string>
): boolean => {
  const level = moderatorGrantLevel(powerLevels);
  return members.some(
    ({ membership, userId }) =>
      (membership === KnownMembership.Join || membership === KnownMembership.Invite) &&
      isEligibleAgent(userId, viewerId) &&
      powerOf(userId, powerLevels, creators) >= level
  );
};
