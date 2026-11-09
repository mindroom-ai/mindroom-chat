import { useMemo } from 'react';
import type { useRoomMembers } from '../matrix/hooks/useRoomMembers';
import { isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import type { ComputerAgent } from './types';
import { useComputerApiUrl } from './useComputerApiUrl';
import { useBindsOpenIdTokens, type useRoomAgentServers } from './useAgentServers';

/** The computer agents of the room and the server each one runs on. */
export const useRoomComputer = (
  members: ReturnType<typeof useRoomMembers>,
  roomServers: ReturnType<typeof useRoomAgentServers>,
  myUserId: string
) => {
  const bindsOpenIdTokens = useBindsOpenIdTokens();
  const publishedComputer = bindsOpenIdTokens
    ? roomServers.find((server) => server.computer)?.apiUrl
    : undefined;
  const configuredApiUrl = useComputerApiUrl();
  const apiUrl = useComputerApiUrl(publishedComputer);

  const agents = useMemo<ComputerAgent[]>(() => {
    // With no server to reach, as when the user turned computers off, no agent's computer opens.
    if (!apiUrl) return [];
    const joinedAgents = members.filter(
      (member) =>
        member.membership === 'join' &&
        member.userId !== myUserId &&
        isMindroomAgentUserId(member.userId)
    );
    return joinedAgents.flatMap((member) => {
      const published = roomServers.find((server) => server.agentUserId === member.userId);
      const name = member.name ?? member.userId;
      if (configuredApiUrl) {
        // A configured server serves every agent but the ones whose MindRoom says it has none.
        return published && !published.computer ? [] : [{ userId: member.userId, name }];
      }
      // Here `apiUrl` is a published computer's server, offered only while the homeserver binds tokens.
      if (!published?.computer) return [];
      return [{ userId: member.userId, name, serverUrl: published.apiUrl }];
    });
  }, [apiUrl, configuredApiUrl, members, myUserId, roomServers]);

  return { agents, apiUrl: agents.length > 0 ? apiUrl : undefined };
};
