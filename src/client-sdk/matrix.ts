// `@mindroom/client-sdk/matrix`, the client SDK's subpath for plugins that read the signed-in
// account's Matrix data (docs/architecture.md "Client plugins"): the account's client, a room's
// members as the app follows them, the app's answers to whether a MindRoom agent is among them and
// whether a user ID is an agent's, what a room lets a user do, and the URLs the app's media use.
// Like `/core` it only grows, and each addition raises CLIENT_PLUGIN_API_VERSION.
import type { Room } from 'matrix-js-sdk';
import { usePowerLevels } from '../app/matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../app/matrix/hooks/useRoomCreators';
import { useRoomPermissions as useRoomPermissionsOf } from '../app/matrix/hooks/useRoomPermissions';

export { useMatrixClient } from '../app/matrix/hooks/useMatrixClient';
export { useMediaAuthentication } from '../app/matrix/hooks/useMediaAuthentication';
export { useRoomMembers } from '../app/matrix/hooks/useRoomMembers';
export { mxcUrlToHttp } from '../app/matrix/mediaUrl';
export {
  hasActiveMindroomAgent,
  isMindroomAgentUserId,
} from '../app/matrix/protocol/agentIdentity';

/**
 * What `room` lets a user do, as the app answers it from the room's power levels and, from room
 * version 12, its creators, who outrank every level; it answers again when either changes.
 */
export const useRoomPermissions = (room: Room) =>
  useRoomPermissionsOf(useRoomCreators(room), usePowerLevels(room));
