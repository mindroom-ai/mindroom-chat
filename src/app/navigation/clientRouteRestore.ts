// Room and space routes as a session stores and opens them: an account's last path keeps room IDs
// so a renamed or removed alias never strands a return visit, and the shell swaps an incoming alias
// route for its room ID route before the page renders, so no page flashes a join prompt while an
// alias resolves.

import type { MatrixClient } from 'matrix-js-sdk';
import { generatePath, matchPath } from 'react-router-dom';
import { getCanonicalAliasRoomId, isRoomAlias, isRoomId } from '../matrix/matrix';
import { Membership } from '../matrix/types/room';
import { DIRECT_ROOM_PATH, HOME_ROOM_PATH, SPACE_PATH, SPACE_ROOM_PATH } from '../routes/paths';
import { ROUTE_PARAM_SEGMENT, routeSegment } from './useRoomRouteParams';

/**
 * The routes whose segments name rooms and spaces, in the order they are tried. The space room
 * pattern takes every path of two or three segments outside Home and Direct Messages, the space
 * lobby and search routes among them; their fixed second segment is not an alias, so they come
 * back unchanged.
 */
const ROOM_ROUTE_PATTERNS = [HOME_ROOM_PATH, DIRECT_ROOM_PATH, SPACE_ROOM_PATH, SPACE_PATH];

/** The optional segment that focuses an event. Every other segment names a room or space. */
const EVENT_SEGMENT = 'eventId';

/** One present segment of a matched route: its parameter name and its decoded text. */
type Segment = { name: string; text: string };

type RoomRoute = { pattern: string; segments: Segment[] };

type DirectoryLookup = { roomId: string; servers: string[] };

export type ResolvedCanonicalRoute = { pathname: string; search: string };

/**
 * The first room route that matches the whole pathname (case-sensitive, trailing slash
 * optional), with each segment as written decoded once, as the room page reads it (matchPath
 * reads a literal `%2F` as `/`). Malformed percent-encoding is kept as text.
 */
const matchRoomRoute = (pathname: string): RoomRoute | undefined => {
  for (const pattern of ROOM_ROUTE_PATTERNS) {
    const match = matchPath({ path: pattern, caseSensitive: true, end: true }, pathname);
    if (match) {
      const segments = Object.entries(match.params).flatMap(([name, encoded]) => {
        const text = routeSegment(
          pathname,
          ROUTE_PARAM_SEGMENT[name as keyof typeof ROUTE_PARAM_SEGMENT]
        );
        return encoded === undefined || text === undefined ? [] : [{ name, text }];
      });
      return { pattern, segments };
    }
  }
  return undefined;
};

const namesRoom = (segment: Segment): boolean => segment.name !== EVENT_SEGMENT;

/** The route's path; `generatePath` encodes each segment on its own and drops the trailing slash. */
const buildPathname = (pattern: string, segments: Segment[]): string =>
  generatePath(pattern, Object.fromEntries(segments.map(({ name, text }) => [name, text])));

/**
 * A room or space segment as a room ID from what the client already holds: an alias maps to the
 * room that carries it as its canonical or an alternative alias, and a segment that is no alias
 * stays as it is. Undefined for an alias no room carries. Only an alias makes it read the client.
 */
const knownRoomId = (mx: MatrixClient, roomIdOrAlias: string): string | undefined =>
  isRoomAlias(roomIdOrAlias) ? getCanonicalAliasRoomId(mx, roomIdOrAlias) : roomIdOrAlias;

/**
 * The room ID and routing servers the homeserver's room directory gives for an alias; else the
 * alias with no servers, never a throw.
 */
const directoryAlias = async (mx: MatrixClient, alias: string): Promise<DirectoryLookup> => {
  try {
    const { room_id: roomId, servers } = await mx.getRoomIdForAlias(alias);
    if (!roomId) return { roomId: alias, servers: [] };
    const via = Array.isArray(servers)
      ? servers.filter((server): server is string => typeof server === 'string' && server !== '')
      : [];
    return { roomId, servers: via };
  } catch {
    return { roomId: alias, servers: [] };
  }
};

const isAlreadyJoined = (mx: MatrixClient, roomId: string): boolean =>
  mx
    .getRooms()
    .find((room) => room.roomId === roomId)
    ?.getMyMembership?.() === Membership.Join;

const hasExplicitVia = (params: URLSearchParams): boolean =>
  params.getAll('viaServers').some((value) => value.split(',').some(Boolean)) ||
  params.getAll('via').some(Boolean);

/** Whether a room or space segment of the route is an alias. Event segments never count. */
export const pathnameContainsAliasRoute = (pathname: string): boolean =>
  matchRoomRoute(pathname)?.segments.some(
    (segment) => namesRoom(segment) && isRoomAlias(segment.text)
  ) ?? false;

/**
 * The pathname to store as the session's last route: each alias the client already knows becomes
 * its room ID, other aliases stay, without network access. Gives back the pathname unchanged when
 * it is no room or space route. Search and hash are the caller's to append.
 */
export const canonicalizeSessionPathname = (mx: MatrixClient, pathname: string): string => {
  const route = matchRoomRoute(pathname);
  if (!route) return pathname;
  const segments = route.segments.map((segment) =>
    namesRoom(segment)
      ? { ...segment, text: knownRoomId(mx, segment.text) ?? segment.text }
      : segment
  );
  return buildPathname(route.pattern, segments);
};

/**
 * The pathname and search with room IDs for the visible route: like `canonicalizeSessionPathname`,
 * and aliases the client does not know are looked up in the homeserver's room directory, all at
 * once. When the target room or space resolves through the directory with routing servers and the
 * account is not already joined to it, those servers are preserved in `viaServers` unless `search`
 * already provides `viaServers` or `via`. A failed lookup keeps its alias, so the promise rejects
 * only when the client itself throws.
 */
export const resolveCanonicalizedRoute = async (
  mx: MatrixClient,
  pathname: string,
  search = ''
): Promise<ResolvedCanonicalRoute> => {
  const route = matchRoomRoute(pathname);
  if (!route) return { pathname, search };
  const segments = await Promise.all(
    route.segments.map(async (segment) => {
      if (!namesRoom(segment)) return { ...segment, servers: [] as string[] };
      const local = knownRoomId(mx, segment.text);
      if (local !== undefined) return { ...segment, text: local, servers: [] as string[] };
      const { roomId, servers } = await directoryAlias(mx, segment.text);
      return { ...segment, text: roomId, servers };
    })
  );
  const resolvedPathname = buildPathname(route.pattern, segments);
  const target =
    segments.find(
      (segment) =>
        segment.name === 'roomIdOrAlias' && (isRoomId(segment.text) || isRoomAlias(segment.text))
    ) ?? segments.find((segment) => segment.name === 'spaceIdOrAlias');
  if (target && target.servers.length > 0 && !isAlreadyJoined(mx, target.text)) {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    if (!hasExplicitVia(params)) {
      params.set('viaServers', target.servers.join(','));
      return { pathname: resolvedPathname, search: `?${params.toString()}` };
    }
  }
  return { pathname: resolvedPathname, search };
};

/**
 * The pathname with room IDs for the visible route: like `canonicalizeSessionPathname`, and the
 * aliases the client does not know are looked up in the homeserver's room directory, all at once.
 * A failed lookup keeps its alias, so the promise rejects only when the client itself throws.
 */
export const resolveCanonicalizedPathname = async (
  mx: MatrixClient,
  pathname: string
): Promise<string> => (await resolveCanonicalizedRoute(mx, pathname)).pathname;
