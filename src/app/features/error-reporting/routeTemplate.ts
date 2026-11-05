import { matchRoutes } from 'react-router-dom';
import * as paths from '../../pages/paths';

// Every route pattern of the app (pages/paths.ts), for React Router to rank as it does itself.
const ROUTES = Object.values(paths)
  .filter((path): path is string => typeof path === 'string' && path.startsWith('/'))
  .map((path) => ({ path }));

export type RouteMatch = {
  /** The route pattern, such as `/home/:roomIdOrAlias/:eventId?/`, with `?threadId=:eventId`. */
  template: string;
  /** The room ID or alias of a room route; for comparing routes only, it never leaves the device. */
  room?: string;
};

/**
 * Which page `pathname` (and `search`) shows, with the room, event, space and server in it
 * replaced by the route's parameter names.
 */
export const matchRoute = (pathname: string, search = ''): RouteMatch => {
  const match = matchRoutes(ROUTES, pathname)?.[0];
  const thread = new URLSearchParams(search).has('threadId') ? '?threadId=:eventId' : '';
  return {
    template: `${match?.route.path ?? '/<unknown>/'}${thread}`,
    room: match?.params.roomIdOrAlias,
  };
};
