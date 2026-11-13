// `@mindroom/client-sdk/matrix`, the client SDK's subpath for plugins that read the signed-in
// account's Matrix data (docs/client-plugins.md "matrix"): the account's client, a room's
// members as the app follows them and the names it shows for them, the app's answers to whether a
// MindRoom agent is among them and whether a user ID is an agent's, what a room lets a user do, and
// the URLs the app's media use.
// Like `/core` it only grows, and each addition raises CLIENT_PLUGIN_API_VERSION.
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { getPowersLevelFromMatrixEvent, usePowerLevels } from '../app/matrix/hooks/usePowerLevels';
import { getRoomCreators, useRoomCreators } from '../app/matrix/hooks/useRoomCreators';
import {
  getRoomPermissionsAPI,
  useRoomPermissions as useAppRoomPermissions,
} from '../app/matrix/hooks/useRoomPermissions';
import { mxcUrlToHttp as appMxcUrlToHttp } from '../app/matrix/mediaUrl';
import { getStateEvent } from '../app/matrix/room';
import { StateEvent } from '../app/matrix/types/room';

export { useMatrixClient } from '../app/matrix/hooks/useMatrixClient';
export { useMediaAuthentication } from '../app/matrix/hooks/useMediaAuthentication';
export { useRoomMembers } from '../app/matrix/hooks/useRoomMembers';
export { getMemberDisplayName } from '../app/matrix/room';
export {
  hasActiveMindroomAgent,
  isMindroomAgentUserId,
} from '../app/matrix/protocol/agentIdentity';

/**
 * What `room` lets a user do, as the app answers it from the room's power levels and, from room
 * version 12, its creators, who outrank every level; it answers again when either changes.
 */
export const useRoomPermissions = (room: Room) =>
  useAppRoomPermissions(useRoomCreators(room), usePowerLevels(room));

/**
 * What `room` lets a user do, the answer `useRoomPermissions(room)` gives, read once from the room's
 * current state, for code outside a component; read it again for a later answer.
 */
export const getRoomPermissions = (room: Room) => {
  const createEvent = getStateEvent(room, StateEvent.RoomCreate);
  return getRoomPermissionsAPI(
    createEvent ? getRoomCreators(createEvent) : new Set<string>(),
    getPowersLevelFromMatrixEvent(getStateEvent(room, StateEvent.RoomPowerLevels))
  );
};

/**
 * The HTTP URL of an `mxc://` URI as the app's own media use it, a thumbnail when a size is given;
 * pass `useMediaAuthentication()` as `useAuthentication`.
 */
export const mxcUrlToHttp: (
  client: MatrixClient,
  mxcUrl: string,
  useAuthentication: boolean,
  width?: number,
  height?: number,
  method?: 'crop' | 'scale'
) => string | null = appMxcUrlToHttp;
