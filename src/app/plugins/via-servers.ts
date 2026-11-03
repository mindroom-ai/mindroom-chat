import { EventTimeline, type Room } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';

/** How many servers a permalink names; the Matrix specification recommends three. */
const MAX_VIA_SERVERS = 3;

// Room versions 1 to 11 give moderators power level 50; the highest such user is a good bet to
// stay in the room.
const MIN_ROUTING_POWER_LEVEL = 50;

const IP_LITERAL = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])(?::\d+)?$/i;

const serverOf = (userId: string): string | undefined => {
  const separator = userId.indexOf(':');
  return separator > 0 ? userId.slice(separator + 1) : undefined;
};

const globToRegExp = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .split('')
      .map((character) => {
        if (character === '*') return '.*';
        if (character === '?') return '.';
        return character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('')}$`,
    'i'
  );

const toPatterns = (value: unknown): RegExp[] =>
  Array.isArray(value)
    ? value.filter((glob): glob is string => typeof glob === 'string').map(globToRegExp)
    : [];

/**
 * The servers a permalink to the room should route through ("via"), as the Matrix specification
 * suggests in "Routing": the server of the highest-powered member, then the servers with the
 * most joined members, without IP literals or servers the room's ACL denies, three at most.
 */
export const getViaServers = (room: Room): string[] => {
  const state = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
  if (!state) return [];

  const acl = state.getStateEvents(StateEvent.RoomServerAcl, '')?.getContent();
  const allow = toPatterns(acl?.allow);
  const deny = toPatterns(acl?.deny);
  const isUsable = (server: string): boolean =>
    !IP_LITERAL.test(server) &&
    !deny.some((pattern) => pattern.test(server)) &&
    (acl === undefined || allow.some((pattern) => pattern.test(server)));

  const joined = state.getMembers().filter((member) => member.membership === 'join');
  const population = new Map<string, number>();
  joined.forEach((member) => {
    const server = serverOf(member.userId);
    if (server && isUsable(server)) population.set(server, (population.get(server) ?? 0) + 1);
  });

  const via: string[] = [];
  const users = state.getStateEvents(StateEvent.RoomPowerLevels, '')?.getContent()?.users;
  if (users && typeof users === 'object') {
    let highest: { server: string; level: number } | undefined;
    joined.forEach((member) => {
      const level = (users as Record<string, unknown>)[member.userId];
      const server = serverOf(member.userId);
      if (typeof level !== 'number' || level < MIN_ROUTING_POWER_LEVEL || !server) return;
      if (!population.has(server)) return;
      if (!highest || level > highest.level) highest = { server, level };
    });
    if (highest) via.push(highest.server);
  }

  [...population.entries()]
    .sort(
      ([serverA, countA], [serverB, countB]) => countB - countA || serverA.localeCompare(serverB)
    )
    .forEach(([server]) => {
      if (via.length < MAX_VIA_SERVERS && !via.includes(server)) via.push(server);
    });
  return via;
};
