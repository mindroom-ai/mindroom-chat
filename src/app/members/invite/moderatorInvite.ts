import { useCallback, useSyncExternalStore } from 'react';
import { atom } from 'jotai';
import type { TFunction } from 'i18next';
import {
  EventTimeline,
  KnownMembership,
  RoomStateEvent,
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
import { matchesEnum } from '../../lib/matchesEnum';
import type { PowerLevelTags } from '../usePowerLevelTags';

export const MODERATOR_LEVEL = 50;
const POWER_LEVEL_SYNC_TIMEOUT_MS = 5_000;

/** Non-blocking notice shown when a dialog-submitted grant fails after the dialog closed. */
export type DetachedGrantFailure = { id: number; message: string };
export const detachedGrantErrorAtom = atom<DetachedGrantFailure | undefined>(undefined);

let nextDetachedFailureId = 1;
export const nextDetachedGrantFailure = (message: string): DetachedGrantFailure => ({
  id: nextDetachedFailureId++,
  message,
});

/** Level an agent needs to write `io.mindroom.router` and other moderator state (at least 50). */
export const moderatorGrantLevel = (powerLevels: IPowerLevels): number =>
  Math.max(MODERATOR_LEVEL, readPowerLevel.state(powerLevels, MINDROOM_ROUTER_STATE_EVENT));

/** Display name the room uses for a granted power level (e.g. Moderator at 50, Admin at 100). */
export const grantRoleName = (tags: PowerLevelTags, level: number, t: TFunction): string =>
  tags[level]?.name ?? t('sharedUi.powerLevels.team', { power: level });

export const getPowerLevelsEvent = (
  room: Pick<Room, 'getLiveTimeline'>
): MatrixEvent | undefined =>
  room
    .getLiveTimeline()
    .getState(EventTimeline.FORWARDS)
    ?.getStateEvents(StateEvent.RoomPowerLevels, '') ?? undefined;

export const getRawPowerLevels = (
  room: Pick<Room, 'getLiveTimeline'>
): Record<string, unknown> => {
  const content = getPowerLevelsEvent(room)?.getContent();
  return content && typeof content === 'object' ? content : {};
};

const getLiveCreators = (room: Pick<Room, 'getLiveTimeline'>): Set<string> => {
  const createEvent =
    room
      .getLiveTimeline()
      .getState(EventTimeline.FORWARDS)
      ?.getStateEvents(StateEvent.RoomCreate, '') ?? undefined;
  return createEvent ? getRoomCreators(createEvent) : new Set<string>();
};

const isOptionalRecord = (value: unknown): value is Record<string, unknown> | undefined =>
  value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value));

const isOptionalNumber = (value: unknown): boolean =>
  value === undefined || (typeof value === 'number' && Number.isFinite(value));

/**
 * True when any raw `m.room.power_levels` field the decision depends on is present but not a
 * finite number (for example legacy Matrix v1-v9 string levels like `"75"`).
 */
export const hasUnreadableGrantLevels = (
  raw: Record<string, unknown>,
  viewerId: string,
  targetUserId: string
): boolean => {
  if (!isOptionalRecord(raw.events) || !isOptionalRecord(raw.users)) return true;
  const fields: unknown[] = [
    raw.state_default,
    raw.users_default,
    raw.events?.[StateEvent.RoomPowerLevels],
    raw.events?.[MINDROOM_ROUTER_STATE_EVENT],
    raw.users?.[viewerId],
    raw.users?.[targetUserId],
  ];
  return fields.some((value) => !isOptionalNumber(value));
};

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
 * Whether the viewer may grant moderator/router rights to `targetUserId` in `room`.
 * False in Spaces, for non-agents or the demoted owner account, when relevant raw power levels
 * are unreadable, when the target already holds that power, or when the viewer cannot grant it.
 */
export const canOfferModeratorGrant = (
  room: Pick<Room, 'isSpaceRoom'>,
  targetUserId: string,
  viewerId: string,
  powerLevels: IPowerLevels,
  creators: ReadonlySet<string>,
  rawPowerLevels: Record<string, unknown> = {}
): boolean => {
  if (room.isSpaceRoom()) return false;
  if (!isEligibleAgent(targetUserId, viewerId)) return false;
  if (hasUnreadableGrantLevels(rawPowerLevels, viewerId, targetUserId)) return false;
  const level = moderatorGrantLevel(powerLevels);
  const may = getRoomPermissionsAPI(creators, powerLevels);
  if (!may.stateEvent(StateEvent.RoomPowerLevels, viewerId)) return false;
  if (powerOf(viewerId, powerLevels, creators) < level) return false;
  return powerOf(targetUserId, powerLevels, creators) < level;
};

/**
 * Whether any joined or invited MindRoom agent in the room already holds moderator power
 * (at least `moderatorGrantLevel(powerLevels)`), or has an unreadable raw level.
 * Excludes the demoted owner account.
 */
export const hasModeratorMindroomAgent = (
  members: readonly Pick<RoomMember, 'membership' | 'userId'>[],
  viewerId: string,
  powerLevels: IPowerLevels,
  creators: ReadonlySet<string>,
  rawPowerLevels: Record<string, unknown> = {}
): boolean => {
  const rawUsers = isOptionalRecord(rawPowerLevels.users) ? rawPowerLevels.users : undefined;
  if (rawPowerLevels.users !== undefined && rawUsers === undefined) return true;
  const level = moderatorGrantLevel(powerLevels);
  return members.some(({ membership, userId }) => {
    if (
      (membership !== KnownMembership.Join && membership !== KnownMembership.Invite) ||
      !isEligibleAgent(userId, viewerId)
    ) {
      return false;
    }
    if (!isOptionalNumber(rawUsers?.[userId])) return true;
    return powerOf(userId, powerLevels, creators) >= level;
  });
};

type RoomGrantSnapshot = { inFlight: boolean; hasPendingGrant: boolean };
const IDLE_SNAPSHOT: RoomGrantSnapshot = { inFlight: false, hasPendingGrant: false };

type RoomGrantTracker = {
  tail: Promise<void>;
  inFlightCount: number;
  pendingTargets: Set<string>;
  snapshot: RoomGrantSnapshot;
  listeners: Set<() => void>;
};

const clientTrackers = new WeakMap<MatrixClient, Map<string, RoomGrantTracker>>();

const getTracker = (client: MatrixClient, roomId: string): RoomGrantTracker => {
  let rooms = clientTrackers.get(client);
  if (!rooms) {
    rooms = new Map<string, RoomGrantTracker>();
    clientTrackers.set(client, rooms);
  }
  let tracker = rooms.get(roomId);
  if (!tracker) {
    tracker = {
      tail: Promise.resolve(),
      inFlightCount: 0,
      pendingTargets: new Set<string>(),
      snapshot: IDLE_SNAPSHOT,
      listeners: new Set<() => void>(),
    };
    rooms.set(roomId, tracker);
  }
  return tracker;
};

const notifyTracker = (tracker: RoomGrantTracker) => {
  const nextInFlight = tracker.inFlightCount > 0;
  const nextPending = tracker.pendingTargets.size > 0;
  if (
    tracker.snapshot.inFlight !== nextInFlight ||
    tracker.snapshot.hasPendingGrant !== nextPending
  ) {
    tracker.snapshot =
      !nextInFlight && !nextPending
        ? IDLE_SNAPSHOT
        : { inFlight: nextInFlight, hasPendingGrant: nextPending };
  }
  tracker.listeners.forEach((listener) => listener());
};

/** Tracks in-flight moderator grants per `(client, roomId)` across dialog and members drawer. */
export const useRoomModeratorGrantState = (
  client: MatrixClient,
  roomId: string
): RoomGrantSnapshot => {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const tracker = getTracker(client, roomId);
      tracker.listeners.add(onStoreChange);
      return () => {
        tracker.listeners.delete(onStoreChange);
      };
    },
    [client, roomId]
  );
  const getSnapshot = useCallback(() => getTracker(client, roomId).snapshot, [client, roomId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

const powerEventReflectsGrant = (
  event: MatrixEvent | undefined,
  targetUserId: string,
  level: number,
  eventId: string | undefined
): boolean => {
  if (!event) return false;
  if (eventId && event.getId?.() === eventId) return true;
  const raw = event.getContent?.();
  if (!raw || typeof raw !== 'object') return false;
  const users = (raw as Record<string, unknown>).users;
  if (!isOptionalRecord(users)) return false;
  const value = users?.[targetUserId];
  return typeof value === 'number' && Number.isFinite(value) && value >= level;
};

/**
 * Waits until the room's synced `m.room.power_levels` reflects the just-written grant (or a short
 * timeout passes), so a subsequent `client.setPowerLevel` copies the updated state event instead of
 * overwriting the first grant.
 */
const waitForPowerLevelSync = (
  client: MatrixClient,
  room: Pick<Room, 'roomId' | 'getLiveTimeline'>,
  targetUserId: string,
  level: number,
  eventId: string | undefined
): Promise<void> => {
  if (powerEventReflectsGrant(getPowerLevelsEvent(room), targetUserId, level, eventId)) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      client.removeListener(RoomStateEvent.Events, onStateEvent);
      clearTimeout(timer);
      resolve();
    };
    const onStateEvent = (event: MatrixEvent) => {
      if (
        event.getRoomId?.() === room.roomId &&
        matchesEnum(event.getType?.(), StateEvent.RoomPowerLevels) &&
        powerEventReflectsGrant(event, targetUserId, level, eventId)
      ) {
        finish();
      }
    };
    const timer = setTimeout(finish, POWER_LEVEL_SYNC_TIMEOUT_MS);
    client.on(RoomStateEvent.Events, onStateEvent);
    if (powerEventReflectsGrant(getPowerLevelsEvent(room), targetUserId, level, eventId)) {
      finish();
    }
  });
};

export type ModeratorGrantResult =
  | { status: 'granted'; level: number }
  | { status: 'already-satisfied'; level: number }
  | { status: 'skipped' };

export class ModeratorGrantError extends Error {
  readonly causeError: unknown;
  readonly level: number;

  constructor(causeError: unknown, level: number) {
    super(
      causeError instanceof Error && causeError.message ? causeError.message : String(causeError)
    );
    this.causeError = causeError;
    this.level = level;
  }
}

/**
 * Serializes moderator grants per room, waits for each previous write to reach synced room state,
 * re-reads live power levels before writing (never lowering a target), and holds the room lock
 * until the write is reflected in synced `m.room.power_levels` (or a short timeout passes).
 */
export const runRoomModeratorGrant = (
  client: MatrixClient,
  room: Pick<Room, 'roomId' | 'isSpaceRoom' | 'getLiveTimeline'>,
  targetUserId: string,
  options?: { isInviteGone?: () => boolean }
): Promise<ModeratorGrantResult> => {
  const tracker = getTracker(client, room.roomId);
  tracker.inFlightCount += 1;
  tracker.pendingTargets.add(targetUserId);
  notifyTracker(tracker);

  let releaseDone = false;
  const release = () => {
    if (releaseDone) return;
    releaseDone = true;
    tracker.inFlightCount = Math.max(0, tracker.inFlightCount - 1);
    tracker.pendingTargets.delete(targetUserId);
    notifyTracker(tracker);
  };

  let releaseTail: () => void = () => undefined;
  const previousTail = tracker.tail;
  tracker.tail = new Promise<void>((resolve) => {
    releaseTail = resolve;
  });

  const finishAll = () => {
    release();
    releaseTail();
  };

  return previousTail.then(async (): Promise<ModeratorGrantResult> => {
    if (options?.isInviteGone?.()) {
      finishAll();
      return { status: 'skipped' };
    }
    const liveEvent = getPowerLevelsEvent(room);
    const liveRaw = liveEvent?.getContent() ?? {};
    const liveLevels = getPowersLevelFromMatrixEvent(liveEvent);
    const liveCreators = getLiveCreators(room);
    const liveMe = client.getSafeUserId();

    if (hasUnreadableGrantLevels(liveRaw, liveMe, targetUserId)) {
      finishAll();
      return { status: 'skipped' };
    }
    const liveLevel = moderatorGrantLevel(liveLevels);
    if (powerOf(targetUserId, liveLevels, liveCreators) >= liveLevel) {
      finishAll();
      return { status: 'already-satisfied', level: liveLevel };
    }
    if (!canOfferModeratorGrant(room, targetUserId, liveMe, liveLevels, liveCreators, liveRaw)) {
      finishAll();
      throw new ModeratorGrantError(new Error('Not allowed to change power levels'), liveLevel);
    }

    let response: { event_id?: string } | undefined;
    try {
      response = (await client.setPowerLevel(room.roomId, targetUserId, liveLevel)) as
        | { event_id?: string }
        | undefined;
    } catch (error) {
      finishAll();
      throw new ModeratorGrantError(error, liveLevel);
    }

    // Hold the per-room lock until synced m.room.power_levels reflects this change (or timeout),
    // while returning the HTTP confirmation to the caller immediately.
    void waitForPowerLevelSync(client, room, targetUserId, liveLevel, response?.event_id).finally(
      finishAll
    );
    return { status: 'granted', level: liveLevel };
  });
};
