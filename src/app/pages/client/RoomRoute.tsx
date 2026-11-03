import React, { ReactNode } from 'react';
import { Box, Spinner } from 'folds';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useResolvedRoomIdOrAlias } from '../../hooks/router/useResolvedRoomIdOrAlias';
import { IsDirectRoomProvider, RoomProvider } from '../../hooks/useRoom';
import { mDirectAtom } from '../../state/mDirectList';
import { JoinBeforeNavigate } from '../../features/join-before-navigate/JoinBeforeNavigate';
import { getRoomSearchParams } from '../pathSearchParam';
import { KnownMembership } from 'matrix-js-sdk';

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
 * summary with a way to join.
 */
export function RoomRoute({ children }: { children: ReactNode }) {
  const mx = useMatrixClient();
  const { roomIdOrAlias: encoded, eventId } = useParams();
  const [searchParams] = useSearchParams();
  const { viaServers } = getRoomSearchParams(searchParams);
  const roomIdOrAlias = encoded ? decodeURIComponent(encoded) : '';
  const { roomId, isResolvingAlias } = useResolvedRoomIdOrAlias(roomIdOrAlias);
  const directs = useAtomValue(mDirectAtom);
  const room = mx.getRoom(roomId ?? '');

  // An alias the client does not know yet resolves through the server first.
  if (isResolvingAlias) return <RouteResolving />;

  if (!room || room.getMyMembership() !== KnownMembership.Join) {
    return (
      <JoinBeforeNavigate
        key={roomIdOrAlias}
        roomIdOrAlias={roomIdOrAlias}
        eventId={eventId ? decodeURIComponent(eventId) : undefined}
        viaServers={viaServers?.split(',').filter(Boolean)}
      />
    );
  }

  return (
    <RoomProvider key={room.roomId} value={room}>
      <IsDirectRoomProvider value={directs.has(room.roomId)}>{children}</IsDirectRoomProvider>
    </RoomProvider>
  );
}
