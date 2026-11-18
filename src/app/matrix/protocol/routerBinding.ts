import type { MatrixEvent } from 'matrix-js-sdk';
import { readPowerLevel, type IPowerLevels } from '../hooks/usePowerLevels';

/**
 * Room state naming the room's MindRoom router, `{"user_id": "<router Matrix ID>"}` at state key
 * `""`, which the router publishes where it may (MindRoom's `matrix/event_types.py`).
 */
export const MINDROOM_ROUTER_STATE_EVENT = 'io.mindroom.router';

/**
 * The router the room's state names, trusted only while ordinary members cannot write that state
 * (the level it takes is above `users_default`) and the router wrote it about itself and still
 * holds that level, so a binding written before the room tightened the level does not count.
 * A room creator (room version 12 on, `getRoomCreators`) outranks every level, as the router is
 * in the rooms it creates. Undefined without the binding, with a malformed one, or when anyone
 * may write it.
 */
export const trustedRouterUserId = (
  binding: MatrixEvent | undefined,
  powerLevels: IPowerLevels,
  creators: ReadonlySet<string> = new Set()
): string | undefined => {
  const userId: unknown = binding?.getContent().user_id;
  if (typeof userId !== 'string' || userId === '' || binding?.getSender() !== userId) {
    return undefined;
  }
  const writeLevel = readPowerLevel.state(powerLevels, MINDROOM_ROUTER_STATE_EVENT);
  return writeLevel > (powerLevels.users_default ?? 0) &&
    (creators.has(userId) || readPowerLevel.user(powerLevels, userId) >= writeLevel)
    ? userId
    : undefined;
};
