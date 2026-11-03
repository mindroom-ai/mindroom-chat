import { CREATOR_POWER_TAG } from './useMemberPowerTag';
import type { PowerLevelTag } from './usePowerLevelTags';

/** The tag shown for a room's privileged creators (room version 12 and later). */
export const useRoomCreatorsTag = (): PowerLevelTag => CREATOR_POWER_TAG;
