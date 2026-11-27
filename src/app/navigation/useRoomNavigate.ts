import { useCallback, useMemo } from 'react';
import { NavigateOptions, useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useSelectedSpace } from './useSelectedSpace';
import { useDirectSelected } from '../routes/useDirectSelected';
import { useActivitySelected } from '../routes/useActivitySelected';
import { useThreadsSelected } from '../routes/useThreadsSelected';
import { roomToParentsAtom } from '../matrix/state/roomToParents';
import { getAncestorSpaceIds, isInSpace } from '../matrix/state/spaceAncestors';
import type { RoomToParents } from '../matrix/types/room';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { getCanonicalAliasOrRoomId, getCanonicalAliasRoomId, isRoomAlias } from '../matrix/matrix';
import {
  getActivityRoomPath,
  getDirectRoomPath,
  getHomeRoomPath,
  getSpacePath,
  getSpaceRoomPath,
  getThreadsRoomPath,
  withSearchParam,
} from '../routes/pathUtils';
import { navigateToRoomThread, type NavigateRoomThreadOptions } from './threadNavigation';
import { useRoomRouteParams } from './useRoomRouteParams';
import { isJoinedRoom } from './routeVisibility';
import { currentHistoryLocation } from '../routes/historyStack';

/**
 * Whether a room the client holds is known not to be joined: invited, left, or removed from. A
 * room it does not hold, or one that tells no membership, is not.
 */
const isKnownUnjoined = (room: ReturnType<MatrixClient['getRoom']>): boolean =>
  !!room?.getMyMembership?.() && !isJoinedRoom(room);

/**
 * The top-level space to open a room in: the first of the joined spaces above the room that no
 * other of them contains, walking up from the room. A space the account left stays in the tree
 * while the client holds it, and is never the one: its own page is its join page, which would
 * take the room's place. Falls back to the nearest joined space above the room when the tree has
 * a cycle. The chat rooms a sub-room sits under are no spaces.
 */
const getRoomTopSpace = (mx: MatrixClient, parentsByRoom: RoomToParents, roomId: string) => {
  const spaceIds = getAncestorSpaceIds(parentsByRoom, roomId).filter((id) => {
    const space = mx.getRoom(id);
    return space?.isSpaceRoom() === true && !isKnownUnjoined(space);
  });
  const topSpaceId =
    spaceIds.find((spaceId) => (parentsByRoom.get(spaceId)?.size ?? 0) === 0) ??
    spaceIds.find((spaceId) => {
      const parents = parentsByRoom.get(spaceId);
      return !parents || !spaceIds.some((other) => parents.has(other));
    });
  return topSpaceId ?? spaceIds[0];
};

/**
 * Where the route is: the space it is inside, whether it is in Direct, the list section it is in
 * (Activity or Threads, which show a room beside their list), and its room segment.
 */
type RoutePlace = {
  spaceId?: string;
  direct: boolean;
  section?: 'activity' | 'threads';
  roomSegment?: string;
};

/** Whether the route's room segment names the room, by ID or by an alias the client knows. */
const routeShowsRoom = (mx: MatrixClient, roomSegment: string | undefined, roomId: string) => {
  if (roomSegment === roomId) return true;
  return (
    !!roomSegment && isRoomAlias(roomSegment) && getCanonicalAliasRoomId(mx, roomSegment) === roomId
  );
};

const getRoomPath = (
  mx: MatrixClient,
  roomToParents: RoomToParents,
  directRooms: Set<string>,
  route: RoutePlace,
  roomId: string,
  eventId?: string
): string => {
  // A room the account is in goes by its canonical alias. One it is invited to, left or was
  // removed from keeps its room ID: its alias may no longer lead to it.
  const roomIdOrAlias = isKnownUnjoined(mx.getRoom(roomId))
    ? roomId
    : getCanonicalAliasOrRoomId(mx, roomId);
  // The room the route shows stays in the route's section: another section is another page,
  // which mounts the room view again (a phone's keyboard closes, the view starts over).
  const shown = routeShowsRoom(mx, route.roomSegment, roomId);

  if (shown && route.section) {
    return route.section === 'activity'
      ? getActivityRoomPath(roomIdOrAlias, eventId)
      : getThreadsRoomPath(roomIdOrAlias, eventId);
  }
  // A space that is not joined shows its own join page, never a room: the room goes elsewhere.
  if (
    route.spaceId &&
    !isKnownUnjoined(mx.getRoom(route.spaceId)) &&
    (shown || isInSpace(roomToParents, roomId, route.spaceId))
  ) {
    return getSpaceRoomPath(getCanonicalAliasOrRoomId(mx, route.spaceId), roomIdOrAlias, eventId);
  }
  if (shown) {
    return route.direct
      ? getDirectRoomPath(roomIdOrAlias, eventId)
      : getHomeRoomPath(roomIdOrAlias, eventId);
  }
  if (directRooms.has(roomId)) return getDirectRoomPath(roomIdOrAlias, eventId);

  const spaceId = getRoomTopSpace(mx, roomToParents, roomId);
  if (spaceId) {
    return getSpaceRoomPath(getCanonicalAliasOrRoomId(mx, spaceId), roomIdOrAlias, eventId);
  }
  return getHomeRoomPath(roomIdOrAlias, eventId);
};

/**
 * Navigation to rooms, threads and events. The room the route shows keeps its address's section.
 * Another room opens in the selected space when it is part of it, as a direct room when it is
 * one, in its space otherwise, and on Home last.
 */
export const useRoomNavigate = () => {
  // Where each room sits and which rooms are direct chats decide the section a room opens in.
  const roomToParents = useAtomValue(roomToParentsAtom);
  const directChats = useAtomValue(mDirectAtom);
  // Paths name rooms and spaces by their canonical alias when they have one.
  const client = useMatrixClient();
  const navigate = useNavigate();
  // The route's room segment, an alias unresolved: it resolves only when navigating, not in every
  // row's render.
  const { roomIdOrAlias: roomSegment } = useRoomRouteParams();
  const selectedSpaceId = useSelectedSpace();
  const inDirect = useDirectSelected();
  const inActivity = useActivitySelected();
  const inThreads = useThreadsSelected();
  let section: RoutePlace['section'];
  if (inActivity) section = 'activity';
  else if (inThreads) section = 'threads';

  /** The app path of a room, at `eventId` when given, in the section the room opens in. */
  const roomPath = useCallback(
    (roomId: string, eventId?: string) =>
      getRoomPath(
        client,
        roomToParents,
        directChats,
        { spaceId: selectedSpaceId, direct: inDirect, section, roomSegment },
        roomId,
        eventId
      ),
    [client, roomToParents, directChats, selectedSpaceId, inDirect, section, roomSegment]
  );

  /** Opens an app path as it is, such as a path recorded earlier. */
  const navigatePath = useCallback(
    (path: string, opts?: NavigateOptions) => {
      void navigate(path, opts);
    },
    [navigate]
  );

  /** Opens a room, at `eventId` when given, in the section `roomPath` picks for it. */
  const navigateRoom = useCallback(
    (roomId: string, eventId?: string, opts?: NavigateOptions): void => {
      void navigate(roomPath(roomId, eventId), opts);
    },
    [navigate, roomPath]
  );

  /** Opens a space's own page, addressed by its canonical alias when it has one. */
  const navigateSpace = useCallback(
    (spaceId: string, opts?: NavigateOptions) => {
      void navigate(getSpacePath(getCanonicalAliasOrRoomId(client, spaceId)), opts);
    },
    [client, navigate]
  );

  /** Opens the room focused on `eventId`, without opening its thread. */
  const navigateRoomFocusEvent = useCallback(
    (roomId: string, eventId: string, opts?: NavigateOptions) => {
      void navigate(withSearchParam(roomPath(roomId, eventId), { focusEvent: '1' }), opts);
    },
    [navigate, roomPath]
  );

  /** Opens a thread without recording where to return to. */
  const navigateRoomThreadDirect = useCallback(
    (roomId: string, threadId: string, eventId?: string, opts?: NavigateOptions) => {
      void navigate(withSearchParam(roomPath(roomId, eventId), { threadId }), opts);
    },
    [navigate, roomPath]
  );

  /**
   * Opens a thread and records the current page as the one it was opened from: its back button
   * steps back there when that page is the thread's room.
   */
  const navigateRoomThread = useCallback(
    (roomId: string, threadId: string, eventId?: string, opts?: NavigateRoomThreadOptions) =>
      navigateToRoomThread({
        navigateRoomThreadDirect,
        roomId,
        threadId,
        eventId,
        opts,
        location: currentHistoryLocation(),
      }),
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
      roomPath,
    }),
    [
      navigatePath,
      navigateRoom,
      navigateRoomFocusEvent,
      navigateRoomThread,
      navigateRoomThreadDirect,
      navigateSpace,
      roomPath,
    ]
  );
};
