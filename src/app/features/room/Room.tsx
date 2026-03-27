import React, { useCallback, useMemo } from 'react';
import { Box, Line } from 'folds';
import { useParams, useSearchParams } from 'react-router-dom';
import { isKeyHotkey } from 'is-hotkey';
import { RoomView } from './RoomView';
import { MembersDrawer } from './MembersDrawer';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { PowerLevelsContextProvider, usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoom } from '../../hooks/useRoom';
import { useKeyDown } from '../../hooks/useKeyDown';
import { markRoomAndThreadsAsRead, markThreadAsRead } from '../../utils/notifications';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { getRoomSearchParams } from '../../pages/pathSearchParam';

export function Room() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const room = useRoom();
  const mx = useMatrixClient();
  const roomSearchParams = useMemo(() => getRoomSearchParams(searchParams), [searchParams]);
  const { threadId } = roomSearchParams;

  const [isDrawer] = useSetting(settingsAtom, 'isPeopleDrawer');
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const screenSize = useScreenSizeContext();
  const powerLevels = usePowerLevels(room);
  const members = useRoomMembers(mx, room.roomId);

  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (isKeyHotkey('escape', evt)) {
          if (threadId) {
            markThreadAsRead(mx, room.roomId, threadId, hideActivity);
            return;
          }
          markRoomAndThreadsAsRead(mx, room.roomId, hideActivity);
        }
      },
      [hideActivity, mx, room.roomId, threadId]
    )
  );

  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <Box grow="Yes">
        <RoomView room={room} eventId={eventId} threadId={threadId} />
        {screenSize === ScreenSize.Desktop && isDrawer && (
          <>
            <Line variant="Background" direction="Vertical" size="300" />
            <MembersDrawer key={room.roomId} room={room} members={members} />
          </>
        )}
      </Box>
    </PowerLevelsContextProvider>
  );
}
