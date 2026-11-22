import type { TFunction } from 'i18next';
import { atom } from 'jotai';
import {
  KnownMembership,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
} from 'matrix-js-sdk';
import { isUserId } from '../../matrix/matrix';
import {
  isMindroomAgentUserIdForViewer,
  isMindroomOwnerUserId,
} from '../../matrix/protocol/agentIdentity';
import { MINDROOM_ROUTER_STATE_EVENT } from '../../matrix/protocol/routerBinding';
import { MODERATOR_LEVEL } from '../../matrix/hooks/usePowerLevels';
import { getRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { getStateEvent } from '../../matrix/room';
import { StateEvent } from '../../matrix/types/room';
import type { PowerLevelTags } from '../usePowerLevelTags';

export type DetachedGrantFailure = { readonly message: string };

/** Non-blocking alert shown at shell level if a dialog-submitted grant fails after unmount. */
export const detachedGrantErrorAtom = atom<DetachedGrantFailure | undefined>(undefined);

export type PowerSnapshot = {
  readonly raw: Record<string, unknown>;
  readonly stateSpecDefault: number;
} | null;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteLevel = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Single snapshot of `m.room.power_levels` content (or `null` if its shape is unreadable). */
export const readPowerSnapshot = (event: MatrixEvent | undefined): PowerSnapshot => {
  if (!event) return { raw: {}, stateSpecDefault: 0 };
  const raw = event.getContent();
  if (
    !isRecord(raw) ||
    (raw.events !== undefined && !isRecord(raw.events)) ||
    (raw.users !== undefined && !isRecord(raw.users))
  ) {
    return null;
  }
  return { raw, stateSpecDefault: MODERATOR_LEVEL };
};

/** Reads an explicit map override, checking `fallback` only when the override is absent. */
const effectiveLevel = (
  map: unknown,
  key: string,
  fallback: unknown,
  specDefault: number
): number | undefined => {
  if (isRecord(map) && Object.prototype.hasOwnProperty.call(map, key) && map[key] !== undefined) {
    return isFiniteLevel(map[key]) ? map[key] : undefined;
  }
  if (fallback === undefined) return specDefault;
  return isFiniteLevel(fallback) ? fallback : undefined;
};

const userPower = (
  userId: string,
  snapshot: NonNullable<PowerSnapshot>,
  creators: ReadonlySet<string>
): number | undefined =>
  creators.has(userId)
    ? Infinity
    : effectiveLevel(snapshot.raw.users, userId, snapshot.raw.users_default, 0);

const isEligibleAgent = (userId: string, viewerId: string) =>
  isUserId(userId) &&
  isMindroomAgentUserIdForViewer(userId, viewerId) &&
  !isMindroomOwnerUserId(userId);

export type ModeratorGrantDecision =
  | { readonly kind: 'grant' | 'levelRaised'; readonly level: number }
  | { readonly kind: 'alreadySatisfied' | 'forbidden' | 'ineligible' | 'unreadable' };

/** Evaluates whether `viewerId` can grant `targetId` moderator rights using only effective levels. */
export const evaluateModeratorGrant = (
  room: Pick<Room, 'isSpaceRoom'>,
  targetId: string,
  viewerId: string,
  snapshot: PowerSnapshot,
  creators: ReadonlySet<string>,
  maxLevel?: number
): ModeratorGrantDecision => {
  if (room.isSpaceRoom() || !isEligibleAgent(targetId, viewerId)) return { kind: 'ineligible' };
  if (!snapshot) return { kind: 'unreadable' };

  const stateLevel = (key: string) =>
    effectiveLevel(snapshot.raw.events, key, snapshot.raw.state_default, snapshot.stateSpecDefault);
  const routerLevel = stateLevel(MINDROOM_ROUTER_STATE_EVENT);
  const targetPower = userPower(targetId, snapshot, creators);
  if (routerLevel === undefined || targetPower === undefined) return { kind: 'unreadable' };

  const level = Math.max(MODERATOR_LEVEL, routerLevel);
  if (targetPower >= level) return { kind: 'alreadySatisfied' };
  if (maxLevel !== undefined && level > maxLevel) return { kind: 'levelRaised', level };

  const viewerPower = userPower(viewerId, snapshot, creators);
  const powerEventLevel = creators.has(viewerId) ? 0 : stateLevel(StateEvent.RoomPowerLevels);
  if (viewerPower === undefined || powerEventLevel === undefined) return { kind: 'unreadable' };
  if (viewerPower < powerEventLevel || viewerPower < level) return { kind: 'forbidden' };
  return { kind: 'grant', level };
};

export const hasModeratorMindroomAgent = (
  members: readonly Pick<RoomMember, 'membership' | 'userId'>[],
  viewerId: string,
  snapshot: PowerSnapshot,
  creators: ReadonlySet<string>,
  level: number
): boolean => {
  if (!snapshot) return true;
  return members.some(({ membership, userId }) => {
    if (membership !== KnownMembership.Join && membership !== KnownMembership.Invite) return false;
    if (!isEligibleAgent(userId, viewerId)) return false;
    const power = userPower(userId, snapshot, creators);
    return power === undefined || power >= level;
  });
};

export const grantRoleName = (tags: PowerLevelTags, level: number, t: TFunction): string =>
  tags[level]?.name ?? t('sharedUi.powerLevels.team', { power: level });

export type GrantFailure =
  | { readonly kind: 'forbidden' | 'unreadable' }
  | { readonly kind: 'levelRaised'; readonly level: number }
  | { readonly kind: 'failed'; readonly detail: string };

/** Re-reads live power levels before writing; never lowers a target or exceeds the shown level. */
export const grantRoomModeratorRights = async (
  client: MatrixClient,
  room: Room,
  targetId: string,
  maxLevel: number
): Promise<GrantFailure | null> => {
  const snapshot = readPowerSnapshot(getStateEvent(room, StateEvent.RoomPowerLevels));
  const createEvent = getStateEvent(room, StateEvent.RoomCreate);
  const creators = createEvent ? getRoomCreators(createEvent) : new Set<string>();
  const decision = evaluateModeratorGrant(
    room,
    targetId,
    client.getSafeUserId(),
    snapshot,
    creators,
    maxLevel
  );
  if (decision.kind === 'alreadySatisfied') return null;
  if (decision.kind === 'unreadable' || decision.kind === 'levelRaised') return decision;
  if (decision.kind !== 'grant') return { kind: 'forbidden' };
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
  else if (failure.kind === 'unreadable') error = t('sharedUi.inviteUserPrompt.rolePermissionsUnreadable');
  else if (failure.kind === 'levelRaised') {
    error = t('sharedUi.inviteUserPrompt.roleRequirementChanged', {
      role: grantRoleName(tags, failure.level, t),
    });
  } else error = failure.detail || t('errors.unknown');
  return t('sharedUi.inviteUserPrompt.roleFailed', {
    user,
    role: grantRoleName(tags, displayedLevel, t),
    error,
  });
};
