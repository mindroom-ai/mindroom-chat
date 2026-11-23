import type { TFunction } from 'i18next';
import { atom } from 'jotai';
import {
  KnownMembership,
  MatrixError,
  EventType,
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

export type DetachedGrantError = {
  readonly id: number;
  readonly message: string;
};

let nextDetachedGrantErrorId = 1;

export const createDetachedGrantError = (message: string): DetachedGrantError => ({
  id: nextDetachedGrantErrorId++,
  message,
});

/** Non-blocking queue of alerts shown at shell level if dialog-submitted grants fail after unmount. */
export const detachedGrantErrorAtom = atom<readonly DetachedGrantError[]>([]);

// Room versions 10+ require integer power levels; v1-9 allow legacy integer strings.
const hasIntegerPowerLevels = (version: string): boolean =>
  /^\d+$/.test(version) && Number(version) >= 10;

const isEligibleAgent = (userId: string, viewerId: string) =>
  isUserId(userId) &&
  isMindroomAgentUserIdForViewer(userId, viewerId) &&
  !isMindroomOwnerUserId(userId);

const powerOf = (userId: string, levels: IPowerLevels, creators: ReadonlySet<string>) =>
  creators.has(userId) ? Infinity : readPowerLevel.user(levels, userId);

const requiredModeratorLevel = (levels: IPowerLevels): number =>
  Math.max(MODERATOR_LEVEL, readPowerLevel.state(levels, MINDROOM_ROUTER_STATE_EVENT));

const canViewerGrantLevel = (
  viewerId: string,
  levels: IPowerLevels,
  creators: ReadonlySet<string>,
  level: number
): boolean =>
  getRoomPermissionsAPI(creators, levels).stateEvent(StateEvent.RoomPowerLevels, viewerId) &&
  powerOf(viewerId, levels, creators) >= level;

export type RoomModeratorGrantDecision =
  | { readonly kind: 'grant'; readonly level: number }
  | { readonly kind: 'forbidden' };

/** Evaluates whether `viewerId` can grant agent moderator rights in a v10+ non-Space room. */
export const evaluateRoomModeratorGrant = (
  room: Pick<Room, 'isSpaceRoom' | 'getVersion'>,
  viewerId: string,
  levels: IPowerLevels,
  creators: ReadonlySet<string>
): RoomModeratorGrantDecision => {
  if (room.isSpaceRoom() || !hasIntegerPowerLevels(room.getVersion())) {
    return { kind: 'forbidden' };
  }
  const level = requiredModeratorLevel(levels);
  if (!canViewerGrantLevel(viewerId, levels, creators, level)) {
    return { kind: 'forbidden' };
  }
  return { kind: 'grant', level };
};

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
  const level = requiredModeratorLevel(levels);
  if (powerOf(targetId, levels, creators) >= level) return { kind: 'alreadySatisfied' };
  if (maxLevel !== undefined && level > maxLevel) return { kind: 'levelRaised', level };
  if (!canViewerGrantLevel(viewerId, levels, creators, level)) {
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
  return level > MODERATOR_LEVEL
    ? t('sharedUi.inviteUserPrompt.roleWithLevel', { role: name, level })
    : name;
};

export type GrantFailure =
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'levelRaised'; readonly level: number }
  | { readonly kind: 'failed'; readonly detail: string };

const roomGrantQueues = new WeakMap<MatrixClient, Map<string, Promise<void>>>();

const enqueueRoomGrant = <T>(
  client: MatrixClient,
  roomId: string,
  task: () => Promise<T>
): Promise<T> => {
  let clientQueues = roomGrantQueues.get(client);
  if (!clientQueues) {
    clientQueues = new Map();
    roomGrantQueues.set(client, clientQueues);
  }
  const previous = clientQueues.get(roomId) ?? Promise.resolve();
  const result = previous.then(task, task);
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  clientQueues.set(roomId, tail);
  void tail.finally(() => {
    if (clientQueues?.get(roomId) === tail) clientQueues.delete(roomId);
  });
  return result;
};

const isNotFoundError = (error: unknown): boolean =>
  (error instanceof MatrixError && error.errcode === 'M_NOT_FOUND') ||
  (typeof error === 'object' &&
    error !== null &&
    'errcode' in error &&
    (error as { errcode?: unknown }).errcode === 'M_NOT_FOUND');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clonePowerLevelsContent = (content: Record<string, unknown>): Record<string, unknown> => ({
  ...content,
  ...(isRecord(content.events) ? { events: { ...content.events } } : {}),
  ...(isRecord(content.notifications) ? { notifications: { ...content.notifications } } : {}),
  users: isRecord(content.users) ? { ...content.users } : {},
});

const errorDetail = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error);

const grantGenerations = new WeakMap<MatrixClient, Map<string, number>>();

const grantKey = (roomId: string, targetId: string): string => `${roomId}\0${targetId}`;

const moderatorGrantGeneration = (client: MatrixClient, roomId: string, targetId: string): number =>
  grantGenerations.get(client)?.get(grantKey(roomId, targetId)) ?? 0;

/**
 * Starts a new invite of `targetId` to the room and returns its generation. A grant of an earlier
 * generation that still waits in the room's queue is superseded and writes nothing, so an invite
 * with the grant, declined and sent again without it, leaves the agent without the rights.
 */
export const advanceModeratorGrantGeneration = (
  client: MatrixClient,
  roomId: string,
  targetId: string
): number => {
  const generations = grantGenerations.get(client) ?? new Map<string, number>();
  grantGenerations.set(client, generations);
  const generation = moderatorGrantGeneration(client, roomId, targetId) + 1;
  generations.set(grantKey(roomId, targetId), generation);
  return generation;
};

/**
 * Serializes moderator grants per room and merges against live `m.room.power_levels` state from
 * the homeserver before writing, so concurrent agent invites before `/sync` never overwrite each
 * other and never lower existing power levels or exceed the shown ceiling. A grant whose
 * `generation` a newer invite of the same user has superseded writes nothing and returns `null`.
 */
export const grantRoomModeratorRights = (
  client: MatrixClient,
  room: Room,
  targetId: string,
  maxLevel: number,
  generation: number = moderatorGrantGeneration(client, room.roomId, targetId)
): Promise<GrantFailure | null> =>
  enqueueRoomGrant(client, room.roomId, async () => {
    const superseded = () => moderatorGrantGeneration(client, room.roomId, targetId) !== generation;
    if (superseded()) return null;

    const createEvent = getStateEvent(room, StateEvent.RoomCreate);
    const creators = createEvent ? getRoomCreators(createEvent) : new Set<string>();

    let liveContent: Record<string, unknown> | undefined;
    try {
      const fetched = await client.getStateEvent(room.roomId, StateEvent.RoomPowerLevels, '');
      liveContent = isRecord(fetched) ? fetched : {};
    } catch (error) {
      if (isNotFoundError(error)) {
        liveContent = undefined;
      } else {
        return { kind: 'failed', detail: errorDetail(error) };
      }
    }

    const levels = getPowersLevelFromMatrixEvent(
      liveContent ? ({ getContent: () => liveContent } as MatrixEvent) : undefined
    );
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

    const nextContent = clonePowerLevelsContent(liveContent ?? {});
    (nextContent.users as Record<string, number>)[targetId] = decision.level;
    if (superseded()) return null;
    try {
      await client.sendStateEvent(room.roomId, EventType.RoomPowerLevels, nextContent, '');
      return null;
    } catch (error) {
      return { kind: 'failed', detail: errorDetail(error) };
    }
  });

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
