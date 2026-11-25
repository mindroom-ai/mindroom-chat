import { useAtomValue } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { useClientConfig } from '../config/useClientConfig';
import { resolveComputerApiUrl } from './api';
import { trustedServerOrigins, trustedServers } from './agentServer';
import { computerServicePreferenceAtom } from './computerServiceSettings';
import { useOpenIdBinding, useRoomAgentServers } from './useAgentServers';

/**
 * One agent's MindRoom server in a room, for requests that must reach that agent's own server
 * rather than the room's newest server or another agent's.
 *
 * - The chosen origins: the deployment's `mindroom.computers.apiUrl` and `trustedApiUrls`, and the
 *   person's own server on this device (Settings, Computers; empty there turns computers off and
 *   names none).
 * - While the homeserver binds tokens and the agent published a server about itself:
 *   - `trust: 'chosen'` (the default, used for secret-bearing writes such as keys): that server
 *     only if it is a chosen origin, else none. Any `mindroom_` account can publish an origin, and
 *     while a token bound to it is useless elsewhere, a key is not, so a published origin counts
 *     here only when chosen, even in a client without a trusted list.
 *   - `trust: 'room'` (used for read-only agent routes such as its profile): matches the
 *     room-server trust rule (`useRoomMindroomServer`). When the deployment sets neither a usable
 *     `apiUrl` nor `trustedApiUrls`, the agent's own published server is accepted unchecked (with
 *     the once-per-session warning); when a trust list is configured, the published server must be
 *     on that list or match the person's own server, else none.
 * - Otherwise (no published server from this agent, or tokens are not bound) the deployment's
 *   server, else the person's.
 *
 * `pending` until the homeserver answers on binding tokens, which can change it.
 */
export const useAgentMindroomServer = (
  mx: MatrixClient,
  roomId: string,
  agentUserId: string,
  options?: { trust?: 'chosen' | 'room' }
) => {
  const trust = options?.trust ?? 'chosen';
  const binding = useOpenIdBinding();
  const { computers } = useClientConfig().mindroom ?? {};
  const preference = useAtomValue(computerServicePreferenceAtom);
  const publishedServer = useRoomAgentServers(mx.getRoom(roomId)).find(
    (server) => server.agentUserId === agentUserId
  );
  // An unusable deployment value counts as unset, as it does in Settings.
  const configured = resolveComputerApiUrl(computers?.apiUrl);
  const personal = preference ? resolveComputerApiUrl(preference) : undefined;
  let apiUrl = configured ?? personal;
  if (binding === true && publishedServer) {
    const trusted = trustedServerOrigins(computers);
    const published = publishedServer.apiUrl;
    if (trust === 'room' && trusted === undefined) {
      apiUrl = trustedServers([publishedServer], undefined)[0]?.apiUrl;
    } else {
      const chosen = trusted ?? new Set<string>();
      apiUrl = chosen.has(published) || published === personal ? published : undefined;
    }
  }
  return { apiUrl, pending: binding === undefined };
};
