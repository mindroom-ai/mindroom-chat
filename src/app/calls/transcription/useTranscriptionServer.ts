import { useMemo } from 'react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { isMindroomAgentUserId } from '../../matrix/protocol/agentIdentity';
import { useClientConfig } from '../../config/useClientConfig';
import { useBindsOpenIdTokens, useRoomAgentServers } from '../../computer/useAgentServers';
import { resolveComputerApiUrl } from '../../computer/api';

/**
 * The room's MindRoom server: the one the room's agents published while the homeserver binds
 * tokens to it (`discovered`), else the deployment's. Never this device's choice of server for
 * agents' computers, since transcription needs the MindRoom whose router is in the room. None in a
 * room without a MindRoom agent.
 */
export const useTranscriptionServer = (mx: MatrixClient, room: Room) => {
  const bindsTokens = useBindsOpenIdTokens();
  const published = useRoomAgentServers(room)[0]?.apiUrl;
  // An unusable deployment value counts as unset, as it does in Settings.
  const deploymentUrl = resolveComputerApiUrl(useClientConfig().mindroom?.computers?.apiUrl);
  const members = useRoomMembers(mx, room.roomId);
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
