import { useMemo } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { SPACE_PATH } from '../routes/paths';
import { decodeRouteParam } from '../routes/pathUtils';
import { getCanonicalAliasRoomId, isRoomAlias, isRoomId } from '../matrix/matrix';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';

// One pattern object for every call; the match is memoized on the address, so the path does not
// compile again in every row that navigates to rooms.
const SPACE_ROUTE_PATTERN = { path: SPACE_PATH, caseSensitive: true, end: false };

/**
 * The ID of the space the route is inside (`/:spaceIdOrAlias/...`), with a known alias resolved.
 * Undefined on the Home, Direct and other fixed sections.
 */
export const useSelectedSpace = (): string | undefined => {
  const mx = useMatrixClient();
  // Matched on the address as written and decoded once: useMatch decodes it already, and reads a
  // literal `%2F` in an ID as `/`.
  const { pathname } = useLocation();
  const encoded = useMemo(
    () => matchPath(SPACE_ROUTE_PATTERN, pathname)?.params.spaceIdOrAlias,
    [pathname]
  );
  const spaceIdOrAlias = encoded ? decodeRouteParam(encoded) : undefined;
  if (!spaceIdOrAlias) return undefined;
  if (isRoomAlias(spaceIdOrAlias)) return getCanonicalAliasRoomId(mx, spaceIdOrAlias);
  return isRoomId(spaceIdOrAlias) ? spaceIdOrAlias : undefined;
};
