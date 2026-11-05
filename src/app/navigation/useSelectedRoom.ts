import { useParams } from 'react-router-dom';
import { decodeRouteParam } from '../routes/pathUtils';
import { getCanonicalAliasRoomId, isRoomAlias } from '../matrix/matrix';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';

/**
 * The ID of the room the route opens (`:roomIdOrAlias`), with a known alias resolved to its
 * room. Undefined on routes without a room or for an alias no joined room claims.
 */
export const useSelectedRoom = (): string | undefined => {
  const mx = useMatrixClient();
  const { roomIdOrAlias: encoded } = useParams();
  const roomIdOrAlias = encoded ? decodeRouteParam(encoded) : undefined;
  if (!roomIdOrAlias) return undefined;
  return isRoomAlias(roomIdOrAlias) ? getCanonicalAliasRoomId(mx, roomIdOrAlias) : roomIdOrAlias;
};
