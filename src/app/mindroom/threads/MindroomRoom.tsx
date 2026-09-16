import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Line } from 'folds';
import { KnownMembership } from 'matrix-js-sdk';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { RoomView } from './MindroomRoomView';
import { MembersDrawer } from '../../features/room/MembersDrawer';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { PowerLevelsContextProvider, usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoom } from '../../hooks/useRoom';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { CallView } from '../../features/call/CallView';
import { RoomViewHeader } from './MindroomRoomViewHeader';
import { callChatAtom } from '../../state/callEmbed';
import { MindroomCallChatView } from './MindroomCallChatView';
import { getRoomSearchParams } from '../../pages/pathSearchParam';
import { useRoomThreadRouteGuards } from './useRoomThreadRouteGuards';
import { useRoomEscapeReadReceipts } from './useRoomEscapeReadReceipts';
import { useRoomViewMode } from './useRoomViewMode';
import { useThreadRootEvent } from './useThreadRootEvent';
import { hasActiveMindroomAgent, isMindroomAgentUserId } from '../matrix/agentIdentity';
import { MembershipFilter } from '../../hooks/useMemberFilter';
import { useClientConfig } from '../../hooks/useClientConfig';
import { resolveComputerApiUrl } from '../computer/api';
import { ComputerPanel } from '../computer/ComputerPanel';
import type { ComputerAgent } from '../computer/types';
import { ResizableMembersPanel } from '../sidebar/ResizableMembersPanel';
import { useMembersDrawer } from '../sidebar/useMembersDrawer';

export function Room() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const room = useRoom();
  const mx = useMatrixClient();
  const roomSearchParams = useMemo(() => getRoomSearchParams(searchParams), [searchParams]);
  const { focusEvent, threadId } = roomSearchParams;

  const [isDrawer, setPeopleDrawer] = useMembersDrawer();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const screenSize = useScreenSizeContext();
  const powerLevels = usePowerLevels(room);
  const members = useRoomMembers(mx, room.roomId);
  const clientConfig = useClientConfig();
  const computerApiUrl = resolveComputerApiUrl(clientConfig.mindroom?.computers?.apiUrl);
  const computerAgents = useMemo<ComputerAgent[]>(
    () =>
      members
        .filter(
          (member) =>
            member.membership === KnownMembership.Join && isMindroomAgentUserId(member.userId)
        )
        .map((member) => ({
          userId: member.userId,
          name: member.name?.trim() || member.userId,
        })),
    [members]
  );
  const [computerOpen, setComputerOpen] = useState(false);
  const computerAvailable = !!computerApiUrl && computerAgents.length > 0;
  const effectiveComputerOpen = computerOpen && computerAvailable;
  const hasMindroomAgents = hasActiveMindroomAgent(members);
  const joinRequestCount = useMemo(
    () => members.filter(MembershipFilter.filterKnocked).length,
    [members]
  );
  const chat = useAtomValue(callChatAtom);
  const { viewMode } = useRoomViewMode(room.roomId);
  const routedThreadId = viewMode === 'classic' ? undefined : threadId;
  const computerThreadId = useThreadRootEvent(room, routedThreadId);
  const continuationReady =
    !routedThreadId ||
    computerThreadId !== routedThreadId ||
    !!room.findEventById(routedThreadId) ||
    !!room.getThread(routedThreadId)?.rootEvent;
  useEffect(() => {
    if (!computerAvailable) setComputerOpen(false);
  }, [computerAvailable]);
  useEffect(() => {
    setComputerOpen(false);
  }, [mx, room.roomId, routedThreadId]);

  const handleComputerToggle = useCallback(() => {
    setComputerOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) setPeopleDrawer(false);
      return nextOpen;
    });
  }, [setPeopleDrawer]);
  const handleThreadLoadError = useRoomThreadRouteGuards({
    eventId,
    roomId: room.roomId,
    threadId,
    viewMode,
  });
  useRoomEscapeReadReceipts({ hideActivity, roomId: room.roomId, threadId: routedThreadId });

  const callView = room.isCallRoom();

  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <Box grow="Yes">
        {callView && (screenSize === ScreenSize.Desktop || !chat) && (
          <Box grow="Yes" direction="Column">
            <RoomViewHeader callView hasMindroomAgents={hasMindroomAgents} />
            <Box grow="Yes">
              <CallView />
            </Box>
          </Box>
        )}
        {!callView && (
          <Box grow="Yes" direction="Column">
            <Box grow="Yes">
              <RoomView
                room={room}
                computerAvailable={computerAvailable}
                computerOpen={effectiveComputerOpen}
                onComputerToggle={handleComputerToggle}
                hasMindroomAgents={hasMindroomAgents}
                joinRequestCount={joinRequestCount}
                eventId={eventId}
                focusEventInRoom={focusEvent === '1'}
                threadId={routedThreadId}
                onThreadLoadError={handleThreadLoadError}
              />
            </Box>
          </Box>
        )}

        {callView && chat && (
          <>
            {screenSize === ScreenSize.Desktop && (
              <Line variant="Background" direction="Vertical" size="300" />
            )}
            <MindroomCallChatView
              room={room}
              hasMindroomAgents={hasMindroomAgents}
              eventId={eventId}
              focusEventInRoom={focusEvent === '1'}
              threadId={routedThreadId}
              onThreadLoadError={handleThreadLoadError}
            />
          </>
        )}
        {!callView && effectiveComputerOpen && computerApiUrl && (
          <>
            {screenSize === ScreenSize.Desktop && (
              <Line variant="Background" direction="Vertical" size="300" />
            )}
            <ComputerPanel
              agents={computerAgents}
              apiUrl={computerApiUrl}
              mx={mx}
              roomId={room.roomId}
              threadId={computerThreadId}
              continuationReady={continuationReady}
              onClose={() => setComputerOpen(false)}
            />
          </>
        )}
        {!callView && isDrawer && !effectiveComputerOpen && (
          <ResizableMembersPanel key={room.roomId} onClose={() => setPeopleDrawer(false)}>
            <MembersDrawer room={room} members={members} />
          </ResizableMembersPanel>
        )}
      </Box>
    </PowerLevelsContextProvider>
  );
}
