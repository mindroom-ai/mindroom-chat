import type { MatrixEvent } from 'matrix-js-sdk';
import { readPowerLevel, type IPowerLevels } from '../hooks/usePowerLevels';

/**
 * Room state naming a bound MindRoom account, `{"user_id": "<Matrix ID>"}` at state key `""`.
 * The backend keeps existing bindings and lets the steward bind itself when needed.
 */
export const MINDROOM_ROUTER_STATE_EVENT = 'io.mindroom.router';

export const MINDROOM_ACCOUNTS_STATE_EVENT = 'io.mindroom.accounts';

/**
 * The account the room's state names, trusted only while ordinary members cannot write that state
 * (the level it takes is above `users_default`) and the account wrote it about itself and still
 * holds that level, so a binding written before the room tightened the level does not count.
 * A room creator (room version 12 on, `getRoomCreators`) outranks every level.
 * Undefined without the binding, with a malformed one, when anyone may
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

/** Only the bound account can vouch for other joined senders, using its own roster key. */
export const trustedRoomAccountIds = (
  boundUserId: string | undefined,
  roster: MatrixEvent | undefined,
  joined: ReadonlySet<string>,
  ignored: ReadonlySet<string>
): ReadonlySet<string> => {
  if (!boundUserId || ignored.has(boundUserId)) return new Set();
  const trusted = new Set([boundUserId]);
  if (roster?.getSender() !== boundUserId || roster.getStateKey() !== boundUserId) return trusted;
  const accounts: unknown = roster.getContent().accounts;
  if (Array.isArray(accounts)) {
    for (const id of accounts) {
      if (typeof id === 'string' && joined.has(id) && !ignored.has(id)) trusted.add(id);
    }
  }
  return trusted;
};
