import React, { ReactNode } from 'react';
import { Box, Spinner } from 'folds';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useResolvedRoomIdOrAlias } from '../../hooks/router/useResolvedRoomIdOrAlias';
import { IsDirectRoomProvider, RoomProvider } from '../../hooks/useRoom';
import { mDirectAtom } from '../../state/mDirectList';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { JoinBeforeNavigate } from '../../features/join-before-navigate/JoinBeforeNavigate';
import { getRoomSearchParams } from '../pathSearchParam';
import { decodeRouteParam, getSpacePath } from '../pathUtils';
import { useClientStartupContext } from './ClientStartupContext';
import { canRenderRoutedRoom, shouldDeferRoomRouteFallback } from './routeVisibility';

/** Shown while a room or space alias in the URL resolves to its room ID. */
export function RouteResolving() {
  return (
    <Box grow="Yes" alignItems="Center" justifyContent="Center">
      <Spinner variant="Secondary" size="400" />
    </Box>
  );
}

/**
 * A room route: `children` (the room) inside the room's providers when joined, otherwise its
 * summary with a way to join. The joined rooms list re-renders the route when a join lands, so
 * the room opens without another click.
 */
export function RoomRoute({ children }: { children: ReactNode }) {
  const mx = useMatrixClient();
  const { roomIdOrAlias: encoded, eventId } = useParams();
  const [searchParams] = useSearchParams();
  const { viaServers, threadId } = getRoomSearchParams(searchParams);
  const roomIdOrAlias = encoded ? decodeRouteParam(encoded) : '';
  const { roomId, isResolvingAlias } = useResolvedRoomIdOrAlias(roomIdOrAlias);
  const { hasCompletedInitialSync } = useClientStartupContext();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const directs = useAtomValue(mDirectAtom);
  const room = mx.getRoom(roomId ?? '');

  // An alias the client does not know yet resolves through the server first, and before the
  // first sync a room missing from the cache may still turn out to be joined.
  if (
    shouldDeferRoomRouteFallback({
      hasCompletedInitialSync,
      isResolvingAlias,
      room,
      routedRoomIds: joinedRoomIds,
    })
  ) {
    return <RouteResolving />;
  }

  if (!room || !canRenderRoutedRoom(room, joinedRoomIds)) {
    return (
      <JoinBeforeNavigate
        key={roomIdOrAlias}
        roomIdOrAlias={roomIdOrAlias}
        eventId={eventId ? decodeRouteParam(eventId) : undefined}
        viaServers={viaServers?.split(',').filter(Boolean)}
        threadId={threadId}
      />
    );
  }

  // A joined space opened by a room address (a link, Join with Address) shows as a space.
  if (room.isSpaceRoom()) return <Navigate to={getSpacePath(roomIdOrAlias)} replace />;
  const isDirect = directs.has(room.roomId);
  return (
    <RoomProvider value={room}>
      <IsDirectRoomProvider value={isDirect}>{children}</IsDirectRoomProvider>
    </RoomProvider>
  );
}
