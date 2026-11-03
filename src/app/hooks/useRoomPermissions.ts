import { useMemo } from 'react';
import { IPowerLevels, PowerLevelAction, readPowerLevel } from './usePowerLevels';

type RoomPermissionsAPI = {
  /** Whether `userId` may send a message event of `eventType`. */
  event: (eventType: string, userId: string) => boolean;
  /** Whether `userId` may send a state event of `eventType`. */
  stateEvent: (eventType: string, userId: string) => boolean;
  /** Whether `userId` may invite, kick, ban, redact others' events, or see history. */
  action: (action: PowerLevelAction, userId: string) => boolean;
  /** Whether `userId` may trigger the `@room` notification (or another notification key). */












    creators.has(userId) ? Infinity : readPowerLevel.user(powerLevels, userId);

  return {
    event: (eventType, userId) => userLevel(userId) >= readPowerLevel.event(powerLevels, eventType),
    stateEvent: (eventType, userId) =>
      userLevel(userId) >= readPowerLevel.state(powerLevels, eventType),
    action: (action, userId) => userLevel(userId) >= readPowerLevel.action(powerLevels, action),
    notification: (key, userId) =>
      userLevel(userId) >= readPowerLevel.notification(powerLevels, key),
  };
};

/** Memoized {@link getRoomPermissionsAPI} for a component. */



): RoomPermissionsAPI =>
  useMemo(() => getRoomPermissionsAPI(creators, powerLevels), [creators, powerLevels]);
