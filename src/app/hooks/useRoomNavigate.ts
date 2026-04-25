import { useCallback } from 'react';
import { type NavigateOptions, useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { getCanonicalAliasOrRoomId } from '../utils/matrix';
import {
  getDirectRoomPath,
  getHomeRoomPath,
  getSpacePath,
  getSpaceRoomPath,
  withSearchParam,
} from '../pages/pathUtils';
import { useMatrixClient } from './useMatrixClient';
import { getOrphanParents, guessPerfectParent } from '../utils/room';
import { roomToParentsAtom } from '../state/room/roomToParents';
import { mDirectAtom } from '../state/mDirectList';
import { useSelectedSpace } from './router/useSelectedSpace';
import { settingsAtom } from '../state/settings';
import { useSetting } from '../state/hooks/settings';
import { _RoomSearchParams } from '../pages/paths';
import { navigateMindroomRoomThread } from '../mindroom/threads/threadNavigation';

export const useRoomNavigate = () => {
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const roomToParents = useAtomValue(roomToParentsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const spaceSelectedId = useSelectedSpace();
  const [developerTools] = useSetting(settingsAtom, 'developerTools');

  const navigateSpace = useCallback(
    (roomId: string) => {
      const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, roomId);
      navigate(getSpacePath(roomIdOrAlias));
    },
    [mx, navigate]
  );

  const getRoomPath = useCallback(
    (roomId: string, eventId?: string) => {
      const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, roomId);
      const openSpaceTimeline = developerTools && spaceSelectedId === roomId;

      const orphanParents = openSpaceTimeline ? [roomId] : getOrphanParents(roomToParents, roomId);
      if (orphanParents.length > 0) {
        let parentSpace: string;
        if (spaceSelectedId && orphanParents.includes(spaceSelectedId)) {
          parentSpace = spaceSelectedId;
        } else {
          parentSpace = guessPerfectParent(mx, roomId, orphanParents) ?? orphanParents[0];
        }

        const pSpaceIdOrAlias = getCanonicalAliasOrRoomId(mx, parentSpace);

        return getSpaceRoomPath(
          pSpaceIdOrAlias,
          openSpaceTimeline ? roomId : roomIdOrAlias,
          eventId
        );
      }

      if (mDirects.has(roomId)) {
        return getDirectRoomPath(roomIdOrAlias, eventId);
      }

      return getHomeRoomPath(roomIdOrAlias, eventId);
    },
    [mx, spaceSelectedId, roomToParents, mDirects, developerTools]
  );

  const navigateRoom = useCallback(
    (roomId: string, eventId?: string, opts?: NavigateOptions) => {
      navigate(getRoomPath(roomId, eventId), opts);
    },
    [navigate, getRoomPath]
  );

  const navigateRoomFocusEvent = useCallback(
    (roomId: string, eventId: string, opts?: NavigateOptions) => {
      const roomPath = getRoomPath(roomId, eventId);
      navigate(withSearchParam<_RoomSearchParams>(roomPath, { focusEvent: '1' }), opts);
    },
    [navigate, getRoomPath]
  );

  const navigateRoomThreadDirect = useCallback(
    (roomId: string, threadId: string, eventId?: string, opts?: NavigateOptions) => {
      const roomPath = getRoomPath(roomId, eventId);
      navigate(withSearchParam<_RoomSearchParams>(roomPath, { threadId }), opts);
    },
    [navigate, getRoomPath]
  );

  const navigatePath = useCallback(
    (path: string, opts?: NavigateOptions) => {
      navigate(path, opts);
    },
    [navigate]
  );

  const navigateRoomThread = useCallback(
    (roomId: string, threadId: string, eventId?: string, opts?: NavigateOptions) => {
      navigateMindroomRoomThread({
        roomId,
        threadId,
        eventId,
        opts,
        navigateRoomThreadDirect,
      });
    },
    [navigateRoomThreadDirect]
  );

  return {
    navigateSpace,
    navigateRoom,
    navigateRoomFocusEvent,
    navigatePath,
    navigateRoomThreadDirect,
    navigateRoomThread,
  };
};
