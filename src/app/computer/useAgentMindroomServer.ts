import type { MatrixClient } from 'matrix-js-sdk';
import { useClientConfig } from '../config/useClientConfig';
import { resolveComputerApiUrl } from './api';
import { trustedServerOrigins, trustedServers } from './agentServer';
import { useOpenIdBinding, useRoomAgentServers } from './useAgentServers';

/**
 * One agent's own MindRoom server in a room: the trusted origin (`trustedServerOrigins`) that agent
 * published about itself while the homeserver binds tokens, else the deployment's configured one.
 * Never another agent's published origin: in a room shared with someone else's MindRoom, the room's
 * newest server may belong to it, so what this agent asks for goes only to its own. `pending` until
 * the homeserver answers on binding tokens, which can change it.
 */
export const useAgentMindroomServer = (mx: MatrixClient, roomId: string, agentUserId: string) => {
  const binding = useOpenIdBinding();
  const { computers } = useClientConfig().mindroom ?? {};
  const published = trustedServers(
    useRoomAgentServers(mx.getRoom(roomId)),
    trustedServerOrigins(computers)
  ).find((server) => server.agentUserId === agentUserId)?.apiUrl;
  // An unusable deployment value counts as unset, as it does in Settings.
  const configured = resolveComputerApiUrl(computers?.apiUrl);
  return {
    apiUrl: binding === true && published ? published : configured,
    pending: binding === undefined,
  };
};
