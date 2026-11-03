import { useMatch } from 'react-router-dom';
import { SPACE_PATH } from '../../pages/paths';
import { decodeRouteParam } from '../../pages/pathUtils';
import { getCanonicalAliasRoomId, isRoomAlias, isRoomId } from '../../utils/matrix';
import { useMatrixClient } from '../useMatrixClient';

/**
 * The ID of the space the route is inside (`/:spaceIdOrAlias/...`), with a known alias resolved.
 * Undefined on the Home, Direct and other fixed sections.
 */
export const useSelectedSpace = (): string | undefined => {
  const mx = useMatrixClient();
  const match = useMatch({ path: SPACE_PATH, caseSensitive: true, end: false });
  const encoded = match?.params.spaceIdOrAlias;
  const spaceIdOrAlias = encoded ? decodeRouteParam(encoded) : undefined;
  if (!spaceIdOrAlias) return undefined;
  if (isRoomAlias(spaceIdOrAlias)) return getCanonicalAliasRoomId(mx, spaceIdOrAlias);
  return isRoomId(spaceIdOrAlias) ? spaceIdOrAlias : undefined;
};
