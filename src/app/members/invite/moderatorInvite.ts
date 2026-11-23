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

/**
 * What the invites of one user to one room mean for their rights, kept while an invite with the
 * grant or its grant is on its way (`active` counts them). `optOutGen` grows with every invite
 * without the grant. Invites with the grant are numbered as they are submitted (`nextSeq`), and
 * `latestSucceededSeq` is the newest of them whose invite was sent: its grant is the one to write.
 */
type GrantState = {
  optOutGen: number;
  nextSeq: number;
  latestSucceededSeq: number;
  active: number;
};

const grantStates = new WeakMap<MatrixClient, Map<string, GrantState>>();

const grantKey = (roomId: string, targetId: string): string => `${roomId}\0${targetId}`;

/**
 * An invite of `targetId` without the grant supersedes every invite with the grant that is still
 * on its way and every grant that waits in the room's queue or reads the live state, also one a
 * sheet started that has closed since: a grant whose write (`sendStateEvent`) has not started
 * writes nothing. A write that is already sent cannot be recalled; only its failure is no longer
 * reported. So an invite with the grant, declined and sent again without it, leaves the agent
 * without the rights. Nothing to do when none waits.
 */
export const supersedeModeratorGrant = (
  client: MatrixClient,
  roomId: string,
  targetId: string
): void => {
  const state = grantStates.get(client)?.get(grantKey(roomId, targetId));
  if (state) state.optOutGen += 1;
};

type ModeratorGrantIntent = {
  /** The invite failed: no grant follows. Leaves the grants of earlier invites as they are. */
  release: () => void;
  /**
   * The invite is sent: grants the rights, unless an invite without the grant came since, or a
   * newer invite with the grant was sent first.
   */
  run: (room: Room, maxLevel: number) => Promise<GrantFailure | null>;
};

/**
 * An invite of `targetId` with the grant, to call before the invite is sent, so an invite without
 * the grant that starts while this one is still on its way withdraws its grant too.
 *
 * `run` serializes moderator grants per room and merges against live `m.room.power_levels` state
 * from the homeserver before writing, so concurrent agent invites before `/sync` never overwrite
 * each other and never lower existing power levels or exceed the shown ceiling. Of the invites of
 * one user, the one submitted last whose invite was sent gives the rights, whatever the order in
 * which the invites return; a superseded grant writes nothing, reports nothing and returns `null`.
 */
export const beginModeratorGrantIntent = (
  client: MatrixClient,
  roomId: string,
  targetId: string
): ModeratorGrantIntent => {
  const key = grantKey(roomId, targetId);
  const states = grantStates.get(client) ?? new Map<string, GrantState>();
  grantStates.set(client, states);
  const state = states.get(key) ?? { optOutGen: 0, nextSeq: 0, latestSucceededSeq: 0, active: 0 };
  states.set(key, state);
  state.nextSeq += 1;
  state.active += 1;
  const mySeq = state.nextSeq;
  const intentOptOut = state.optOutGen;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    state.active -= 1;
    if (state.active === 0) states.delete(key);
  };

  const run = (room: Room, maxLevel: number): Promise<GrantFailure | null> => {
    if (state.optOutGen !== intentOptOut || mySeq < state.latestSucceededSeq) {
      release();
      return Promise.resolve(null);
    }
    state.latestSucceededSeq = mySeq;
    const isSuperseded = () => state.optOutGen !== intentOptOut || state.latestSucceededSeq > mySeq;

    return enqueueRoomGrant<GrantFailure | null>(client, roomId, async () => {
      if (isSuperseded()) return null;

      const createEvent = getStateEvent(room, StateEvent.RoomCreate);
      const creators = createEvent ? getRoomCreators(createEvent) : new Set<string>();

      let liveContent: Record<string, unknown> | undefined;
      let readFailure: GrantFailure | undefined;
      try {
        const fetched = await client.getStateEvent(roomId, StateEvent.RoomPowerLevels, '');
        liveContent = isRecord(fetched) ? fetched : {};
      } catch (error) {
        if (!isNotFoundError(error)) readFailure = { kind: 'failed', detail: errorDetail(error) };
      }
      // Superseded while the state was read: whatever the read says, also a failure, is obsolete.
      // Nothing below waits before it writes.
      if (isSuperseded()) return null;
      if (readFailure) return readFailure;

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
      try {
        await client.sendStateEvent(roomId, EventType.RoomPowerLevels, nextContent, '');
        return null;
      } catch (error) {
        // Superseded while it was written: its failure is obsolete as well.
        return isSuperseded() ? null : { kind: 'failed', detail: errorDetail(error) };
      }
    }).finally(release);
  };

  return { release, run };
};

/** The grant of an invite that is sent already: `beginModeratorGrantIntent` and its `run` in one. */
export const grantRoomModeratorRights = (
  client: MatrixClient,
  room: Room,
  targetId: string,
  maxLevel: number
): Promise<GrantFailure | null> =>
  beginModeratorGrantIntent(client, room.roomId, targetId).run(room, maxLevel);

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
