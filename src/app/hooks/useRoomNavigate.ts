import { useCallback, useMemo } from 'react';
import { NavigateOptions, useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';
import { useSelectedSpace } from './router/useSelectedSpace';
import { roomToParentsAtom } from '../state/room/roomToParents';
import { mDirectAtom } from '../state/mDirectList';
import { getCanonicalAliasOrRoomId } from '../utils/matrix';
import {
  getDirectRoomPath,
  getHomeRoomPath,
  getSpaceRoomPath,
  withSearchParam,
} from '../pages/pathUtils';
import { navigateMindroomRoomThread } from '../mindroom/threads/threadNavigation';

type RoomToParents = Map<string, Set<string>>;

/** Whether `roomId` sits anywhere below `spaceId` in the space tree. */
const isInsideSpace = (roomToParents: RoomToParents, roomId: string, spaceId: string): boolean => {
  const seen = new Set<string>();
  const queue = [roomId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const parents = roomToParents.get(id);
    if (parents?.has(spaceId)) return true;
    parents?.forEach((parentId) => {
      if (seen.has(parentId)) return;
      seen.add(parentId);
      queue.push(parentId);
    });
  }
  return false;
};

/**
 * The top-level space to open a room in: the first root space found walking up from the room,
 * where a root space is one no other space contains. Falls back to the room's first parent when
 * the tree has a cycle.
 */
const getRoomTopSpace = (roomToParents: RoomToParents, roomId: string): string | undefined => {
  const directParents = roomToParents.get(roomId);
  if (!directParents || directParents.size === 0) return undefined;
  const seen = new Set<string>([roomId]);
  const queue = Array.from(directParents);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const parents = roomToParents.get(id);
    if (!parents || parents.size === 0) return id;
    parents.forEach((parentId) => queue.push(parentId));
  }
  return directParents.values().next().value;
};

const getRoomPath = (
  mx: MatrixClient,
  roomToParents: RoomToParents,
  directRooms: Set<string>,
  selectedSpaceId: string | undefined,
  roomId: string,
  eventId?: string
): string => {
  const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, roomId);

  if (selectedSpaceId && isInsideSpace(roomToParents, roomId, selectedSpaceId)) {
    return getSpaceRoomPath(getCanonicalAliasOrRoomId(mx, selectedSpaceId), roomIdOrAlias, eventId);
  }
  if (directRooms.has(roomId)) return getDirectRoomPath(roomIdOrAlias, eventId);

  const spaceId = getRoomTopSpace(roomToParents, roomId);
  if (spaceId) {
    return getSpaceRoomPath(getCanonicalAliasOrRoomId(mx, spaceId), roomIdOrAlias, eventId);
  }
  return getHomeRoomPath(roomIdOrAlias, eventId);
};

/**
 * Navigation to rooms, threads and events. A room opens in the selected space when it is part
 * of it, as a direct room when it is one, in its space otherwise, and on Home last.
 */





  const selectedSpaceId = useSelectedSpace();

  const roomPath = useCallback(
    (roomId: string, eventId?: string) =>
      getRoomPath(mx, roomToParents, directRooms, selectedSpaceId, roomId, eventId),
    [mx, roomToParents, directRooms, selectedSpaceId]
  );

  /** Opens an app path as it is, such as a path recorded earlier. */
  const navigatePath = useCallback(
    (path: string, opts?: NavigateOptions) => {
      navigate(path, opts);
    },
    [navigate]
  );

  const navigateSpace = useCallback(
    (spaceId: string, opts?: NavigateOptions) => {








    },
    [navigate, roomPath]
  );

  /** Opens the room focused on `eventId`, without opening its thread. */
  const navigateRoomFocusEvent = useCallback(
    (roomId: string, eventId: string, opts?: NavigateOptions) => {
      navigate(withSearchParam(roomPath(roomId, eventId), { focusEvent: '1' }), opts);
    },
    [navigate, roomPath]
  );

  /** Opens a thread without recording where to return to. */
  const navigateRoomThreadDirect = useCallback(
    (roomId: string, threadId: string, eventId?: string, opts?: NavigateOptions) => {
      navigate(withSearchParam(roomPath(roomId, eventId), { threadId }), opts);
    },
    [navigate, roomPath]
  );

  /** Opens a thread and records the current page as the place its back button returns to. */
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

  return useMemo(
    () => ({
      navigatePath,
      navigateSpace,
      navigateRoom,
      navigateRoomFocusEvent,
      navigateRoomThread,
      navigateRoomThreadDirect,
    }),
    [
      navigatePath,
      navigateSpace,
      navigateRoom,
      navigateRoomFocusEvent,
      navigateRoomThread,
      navigateRoomThreadDirect,
    ]
  );
};
