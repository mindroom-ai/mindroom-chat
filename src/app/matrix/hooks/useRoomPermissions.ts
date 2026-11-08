import { useMemo } from 'react';
import { IPowerLevels, PowerLevelAction, readPowerLevel } from './usePowerLevels';

type RoomPermissions = {
  /** Whether `userId` may send a message event of `eventType`. */
  event: (eventType: string, userId: string) => boolean;
  /** Whether `userId` may send a state event of `eventType`. */
  stateEvent: (eventType: string, userId: string) => boolean;
  /** Whether `userId` may invite, kick, ban, or redact others' events. */
  action: (action: PowerLevelAction, userId: string) => boolean;
  /** Whether `userId` may trigger the `@room` notification (or another notification key). */
  notification: (key: string, userId: string) => boolean;
};

/**
 * Answers permission questions from a room's power levels. Room creators (room version 12 and
 * later, Matrix spec: room version 12 "creators") outrank every power level.
 */
export function getRoomPermissionsAPI(
  creatorIds: ReadonlySet<string>,
  levels: IPowerLevels
): RoomPermissions {
  const levelOf = (userId: string) =>
    creatorIds.has(userId) ? Infinity : readPowerLevel.user(levels, userId);

  return {
    event: (eventType, userId) => levelOf(userId) >= readPowerLevel.event(levels, eventType),
    stateEvent: (eventType, userId) => levelOf(userId) >= readPowerLevel.state(levels, eventType),
    action: (action, userId) => levelOf(userId) >= readPowerLevel.action(levels, action),
    notification: (key, userId) => levelOf(userId) >= readPowerLevel.notification(levels, key),
  };
}

/** Memoized {@link getRoomPermissionsAPI} for a component. */
export function useRoomPermissions(
  creatorIds: ReadonlySet<string>,
  levels: IPowerLevels
): RoomPermissions {
  return useMemo(() => getRoomPermissionsAPI(creatorIds, levels), [creatorIds, levels]);
}
