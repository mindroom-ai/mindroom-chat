// The servers the room directory names for a room an alias resolved to, kept in memory for each
// client: the page of a room that is not joined asks for its summary and joins through them. They
// stay out of the address, where a space and the room below it would share one list.

import type { MatrixClient } from 'matrix-js-sdk';

/** A directory may name every server of a room; a request carries the first few. */
const MAX_DIRECTORY_VIA_SERVERS = 5;

/** The rooms each client keeps servers for; the one remembered longest ago goes first. */
const MAX_TRACKED_ROOMS = 64;

const serversByClient = new WeakMap<MatrixClient, Map<string, string[]>>();

/** The first servers of a directory answer, each once and none empty; `[]` for no list. */
export const boundDirectoryViaServers = (servers: unknown): string[] => {
  if (!Array.isArray(servers)) return [];
  const bounded: string[] = [];
  for (const server of servers) {
    const name = typeof server === 'string' ? server.trim() : '';
    if (name && !bounded.includes(name)) bounded.push(name);
    if (bounded.length === MAX_DIRECTORY_VIA_SERVERS) break;
  }
  return bounded;
};

/**
 * Keeps the bounded servers of a directory answer for the room and gives them back. An answer
 * without servers keeps nothing and leaves what the room had.
 */
export const rememberDirectoryViaServers = (
  mx: MatrixClient,
  roomId: string,
  servers: unknown
): string[] => {
  const bounded = boundDirectoryViaServers(servers);
  if (bounded.length === 0 || !roomId) return bounded;
  let rooms = serversByClient.get(mx);
  if (!rooms) {
    rooms = new Map();
    serversByClient.set(mx, rooms);
  }
  // Set again, the room is the newest.
  rooms.delete(roomId);
  rooms.set(roomId, bounded);
  if (rooms.size > MAX_TRACKED_ROOMS) {
    const oldest = rooms.keys().next();
    if (!oldest.done) rooms.delete(oldest.value);
  }
  return [...bounded];
};

/** A copy of the servers the client's directory lookups gave for the room, if any. */
export const getDirectoryViaServers = (mx: MatrixClient, roomId: string): string[] | undefined => {
  const servers = serversByClient.get(mx)?.get(roomId);
  return servers ? [...servers] : undefined;
};
