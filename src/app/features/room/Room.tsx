import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, Line } from 'folds';
import { useParams, useSearchParams } from 'react-router-dom';
import { isKeyHotkey } from 'is-hotkey';
import { useAtomValue } from 'jotai';
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
import { CallView } from '../call/CallView';
import { RoomViewHeader } from './RoomViewHeader';
import { callChatAtom } from '../../state/callEmbed';
import { CallChatView } from './CallChatView';
import { getRoomSearchParams } from '../../pages/pathSearchParam';
import {
  clearLastOpenThread,
  getLastOpenThread,
  setLastOpenThread,
} from '../../state/lastOpenThread';
import { bumpRecentThread, removeRecentThread } from '../../state/recentThreads';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';

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
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const previousRoomIdRef = useRef(room.roomId);
  const previousThreadIdRef = useRef<string | undefined>(threadId);
  const attemptedRestoreRef = useRef<string>();
  const autoRestoredThreadIdRef = useRef<string>();

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

  const callView = room.isCallRoom();

  useEffect(() => {
    if (!threadId) return;
    setLastOpenThread(room.roomId, threadId);
    bumpRecentThread(room.roomId, threadId);
  }, [room.roomId, threadId]);

  useEffect(() => {
    const previousRoomId = previousRoomIdRef.current;
    const previousThreadId = previousThreadIdRef.current;

    if (previousRoomId === room.roomId && previousThreadId && !threadId) {
      clearLastOpenThread(room.roomId);
      if (autoRestoredThreadIdRef.current === previousThreadId) {
        autoRestoredThreadIdRef.current = undefined;
      }
    }

    previousRoomIdRef.current = room.roomId;
    previousThreadIdRef.current = threadId;
  }, [room.roomId, threadId]);

  useEffect(() => {
    if (threadId || eventId) return;

    const savedThreadId = getLastOpenThread(room.roomId);
    if (!savedThreadId) return;

    const restoreKey = `${room.roomId}|${savedThreadId}`;
    if (attemptedRestoreRef.current === restoreKey) return;

    attemptedRestoreRef.current = restoreKey;
    autoRestoredThreadIdRef.current = savedThreadId;
    navigateRoomThread(room.roomId, savedThreadId, undefined, { replace: true });
  }, [eventId, navigateRoomThread, room.roomId, threadId]);

  const handleThreadLoadError = useCallback(
    (failedThreadId: string) => {
      if (getLastOpenThread(room.roomId) === failedThreadId) {
        clearLastOpenThread(room.roomId);
      }
      removeRecentThread(room.roomId, failedThreadId);
      if (autoRestoredThreadIdRef.current !== failedThreadId) return;

      autoRestoredThreadIdRef.current = undefined;
      navigateRoom(room.roomId, undefined, { replace: true });
    },
    [navigateRoom, room.roomId]
  );

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
            <RoomViewHeader />
            <Box grow="Yes">
              <RoomView
                room={room}
                eventId={eventId}
                focusEventInRoom={focusEvent === '1'}
                threadId={threadId}
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
            <CallChatView />
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
