import { useMemo } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMemberListSettled } from '../matrix/hooks/useMemberListSettled';
import { useRoomMembers } from '../matrix/hooks/useRoomMembers';
import { isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import { useClientConfig } from '../config/useClientConfig';
import { useOpenIdBinding, useRoomAgentServers } from './useAgentServers';
import { resolveComputerApiUrl } from './api';
import { trustedServerOrigins, trustedServers } from './agentServer';

/**
 * The room's MindRoom server: the one the room's agents published while the homeserver binds
 * tokens to it and it is trusted (`trustedServerOrigins`), else the deployment's. Never this
 * device's choice of server for agents' computers, since call transcripts and plugin routes need
 * the MindRoom whose router is in the room. None in a room without a MindRoom agent. `pending`
 * while the room's member list or the homeserver's answer on binding tokens is still out, which
 * can change it.
 */
export const useRoomMindroomServer = (mx: MatrixClient, roomId: string) => {
  const binding = useOpenIdBinding();
  // A room the client does not know yet has no agent; its members render again once it does.
  const room = mx.getRoom(roomId);
  const { computers } = useClientConfig().mindroom ?? {};
  const trusted = trustedServerOrigins(computers);
  const published = trustedServers(useRoomAgentServers(room), trusted)[0]?.apiUrl;
  // An unusable deployment value counts as unset, as it does in Settings.
  const deploymentUrl = resolveComputerApiUrl(computers?.apiUrl);
  const members = useRoomMembers(mx, roomId);
  const membersSettled = useMemberListSettled(room);
  const hasAgent = useMemo(
    () =>
      members.some(
        (member) => member.membership === 'join' && isMindroomAgentUserId(member.userId)
      ),
    [members]
  );
  const apiUrl = binding === true && published ? published : deploymentUrl;
  return {
    apiUrl: hasAgent ? apiUrl : undefined,
    pending: binding === undefined || !membersSettled,
  };
};
