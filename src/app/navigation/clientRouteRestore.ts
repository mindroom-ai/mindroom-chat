// Room and space routes name a room by alias (`#room:server`) or by room ID (`!id:server`). The
// signed-in layout stores room ID routes as each session's last route, and swaps a visible alias
// route for its room ID route before the page renders, so no page flashes a join prompt while an
// alias resolves.

import type { MatrixClient } from 'matrix-js-sdk';
import { generatePath, matchPath } from 'react-router-dom';
import { getCanonicalAliasRoomId, isRoomAlias } from '../matrix/matrix';
import { decodeRouteParam } from '../routes/pathUtils';
import { DIRECT_ROOM_PATH, HOME_ROOM_PATH, SPACE_PATH, SPACE_ROOM_PATH } from '../routes/paths';

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

/**
 * The first room route that matches the whole pathname (case-sensitive, trailing slash
 * optional), with each segment decoded once. Malformed percent-encoding is kept as text.
 */
const matchRoomRoute = (pathname: string): RoomRoute | undefined => {
  for (const pattern of ROOM_ROUTE_PATTERNS) {
    const match = matchPath({ path: pattern, caseSensitive: true, end: true }, pathname);
    if (match) {
      const segments = Object.entries(match.params).flatMap(([name, encoded]) =>
        encoded === undefined ? [] : [{ name, text: decodeRouteParam(encoded) }]
      );
      return { pattern, segments };
    }
  }
  return undefined;
};

const namesRoom = (segment: Segment): boolean => segment.name !== EVENT_SEGMENT;

/** The route's path, each segment encoded on its own; `generatePath` drops the trailing slash. */
const buildPathname = (pattern: string, segments: Segment[]): string =>
  generatePath(
    pattern,
    Object.fromEntries(segments.map(({ name, text }) => [name, encodeURIComponent(text)]))
  );

/**
 * A room or space segment as a room ID from what the client already holds: an alias maps to the
 * room that carries it as its canonical or an alternative alias, and a segment that is no alias
 * stays as it is. Undefined for an alias no room carries. Only an alias makes it read the client.
 */
const knownRoomId = (mx: MatrixClient, roomIdOrAlias: string): string | undefined =>
  isRoomAlias(roomIdOrAlias) ? getCanonicalAliasRoomId(mx, roomIdOrAlias) : roomIdOrAlias;

/** The room ID the homeserver's room directory gives for an alias; else the alias, never a throw. */
const directoryRoomId = async (mx: MatrixClient, alias: string): Promise<string> => {
  try {
    const { room_id: roomId } = await mx.getRoomIdForAlias(alias);
    return roomId || alias;
  } catch {
    return alias;
  }
};

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
 * The pathname with room IDs for the visible route: like `canonicalizeSessionPathname`, and the
 * aliases the client does not know are looked up in the homeserver's room directory, all at once.
 * A failed lookup keeps its alias, so the promise rejects only when the client itself throws.
 */
export const resolveCanonicalizedPathname = async (
  mx: MatrixClient,
  pathname: string
): Promise<string> => {
  const route = matchRoomRoute(pathname);
  if (!route) return pathname;
  const segments = await Promise.all(
    route.segments.map(async (segment) =>
      namesRoom(segment)
        ? {
            ...segment,
            text: knownRoomId(mx, segment.text) ?? (await directoryRoomId(mx, segment.text)),
          }
        : segment
    )
  );
  return buildPathname(route.pattern, segments);
};
