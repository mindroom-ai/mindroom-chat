import type { MatrixClient, Room } from 'matrix-js-sdk';
import { getMatrixToRoom } from '../../../plugins/matrix-to';
import { getViaServers } from '../../../plugins/via-servers';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';

/**
 * A matrix.to link that opens the space in any Matrix client: by its canonical alias when it has
 * one, else by its ID with the servers that can route to it.
 */
export const getSpaceShareLink = (client: MatrixClient, space: Room): string => {
  const idOrAlias = getCanonicalAliasOrRoomId(client, space.roomId);
  return getMatrixToRoom(idOrAlias, idOrAlias.startsWith('#') ? undefined : getViaServers(space));
};
