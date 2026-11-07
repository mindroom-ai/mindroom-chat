import { useCallback, useMemo } from 'react';
import { NavigateOptions, useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useSelectedSpace } from './useSelectedSpace';
import { roomToParentsAtom } from '../matrix/state/roomToParents';
import { getAncestorSpaceIds, isInSpace } from '../matrix/state/spaceAncestors';
import type { RoomToParents } from '../matrix/types/room';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { getCanonicalAliasOrRoomId } from '../matrix/matrix';
import {
  getDirectRoomPath,
  getHomeRoomPath,
  getSpacePath,
  getSpaceRoomPath,
  withSearchParam,
} from '../routes/pathUtils';
import { navigateToRoomThread } from './threadNavigation';

/**
 * The top-level space to open a room in: the first root space found walking up from the room,
 * where a root space is one no other space contains. Falls back to the nearest space above the
 * room when the tree has a cycle. The chat rooms a sub-room sits under are no spaces.
 */
const getRoomTopSpace = (mx: MatrixClient, parentsByRoom: RoomToParents, roomId: string) => {
  const spaceIds = getAncestorSpaceIds(parentsByRoom, roomId).filter(
    (id) => mx.getRoom(id)?.isSpaceRoom() === true
  );
  return spaceIds.find((spaceId) => (parentsByRoom.get(spaceId)?.size ?? 0) === 0) ?? spaceIds[0];
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

  if (selectedSpaceId && isInSpace(roomToParents, roomId, selectedSpaceId)) {
    return getSpaceRoomPath(getCanonicalAliasOrRoomId(mx, selectedSpaceId), roomIdOrAlias, eventId);
  }
  if (directRooms.has(roomId)) return getDirectRoomPath(roomIdOrAlias, eventId);

  const spaceId = getRoomTopSpace(mx, roomToParents, roomId);
  if (spaceId) {
    return getSpaceRoomPath(getCanonicalAliasOrRoomId(mx, spaceId), roomIdOrAlias, eventId);
  }
  return getHomeRoomPath(roomIdOrAlias, eventId);
};

/**
 * Navigation to rooms, threads and events. A room opens in the selected space when it is part
 * of it, as a direct room when it is one, in its space otherwise, and on Home last.
 */
export const useRoomNavigate = () => {
  // Where each room sits and which rooms are direct chats decide the section a room opens in.
  const roomToParents = useAtomValue(roomToParentsAtom);
  const directChats = useAtomValue(mDirectAtom);
  // Paths name rooms and spaces by their canonical alias when they have one.
  const client = useMatrixClient();
  const navigate = useNavigate();
  const selectedSpaceId = useSelectedSpace();

  const roomPath = useCallback(
    (roomId: string, eventId?: string) =>
      getRoomPath(client, roomToParents, directChats, selectedSpaceId, roomId, eventId),
    [client, roomToParents, directChats, selectedSpaceId]
  );

  /** Opens an app path as it is, such as a path recorded earlier. */
  const navigatePath = useCallback(
    (path: string, opts?: NavigateOptions) => {
      navigate(path, opts);
    },
    [navigate]
  );

  /** Opens a room, at `eventId` when given, in the section `roomPath` picks for it. */
  const navigateRoom = useCallback(
    (roomId: string, eventId?: string, opts?: NavigateOptions): void => {
      navigate(roomPath(roomId, eventId), opts);
    },
    [navigate, roomPath]
  );

  /** Opens a space's own page, addressed by its canonical alias when it has one. */
  const navigateSpace = useCallback(
    (spaceId: string, opts?: NavigateOptions) => {
      navigate(getSpacePath(getCanonicalAliasOrRoomId(client, spaceId)), opts);
    },
    [client, navigate]
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
    (roomId: string, threadId: string, eventId?: string, opts?: NavigateOptions) =>
      navigateToRoomThread({ navigateRoomThreadDirect, roomId, threadId, eventId, opts }),
    [navigateRoomThreadDirect]
  );

  return useMemo(
    () => ({
      navigatePath,
      navigateRoom,
      navigateRoomFocusEvent,
      navigateRoomThread,
      navigateRoomThreadDirect,
      navigateSpace,
    }),
    [
      navigatePath,
      navigateRoom,
      navigateRoomFocusEvent,
      navigateRoomThread,
      navigateRoomThreadDirect,
      navigateSpace,
    ]
  );
};
