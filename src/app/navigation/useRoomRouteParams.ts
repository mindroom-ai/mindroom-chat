import { useLocation, useParams } from 'react-router-dom';
import { decodeRouteParam } from '../routes/pathUtils';

/**
 * Where each parameter sits in the address (`pathname.split('/')`), the same in every route of
 * paths.ts: `/:space/:room/:event?/`, `/home/:room/:event?/`, `/explore/:server/`,
 * `/login/:server?/`. A test holds the routes to it.
 */
export const ROUTE_PARAM_SEGMENT = {
  spaceIdOrAlias: 1,
  roomIdOrAlias: 2,
  eventId: 3,
  server: 2,
} as const;

type RouteParamName = keyof typeof ROUTE_PARAM_SEGMENT;

/** The space, room and event segments of a route, each as the ID or alias it names. */
export type RoomRouteParams = { spaceIdOrAlias?: string; roomIdOrAlias?: string; eventId?: string };

// Every row of a list reads the same address: the last one, split and decoded, serves them all.
let last: { pathname: string; segments: string[] } | undefined;

/**
 * The segment at `index` of `pathname` (router-relative, as written), decoded once. Malformed
 * percent-encoding stays as it is written.
 */
export const routeSegment = (pathname: string, index: number): string | undefined => {
  if (last?.pathname !== pathname) {
    last = { pathname, segments: pathname.split('/').map(decodeRouteParam) };
  }
  return last.segments[index];
};

/**
 * Route parameter `name`, from the address as written and decoded once, when the router matched
 * it. React Router's own parameters come decoded already, so decoding them again turns
 * `!sales%41:…` into `!salesA:…`, and they read an escaped `/` and a literal `%2F` in an ID
 * alike as `/`. The router decides which parameters there are: on `/home/create/` or a space's
 * lobby no segment names a room.
 */
export const useRouteParam = (name: RouteParamName): string | undefined => {
  const routed = useParams()[name];
  const { pathname } = useLocation();
  return routed === undefined ? undefined : routeSegment(pathname, ROUTE_PARAM_SEGMENT[name]);
};

/** The space, room and event the route names; see useRouteParam. */
export const useRoomRouteParams = (): RoomRouteParams => ({
  spaceIdOrAlias: useRouteParam('spaceIdOrAlias'),
  roomIdOrAlias: useRouteParam('roomIdOrAlias'),
  eventId: useRouteParam('eventId'),
});
