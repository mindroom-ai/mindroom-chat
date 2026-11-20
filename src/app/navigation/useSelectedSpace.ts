import { useLocation } from 'react-router-dom';
import { getCanonicalAliasRoomId, isRoomAlias, isRoomId } from '../matrix/matrix';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { ROUTE_PARAM_SEGMENT, routeSegment } from './useRoomRouteParams';

/**
 * The ID of the space the route is inside (`/:spaceIdOrAlias/...`), with a known alias resolved.
 * Undefined on the Home, Direct and other fixed sections. The first segment is read as written
 * and decoded once, from the parse every row of a list shares: useMatch decodes it already, and
 * reads a literal `%2F` in an ID as `/`.
 */
export const useSelectedSpace = (): string | undefined => {
  const mx = useMatrixClient();
  const spaceIdOrAlias = routeSegment(useLocation().pathname, ROUTE_PARAM_SEGMENT.spaceIdOrAlias);
  if (!spaceIdOrAlias) return undefined;
  if (isRoomAlias(spaceIdOrAlias)) return getCanonicalAliasRoomId(mx, spaceIdOrAlias);
  return isRoomId(spaceIdOrAlias) ? spaceIdOrAlias : undefined;
};
