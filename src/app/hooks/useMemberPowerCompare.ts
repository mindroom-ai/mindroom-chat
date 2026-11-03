import { useMemo } from 'react';
import { IPowerLevels, readPowerLevel } from './usePowerLevels';

/** Compares members' power; privileged creators outrank every power level. */
export const useMemberPowerCompare = (creators: Set<string>, powerLevels: IPowerLevels) =>
  useMemo(() => {
    const getPower = (userId: string): number =>
      creators.has(userId) ? Infinity : readPowerLevel.user(powerLevels, userId);
    return {
      getPower,
      /** Whether `userId` outranks `otherUserId`; creators never outrank each other. */
      hasMorePower: (userId: string, otherUserId: string): boolean =>
        getPower(userId) > getPower(otherUserId),
    };
  }, [creators, powerLevels]);
