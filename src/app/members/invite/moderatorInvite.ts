import { atom } from 'jotai';
import type { TFunction } from 'i18next';
import {
  EventTimeline,
  KnownMembership,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
} from 'matrix-js-sdk';
import {
  getPowersLevelFromMatrixEvent,
  readPowerLevel,
  type IPowerLevels,
} from '../../matrix/hooks/usePowerLevels';
import { getRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { getRoomPermissionsAPI } from '../../matrix/hooks/useRoomPermissions';
import { isUserId } from '../../matrix/matrix';
import {
  isMindroomAgentUserIdForViewer,
  isMindroomOwnerUserId,
} from '../../matrix/protocol/agentIdentity';
import { MINDROOM_ROUTER_STATE_EVENT } from '../../matrix/protocol/routerBinding';
import { StateEvent } from '../../matrix/types/room';
import type { PowerLevelTags } from '../usePowerLevelTags';

export const MODERATOR_LEVEL = 50;

/** Non-blocking notice shown when a dialog-submitted grant fails after the dialog closed. */
export type DetachedGrantFailure = { id: number; message: string };
export const detachedGrantErrorAtom = atom<DetachedGrantFailure | undefined>(undefined);

let nextFailureId = 1;
export const nextDetachedGrantFailure = (message: string): DetachedGrantFailure => ({
  id: nextFailureId++,
  message,
});

export const moderatorGrantLevel = (levels: IPowerLevels): number =>
  Math.max(MODERATOR_LEVEL, readPowerLevel.state(levels, MINDROOM_ROUTER_STATE_EVENT));

export const grantRoleName = (tags: PowerLevelTags, level: number, t: TFunction): string =>
  tags[level]?.name ?? t('sharedUi.powerLevels.team', { power: level });

const getStateEvent = (
  room: Pick<Room, 'getLiveTimeline'>,
  type: StateEvent
): MatrixEvent | undefined =>
  room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(type, '') ?? undefined;

export const getRawPowerLevels = (room: Pick<Room, 'getLiveTimeline'>): Record<string, unknown> => {
  const content = getStateEvent(room, StateEvent.RoomPowerLevels)?.getContent();
  return content && typeof content === 'object' ? content : {};
};

const isOptionalMap = (v: unknown): v is Record<string, unknown> | undefined =>
  v === undefined || (typeof v === 'object' && v !== null && !Array.isArray(v));

const isOptionalNum = (v: unknown): boolean =>
  v === undefined || (typeof v === 'number' && Number.isFinite(v));

const hasUnreadableGrantLevels = (
  raw: Record<string, unknown>,
  viewerId: string,
  targetId: string
) =>
  !isOptionalMap(raw.events) ||
  !isOptionalMap(raw.users) ||
  [
    raw.state_default,
    raw.users_default,
    raw.events?.[StateEvent.RoomPowerLevels],
    raw.events?.[MINDROOM_ROUTER_STATE_EVENT],
    raw.users?.[viewerId],
    raw.users?.[targetId],
  ].some((v) => !isOptionalNum(v));

const isEligibleAgent = (userId: string, viewerId: string) =>
  isUserId(userId) &&
  isMindroomAgentUserIdForViewer(userId, viewerId) &&
  !isMindroomOwnerUserId(userId);

const powerOf = (userId: string, levels: IPowerLevels, creators: ReadonlySet<string>) =>
  creators.has(userId) ? Infinity : readPowerLevel.user(levels, userId);

export const canOfferModeratorGrant = (
  room: Pick<Room, 'isSpaceRoom'>,
  targetId: string,
  viewerId: string,
  levels: IPowerLevels,
  creators: ReadonlySet<string>,
  raw: Record<string, unknown> = {}
): boolean => {
  if (room.isSpaceRoom() || !isEligibleAgent(targetId, viewerId)) return false;
  if (hasUnreadableGrantLevels(raw, viewerId, targetId)) return false;
  const level = moderatorGrantLevel(levels);
  return (
    getRoomPermissionsAPI(creators, levels).stateEvent(StateEvent.RoomPowerLevels, viewerId) &&
    powerOf(viewerId, levels, creators) >= level &&
    powerOf(targetId, levels, creators) < level
  );
};

export const hasModeratorMindroomAgent = (
  members: readonly Pick<RoomMember, 'membership' | 'userId'>[],
  viewerId: string,
  levels: IPowerLevels,
  creators: ReadonlySet<string>,
  raw: Record<string, unknown> = {}
): boolean => {
  const rawUsers = isOptionalMap(raw.users) ? raw.users : undefined;
  if (raw.users !== undefined && rawUsers === undefined) return true;
  const level = moderatorGrantLevel(levels);
  return members.some(
    ({ membership, userId }) =>
      (membership === KnownMembership.Join || membership === KnownMembership.Invite) &&
      isEligibleAgent(userId, viewerId) &&
      (!isOptionalNum(rawUsers?.[userId]) || powerOf(userId, levels, creators) >= level)
  );
};

export class ModeratorGrantError extends Error {
  constructor(cause: unknown, readonly level: number) {
    super(cause instanceof Error && cause.message ? cause.message : String(cause));
  }
}

/** Re-reads live power levels before writing; never lowers a target already at or above the level. */
export const grantRoomModeratorRights = async (
  client: MatrixClient,
  room: Pick<Room, 'roomId' | 'isSpaceRoom' | 'getLiveTimeline'>,
  targetId: string
): Promise<void> => {
  const powerEvent = getStateEvent(room, StateEvent.RoomPowerLevels);
  const raw = powerEvent?.getContent() ?? {};
  const levels = getPowersLevelFromMatrixEvent(powerEvent);
  const createEvent = getStateEvent(room, StateEvent.RoomCreate);
  const creators = createEvent ? getRoomCreators(createEvent) : new Set<string>();
  const me = client.getSafeUserId();

  if (hasUnreadableGrantLevels(raw, me, targetId)) return;
  const level = moderatorGrantLevel(levels);
  if (powerOf(targetId, levels, creators) >= level) return;
  if (!canOfferModeratorGrant(room, targetId, me, levels, creators, raw)) {
    throw new ModeratorGrantError(new Error('Not allowed to change power levels'), level);
  }
  try {
    await client.setPowerLevel(room.roomId, targetId, level);
  } catch (error) {
    throw new ModeratorGrantError(error, level);
  }
};
