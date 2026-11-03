import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Box } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoom } from '../../hooks/useRoom';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { usePowerLevels, PowerLevelsContextProvider } from '../../hooks/usePowerLevels';
import { useKeyDown } from '../../hooks/useKeyDown';
import { MembersDrawer } from '../../features/room/MembersDrawer';
import { markRoomAndThreadsAsRead, markThreadAsRead } from '../notifications/readReceipts';
import { isMindroomAgentUserId } from '../matrix/agentIdentity';
import { useMembersDrawer } from '../sidebar/useMembersDrawer';
import { ResizableMembersPanel } from '../sidebar/ResizableMembersPanel';
import { ComputerPanel } from '../computer/ComputerPanel';
import type { ComputerAgent } from '../computer/types';
import { useComputerApiUrl } from '../computer/useComputerApiUrl';
import { useBindsOpenIdTokens, useRoomMindroomServers } from '../server/useMindroomServers';
import { removeRecentThread } from '../recent-threads/recentThreads';
import { RoomView } from './MindroomRoomView';

/** The computer agents of the room and the server each one runs on. */
const useRoomComputer = (
  members: ReturnType<typeof useRoomMembers>,
  roomServers: ReturnType<typeof useRoomMindroomServers>,
  myUserId: string
) => {
  const bindsOpenIdTokens = useBindsOpenIdTokens();
  const publishedComputer = bindsOpenIdTokens
    ? roomServers.find((server) => server.computer)?.apiUrl
    : undefined;
  const configuredApiUrl = useComputerApiUrl();
  const discoveredApiUrl = useComputerApiUrl(publishedComputer);
  const apiUrl = configuredApiUrl ?? discoveredApiUrl;

  const agents = useMemo<ComputerAgent[]>(() => {
    const joinedAgents = members.filter(
      (member) =>
        member.membership === 'join' &&
        member.userId !== myUserId &&
        isMindroomAgentUserId(member.userId)
    );
    return joinedAgents.flatMap((member) => {
      const published = roomServers.find((server) => server.agentUserId === member.userId);
      const name = (member as { name?: string }).name ?? member.userId;
      if (configuredApiUrl) {
        // A configured server serves every agent but the ones whose MindRoom says it has none.
        return published && !published.computer ? [] : [{ userId: member.userId, name }];
      }
      if (!bindsOpenIdTokens || !published?.computer) return [];
      return [{ userId: member.userId, name, serverUrl: published.apiUrl }];
    });
  }, [bindsOpenIdTokens, configuredApiUrl, members, myUserId, roomServers]);

  return { agents, apiUrl: agents.length > 0 ? apiUrl : undefined };
};

/** A room: its view, the members panel, and the agents' computer beside it. */





  const threadId = searchParams.get('threadId') ?? undefined;
  const powerLevels = usePowerLevels(room);
  const members = useRoomMembers(mx, room.roomId);
  const [membersOpen, setMembersOpen] = useMembersDrawer();
  const myUserId = mx.getSafeUserId();

  const hasMindroomAgents = useMemo(
    () =>
      members.some(
        (member) => member.membership === 'join' && isMindroomAgentUserId(member.userId)
      ),
    [members]
  );
  const joinRequestCount = useMemo(
    () => members.filter((member) => member.membership === 'knock').length,
    [members]
  );

  const roomServers = useRoomMindroomServers(room);
  const computer = useRoomComputer(members, roomServers, myUserId);
  const [computerOpen, setComputerOpen] = useState(false);
  const [computerExpanded, setComputerExpanded] = useState(false);
  useEffect(() => {
    if (!computer.apiUrl) setComputerOpen(false);
  }, [computer.apiUrl]);

  // A thread that cannot load leaves the recently opened list; the route itself stays.
  const onThreadLoadError = useCallback(
    (failed: string) => removeRecentThread(room.roomId, failed),







      (evt: KeyboardEvent) => {
        if (evt.key !== 'Escape' || evt.defaultPrevented) return;
        if (threadId) markThreadAsRead(mx, room.roomId, threadId, false);
        else markRoomAndThreadsAsRead(mx, room.roomId, false);
      },
      [mx, room.roomId, threadId]
    )
  );

  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <Box grow="Yes" style={{ minWidth: 0, minHeight: 0 }}>
        <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
          <RoomView
            room={room}
            eventId={eventId}
            threadId={threadId}
            hasMindroomAgents={hasMindroomAgents}
            joinRequestCount={joinRequestCount}
            computerAvailable={!!computer.apiUrl}
            computerOpen={computerOpen}
            onComputerToggle={() => setComputerOpen((open) => !open)}
            onThreadLoadError={onThreadLoadError}
          />
        </Box>
        {computerOpen && computer.apiUrl && (
          <Box
            data-testid="resizable-computer-panel"
            direction="Column"
            shrink="No"
            style={{ width: computerExpanded ? '60%' : '28rem', minWidth: 0 }}
          >
            <ComputerPanel
              agents={computer.agents}
              apiUrl={computer.apiUrl}
              mx={mx}
              roomId={room.roomId}
              threadId={threadId}
              onClose={() => setComputerOpen(false)}
              expanded={computerExpanded}
              onToggleExpanded={() => setComputerExpanded((expanded) => !expanded)}
            />
          </Box>
        )}
        {membersOpen && (
          <ResizableMembersPanel onClose={() => setMembersOpen(false)}>
            <MembersDrawer key={room.roomId} room={room} members={members} />
          </ResizableMembersPanel>
        )}
      </Box>
    </PowerLevelsContextProvider>
  );
}
