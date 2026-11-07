import { useMemo } from 'react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { isMindroomAgentUserId } from '../../matrix/protocol/agentIdentity';
import { useBindsOpenIdTokens, useRoomAgentServers } from '../../computer/useAgentServers';
import { useComputerApiUrl } from '../../computer/useComputerApiUrl';

/**
 * The room's MindRoom server, found as for agents' computers: the one this device or the deployment
 * names, else the one the room's agents published (only while the homeserver binds tokens to it,
 * `discovered`). None in a room without a MindRoom agent.
 */
export const useTranscriptionServer = (mx: MatrixClient, room: Room) => {
  const bindsTokens = useBindsOpenIdTokens();
  const published = useRoomAgentServers(room)[0]?.apiUrl;
  const configured = useComputerApiUrl();
  const apiUrl = useComputerApiUrl(bindsTokens ? published : undefined);
  const members = useRoomMembers(mx, room.roomId);
  const hasAgent = useMemo(
    () =>
      members.some(
        (member) => member.membership === 'join' && isMindroomAgentUserId(member.userId)
      ),
    [members]
  );
  return { apiUrl: hasAgent ? apiUrl : undefined, discovered: !configured };
};
