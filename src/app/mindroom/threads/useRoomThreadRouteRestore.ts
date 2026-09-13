import { useCallback, useEffect, useRef } from 'react';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { removeRecentThread } from '../recent-threads/recentThreads';
import { clearLastOpenThread, getLastOpenThread, setLastOpenThread } from './lastOpenThread';

type UseRoomThreadRouteRestoreOptions = {
  eventId?: string;
  roomId: string;
  threadId?: string;
};

export const useRoomThreadRouteRestore = ({
  eventId,
  roomId,
  threadId,
}: UseRoomThreadRouteRestoreOptions): ((failedThreadId: string) => void) => {
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const previousRoomIdRef = useRef(roomId);
  const previousThreadIdRef = useRef<string | undefined>(threadId);
  const attemptedRestoreRef = useRef<string>();
  const autoRestoredThreadIdRef = useRef<string>();

  useEffect(() => {
    if (!threadId) return;
    setLastOpenThread(roomId, threadId);
  }, [roomId, threadId]);

  useEffect(() => {
    const previousRoomId = previousRoomIdRef.current;
    const previousThreadId = previousThreadIdRef.current;

    if (previousRoomId === roomId && previousThreadId && !threadId) {
      clearLastOpenThread(roomId);
      if (autoRestoredThreadIdRef.current === previousThreadId) {
        autoRestoredThreadIdRef.current = undefined;
      }
    }

    previousRoomIdRef.current = roomId;
    previousThreadIdRef.current = threadId;
  }, [roomId, threadId]);

  useEffect(() => {
    if (threadId || eventId) return;

    const savedThreadId = getLastOpenThread(roomId);
    if (!savedThreadId) return;

    const restoreKey = `${roomId}|${savedThreadId}`;
    if (attemptedRestoreRef.current === restoreKey) return;

    attemptedRestoreRef.current = restoreKey;
    autoRestoredThreadIdRef.current = savedThreadId;
    navigateRoomThread(roomId, savedThreadId, undefined, { replace: true });
  }, [eventId, navigateRoomThread, roomId, threadId]);

  return useCallback(
    (failedThreadId: string) => {
      if (getLastOpenThread(roomId) === failedThreadId) {
        clearLastOpenThread(roomId);
      }
      removeRecentThread(roomId, failedThreadId);
      if (autoRestoredThreadIdRef.current !== failedThreadId) return;

      autoRestoredThreadIdRef.current = undefined;
      navigateRoom(roomId, undefined, { replace: true });
    },
    [navigateRoom, roomId]
  );
};
