import { useMatch } from 'react-router-dom';
import { SPACE_PATH } from '../routes/paths';
import { decodeRouteParam } from '../routes/pathUtils';
import { getCanonicalAliasRoomId, isRoomAlias, isRoomId } from '../matrix/matrix';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';

// One pattern object for every call: useMatch memoizes on it, and a new object each render would
// compile the path again in every row that navigates to rooms.
const SPACE_ROUTE_PATTERN = { path: SPACE_PATH, caseSensitive: true, end: false };

/**
 * The ID of the space the route is inside (`/:spaceIdOrAlias/...`), with a known alias resolved.
 * Undefined on the Home, Direct and other fixed sections.
 */
export const useSelectedSpace = (): string | undefined => {
  const mx = useMatrixClient();
  const match = useMatch(SPACE_ROUTE_PATTERN);
  const encoded = match?.params.spaceIdOrAlias;
  const spaceIdOrAlias = encoded ? decodeRouteParam(encoded) : undefined;
  if (!spaceIdOrAlias) return undefined;
  if (isRoomAlias(spaceIdOrAlias)) return getCanonicalAliasRoomId(mx, spaceIdOrAlias);
  return isRoomId(spaceIdOrAlias) ? spaceIdOrAlias : undefined;
};
