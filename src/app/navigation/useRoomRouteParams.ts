import { useMemo } from 'react';
import { matchPath, useLocation, useParams } from 'react-router-dom';
import { decodeRouteParam } from '../routes/pathUtils';
import {
  ACTIVITY_ROOM_PATH,
  DIRECT_ROOM_PATH,
  HOME_ROOM_PATH,
  SPACE_PATH,
  SPACE_ROOM_PATH,
  THREADS_ROOM_PATH,
} from '../routes/paths';

/** The space, room and event segments of a route, each as the ID or alias it names. */
export type RoomRouteParams = { spaceIdOrAlias?: string; roomIdOrAlias?: string; eventId?: string };

// The routes with room, space and event segments, the fixed sections before the space routes
// that would also match them; a space's own pages (lobby, search) match the space's prefix.
const ROOM_ROUTE_PATTERNS = [
  ...[HOME_ROOM_PATH, DIRECT_ROOM_PATH, THREADS_ROOM_PATH, ACTIVITY_ROOM_PATH, SPACE_ROOM_PATH].map(
    (path) => ({ path, end: true })
  ),
  { path: SPACE_PATH, end: false },
];

/**
 * The space, room and event the route names, each segment read from the address as written and
 * decoded once. React Router's own parameters come decoded already, so decoding them again turns
 * `!sales%41:…` into `!salesA:…`, and they read an escaped `/` and a literal `%2F` in an ID
 * alike as `/`. Only the segments the router matched are given: `lobby` names no room.
 */
export const useRoomRouteParams = (): RoomRouteParams => {
  const { spaceIdOrAlias, roomIdOrAlias, eventId } = useParams();
  const { pathname } = useLocation();
  return useMemo(() => {
    const written =
      ROOM_ROUTE_PATTERNS.reduce<Record<string, string | undefined> | undefined>(
        (found, pattern) => found ?? matchPath(pattern, pathname)?.params,
        undefined
      ) ?? {};
    const once = (routed: string | undefined, name: keyof RoomRouteParams) => {
      if (routed === undefined) return undefined;
      const segment = written[name];
      return segment === undefined ? routed : decodeRouteParam(segment);
    };
    return {
      spaceIdOrAlias: once(spaceIdOrAlias, 'spaceIdOrAlias'),
      roomIdOrAlias: once(roomIdOrAlias, 'roomIdOrAlias'),
      eventId: once(eventId, 'eventId'),
    };
  }, [pathname, spaceIdOrAlias, roomIdOrAlias, eventId]);
};
