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
 * in the rooms it creates. Undefined without the binding, with a malformed one, when anyone may
 * write it, or when `rawPowerLevels` (the `m.room.power_levels` content) gives a level it reads
 * as something other than a number, which the shared parser would drop for a default.
 */
export const trustedRouterUserId = (
  binding: MatrixEvent | undefined,
  powerLevels: IPowerLevels,
  creators: ReadonlySet<string> = new Set(),
  rawPowerLevels: Record<string, unknown> = {}
): string | undefined => {
  const userId: unknown = binding?.getContent().user_id;
  if (typeof userId !== 'string' || userId === '' || binding?.getSender() !== userId) {
    return undefined;
  }
  const entry = (map: unknown, key: string): unknown =>
    map && typeof map === 'object' ? (map as Record<string, unknown>)[key] : undefined;
  const read = [
    rawPowerLevels.state_default,
    rawPowerLevels.users_default,
    entry(rawPowerLevels.events, MINDROOM_ROUTER_STATE_EVENT),
    entry(rawPowerLevels.users, userId),
  ];
  if (read.some((level) => level !== undefined && typeof level !== 'number')) return undefined;
  const writeLevel = readPowerLevel.state(powerLevels, MINDROOM_ROUTER_STATE_EVENT);
  return writeLevel > (powerLevels.users_default ?? 0) &&
    (creators.has(userId) || readPowerLevel.user(powerLevels, userId) >= writeLevel)
    ? userId
    : undefined;
};
