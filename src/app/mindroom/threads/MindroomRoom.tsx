import React, { useMemo } from 'react';
import { Box, Line } from 'folds';
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

export function Room() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const room = useRoom();
  const mx = useMatrixClient();
  const roomSearchParams = useMemo(() => getRoomSearchParams(searchParams), [searchParams]);
  const { focusEvent, threadId } = roomSearchParams;

  const [isDrawer] = useSetting(settingsAtom, 'isPeopleDrawer');
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const screenSize = useScreenSizeContext();
  const powerLevels = usePowerLevels(room);
  const members = useRoomMembers(mx, room.roomId);
  const chat = useAtomValue(callChatAtom);
  const { viewMode } = useRoomViewMode(room.roomId);
  const routedThreadId = viewMode === 'classic' ? undefined : threadId;
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
            <RoomViewHeader callView />
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
              eventId={eventId}
              focusEventInRoom={focusEvent === '1'}
              threadId={routedThreadId}
              onThreadLoadError={handleThreadLoadError}
            />
          </>
        )}
        {!callView && screenSize === ScreenSize.Desktop && isDrawer && (
          <>
            <Line variant="Background" direction="Vertical" size="300" />
            <MembersDrawer key={room.roomId} room={room} members={members} />
          </>
        )}
      </Box>
    </PowerLevelsContextProvider>
  );
}
