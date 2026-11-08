import { useMemo } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useRoomMembers } from '../matrix/hooks/useRoomMembers';
import { isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import { useClientConfig } from '../config/useClientConfig';
import { useBindsOpenIdTokens, useRoomAgentServers } from './useAgentServers';
import { resolveComputerApiUrl } from './api';

/**
 * The room's MindRoom server: the one the room's agents published while the homeserver binds
 * tokens to it (`discovered`), else the deployment's. Never this device's choice of server for
 * agents' computers, since call transcripts and plugin routes need the MindRoom whose router is in
 * the room. None in a room without a MindRoom agent.
 */
export const useRoomMindroomServer = (mx: MatrixClient, roomId: string) => {
  const bindsTokens = useBindsOpenIdTokens();
  // A room the client does not know yet has no agent; its members render again once it does.
  const published = useRoomAgentServers(mx.getRoom(roomId))[0]?.apiUrl;
  // An unusable deployment value counts as unset, as it does in Settings.
  const deploymentUrl = resolveComputerApiUrl(useClientConfig().mindroom?.computers?.apiUrl);
  const members = useRoomMembers(mx, roomId);
  const hasAgent = useMemo(
    () =>
      members.some(
        (member) => member.membership === 'join' && isMindroomAgentUserId(member.userId)
      ),
    [members]
  );
  const discovered = bindsTokens && !!published;
  const apiUrl = discovered ? published : deploymentUrl;
  return { apiUrl: hasAgent ? apiUrl : undefined, discovered };
};
