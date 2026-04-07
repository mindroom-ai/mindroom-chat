import { useCallback } from 'react';
import { NavigateOptions, useNavigate } from 'react-router-dom';
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
import { useClientConfig } from './useClientConfig';
import { appUrl } from '../utils/basePath';

export const useRoomNavigate = () => {
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const roomToParents = useAtomValue(roomToParentsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const spaceSelectedId = useSelectedSpace();
  const [developerTools] = useSetting(settingsAtom, 'developerTools');
  const { hashRouter } = useClientConfig();

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

  const navigateRoomThread = useCallback(
    (roomId: string, threadId: string, eventId?: string, opts?: NavigateOptions) => {
      if (!opts?.replace) {
        // Only pre-seed when navigating from a room timeline, not from another thread.
        // Thread views have threadId in the URL — check both search and hash to cover
        // browser-router and hash-router modes respectively.
        const alreadyInThread =
          window.location.search.includes('threadId=') ||
          window.location.hash.includes('threadId=');
        if (!alreadyInThread) {
          // Rewrite the current room entry synchronously before pushing the thread URL.
          // Build a full browser URL that respects hash-router mode and base path.
          const focusedRoomPath = withSearchParam<_RoomSearchParams>(getRoomPath(roomId, threadId), {
            focusEvent: '1',
          });
          const replaceUrl = hashRouter?.enabled
            ? `#${appUrl(focusedRoomPath, hashRouter.basename ?? '/')}`
            : appUrl(focusedRoomPath);
          window.history.replaceState(window.history.state, '', replaceUrl);
        }
      }

      const roomPath = getRoomPath(roomId, eventId);
      navigate(withSearchParam<_RoomSearchParams>(roomPath, { threadId }), opts);
    },
    [navigate, getRoomPath, hashRouter]
  );

  return {
    navigateSpace,
    navigateRoom,
    navigateRoomFocusEvent,
    navigateRoomThread,
  };
};
