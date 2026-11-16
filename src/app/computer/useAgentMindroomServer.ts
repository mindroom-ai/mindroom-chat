import { useAtomValue } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { useClientConfig } from '../config/useClientConfig';
import { resolveComputerApiUrl } from './api';
import { trustedServerOrigins } from './agentServer';
import { computerServicePreferenceAtom } from './computerServiceSettings';
import { useOpenIdBinding, useRoomAgentServers } from './useAgentServers';

/**
 * Where what one agent asks the person for, such as a key, may go: an origin the deployment or the
 * person chose, never one only published state names.
 *
 * - The chosen origins: the deployment's `mindroom.computers.apiUrl` and `trustedApiUrls`, and the
 *   person's own server on this device (Settings, Computers; empty there turns computers off and
 *   names none).
 * - While the homeserver binds tokens and the agent published a server about itself, that server if
 *   it is a chosen one, else none: never the room's newest server, another agent's, or a fallback.
 *   Any `mindroom_` account can publish an origin, and a token bound to it is useless elsewhere, but
 *   a key is not, so a published origin counts here only when chosen, also in a client without a
 *   trusted list.
 * - Otherwise the deployment's server, else the person's.
 *
 * `pending` until the homeserver answers on binding tokens, which can change it.
 */
export const useAgentMindroomServer = (mx: MatrixClient, roomId: string, agentUserId: string) => {
  const binding = useOpenIdBinding();
  const { computers } = useClientConfig().mindroom ?? {};
  const preference = useAtomValue(computerServicePreferenceAtom);
  const published = useRoomAgentServers(mx.getRoom(roomId)).find(
    (server) => server.agentUserId === agentUserId
  )?.apiUrl;
  // An unusable deployment value counts as unset, as it does in Settings.
  const configured = resolveComputerApiUrl(computers?.apiUrl);
  const personal = preference ? resolveComputerApiUrl(preference) : undefined;
  let apiUrl = configured ?? personal;
  if (binding === true && published) {
    const chosen = trustedServerOrigins(computers) ?? new Set<string>();
    apiUrl = chosen.has(published) || published === personal ? published : undefined;
  }
  return { apiUrl, pending: binding === undefined };
};
